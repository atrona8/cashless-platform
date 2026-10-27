// Back-office des vendeurs (mission 5b, lot WP09, T039 ; FR-001, FR-002, FR-026, NFR-002, NFR-007 ;
// contracts/vendors.md, « Back-office »).
//
// Portée : un `OPERATOR_ADMIN` du prestataire (attribution de portée OPERATOR sur CE prestataire)
// voit tous ses commerçants ; un `MERCHANT_ADMIN` les seuls commerçants qu'il administre. Hors
// portée, commerçant inconnu ou d'un autre prestataire : `404` neutre (même corps qu'un objet
// inexistant). La base revérifie l'auteur (`vendor_admin_allowed` dans `create_vendor`,
// `set_vendor_pin`, `set_vendor_status` : P0002 → 404).
//
// Lecture : la vue `vendor_public` SEULEMENT (A20) ; jamais la table `vendor`, jamais
// l'empreinte. Écritures : les fonctions de la base seulement. Audit dans la transaction de
// l'action, sans PIN ni empreinte.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditAction } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { notFound, type PageRequest } from '../organization/platform/platform.dto';
import { scopesHeld, type TenantActor } from '../organization/tenant/tenant-access';
import {
  VENDOR_COLUMNS,
  vendorDto,
  type Vendor,
  type VendorRow,
  type VendorStatus,
} from './vendors.dto';

/** Actions d'audit du back-office des vendeurs. */
export type VendorAdminAction = Extract<
  AuditAction,
  'VENDOR_CREATED' | 'VENDOR_PIN_CHANGED' | 'VENDOR_DISABLED' | 'VENDOR_REACTIVATED'
>;

/**
 * Commerçants de la portée ; `null` : tout le prestataire. Seule une attribution OPERATOR_ADMIN de
 * portée OPERATOR sur CE prestataire donne tout le prestataire ; sinon, les commerçants
 * administrés (MERCHANT_ADMIN de portée MERCHANT).
 */
export function merchantScope(
  actor: Pick<TenantActor, 'principal' | 'operatorId'>,
): string[] | null {
  if (
    actor.principal.assignments.some(
      (a) =>
        a.role === 'OPERATOR_ADMIN' && a.scopeType === 'OPERATOR' && a.scopeId === actor.operatorId,
    )
  )
    return null;
  return scopesHeld(actor.principal, 'MERCHANT_ADMIN', 'MERCHANT');
}

/** Commerçant hors de la portée de la personne : `404` (avant toute requête). */
export function assertMerchantInScope(actor: TenantActor, merchantId: string): void {
  const scope = merchantScope(actor);
  if (scope !== null && !scope.includes(merchantId)) throw notFound();
}

@Injectable()
export class VendorsService {
  constructor(private readonly audit: AuditService) {}

  /** Commerçant de la portée et du prestataire ; `404` sinon. */
  async assertMerchant(client: TxClient, actor: TenantActor, merchantId: string): Promise<void> {
    assertMerchantInScope(actor, merchantId);
    const { rows } = await client.query(
      `SELECT 1 FROM party WHERE id = $1 AND operator_id = $2 AND kind = 'MERCHANT'`,
      [merchantId, actor.operatorId],
    );
    if (rows.length === 0) throw notFound();
  }

  /** Vendeurs d'un commerçant (`limit + 1` lignes à partir de `offset`). */
  async list(
    client: TxClient,
    actor: TenantActor,
    merchantId: string,
    status: VendorStatus | undefined,
    page: PageRequest,
  ): Promise<VendorRow[]> {
    await this.assertMerchant(client, actor, merchantId);
    const { rows } = await client.query<VendorRow>(
      `SELECT ${VENDOR_COLUMNS}
         FROM vendor_public v
        WHERE v.operator_id = $1 AND v.merchant_id = $2
          AND ($3::text IS NULL OR v.status = $3)
        ORDER BY v.display_name, v.id
        OFFSET $4 LIMIT $5`,
      [actor.operatorId, merchantId, status ?? null, page.offset, page.limit + 1],
    );
    return rows;
  }

  /** Vendeur de la portée ; `404` sinon (inconnu, autre prestataire, autre commerçant). */
  async find(client: TxClient, actor: TenantActor, vendorId: string): Promise<VendorRow> {
    const { rows } = await client.query<VendorRow>(
      `SELECT ${VENDOR_COLUMNS} FROM vendor_public v WHERE v.operator_id = $1 AND v.id = $2`,
      [actor.operatorId, vendorId],
    );
    const row = rows[0];
    if (!row) throw notFound();
    assertMerchantInScope(actor, row.merchant_id);
    return row;
  }

  /** `create_vendor` puis audit `VENDOR_CREATED` ; `pinHash` calculé hors transaction. */
  async create(
    client: TxClient,
    actor: TenantActor,
    merchantId: string,
    displayName: string,
    pinHash: string,
  ): Promise<Vendor> {
    await this.assertMerchant(client, actor, merchantId);
    const { rows } = await client.query<{ id: string }>(
      'SELECT create_vendor($1, $2, $3, $4) AS id',
      [merchantId, displayName, pinHash, actor.principal.userId],
    );
    const created = await this.find(client, actor, rows[0]!.id);
    await this.record(client, actor, 'VENDOR_CREATED', created.id, undefined, {
      merchant_id: created.merchant_id,
      display_name: created.display_name,
      status: created.status,
    });
    return vendorDto(created);
  }

  /** `set_vendor_pin` (compteur à 0, blocage levé, sessions fermées) puis audit. */
  async setPin(
    client: TxClient,
    actor: TenantActor,
    vendorId: string,
    pinHash: string,
  ): Promise<Vendor> {
    const before = await this.find(client, actor, vendorId);
    await client.query('SELECT set_vendor_pin($1, $2, $3)', [
      vendorId,
      pinHash,
      actor.principal.userId,
    ]);
    const after = await this.find(client, actor, vendorId);
    await this.record(
      client,
      actor,
      'VENDOR_PIN_CHANGED',
      vendorId,
      { locked: before.locked },
      { locked: after.locked, unlocked: before.locked && !after.locked },
    );
    return vendorDto(after);
  }

  /** `set_vendor_status` (désactivation : sessions fermées par la base) puis audit. */
  async setStatus(
    client: TxClient,
    actor: TenantActor,
    vendorId: string,
    status: VendorStatus,
  ): Promise<Vendor> {
    const before = await this.find(client, actor, vendorId);
    await client.query('SELECT set_vendor_status($1, $2, $3)', [
      vendorId,
      status,
      actor.principal.userId,
    ]);
    const after = await this.find(client, actor, vendorId);
    await this.record(
      client,
      actor,
      status === 'DISABLED' ? 'VENDOR_DISABLED' : 'VENDOR_REACTIVATED',
      vendorId,
      { status: before.status },
      { status: after.status, locked: after.locked },
    );
    return vendorDto(after);
  }

  private record(
    client: TxClient,
    actor: TenantActor,
    action: VendorAdminAction,
    vendorId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    return this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action,
      objectType: 'vendor',
      objectId: vendorId,
      before,
      after,
    });
  }
}
