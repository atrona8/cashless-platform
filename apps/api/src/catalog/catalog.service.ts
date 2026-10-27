// Back-office du catalogue d'un point de vente (mission 5b, lot WP10 ; FR-007, FR-026, NFR-007 ;
// contracts/catalog.md ; research R-11 A21 ; migration 0032). Lectures et écritures dans la
// transaction
// cloisonnée du prestataire de la personne (RLS) ET avec le prestataire nommé dans chaque requête.
//
// Portée, résolue dans la transaction (point de vente → participation → événement → organisateur ;
// commerçant de la participation) :
//   - lecture : `OPERATOR_ADMIN` du prestataire, `ORGANIZER_ADMIN` de l'organisateur de
//     l'événement,
//     `MERCHANT_ADMIN` du commerçant du point de vente ;
//   - gestion (catégories, articles) : les deux premiers ; le `MERCHANT_ADMIN` du commerçant
//     seulement
//     si `merchant_manages` est vrai, sinon `403 FORBIDDEN` (contrat) ;
//   - délégation (`setCatalogPolicy`) : les deux premiers ; `MERCHANT_ADMIN` → `403`.
//   Point de vente, catégorie ou article hors portée ou d'un autre prestataire : `404` neutre.
// Ce contrôle n'est qu'une première barrière (A21) : chaque écriture passe par UNE fonction de
// 0032,
// avec l'auteur ; la fonction verrouille la politique du point de vente, relit le rôle de l'auteur
// et
// la délégation sous ce verrou, refuse un événement CLOSED (CL029 → 409) et crée la version
// suivante.
// Aucun INSERT ni UPDATE direct sur une table du catalogue ; un refus de la base n'est jamais
// contourné.
// Audit (FR-026) : une ligne par écriture, dans la même transaction, avec la version créée.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditAction } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { Role } from '../identity/principal';
import type { TenantActor } from '../organization/tenant/tenant-access';
import {
  categoryDto,
  itemDto,
  versionItemDto,
  type CatalogBody,
  type CatalogCategoryResultBody,
  type CatalogItemResultBody,
  type CatalogPolicyBody,
  type CatalogVersionBody,
  type CategoryCreate,
  type CategoryRow,
  type CategoryUpdate,
  type ItemCreate,
  type ItemRow,
  type ItemUpdate,
  type PolicySet,
  type VersionItemRow,
} from './catalog.dto';

/** Rôles admis par les routes du catalogue, dans l'ordre de préférence. */
export const CATALOG_ROLES: readonly Role[] = [
  'OPERATOR_ADMIN',
  'ORGANIZER_ADMIN',
  'MERCHANT_ADMIN',
];

/** Ce que la route demande : lire, gérer le contenu, ou régler la délégation. */
export type CatalogNeed = 'read' | 'manage' | 'policy';

/** Point de vente du prestataire et ce dont dépend la portée. */
export interface PosScope {
  posId: string;
  organizerId: string;
  merchantId: string;
  merchantManages: boolean;
}

/**
 * Rôle qui donne l'accès demandé sur ce point de vente ; sinon refus. Seules comptent les
 * attributions dont la portée couvre le point de vente (une attribution d'une autre portée ne vaut
 * rien) : `OPERATOR_ADMIN` de portée OPERATOR sur CE prestataire, `ORGANIZER_ADMIN` de
 * l'organisateur de l'événement, `MERCHANT_ADMIN` du commerçant. Aucune : `404` neutre (hors
 * portée).
 */
export function catalogAccess(
  actor: Pick<TenantActor, 'principal' | 'operatorId'>,
  scope: PosScope,
  need: CatalogNeed,
): Role {
  const holds = (role: Role, scopeType: string, scopeId: string) =>
    actor.principal.assignments.some(
      (a) => a.role === role && a.scopeType === scopeType && a.scopeId === scopeId,
    );
  if (holds('OPERATOR_ADMIN', 'OPERATOR', actor.operatorId)) return 'OPERATOR_ADMIN';
  if (holds('ORGANIZER_ADMIN', 'ORGANIZER', scope.organizerId)) return 'ORGANIZER_ADMIN';
  if (holds('MERCHANT_ADMIN', 'MERCHANT', scope.merchantId)) {
    if (need === 'read') return 'MERCHANT_ADMIN';
    if (need === 'manage' && scope.merchantManages) return 'MERCHANT_ADMIN';
    throw new ProblemException('FORBIDDEN');
  }
  throw new ProblemException('NOT_FOUND');
}

const CATEGORY_COLUMNS = 'c.id, c.label_fr, c.label_en, c.position, c.active';
const ITEM_COLUMNS =
  'i.id, i.category_id, i.label_fr, i.label_en, i.unit_price::text AS unit_price, ' +
  'i.vat_rate_bps, i.active';

/** Résultat d'une fonction d'écriture de 0032 : objet écrit et version créée. */
interface Written {
  id: string;
  version: number;
}

@Injectable()
export class CatalogService {
  constructor(private readonly audit: AuditService) {}

  /** Point de vente du prestataire (organisateur, commerçant, délégation) ; inconnu : `404`. */
  async posScope(client: TxClient, operatorId: string, posId: string): Promise<PosScope> {
    const { rows } = await client.query<{
      organizer_id: string;
      merchant_id: string;
      merchant_manages: boolean;
    }>(
      `SELECT e.organizer_id, mp.merchant_id,
              coalesce(pol.merchant_manages, false) AS merchant_manages
         FROM point_of_sale p
         JOIN merchant_participation mp ON mp.id = p.participation_id AND mp.operator_id = $1
         JOIN event e ON e.id = mp.event_id AND e.operator_id = $1
         LEFT JOIN point_of_sale_catalog_policy pol ON pol.pos_id = p.id AND pol.operator_id = $1
        WHERE p.id = $2 AND p.operator_id = $1`,
      [operatorId, posId],
    );
    const row = rows[0];
    if (!row) throw new ProblemException('NOT_FOUND');
    return {
      posId,
      organizerId: row.organizer_id,
      merchantId: row.merchant_id,
      merchantManages: row.merchant_manages,
    };
  }

  /** Accès demandé sur le point de vente ; rend l'auteur avec le rôle qui l'a donné (audit). */
  private async authorize(
    client: TxClient,
    actor: TenantActor,
    posId: string,
    need: CatalogNeed,
  ): Promise<TenantActor> {
    const scope = await this.posScope(client, actor.operatorId, posId);
    const role = catalogAccess(actor, scope, need);
    return { ...actor, role, audit: { ...actor.audit, actorRole: role } };
  }

  private async category(client: TxClient, operatorId: string, id: string) {
    const { rows } = await client.query<CategoryRow & { pos_id: string }>(
      `SELECT ${CATEGORY_COLUMNS}, c.pos_id FROM catalog_category c
        WHERE c.id = $1 AND c.operator_id = $2`,
      [id, operatorId],
    );
    return rows[0];
  }

  private async item(client: TxClient, operatorId: string, id: string) {
    const { rows } = await client.query<ItemRow & { pos_id: string }>(
      `SELECT ${ITEM_COLUMNS}, i.pos_id FROM catalog_item i WHERE i.id = $1 AND i.operator_id = $2`,
      [id, operatorId],
    );
    return rows[0];
  }

  private async currentVersion(client: TxClient, operatorId: string, posId: string) {
    const { rows } = await client.query<{ version: number }>(
      `SELECT coalesce(max(version), 0)::int AS version FROM catalog_version
        WHERE pos_id = $1 AND operator_id = $2`,
      [posId, operatorId],
    );
    return rows[0]!.version;
  }

  private record(
    client: TxClient,
    actor: TenantActor,
    action: AuditAction,
    objectType: string,
    objectId: string,
    before: unknown,
    after: unknown,
  ) {
    return this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action,
      objectType,
      objectId,
      before,
      after,
    });
  }

  // ---------------------------------------------------------------- Lectures

  async getCatalog(client: TxClient, actor: TenantActor, posId: string): Promise<CatalogBody> {
    const scope = await this.posScope(client, actor.operatorId, posId);
    catalogAccess(actor, scope, 'read');
    const categories = await client.query<CategoryRow>(
      `SELECT ${CATEGORY_COLUMNS} FROM catalog_category c
        WHERE c.pos_id = $1 AND c.operator_id = $2
        ORDER BY c.position, c.label_fr, c.id`,
      [posId, actor.operatorId],
    );
    const items = await client.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM catalog_item i
         JOIN catalog_category c ON c.id = i.category_id AND c.operator_id = i.operator_id
        WHERE i.pos_id = $1 AND i.operator_id = $2
        ORDER BY c.position, c.id, i.label_fr, i.id`,
      [posId, actor.operatorId],
    );
    return {
      pos_id: posId,
      version: await this.currentVersion(client, actor.operatorId, posId),
      merchant_manages: scope.merchantManages,
      categories: categories.rows.map(categoryDto),
      items: items.rows.map(itemDto),
    };
  }

  /** Version immuable (`catalog_version_item`) ; inconnue : `404`. Lecteurs de `getCatalog`. */
  async getVersion(
    client: TxClient,
    actor: TenantActor,
    posId: string,
    version: number,
  ): Promise<CatalogVersionBody> {
    const scope = await this.posScope(client, actor.operatorId, posId);
    catalogAccess(actor, scope, 'read');
    const { rows } = await client.query<{ created_at: Date }>(
      `SELECT created_at FROM catalog_version
        WHERE pos_id = $1 AND version = $2 AND operator_id = $3`,
      [posId, version, actor.operatorId],
    );
    const head = rows[0];
    if (!head) throw new ProblemException('NOT_FOUND');
    const items = await client.query<VersionItemRow>(
      `SELECT item_id, category_id, label_fr, label_en, unit_price::text AS unit_price, vat_rate_bps
         FROM catalog_version_item
        WHERE pos_id = $1 AND version = $2 AND operator_id = $3
        ORDER BY category_position, category_id, label_fr, item_id`,
      [posId, version, actor.operatorId],
    );
    return {
      pos_id: posId,
      version,
      created_at: head.created_at.toISOString(),
      items: items.rows.map(versionItemDto),
    };
  }

  // ---------------------------------------------------------------- Écritures

  async createCategory(
    client: TxClient,
    actor: TenantActor,
    posId: string,
    input: CategoryCreate,
  ): Promise<CatalogCategoryResultBody> {
    const author = await this.authorize(client, actor, posId, 'manage');
    // Rang par défaut : après la dernière catégorie du point de vente.
    let position = input.position;
    if (position === undefined) {
      const { rows } = await client.query<{ next: number }>(
        `SELECT coalesce(max(position) + 1, 0)::int AS next FROM catalog_category
          WHERE pos_id = $1 AND operator_id = $2`,
        [posId, actor.operatorId],
      );
      position = rows[0]!.next;
    }
    const written = await this.write(
      client,
      'SELECT id, version FROM create_catalog_category($1, $2, $3, $4, $5)',
      [posId, input.labelFr, input.labelEn, position, actor.principal.userId],
    );
    const row = (await this.category(client, actor.operatorId, written.id))!;
    await this.record(
      client,
      author,
      'CATALOG_CATEGORY_CREATED',
      'catalog_category',
      written.id,
      null,
      {
        pos_id: posId,
        label_fr: row.label_fr,
        label_en: row.label_en,
        position: row.position,
        active: row.active,
        catalog_version: written.version,
      },
    );
    return { category: categoryDto(row), catalog_version: written.version };
  }

  async updateCategory(
    client: TxClient,
    actor: TenantActor,
    categoryId: string,
    input: CategoryUpdate,
  ): Promise<CatalogCategoryResultBody> {
    const before = await this.category(client, actor.operatorId, categoryId);
    if (!before) throw new ProblemException('NOT_FOUND');
    const author = await this.authorize(client, actor, before.pos_id, 'manage');
    const written = await this.write(
      client,
      'SELECT id, version FROM update_catalog_category($1, $2, $3, $4, $5, $6)',
      [
        categoryId,
        input.labelFr ?? null,
        input.labelEn ?? null,
        input.position ?? null,
        input.active ?? null,
        actor.principal.userId,
      ],
    );
    const row = (await this.category(client, actor.operatorId, categoryId))!;
    await this.record(
      client,
      author,
      'CATALOG_CATEGORY_UPDATED',
      'catalog_category',
      categoryId,
      categoryDto(before),
      { ...writtenFields(input, categoryFields), catalog_version: written.version },
    );
    return { category: categoryDto(row), catalog_version: written.version };
  }

  async createItem(
    client: TxClient,
    actor: TenantActor,
    categoryId: string,
    input: ItemCreate,
  ): Promise<CatalogItemResultBody> {
    const category = await this.category(client, actor.operatorId, categoryId);
    if (!category) throw new ProblemException('NOT_FOUND');
    const author = await this.authorize(client, actor, category.pos_id, 'manage');
    const written = await this.write(
      client,
      'SELECT id, version FROM create_catalog_item($1, $2, $3, $4::bigint, $5, $6)',
      [
        categoryId,
        input.labelFr,
        input.labelEn,
        input.unitPrice.toString(),
        input.vatRateBps,
        actor.principal.userId,
      ],
    );
    const row = (await this.item(client, actor.operatorId, written.id))!;
    await this.record(client, author, 'CATALOG_ITEM_CREATED', 'catalog_item', written.id, null, {
      ...itemDto(row),
      unit_price: row.unit_price,
      pos_id: category.pos_id,
      catalog_version: written.version,
    });
    return { item: itemDto(row), catalog_version: written.version };
  }

  async updateItem(
    client: TxClient,
    actor: TenantActor,
    itemId: string,
    input: ItemUpdate,
  ): Promise<CatalogItemResultBody> {
    const before = await this.item(client, actor.operatorId, itemId);
    if (!before) throw new ProblemException('NOT_FOUND');
    const author = await this.authorize(client, actor, before.pos_id, 'manage');
    if (input.categoryId !== undefined) {
      // Nouvelle catégorie : du même point de vente, sinon `404` (contrat ; la base refuse aussi).
      const target = await this.category(client, actor.operatorId, input.categoryId);
      if (!target || target.pos_id !== before.pos_id) throw new ProblemException('NOT_FOUND');
    }
    const written = await this.write(
      client,
      'SELECT id, version FROM update_catalog_item($1, $2, $3, $4, $5::bigint, $6, $7, $8)',
      [
        itemId,
        input.categoryId ?? null,
        input.labelFr ?? null,
        input.labelEn ?? null,
        input.unitPrice === undefined ? null : input.unitPrice.toString(),
        input.vatRateBps ?? null,
        input.active ?? null,
        actor.principal.userId,
      ],
    );
    const row = (await this.item(client, actor.operatorId, itemId))!;
    await this.record(
      client,
      author,
      'CATALOG_ITEM_UPDATED',
      'catalog_item',
      itemId,
      { ...itemDto(before), unit_price: before.unit_price },
      { ...writtenFields(input, itemFields), catalog_version: written.version },
    );
    return { item: itemDto(row), catalog_version: written.version };
  }

  /** Délégation au commerçant (organisateur ou prestataire seuls) ; ne crée pas de version. */
  async setPolicy(
    client: TxClient,
    actor: TenantActor,
    posId: string,
    input: PolicySet,
  ): Promise<CatalogPolicyBody> {
    const scope = await this.posScope(client, actor.operatorId, posId);
    const role = catalogAccess(actor, scope, 'policy');
    const author = { ...actor, role, audit: { ...actor.audit, actorRole: role } };
    await client.query('SELECT set_catalog_policy($1, $2, $3)', [
      posId,
      input.merchantManages,
      actor.principal.userId,
    ]);
    const { rows } = await client.query<{ merchant_manages: boolean }>(
      `SELECT merchant_manages FROM point_of_sale_catalog_policy
        WHERE pos_id = $1 AND operator_id = $2`,
      [posId, actor.operatorId],
    );
    const merchantManages = rows[0]!.merchant_manages;
    await this.record(
      client,
      author,
      'CATALOG_POLICY_SET',
      'point_of_sale',
      posId,
      { merchant_manages: scope.merchantManages },
      { merchant_manages: merchantManages },
    );
    return { pos_id: posId, merchant_manages: merchantManages };
  }

  /** Un seul appel à une fonction d'écriture de 0032 ; rend l'objet écrit et la version créée. */
  private async write(client: TxClient, sql: string, params: unknown[]): Promise<Written> {
    const { rows } = await client.query<Written>(sql, params);
    return rows[0]!;
  }
}

const categoryFields = {
  labelFr: 'label_fr',
  labelEn: 'label_en',
  position: 'position',
  active: 'active',
} as const;

const itemFields = {
  categoryId: 'category_id',
  labelFr: 'label_fr',
  labelEn: 'label_en',
  unitPrice: 'unit_price',
  vatRateBps: 'vat_rate_bps',
  active: 'active',
} as const;

/** Champs reçus (et donc écrits), sous leur nom du contrat ; un prix passe en texte (bigint). */
function writtenFields<T extends object>(
  input: T,
  names: Partial<Record<keyof T, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const name = names[key as keyof T];
    if (name && value !== undefined)
      out[name] = typeof value === 'bigint' ? value.toString() : value;
  }
  return out;
}
