// Identification d'un festivalier au guichet (mission 10a, WP05 ; FR-001 à FR-003, FR-006, C-005, C-006).
// L'écriture passe uniquement par `create_kyc_verification` (WP01). L'agent est la personne authentifiée, jamais une
// valeur du corps. La base ne contrôle pas le rôle : ce service exige `CASHIER` ou `ORGANIZER_ADMIN` sur la chaîne de
// l'événement du portefeuille (ou, avec `customer_id`, d'au moins un portefeuille du client), sinon 403, rien d'écrit.
// Limite C-005 : l'agent titulaire est refusé par la base (égalité de numéro) ; l'API ne refait pas ce contrôle.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { exercisedRole, resolveChain } from '../identity/scope-resolver';
import type { Role } from '../identity/principal';
import type { TenantActor } from '../organization/tenant/tenant-access';
import { invalid, isUuid, notFound, objectBody } from '../organization/platform/platform.dto';

/** Rôles du guichet (`CASHIER` ou `ORGANIZER_ADMIN`). */
export const KYC_DESK_ROLES: readonly Role[] = ['CASHIER', 'ORGANIZER_ADMIN'];

const ID_TYPES = ['NATIONAL_ID', 'PASSPORT', 'RESIDENCE_PERMIT', 'DRIVING_LICENCE', 'OTHER'];
const FIELDS = ['wallet_id', 'customer_id', 'id_type', 'id_country', 'id_last4', 'id_expires_on'];

export interface KycVerificationCreate {
  wallet_id?: string;
  customer_id?: string;
  id_type: string;
  id_country: string;
  id_last4: string;
  id_expires_on: string;
}

export interface KycVerification {
  kyc_verification_id: string;
  customer_id: string;
  wallet_id: string | null;
  method: 'DESK' | 'ONLINE';
  agent_id: string;
  id_type: string;
  id_country: string;
  id_last4: string;
  id_expires_on: string;
  status: 'VERIFIED' | 'REVOKED';
  verified_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
}

interface KycRow {
  id: string;
  customer_id: string;
  wallet_id: string | null;
  method: 'DESK' | 'ONLINE';
  agent_id: string;
  id_type: string;
  id_country: string;
  id_last4: string;
  id_expires_on: string;
  status: 'VERIFIED' | 'REVOKED';
  verified_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoked_reason: string | null;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Valide le corps : champ inconnu, type, motif ou date mal formés : 400. L'agent n'y figure jamais. */
export function parseKycVerificationCreate(raw: unknown): KycVerificationCreate {
  const body = objectBody(raw);
  for (const key of Object.keys(body)) {
    if (!FIELDS.includes(key)) throw invalid(`Champ inconnu : ${key}.`);
  }
  const hasWallet = body.wallet_id !== undefined;
  const hasCustomer = body.customer_id !== undefined;
  if (hasWallet === hasCustomer) throw invalid('Un seul de wallet_id ou customer_id est attendu.');
  if (hasWallet && !isUuid(body.wallet_id)) throw invalid('wallet_id : identifiant attendu.');
  if (hasCustomer && !isUuid(body.customer_id)) throw invalid('customer_id : identifiant attendu.');
  const { id_type, id_country, id_last4, id_expires_on } = body;
  if (typeof id_type !== 'string' || !ID_TYPES.includes(id_type))
    throw invalid('id_type : valeur inconnue.');
  if (typeof id_country !== 'string' || !/^[A-Z]{2}$/.test(id_country))
    throw invalid('id_country : code pays sur deux lettres majuscules.');
  if (typeof id_last4 !== 'string' || !/^[0-9A-Z]{1,4}$/.test(id_last4))
    throw invalid('id_last4 : un à quatre caractères, chiffres ou majuscules.');
  if (typeof id_expires_on !== 'string' || !isCalendarDate(id_expires_on))
    throw invalid('id_expires_on : date AAAA-MM-JJ attendue.');
  return {
    ...(hasWallet ? { wallet_id: body.wallet_id as string } : {}),
    ...(hasCustomer ? { customer_id: body.customer_id as string } : {}),
    id_type,
    id_country,
    id_last4,
    id_expires_on,
  };
}

@Injectable()
export class KycService {
  constructor(private readonly audit: AuditService) {}

  /** Identification, dans la transaction idempotente et cloisonnée de l'appelant. */
  async create(client: TxClient, actor: TenantActor, raw: unknown): Promise<KycVerification> {
    const input = parseKycVerificationCreate(raw);
    let role: Role | undefined;
    if (input.wallet_id) {
      // Portefeuille inconnu (RLS comprise) ou sans grand livre d'événement : 404.
      const found = await client.query<{ event_id: string }>(
        `SELECT l.scope_id AS event_id
           FROM wallet w JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT'
          WHERE w.id = $1`,
        [input.wallet_id],
      );
      if (!found.rows[0]) throw notFound();
      role = await this.deskRole(client, actor, [found.rows[0].event_id]);
    } else {
      const customer = await client.query(
        "SELECT 1 FROM party WHERE id = $1 AND kind = 'CUSTOMER'",
        [input.customer_id],
      );
      if (!customer.rows[0]) throw notFound();
      const events = await client.query<{ event_id: string }>(
        `SELECT DISTINCT l.scope_id AS event_id
           FROM wallet w JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT'
          WHERE w.customer_id = $1`,
        [input.customer_id],
      );
      role = await this.deskRole(
        client,
        actor,
        events.rows.map((e) => e.event_id),
      );
    }
    // Aucun rôle exercé sur une portée du festivalier : refus avant toute écriture.
    if (!role) throw new ProblemException('FORBIDDEN');
    // L'agent est la personne authentifiée ; la base refuse l'agent titulaire du compte (CL061).
    const written = await client.query<KycRow>(
      `SELECT k.id, k.customer_id, k.wallet_id, k.method, k.agent_id, k.id_type, k.id_country,
              k.id_last4, k.id_expires_on::text AS id_expires_on, k.status, k.verified_at,
              k.revoked_at, k.revoked_by, k.revoked_reason
         FROM create_kyc_verification($1::uuid, $2::uuid, $3, $4, $5, $6::date, $7) k`,
      [
        input.wallet_id ?? null,
        input.customer_id ?? null,
        input.id_type,
        input.id_country,
        input.id_last4,
        input.id_expires_on,
        actor.principal.userId,
      ],
    );
    const row = written.rows[0]!;
    // `id_last4` est admis dans l'audit (même donnée que la table), jamais dans les journaux ni un numéro de téléphone.
    await this.audit.record(client, {
      ...actor.audit,
      actorRole: role,
      operatorId: actor.operatorId,
      action: 'KYC_VERIFIED',
      objectType: 'kyc_verification',
      objectId: row.id,
      after: {
        wallet_id: row.wallet_id,
        customer_id: row.customer_id,
        id_type: row.id_type,
        id_country: row.id_country.trim(),
        id_last4: row.id_last4,
        id_expires_on: row.id_expires_on,
        method: row.method,
      },
    });
    return toKycVerification(row);
  }

  /** Rôle du guichet exercé sur la chaîne d'au moins un des événements ; `undefined` si aucun. */
  private async deskRole(
    client: TxClient,
    actor: TenantActor,
    eventIds: string[],
  ): Promise<Role | undefined> {
    for (const id of eventIds) {
      const chain = await resolveChain(client, { type: 'EVENT', id });
      const role = exercisedRole(actor.principal, KYC_DESK_ROLES, chain);
      if (role) return role;
    }
    return undefined;
  }
}

export function toKycVerification(row: KycRow): KycVerification {
  return {
    kyc_verification_id: row.id,
    customer_id: row.customer_id,
    wallet_id: row.wallet_id,
    method: row.method,
    agent_id: row.agent_id,
    id_type: row.id_type,
    id_country: row.id_country.trim(),
    id_last4: row.id_last4,
    id_expires_on: row.id_expires_on,
    status: row.status,
    verified_at: row.verified_at.toISOString(),
    revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
    revoked_by: row.revoked_by,
    revoked_reason: row.revoked_reason,
  };
}
