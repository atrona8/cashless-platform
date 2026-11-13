// Lectures du terminal servies par la passerelle (contracts/gateway-served-operations.md, lignes 2
// à 4 : getDeviceConfig, postDeviceHeartbeat, getDeviceSeqStatus), construites UNIQUEMENT depuis la
// copie locale répliquée. Rien n'est inventé (R-10) : une donnée que le flux n'a pas encore portée
// (événement, politique, bloc `device`) fait refuser la configuration en `409 CONFLICT_STATE`.
//
// - `config_id` : celui du central, par terminal (`edge_event_setting.offline_policy[device_id]`),
//   jamais recréé ici ;
// - `ETag` : SHA-256 du contenu canonique (JCS) hors `server_time`, comme le central, de sorte
//   qu'un changement d'autorité, de catalogue ou de statut change l'ETag (l'ETag ne se réduit pas
//   au `config_id`, écart de lecture du prompt signalé) ;
// - `debit_authority` : `EDGE` seulement quand l'état local est `ACTIVE` (lu par `AUTHORITY`, ce
//   lot ne décide de rien) ; sinon `CENTRAL`, sans adresse ;
// - `seq.contiguous_acked_seq` : le dernier accusé du CENTRAL répliqué (périmé plutôt que
//   provisoire, FR-026) ; jamais un accusé local ; `0` tant qu'aucune passe n'a eu lieu ;
// - `server_time` : `GatewayClock.now()`.
import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { components } from '@cashless/contracts';
import canonicalize from 'canonicalize';
import { AUTHORITY, type AuthorityService } from '../authority/authority.service';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import type { TxClient } from '../db/gateway-tx';
import { CLOCK_TOLERANCE_SECONDS } from '../device-proofs/nonce-store';
import { ProblemException } from '../device-proofs/problem';
import type { AuthenticatedDevice } from '../device-proofs/device-proofs.guard';
import {
  GATEWAY_SNAPSHOT_KEYS,
  LOCAL_SNAPSHOT_STATE,
  type GatewaySnapshotKeys,
  type LocalSnapshotState,
} from './ports';

export type DeviceConfigBody = components['schemas']['DeviceConfig'];
export type DebitAuthorityBody = components['schemas']['DebitAuthority'];
export type SeqStatusBody = components['schemas']['SeqStatus'];
export type Language = 'fr' | 'en';

export interface ServedConfig {
  body: DeviceConfigBody;
  etag: string;
}

export function pickLanguage(header: string | undefined): Language {
  if (!header) return 'fr';
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return {
        lang: tag.trim().toLowerCase().split('-')[0],
        weight: Number.isNaN(weight) ? 0 : weight,
        index,
      };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  const chosen = ranked.find((entry) => entry.lang === 'fr' || entry.lang === 'en');
  return chosen?.lang === 'en' ? 'en' : 'fr';
}

export function configEtag(body: DeviceConfigBody): string {
  const { server_time: _serverTime, ...content } = body;
  return `"${createHash('sha256')
    .update(canonicalize(content) ?? '', 'utf8')
    .digest('hex')}"`;
}

export function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const strip = (value: string) => value.trim().replace(/^W\//, '');
  return header.split(',').some((value) => value.trim() === '*' || strip(value) === etag);
}

const incomplete = (detail: string): ProblemException =>
  new ProblemException('CONFLICT_STATE', { detail, extensions: { retryable: true } });

function exact(value: string | number | bigint, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} hors de la plage exacte`);
  return n;
}

interface DeviceRow {
  serial: string;
  kind: 'POS' | 'TOPUP';
  app_mode: DeviceConfigBody['device']['app_mode'] | null;
  status: 'ACTIVE' | 'SUSPENDED';
  os: 'ANDROID' | 'IOS' | null;
  nfc_enabled: boolean | null;
  station_name: string | null;
  pos_id: string | null;
  pos_name: string | null;
  merchant_name: string | null;
}

interface EventRow {
  name: string | null;
  status: string;
  currency: string;
  minor_units: number;
  timezone: string;
  activation_modes: DeviceConfigBody['event']['activation_modes'];
  terminal_settings: DeviceConfigBody['terminal_settings'];
  offline_policy: Record<string, Record<string, unknown> | undefined>;
}

@Injectable()
export class DeviceConfigService {
  constructor(
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(AUTHORITY) private readonly authority: Pick<AuthorityService, 'state'>,
    @Optional() @Inject(GATEWAY_SNAPSHOT_KEYS) private readonly snapshotKeys?: GatewaySnapshotKeys,
    @Optional() @Inject(LOCAL_SNAPSHOT_STATE) private readonly snapshots?: LocalSnapshotState,
  ) {}

  async build(
    tx: TxClient,
    device: AuthenticatedDevice,
    language: Language = 'fr',
  ): Promise<ServedConfig> {
    const { rows: metas } = await tx.query<{
      gateway_id: string;
      event_id: string;
      ledger_id: string;
      lan_authority: string;
    }>('SELECT gateway_id, event_id, ledger_id, lan_authority FROM edge_meta');
    const gateway = metas[0];
    if (!gateway) throw new Error('edge_meta absent : passerelle non enrôlée');
    const { rows: devices } = await tx.query<DeviceRow>(
      `SELECT serial, kind, app_mode, status, os, nfc_enabled, station_name, pos_id, pos_name,
              merchant_name
         FROM edge_device WHERE device_id = $1`,
      [device.deviceId],
    );
    const d = devices[0];
    if (!d) throw new ProblemException('UNAUTHENTICATED');
    if (d.os === null || d.nfc_enabled === null || d.app_mode === null)
      throw incomplete('Copie locale du terminal incomplète : réplication en cours.');

    const { rows: events } = await tx.query<EventRow>(
      `SELECT name, status, currency, minor_units, timezone, activation_modes, terminal_settings,
              offline_policy
         FROM edge_event_setting`,
    );
    const e = events[0];
    if (!e || e.status === 'UNKNOWN' || e.name === null)
      throw incomplete('Réglages de l’événement non encore répliqués.');
    const policy = e.offline_policy[device.deviceId];
    if (!policy || typeof policy.config_id !== 'number')
      throw incomplete('Configuration du terminal non encore répliquée.');

    const keys = (await this.snapshotKeys?.list(tx)) ?? [];

    let catalog: DeviceConfigBody['catalog'] = null;
    if (d.app_mode === 'CATALOG_POS') {
      const { rows } = await tx.query<{
        item_id: string;
        version: string;
        price: string;
        lines: {
          name_fr: string;
          name_en: string;
          category_fr: string | null;
          category_en: string | null;
          vat_rate_bps: number;
        };
      }>(
        'SELECT item_id, version, price, lines FROM edge_catalog_item WHERE pos_id = $1 ORDER BY item_id',
        [d.pos_id],
      );
      catalog = {
        version: rows.reduce((max, r) => Math.max(max, exact(r.version, 'version')), 0),
        items: rows.map((r) => {
          const category = language === 'en' ? r.lines.category_en : r.lines.category_fr;
          return {
            product_id: r.item_id,
            name: language === 'en' ? r.lines.name_en : r.lines.name_fr,
            unit_price: exact(r.price, 'unit_price'),
            ...(category ? { category } : {}),
            vat_rate_bps: r.lines.vat_rate_bps,
          };
        }),
      };
    }

    const { rows: seq } = await tx.query<{
      contiguous_local_seq: string;
      central_acked_seq: string;
      acked_known: boolean;
    }>(
      `SELECT contiguous_local_seq, central_acked_seq, acked_known
         FROM edge_device_seq WHERE device_id = $1`,
      [device.deviceId],
    );
    const s = seq[0];
    const acked = s?.acked_known ? exact(s.central_acked_seq, 'contiguous_acked_seq') : 0;
    const local = s ? exact(s.contiguous_local_seq, 'contiguous_local_seq') : 0;

    const authority = await this.authority.state();
    const edgeActive = authority.state === 'ACTIVE';
    const debitAuthority: DebitAuthorityBody = edgeActive
      ? {
          ledger_id: gateway.ledger_id,
          authority: 'EDGE',
          epoch: authority.epoch,
          edge_gateway_id: gateway.gateway_id,
          edge_base_url: `https://${gateway.lan_authority}`,
        }
      : {
          ledger_id: gateway.ledger_id,
          authority: 'CENTRAL',
          epoch: Math.max(authority.epoch, authority.highestEpochSeen),
          edge_gateway_id: null,
          edge_base_url: null,
        };

    const body: DeviceConfigBody = {
      config_id: policy.config_id,
      terminal_settings: e.terminal_settings,
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
        event_id: gateway.event_id,
        name: e.name,
        currency: e.currency,
        minor_units: e.minor_units,
        timezone: e.timezone,
        status: e.status as DeviceConfigBody['event']['status'],
        activation_modes: e.activation_modes,
      },
      pos:
        d.pos_id && d.pos_name && d.merchant_name
          ? { pos_id: d.pos_id, name: d.pos_name, merchant_name: d.merchant_name }
          : null,
      catalog,
      offline_policy: {
        offline_enabled: policy.offline_enabled === true && keys.length > 0,
        max_per_sale: Number(policy.max_per_sale ?? 0),
        max_per_media_per_device: Number(policy.max_per_media_per_device ?? 0),
        max_total_per_device: Number(policy.max_total_per_device ?? 0),
        max_snapshot_age_seconds: Number(policy.max_snapshot_age_seconds ?? 900),
        // Aucune recharge en espèces hors ligne (décision du porteur) : toujours faux.
        cash_topup_offline: false,
        capped: policy.capped === true,
      },
      snapshot_keys: keys,
      debit_authority: debitAuthority,
      seq: {
        next_seq_floor: Math.max(local, acked) + 1,
        contiguous_acked_seq: acked,
      },
      server_time: this.clock.now().toISOString(),
      clock_tolerance_seconds: CLOCK_TOLERANCE_SECONDS,
    };
    return { body, etag: configEtag(body) };
  }

  /** `sync_requested` : l'événement est en `CLOSING` dans la copie locale. */
  async heartbeatState(
    tx: TxClient,
    deviceId: string,
  ): Promise<{ latestSnapshotVersion: number | null; syncRequested: boolean }> {
    const { rows } = await tx.query<{ status: string }>('SELECT status FROM edge_event_setting');
    return {
      latestSnapshotVersion: (await this.snapshots?.latestVersion(tx, deviceId)) ?? null,
      syncRequested: rows[0]?.status === 'CLOSING',
    };
  }

  async seqStatus(tx: TxClient, device: AuthenticatedDevice): Promise<SeqStatusBody> {
    const { rows } = await tx.query<{
      contiguous_local_seq: string;
      central_acked_seq: string;
      acked_known: boolean;
    }>(
      `SELECT contiguous_local_seq, central_acked_seq, acked_known
         FROM edge_device_seq WHERE device_id = $1`,
      [device.deviceId],
    );
    const row = rows[0];
    const acked = row?.acked_known ? exact(row.central_acked_seq, 'contiguous_acked_seq') : 0;
    const local = row ? exact(row.contiguous_local_seq, 'contiguous_local_seq') : 0;
    return {
      device_serial: device.serial,
      contiguous_acked_seq: acked,
      max_seen_seq: local,
      missing_seqs: [],
      next_seq_floor: Math.max(local, acked) + 1,
    };
  }
}
