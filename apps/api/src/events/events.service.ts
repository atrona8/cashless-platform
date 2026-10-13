// Événements (SPECIFICATION §4.2, §4.4, §5.2, §9.8, §12.1 ; contrat event-lifecycle ; FR-009 à FR-011, FR-014,
// FR-015). Création : l'événement (`DRAFT`), son grand livre et ses comptes fixes (`open_event_ledger`), la version 1
// de sa configuration et l'audit, dans la transaction de la requête — jamais un grand livre sans événement ni
// l'inverse (NFR-004). Modification : contrôle des bornes, colonnes, nouvelle version `EVENT` (instantané), audit.
// Le statut ne se modifie jamais ici (C-001).
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { assertWithinBounds, type JurisdictionBounds } from '../configuration/bounds-validator';
import { CascadeService, eventSnapshot } from '../configuration/cascade.service';
import type { TxClient } from '../db/tenant-tx';
import type { Language } from '../http/language';
import { notFound, unprocessable } from '../organization/platform/platform.dto';
import { currentValues, eventDto, UPDATE_KEYS, type EventCreateInput, type EventRow } from './events.dto';

export interface EventListFilter {
  organizerId?: string;
  status?: string;
  /** Restriction de visibilité : organisateurs et événements que la personne peut voir (`null` : tous). */
  organizers: string[] | null;
  events: string[] | null;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly cascade: CascadeService,
    private readonly audit: AuditService,
  ) {}

  async row(client: TxClient, eventId: string): Promise<EventRow> {
    const { rows } = await client.query<EventRow>('SELECT * FROM event WHERE id = $1', [eventId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  async dto(client: TxClient, row: EventRow): Promise<Record<string, unknown>> {
    const { rows } = await client.query<{ ledger_id: string | null; config_version_id: string | null }>(
      `SELECT (SELECT l.id FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = $1 ORDER BY l.id LIMIT 1) AS ledger_id,
              (SELECT c.id FROM config_version c WHERE c.scope_type = 'EVENT' AND c.scope_id = $1 ORDER BY c.version DESC LIMIT 1) AS config_version_id`,
      [row.id],
    );
    return eventDto(row, rows[0]?.ledger_id ?? null, rows[0]?.config_version_id ?? null);
  }

  async list(client: TxClient, filter: EventListFilter, offset: number, limit: number): Promise<EventRow[]> {
    // Grand livre et version de configuration lus dans la même requête : pas deux lectures par événement.
    const { rows } = await client.query<EventRow>(
      `SELECT event.*,
              (SELECT l.id FROM ledger l WHERE l.scope_type = 'EVENT' AND l.scope_id = event.id ORDER BY l.id LIMIT 1) AS ledger_id,
              (SELECT c.id FROM config_version c WHERE c.scope_type = 'EVENT' AND c.scope_id = event.id ORDER BY c.version DESC LIMIT 1) AS config_version_id
         FROM event
        WHERE ($1::uuid IS NULL OR organizer_id = $1) AND ($2::event_status IS NULL OR status = $2)
          AND (($3::uuid[] IS NULL AND $4::uuid[] IS NULL) OR organizer_id = ANY(coalesce($3, '{}')) OR id = ANY(coalesce($4, '{}')))
        ORDER BY starts_at DESC NULLS LAST, id LIMIT $5 OFFSET $6`,
      [filter.organizerId ?? null, filter.status ?? null, filter.organizers, filter.events, limit, offset],
    );
    return rows;
  }

  /** Crée l'événement, son grand livre, sa version 1 de configuration et sa ligne d'audit. */
  async create(client: TxClient, operatorId: string, input: EventCreateInput, actor: AuditContext, language: Language): Promise<Record<string, unknown>> {
    const values = input.values;
    await this.assertReferences(client, input.organizer_id, { currency: input.currency, ...values });
    assertWithinBounds(
      values,
      {
        level: 'EVENT',
        resolved: await this.cascade.resolve(client, { operatorId, organizerId: input.organizer_id }),
        jurisdiction: await this.jurisdiction(client, values.jurisdiction_id),
        eventStatus: 'DRAFT',
      },
      language,
    );
    const columns = ['operator_id', 'organizer_id', 'currency', 'timezone', ...Object.keys(values)];
    const params = [operatorId, input.organizer_id, input.currency, input.timezone, ...Object.values(values)];
    const { rows } = await client.query<EventRow>(
      `INSERT INTO event (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map((_c, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      params,
    );
    const row = rows[0]!;
    const ledger = await client.query<{ ledger_id: string }>('SELECT open_event_ledger($1) AS ledger_id', [row.id]);
    const version = await this.cascade.writeVersion(client, { level: 'EVENT', scopeId: row.id, operatorId }, eventSnapshot(row), actor);
    const created = eventDto(row, ledger.rows[0]!.ledger_id, version.config_version_id);
    await this.audit.record(client, { ...actor, operatorId, action: 'EVENT_CREATED', objectType: 'event', objectId: row.id, after: created });
    return created;
  }

  /**
   * Contrôle une modification sans l'appliquer (bornes, références). Sert à la route (refus immédiat, y compris avant
   * une demande d'approbation) et à l'exécution d'une demande (nouvelle vérification).
   */
  async check(client: TxClient, row: EventRow, changes: Record<string, unknown>, language: Language): Promise<void> {
    await this.assertReferences(client, row.organizer_id, { ...currentValues(row), ...changes });
    const jurisdictionId = changes.jurisdiction_id ?? row.jurisdiction_id;
    assertWithinBounds(
      changes,
      {
        level: 'EVENT',
        resolved: await this.cascade.resolve(client, { operatorId: row.operator_id, organizerId: row.organizer_id }),
        jurisdiction: await this.jurisdiction(client, jurisdictionId),
        current: currentValues(row),
        eventStatus: row.status,
      },
      language,
    );
  }

  /** Applique une modification contrôlée : colonnes, version `EVENT` suivante (instantané), audit avant / après. */
  async apply(client: TxClient, row: EventRow, changes: Record<string, unknown>, actor: AuditContext, approverId?: string): Promise<Record<string, unknown>> {
    const keys = Object.keys(changes).filter((key) => UPDATE_KEYS.includes(key));
    const before = await this.dto(client, row);
    const { rows } = await client.query<EventRow>(
      `UPDATE event SET ${keys.map((key, i) => `"${key}" = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [row.id, ...keys.map((key) => changes[key])],
    );
    const updated = rows[0]!;
    // Les réglages de cascade déjà posés au niveau de l'événement sont conservés : le contenu d'une version est complet.
    const previous = await this.cascade.latest(client, { level: 'EVENT', scopeId: row.id });
    const version = await this.cascade.writeVersion(
      client,
      { level: 'EVENT', scopeId: row.id, operatorId: row.operator_id },
      { ...(previous?.settings ?? {}), ...eventSnapshot(updated) },
      actor,
    );
    const after = eventDto(updated, (before.ledger_id as string | null) ?? null, version.config_version_id);
    await this.audit.record(client, {
      ...actor,
      operatorId: row.operator_id,
      action: 'EVENT_UPDATED',
      objectType: 'event',
      objectId: row.id,
      before,
      after,
      approverId: approverId ?? null,
    });
    return after;
  }

  /** Version de configuration `EVENT` en vigueur (référence figée dans une demande d'approbation). */
  async currentVersionId(client: TxClient, eventId: string): Promise<string | null> {
    return (await this.cascade.latest(client, { level: 'EVENT', scopeId: eventId }))?.config_version_id ?? null;
  }

  // ------------------------------------------------------------------ Aides

  /** Références de l'événement : messages clairs avant les gardes de la base (qui restent l'arbitre). */
  private async assertReferences(client: TxClient, organizerId: string, state: Record<string, unknown>): Promise<void> {
    if (state.currency !== undefined) {
      const known = await client.query('SELECT 1 FROM currency_exponent WHERE code = $1', [state.currency]);
      if (known.rowCount !== 1) throw unprocessable(`currency : devise inconnue (${String(state.currency)}).`);
    }
    const thirdParty = state.funds_holder === 'THIRD_PARTY';
    const partyId = state.funds_holder_party_id ?? null;
    if (thirdParty !== (partyId !== null)) {
      throw unprocessable('funds_holder_party_id : partie tierce à désigner si et seulement si funds_holder = THIRD_PARTY.');
    }
    if (partyId !== null) {
      const party = await client.query(`SELECT 1 FROM party WHERE id = $1 AND kind = 'THIRD_PARTY'`, [partyId]);
      if (party.rowCount !== 1) throw unprocessable('funds_holder_party_id : partie tierce de ce prestataire attendue.');
    }
    if (state.contract_id !== undefined && state.contract_id !== null) {
      const contract = await client.query(`SELECT 1 FROM contract WHERE id = $1 AND kind = 'OPERATOR_ORGANIZER' AND counterparty_id = $2`, [
        state.contract_id,
        organizerId,
      ]);
      if (contract.rowCount !== 1) throw unprocessable('contract_id : contrat prestataire–organisateur de cet organisateur attendu.');
    }
  }

  private async jurisdiction(client: TxClient, jurisdictionId: unknown): Promise<JurisdictionBounds> {
    const { rows } =
      typeof jurisdictionId === 'string' && /^[0-9a-f-]{36}$/i.test(jurisdictionId)
        ? await client.query<JurisdictionBounds>('SELECT country_code, version, min_refund_window_days FROM jurisdiction_profile WHERE id = $1', [jurisdictionId])
        : { rows: [] };
    if (!rows[0]) throw unprocessable('jurisdiction_id : profil de législation inconnu.');
    return rows[0];
  }
}
