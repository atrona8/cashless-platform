// Action à deux personnes `PAYOUT` : lot de versements (mission 9b, lot WP08, T036 ; FR-009,
// FR-010, NFR-001 ;
// ADR-74). Une PERSONNE du back-office prépare le lot (demande `202`, rien d'écrit), une AUTRE le
// valide ; à la
// validation, `create_payout_batch` relit le droit net SOUS VERROU, le borne (CL055), écrit
// `PAYOUT_INITIATED` et les
// lignes `payout`. L'API ne verse rien (C-003) : paiement hors système, puis `confirmPayout`.
//
// Rôle selon le bénéficiaire (décision du porteur, contradiction 1 ; SPECIFICATION §3.2 amendée par
// WP14) :
// `ORGANIZER_ADMIN` pour `MERCHANT` et `ORGANIZER`, `OPERATOR_ADMIN` pour `OPERATOR` et `PLATFORM`.
// Le registre ne
// connaît qu'une liste de rôles (l'un quelconque) : l'auteur ET le valideur doivent tenir le rôle
// de CHAQUE classe
// présente dans le lot (contrôle ici, à la demande puis à l'exécution). Un lot qui mêle les deux
// classes exige donc
// les deux rôles. Le bénéficiaire `LEGAL` (compte sans titulaire) n'est pas exprimable : aucun rôle
// n'est décidé.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import { isValidIban, maskIban, normalizeIban } from '../common/iban';
import { IbanVault } from '../common/iban-vault';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { Principal } from '../identity/principal';
import type { StaffRole } from '../identity/roles.decorator';
import {
  exercisedRole,
  resolveChain,
  type ScopeLink,
  type ScopeRef,
} from '../identity/scope-resolver';
import { isUuid, notFound, unprocessable } from '../organization/platform/platform.dto';
import { EntitlementService, PAYEE_KINDS, type PayeeKind } from './entitlements';

/**
 * Rôle exigé selon la nature du bénéficiaire (liste figée par un test : tout ajout ou retrait le
 * fait échouer). */
export const PAYOUT_ROLES_BY_BENEFICIARY: Readonly<Record<PayeeKind, StaffRole>> = Object.freeze({
  MERCHANT: 'ORGANIZER_ADMIN',
  ORGANIZER: 'ORGANIZER_ADMIN',
  OPERATOR: 'OPERATOR_ADMIN',
  PLATFORM: 'OPERATOR_ADMIN',
});

/**
 * Rôles admis par le registre (union des classes) ; le contrôle par bénéficiaire s'ajoute (voir ci-
 * dessus). */
export const PAYOUT_ROLES: readonly StaffRole[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];

export const PAYOUT_METHODS = ['WAVE', 'ORANGE_MONEY', 'BANK_TRANSFER'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
/** Forme d'enveloppe du coffre (`IbanVault.isSealed`) ; l'ouverture se fait à l'exécution. */
const SEALED_IBAN = /^enc:v1:/;
const MSISDN = /^\+[1-9][0-9]{6,14}$/;

export interface PayoutLinePayload {
  beneficiary_party_id: string;
  beneficiary_kind: PayeeKind;
  /** Participation du commerçant dans l'événement du grand livre (nature `MERCHANT` seulement). */
  participation_id?: string;
  amount: number;
  method: PayoutMethod;
  msisdn?: string;
  /**
   * Enveloppe `enc:v1:…` de l'IBAN normalisé (OP-N140) : jamais le clair, ni en base ni dans la
   * demande. Chiffré une seule fois, à la demande.
   */
  iban?: string;
  /** Masque de l'IBAN (`SN08************3035`), calculé sur le clair avant le chiffrement. */
  iban_mask?: string;
}

/** Charge figée de la demande. Le prestataire n'y figure pas : il vient de la demande. */
export interface PayoutBatchPayload {
  ledger_id: string;
  /**
   * Portée figée à la demande, lue en base : l'événement du grand livre, l'organisateur, ou le
   * prestataire. */
  scope_type: 'EVENT' | 'ORGANIZER' | 'OPERATOR';
  scope_id: string;
  lines: PayoutLinePayload[];
}

const FIELDS = new Set(['ledger_id', 'scope_type', 'scope_id', 'lines']);
const LINE_FIELDS = new Set([
  'beneficiary_party_id',
  'beneficiary_kind',
  'participation_id',
  'amount',
  'method',
  'msisdn',
  'iban',
  'iban_mask',
]);

/** Ligne d'un corps de demande (contrat `PayoutLine`), avant résolution du bénéficiaire. */
export interface BatchLineInput {
  beneficiaryPartyId: string;
  amount: number;
  currency: string;
  method: string;
  msisdn?: string;
  iban?: string;
}

export interface LedgerRow {
  id: string;
  operator_id: string;
  scope_type: 'EVENT' | 'ORGANIZER' | 'OPERATOR_BILLING';
  scope_id: string;
  currency: string;
  status: 'OPEN' | 'CLOSING' | 'LOCKED';
}

export async function readLedger(client: TxClient, id: string): Promise<LedgerRow> {
  if (!isUuid(id)) throw notFound();
  const { rows } = await client.query<LedgerRow>(
    `SELECT id, operator_id, scope_type, scope_id, trim(currency) AS currency, status
       FROM ledger WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

/**
 * Portée de rôle d'un grand livre : l'événement, l'organisateur, ou le prestataire (facturation).
 * */
export function ledgerScope(ledger: Pick<LedgerRow, 'scope_type' | 'scope_id'>): {
  type: PayoutBatchPayload['scope_type'];
  id: string;
} {
  const type = ledger.scope_type === 'OPERATOR_BILLING' ? 'OPERATOR' : ledger.scope_type;
  return { type, id: ledger.scope_id };
}

/**
 * Premier rôle manquant parmi ceux que les natures de bénéficiaire exigent (undefined : tous
 * tenus). Les attributions
 * sont celles de la personne ; la portée est la chaîne du grand livre.
 */
export function missingRole(
  principal: Pick<Principal, 'assignments'>,
  kinds: Iterable<PayeeKind>,
  chain: readonly ScopeLink[],
): StaffRole | undefined {
  const needed = new Set([...kinds].map((kind) => PAYOUT_ROLES_BY_BENEFICIARY[kind]));
  for (const role of needed) {
    if (!exercisedRole(principal as Principal, [role], chain)) return role;
  }
  return undefined;
}

/** Attributions ACTIVES d'une personne, lues en base (même source que `identify_person`). */
export async function readAssignments(
  client: TxClient,
  userId: string,
): Promise<Pick<Principal, 'assignments'>> {
  const { rows } = await client.query<{
    role: Principal['assignments'][number]['role'];
    scope_type: Principal['assignments'][number]['scopeType'];
    scope_id: string | null;
  }>(
    `SELECT ra.role, ra.scope_type, ra.scope_id
       FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id
      WHERE ra.user_id = $1 AND ra.revoked_at IS NULL AND u.status = 'ACTIVE'`,
    [userId],
  );
  return {
    assignments: rows.map((r) => ({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id })),
  };
}

/** Refus de l'exécution : la demande passe FAILED avec ce motif lisible ; rien n'est écrit. */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL055: 'Montant supérieur au droit net disponible d’un bénéficiaire.',
  CL003: 'Grand livre verrouillé : versement impossible.',
  CL004: 'Événement en clôture : versement impossible.',
  CL005: 'Période close : versement impossible.',
  CL001: 'Lot de versements invalide pour ce grand livre.',
  CL002: 'Ce lot a déjà été écrit avec un contenu différent.',
  CL029: 'La demande d’approbation du lot n’est pas dans un état qui permet l’écriture.',
  CL047: 'Le moyen CASH n’est pas admis pour un versement.',
  P0002: 'Grand livre ou demande introuvable.',
};

@Injectable()
export class PayoutActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly approvals: ApprovalService,
    private readonly entitlements: EntitlementService,
    private readonly audit: AuditService,
    private readonly vault: IbanVault,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * Demande d'un lot : lit le grand livre (404 sinon, refusé s'il est `LOCKED`), résout chaque
   * bénéficiaire en
   * base, contrôle le rôle de l'auteur pour chaque classe présente, précontrôle le droit net (`409
   * PAYOUT_EXCEEDS_ENTITLEMENT` ; la borne ferme reste celle de la base), puis crée la demande. À
   * appeler dans
   * l'`IdempotentTx.run` de la route.
   */
  async request(
    client: TxClient,
    operatorId: string,
    input: { ledgerId: string; lines: BatchLineInput[] },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    const ledger = await readLedger(client, input.ledgerId);
    if (ledger.status === 'LOCKED')
      throw new ProblemException('LEDGER_LOCKED', {
        detail: 'Grand livre verrouillé : aucun lot de versements ne peut être demandé.',
      });
    const scope = ledgerScope(ledger);
    const chain = await resolveChain(client, scope);
    const lines = await this.resolve(client, ledger, input.lines, operatorId);
    const absent = missingRole(
      actor.principal,
      lines.map((l) => l.beneficiary_kind),
      chain,
    );
    if (absent)
      throw new ProblemException('FORBIDDEN', {
        detail: `Le rôle ${absent} est exigé pour les bénéficiaires de ce lot.`,
      });
    await this.precheck(client, ledger.id, lines);
    const payload: PayoutBatchPayload = {
      ledger_id: ledger.id,
      scope_type: scope.type,
      scope_id: scope.id,
      lines,
    };
    const dto = await this.approvals.request(
      client,
      operatorId,
      { action: 'PAYOUT', targetId: ledger.id, payload },
      actor,
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'PAYOUT_BATCH_REQUESTED',
      objectType: 'approval_request',
      objectId: dto.approval_request_id,
      // Jamais de destination : nombre de lignes et total seulement.
      after: {
        ledger_id: ledger.id,
        lines: lines.length,
        total: lines.reduce((sum, l) => sum + l.amount, 0),
      },
    });
    return dto;
  }

  /** Nature, participation et devise de chaque ligne, lues en base ; refus `422` sinon. */
  private async resolve(
    client: TxClient,
    ledger: LedgerRow,
    inputs: BatchLineInput[],
    operatorId: string,
  ): Promise<PayoutLinePayload[]> {
    const ids = inputs.map((line) => line.beneficiaryPartyId);
    if (new Set(ids).size !== ids.length)
      throw unprocessable('Un seul versement par bénéficiaire dans un lot.');
    const parties = await client.query<{ id: string; kind: string }>(
      'SELECT id, kind::text AS kind FROM party WHERE id = ANY($1::uuid[])',
      [ids],
    );
    const kindOf = new Map(parties.rows.map((row) => [row.id, row.kind]));
    const merchants = ids.filter((id) => kindOf.get(id) === 'MERCHANT');
    const participations = new Map<string, string>();
    if (merchants.length > 0 && ledger.scope_type === 'EVENT') {
      const found = await client.query<{ merchant_id: string; id: string }>(
        `SELECT merchant_id, id FROM merchant_participation
          WHERE event_id = $1 AND merchant_id = ANY($2::uuid[])`,
        [ledger.scope_id, merchants],
      );
      for (const row of found.rows) participations.set(row.merchant_id, row.id);
    }
    return inputs.map((line) => {
      const kind = kindOf.get(line.beneficiaryPartyId);
      if (!kind || !(PAYEE_KINDS as readonly string[]).includes(kind))
        throw unprocessable('Bénéficiaire inconnu ou qui ne peut pas recevoir de versement.');
      if (line.currency !== ledger.currency)
        throw unprocessable('currency : la devise du grand livre est attendue.');
      const out: PayoutLinePayload = {
        beneficiary_party_id: line.beneficiaryPartyId,
        beneficiary_kind: kind as PayeeKind,
        amount: line.amount,
        method: line.method as PayoutMethod,
        ...(line.msisdn !== undefined ? { msisdn: line.msisdn } : {}),
      };
      if (line.iban !== undefined) {
        // Valider et masquer sur le clair, puis chiffrer UNE fois (forme normalisée) : le clair ne
        // survit dans aucune variable transmise plus loin (demande, audit, base).
        if (!isValidIban(line.iban)) throw unprocessable('iban : IBAN valide (ISO 13616) attendu.');
        const clear = normalizeIban(line.iban);
        out.iban_mask = maskIban(clear);
        out.iban = this.vault.seal(clear, operatorId);
      }
      if (kind === 'MERCHANT') {
        const participation = participations.get(line.beneficiaryPartyId);
        if (!participation)
          throw unprocessable('Commerçant sans participation à l’événement de ce grand livre.');
        out.participation_id = participation;
      }
      return out;
    });
  }

  /**
   * Chaque enveloppe doit s'ouvrir pour CE prestataire et donner un IBAN valide dont le masque est
   * celui de la charge (le masque affiché au valideur doit être celui de l'IBAN payé : revue
   * post-fusion de la mission 11a, B-1) ; le clair ouvert n'est ni conservé ni réécrit (la ligne SQL
   * reçoit l'enveloppe telle quelle).
   */
  private checkSealed(batch: PayoutBatchPayload, operatorId: string): void {
    for (const line of batch.lines) {
      if (line.iban === undefined) continue;
      let clear: string;
      try {
        clear = this.vault.open(line.iban, operatorId);
      } catch {
        throw unprocessable('iban : enveloppe illisible pour ce prestataire.');
      }
      if (!isValidIban(clear)) throw unprocessable('iban : IBAN valide (ISO 13616) attendu.');
      if (line.iban_mask !== maskIban(clear))
        throw unprocessable('iban_mask : ne correspond pas à l’IBAN chiffré.');
    }
  }

  /**
   * Précontrôle (sans écriture) : chaque bénéficiaire a un droit dans ce grand livre et le montant
   * le respecte. */
  private async precheck(
    client: TxClient,
    ledgerId: string,
    lines: PayoutLinePayload[],
  ): Promise<void> {
    const rights = await this.entitlements.forParties(
      client,
      ledgerId,
      lines.map((l) => l.beneficiary_party_id),
    );
    for (const line of lines) {
      const right = rights.get(line.beneficiary_party_id);
      if (!right) throw unprocessable('Un bénéficiaire n’a aucun droit dans ce grand livre.');
      if (BigInt(line.amount) > right.available)
        throw new ProblemException('PAYOUT_EXCEEDS_ENTITLEMENT', {
          detail: `Versement de ${line.amount} supérieur au droit net disponible de ${right.legalName} (${right.available}).`,
        });
    }
  }

  private definition(): ApprovalActionDefinition<PayoutBatchPayload> {
    return {
      action: 'PAYOUT',
      requiredRole: PAYOUT_ROLES,
      scopeOf: (payload) => ({ type: payload.scope_type, id: payload.scope_id }) as ScopeRef,
      validate: (raw) => validatePayload(raw),
      guardDecision: async ({ client, payload, actor }) => {
        // Avant `decide` (approuver comme refuser) : un mauvais rôle laisse la demande PENDING.
        const scope = { type: payload.scope_type, id: payload.scope_id } as ScopeRef;
        const chain = await resolveChain(client, scope);
        const absent = missingRole(
          actor.principal,
          payload.lines.map((l) => l.beneficiary_kind),
          chain,
        );
        if (absent)
          throw new ProblemException('FORBIDDEN', {
            detail: `Le rôle ${absent} est exigé pour les bénéficiaires de ce lot.`,
          });
      },
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        try {
          // La charge est relue comme à la demande : une charge modifiée en base est refusée ici.
          const batch = validatePayload(payload);
          this.checkSealed(batch, request.operator_id);
          if (request.target_id !== batch.ledger_id)
            throw unprocessable(
              'Le grand livre visé par la demande n’est pas celui de sa charge utile.',
            );
          const ledger = await readLedger(client, batch.ledger_id);
          const scope = ledgerScope(ledger);
          if (scope.type !== batch.scope_type || scope.id !== batch.scope_id)
            throw unprocessable('La portée de la demande n’est pas celle du grand livre.');
          if (ledger.status === 'LOCKED')
            throw new ProblemException('LEDGER_LOCKED', {
              detail: 'Grand livre verrouillé : versement impossible.',
            });
          // Défense en profondeur : `guardDecision` a déjà contrôlé le rôle de l'approbateur avant
          // la décision ; ce contrôle ne sert plus que si une attribution est révoquée entre la
          // décision et l'exécution (seul cas où un refus de rôle fait encore passer FAILED).
          // Auteur et valideur tiennent le rôle de chaque classe du lot (attributions lues en
          // base).
          const chain = await resolveChain(client, scope);
          const kinds = batch.lines.map((l) => l.beneficiary_kind);
          for (const who of [requestedBy, approvedBy]) {
            const absent = missingRole(await readAssignments(client, who), kinds, chain);
            if (absent)
              throw new ProblemException('FORBIDDEN', {
                detail: `Le rôle ${absent} est exigé de l’auteur et du valideur pour ce lot.`,
              });
          }
          const { rows } = await client.query<{
            result: { transaction_id: string; payout_ids: string[] };
          }>('SELECT create_payout_batch($1, $2, $3::jsonb, $4, $5) AS result', [
            ledger.id,
            request.id,
            JSON.stringify(sqlLines(batch)),
            requestedBy,
            approvedBy,
          ]);
          const result = rows[0]!.result;
          await this.audit.record(client, {
            actorId: approvedBy,
            actorRole: null,
            origin: 'approval',
            requestId: null,
            operatorId: request.operator_id,
            action: 'PAYOUT_BATCH_EXECUTED',
            objectType: 'approval_request',
            objectId: request.id,
            approverId: approvedBy,
            after: {
              ledger_id: ledger.id,
              transaction_id: result.transaction_id,
              payouts: result.payout_ids.length,
            },
          });
          return {
            result: { transaction_id: result.transaction_id, payout_ids: result.payout_ids },
            executedTxId: result.transaction_id,
          };
        } catch (error) {
          throw failure(error);
        }
      },
      // Aucune ligne n'existe avant la validation : refus, échéance ou échec n'ont rien à libérer.
      onClosed: async (client, { request, outcome, actorId }) => {
        await this.audit.record(client, {
          actorId,
          actorRole: null,
          origin: 'approval',
          requestId: null,
          operatorId: request.operator_id,
          action: 'PAYOUT_BATCH_CLOSED',
          objectType: 'approval_request',
          objectId: request.id,
          after: { outcome, ledger_id: request.target_id },
        });
      },
    };
  }
}

/**
 * Lignes de `create_payout_batch` : bénéficiaire (descripteur et identifiant), montant, moyen,
 * destination. */
function sqlLines(batch: PayoutBatchPayload): unknown[] {
  return batch.lines.map((line) => ({
    beneficiary:
      line.beneficiary_kind === 'MERCHANT'
        ? { participation_id: line.participation_id }
        : line.beneficiary_kind,
    beneficiary_id: line.beneficiary_party_id,
    amount: line.amount,
    method: line.method,
    ...(line.msisdn !== undefined ? { msisdn: line.msisdn } : {}),
    ...(line.iban !== undefined ? { iban: line.iban } : {}),
  }));
}

/**
 * Refus SQL connu → erreur métier avec un motif lisible (la demande passe FAILED) ; le reste repart
 * tel quel. */
function failure(error: unknown): unknown {
  if (!isSqlError(error) || !(error.code in SQL_FAILURES)) return error;
  const problem = resolveProblem(error);
  return new ProblemException(problem.code, {
    status: problem.status,
    detail: SQL_FAILURES[error.code]!,
  });
}

function asRecord(raw: unknown): Record<string, unknown> {
  return (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
}

function validateLine(raw: unknown): PayoutLinePayload {
  const l = asRecord(raw);
  const foreign = Object.keys(l).filter((key) => !LINE_FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors d’une ligne : ${foreign.join(', ')}.`);
  if (!isUuid(l.beneficiary_party_id))
    throw unprocessable('beneficiary_party_id : identifiant attendu.');
  const kind = l.beneficiary_kind;
  if (typeof kind !== 'string' || !(PAYEE_KINDS as readonly string[]).includes(kind))
    throw unprocessable('beneficiary_kind : MERCHANT, ORGANIZER, OPERATOR ou PLATFORM attendu.');
  if (typeof l.amount !== 'number' || !Number.isSafeInteger(l.amount) || l.amount <= 0)
    throw unprocessable('amount : entier strictement positif attendu.');
  const method = l.method;
  if (typeof method !== 'string' || !(PAYOUT_METHODS as readonly string[]).includes(method))
    throw unprocessable('method : WAVE, ORANGE_MONEY ou BANK_TRANSFER attendu.');
  if ((kind === 'MERCHANT') !== (l.participation_id !== undefined))
    throw unprocessable('participation_id : exigé pour un commerçant, interdit sinon.');
  if (l.participation_id !== undefined && !isUuid(l.participation_id))
    throw unprocessable('participation_id : identifiant attendu.');
  const out: PayoutLinePayload = {
    beneficiary_party_id: l.beneficiary_party_id,
    beneficiary_kind: kind as PayeeKind,
    amount: l.amount,
    method: method as PayoutMethod,
  };
  if (typeof l.participation_id === 'string') out.participation_id = l.participation_id;
  if (method === 'BANK_TRANSFER') {
    if (l.msisdn !== undefined) throw unprocessable('msisdn : interdit pour un virement bancaire.');
    // Seule une enveloppe est admise : un IBAN en clair dans la charge est refusé (422).
    if (typeof l.iban !== 'string' || !SEALED_IBAN.test(l.iban))
      throw unprocessable('iban : enveloppe chiffrée attendue.');
    if (typeof l.iban_mask !== 'string' || l.iban_mask.length === 0)
      throw unprocessable('iban_mask : masque attendu.');
    out.iban = l.iban;
    out.iban_mask = l.iban_mask;
  } else {
    if (l.iban !== undefined || l.iban_mask !== undefined)
      throw unprocessable('iban : interdit pour ce moyen.');
    if (typeof l.msisdn !== 'string' || !MSISDN.test(l.msisdn))
      throw unprocessable('msisdn : numéro international (+…) attendu.');
    out.msisdn = l.msisdn;
  }
  return out;
}

export function validatePayload(raw: unknown): PayoutBatchPayload {
  const p = asRecord(raw);
  const foreign = Object.keys(p).filter((key) => !FIELDS.has(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (
    !isUuid(p.ledger_id) ||
    !isUuid(p.scope_id) ||
    (p.scope_type !== 'EVENT' && p.scope_type !== 'ORGANIZER' && p.scope_type !== 'OPERATOR')
  )
    throw unprocessable(
      'ledger_id, scope_type (EVENT, ORGANIZER ou OPERATOR) et scope_id attendus.',
    );
  if (!Array.isArray(p.lines) || p.lines.length === 0)
    throw unprocessable('lines : au moins un versement attendu.');
  const lines = p.lines.map(validateLine);
  const parties = lines.map((l) => l.beneficiary_party_id);
  if (new Set(parties).size !== parties.length)
    throw unprocessable('Un seul versement par bénéficiaire dans un lot.');
  return { ledger_id: p.ledger_id, scope_type: p.scope_type, scope_id: p.scope_id, lines };
}
