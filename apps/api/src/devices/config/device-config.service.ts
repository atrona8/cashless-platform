// Configuration servie à un terminal (openapi.yaml : `DeviceConfig` ;
// contracts/device-lifecycle.md ; research R-10, R-14 ; FR-018). Contenu de cette mission, sans
// rien inventer :
//   - affectation, mode, `terminal_settings` de l'événement, `offline_policy` effective et
//     plancher de séquence : ceux de la configuration enregistrée par `record_config_served`
//     (S10), dont la ligne donne `config_id` (`device_config_served.id`, entier du contrat), stable
//     tant que la politique, l'époque, le plancher et les réglages ne changent pas ;
//   - `debit_authority` : relue sur le grand livre de l'événement (CENTRAL d'époque 0 tant que la
//     mission 8 n'existe pas) ; `snapshot_keys` = [] (aucune clé de snapshot : hors ligne
//     impossible, refus par défaut) ;
//   - `catalog` (mission 5b, lot WP10 ; FR-008, A2) : pour CATALOG_POS, dernière version du
//     catalogue du point de vente, servie `{version, items}` dans la langue demandée
//     (`ServedCatalog`) ; quand la configuration est remise au terminal (`GET /device/config`),
//     cette
//     version est inscrite dans `device_catalog_served` par `record_device_catalog_served` APRÈS le
//     verrou du terminal et `record_config_served` (le battement de cœur la lit sans l'inscrire) ;
//     sans point de vente ou
//     sans version : `{version: 0, items: []}`, rien écrit ; `null` pour les autres modes.
//     `config_id` n'en dépend pas (R-04 : déduplication de `record_config_served` inchangée) ;
//     l'ETag, si : une nouvelle version change l'ETag, donc le battement de cœur suivant ;
//   - `server_time` : heure de la base, celle qui juge la fraîcheur des signatures (nonces).
// ETag : SHA-256 du contenu canonique (JCS, RFC 8785) hors `server_time`. Il change avec
// `config_id` et avec toute autre partie servie (statut, nom de l'événement, plage acquittée…),
// jamais sans changement réel. Le statut du terminal est relu et verrouillé dans la transaction
// (R-14) : un terminal révoqué après la garde est refusé ici, et deux lectures simultanées du même
// terminal ne créent pas deux configurations identiques.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { components } from '@cashless/contracts';
import canonicalize from 'canonicalize';
import { ServedCatalog } from '../../catalog/served-catalog';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { TxClient } from '../../db/tenant-tx';
import type { DeviceContext } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';

export type DeviceConfigBody = components['schemas']['DeviceConfig'];
export type DebitAuthorityBody = components['schemas']['DebitAuthority'];

/** Configuration servie et son ETag. */
export interface ServedConfig {
  body: DeviceConfigBody;
  etag: string;
}

interface DeviceRow {
  serial: string;
  kind: 'POS' | 'TOPUP';
  app_mode: 'CATALOG_POS' | 'KEYPAD_TPE' | 'TOPUP_DESK';
  os: 'ANDROID' | 'IOS';
  nfc_enabled: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  station_name: string | null;
  contiguous_acked_seq: string;
  event_id: string | null;
  pos_id: string | null;
}

interface ServedRow {
  config_id: string;
  next_seq_floor: string;
  terminal_settings: DeviceConfigBody['terminal_settings'];
  offline_enabled: boolean;
  max_per_sale: string;
  max_per_media_per_device: string;
  max_total_per_device: string;
  max_snapshot_age_seconds: number;
  cash_topup_offline: boolean;
  capped: boolean;
}

interface EventRow {
  name: string;
  currency: string;
  minor_units: number;
  timezone: string;
  status: DeviceConfigBody['event']['status'];
  activation_modes: DeviceConfigBody['event']['activation_modes'];
}

interface LedgerRow {
  ledger_id: string;
  authority: 'CENTRAL' | 'EDGE';
  epoch: number;
  edge_gateway_id: string | null;
  edge_base_url: string | null;
}

/** Affectation incomplète : rien de valide à servir (jamais une valeur inventée, R-10). */
const unassigned = (detail: string) => new ProblemException('CONFLICT_STATE', { detail });

/** ETag fort : SHA-256 hexadécimal du contenu canonique hors `server_time`. */
export function configEtag(body: DeviceConfigBody): string {
  const { server_time: _serverTime, ...content } = body;
  const digest = createHash('sha256')
    .update(canonicalize(content) ?? '', 'utf8')
    .digest('hex');
  return `"${digest}"`;
}

/**
 * `If-None-Match` (RFC 9110 §13.1.2, comparaison faible) : vrai si l'une des valeurs désigne
 * `etag`, ou `*`.
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const strip = (value: string) => value.trim().replace(/^W\//, '');
  return header.split(',').some((value) => value.trim() === '*' || strip(value) === etag);
}

@Injectable()
export class DeviceConfigService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'clockToleranceSeconds'>,
    private readonly catalogs: ServedCatalog,
  ) {}

  /**
   * Construit la configuration dans la transaction de l'appelant (prestataire du terminal posé).
   * Terminal révoqué → `403 DEVICE_REVOKED` ; suspendu : servi (R-14, `allowSuspended`).
   * `language` : langue des libellés du catalogue (défaut `fr`). `deliver` : vrai seulement quand
   * la configuration est remise au terminal (`GET /device/config`) — la version du catalogue est
   * alors inscrite dans `device_catalog_served` ; faux (battement de cœur, qui ne rend que
   * l'ETag) : même contenu, rien inscrit.
   */
  async build(
    client: TxClient,
    device: DeviceContext,
    language: Language = 'fr',
    deliver = false,
  ): Promise<ServedConfig> {
    // Statut relu et verrou pris AVANT record_config_served (R-14). NO KEY UPDATE : sérialise deux
    // lectures du même terminal et attend une révocation en cours (set_device_status : FOR UPDATE).
    const { rows: devices } = await client.query<DeviceRow>(
      `SELECT serial, kind, app_mode, os, nfc_enabled, status, station_name,
              contiguous_acked_seq::text AS contiguous_acked_seq, event_id, pos_id
         FROM device WHERE id = $1 FOR NO KEY UPDATE`,
      [device.deviceId],
    );
    const d = devices[0];
    if (!d) throw new ProblemException('UNAUTHENTICATED');
    if (d.status === 'REVOKED') throw new ProblemException('DEVICE_REVOKED');
    if (!d.event_id) throw unassigned('Terminal affecté à aucun événement.');

    const { rows: served } = await client.query<ServedRow>(
      `SELECT r.id::text AS config_id, r.next_seq_floor::text AS next_seq_floor,
              r.terminal_settings,
              (r.policy->>'offline_enabled')::boolean AS offline_enabled,
              (r.policy->>'max_per_sale')::bigint::text AS max_per_sale,
              (r.policy->>'max_per_media_per_device')::bigint::text AS max_per_media_per_device,
              (r.policy->>'max_total_per_device')::bigint::text AS max_total_per_device,
              extract(epoch FROM (r.policy->>'max_snapshot_age')::interval)::int
                AS max_snapshot_age_seconds,
              (r.policy->>'cash_topup_offline')::boolean AS cash_topup_offline,
              coalesce((r.policy->>'capped')::boolean, false) AS capped
         FROM record_config_served($1) r`,
      [device.deviceId],
    );
    const s = served[0]!;

    // Catalogue servi : après le verrou du terminal et record_config_served (ordre de la 5a).
    const catalog =
      d.app_mode === 'CATALOG_POS'
        ? await this.catalogs.serve(
            client,
            { operatorId: device.operatorId, deviceId: device.deviceId, posId: d.pos_id },
            language,
            deliver,
          )
        : null;

    const { rows: events } = await client.query<EventRow>(
      `SELECT e.name, e.currency, x.exponent::int AS minor_units, e.timezone,
              e.status::text AS status, e.activation_modes
         FROM event e JOIN currency_exponent x ON x.code = e.currency
        WHERE e.id = $1`,
      [d.event_id],
    );
    const e = events[0];
    if (!e) throw unassigned('Événement du terminal introuvable.');

    const { rows: ledgers } = await client.query<LedgerRow>(
      `SELECT l.id AS ledger_id, l.debit_authority AS authority, l.authority_epoch AS epoch,
              l.edge_gateway_id, g.lan_url AS edge_base_url
         FROM ledger l LEFT JOIN edge_gateway g ON g.id = l.edge_gateway_id
        WHERE l.scope_type = 'EVENT' AND l.scope_id = $1 AND l.currency = $2`,
      [d.event_id, e.currency],
    );
    const l = ledgers[0];
    if (!l) throw unassigned('Grand livre de l’événement non ouvert.');

    let pos: DeviceConfigBody['pos'] = null;
    if (d.pos_id) {
      const { rows } = await client.query<{ pos_id: string; name: string; merchant_name: string }>(
        `SELECT p.id AS pos_id, p.name, m.legal_name AS merchant_name
           FROM point_of_sale p
           JOIN merchant_participation mp ON mp.id = p.participation_id
           JOIN party m ON m.id = mp.merchant_id
          WHERE p.id = $1`,
        [d.pos_id],
      );
      pos = rows[0] ?? null;
    }

    const { rows: clock } = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');

    const body: DeviceConfigBody = {
      config_id: Number(s.config_id),
      terminal_settings: s.terminal_settings,
      device: {
        device_id: device.deviceId,
        serial: d.serial,
        kind: d.kind,
        app_mode: d.app_mode,
        os: d.os,
        nfc_enabled: d.nfc_enabled,
        status: d.status,
        station_name: d.station_name,
      },
      event: {
        event_id: d.event_id,
        name: e.name,
        currency: e.currency,
        minor_units: e.minor_units,
        timezone: e.timezone,
        status: e.status,
        activation_modes: e.activation_modes,
      },
      pos,
      catalog,
      offline_policy: {
        offline_enabled: s.offline_enabled,
        max_per_sale: Number(s.max_per_sale),
        max_per_media_per_device: Number(s.max_per_media_per_device),
        max_total_per_device: Number(s.max_total_per_device),
        max_snapshot_age_seconds: s.max_snapshot_age_seconds,
        cash_topup_offline: s.cash_topup_offline,
        capped: s.capped,
      },
      // Aucune clé de snapshot avant la mission des snapshots : le terminal ne peut rien faire hors
      // ligne (§9, refus par défaut).
      snapshot_keys: [],
      debit_authority: debitAuthority(l),
      seq: {
        next_seq_floor: Number(s.next_seq_floor),
        contiguous_acked_seq: Number(d.contiguous_acked_seq),
      },
      server_time: clock[0]!.now.toISOString(),
      clock_tolerance_seconds: this.config.clockToleranceSeconds,
    };
    return { body, etag: configEtag(body) };
  }
}

function debitAuthority(l: LedgerRow): DebitAuthorityBody {
  return {
    ledger_id: l.ledger_id,
    authority: l.authority,
    epoch: Number(l.epoch),
    edge_gateway_id: l.edge_gateway_id,
    edge_base_url: l.edge_base_url,
  };
}
