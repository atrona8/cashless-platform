// Entités de référence (B.4) : chaque entité est REMPLACÉE EN ENTIER quand `reference` la porte,
// dans la transaction qui avance `last_change_seq`. Le statut d'un bracelet vient de `media_refs`
// et prime sur `media[]` ; le statut et le palier d'un portefeuille viennent de `wallet_states`.
// Empreinte du jeton de rafraîchissement : stockée telle quelle, jamais journalisée, et seulement
// pour une passerelle PRIMARY (R-19).
import type { TxClient } from '../db/gateway-tx';
import { encodeBlob } from './pwd-pack-key';
import type { Reference } from './page-schema';

const bytes = (hex: string | null): Buffer | null =>
  hex === null ? null : Buffer.from(hex, 'hex');
const b64 = (v: string | null): Buffer | null => (v === null ? null : Buffer.from(v, 'base64'));

export async function applyReference(
  tx: TxClient,
  ref: Reference,
  ctx: { role: 'PRIMARY' | 'STANDBY' },
): Promise<void> {
  const primary = ctx.role === 'PRIMARY';

  if (ref.event) {
    const e = ref.event;
    await tx.query(
      `INSERT INTO edge_event_setting (id, name, status, currency, minor_units, timezone,
                                       activation_modes, terminal_settings, wallet_limits)
       VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status,
         currency = EXCLUDED.currency, minor_units = EXCLUDED.minor_units,
         timezone = EXCLUDED.timezone, activation_modes = EXCLUDED.activation_modes,
         terminal_settings = EXCLUDED.terminal_settings, wallet_limits = EXCLUDED.wallet_limits`,
      [
        e.name,
        e.status,
        e.currency,
        e.minor_units,
        e.timezone,
        e.activation_modes,
        JSON.stringify(e.terminal_settings),
        JSON.stringify(e.wallet_limits),
      ],
    );
  }

  for (const w of ref.wallet_states) {
    await tx.query(
      `INSERT INTO edge_wallet_state (wallet_id, status, identification_tier, change_seq)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet_id) DO UPDATE SET status = EXCLUDED.status,
         identification_tier = EXCLUDED.identification_tier, change_seq = EXCLUDED.change_seq
        WHERE edge_wallet_state.change_seq <= EXCLUDED.change_seq`,
      [w.wallet_id, w.status, w.kyc_verified ? 'VERIFIED' : 'UNVERIFIED', ref.to_change_seq],
    );
    await tx.query('UPDATE edge_wallet SET status = $2 WHERE wallet_id = $1', [
      w.wallet_id,
      w.status,
    ]);
  }

  for (const d of ref.devices) {
    await tx.query('DELETE FROM edge_device WHERE serial = $1 AND device_id <> $2', [
      d.serial,
      d.device_id,
    ]);
    await tx.query(
      `INSERT INTO edge_device (device_id, serial, kind, app_mode, status, public_key, cert_sha256,
                                agreement_public_key, pos_id, cash_desk_account_id, os, nfc_enabled,
                                station_name, pos_name, merchant_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (device_id) DO UPDATE SET serial = EXCLUDED.serial, kind = EXCLUDED.kind,
         app_mode = EXCLUDED.app_mode, status = EXCLUDED.status, public_key = EXCLUDED.public_key,
         cert_sha256 = EXCLUDED.cert_sha256,
         agreement_public_key = EXCLUDED.agreement_public_key, pos_id = EXCLUDED.pos_id,
         cash_desk_account_id = EXCLUDED.cash_desk_account_id, os = EXCLUDED.os,
         nfc_enabled = EXCLUDED.nfc_enabled, station_name = EXCLUDED.station_name,
         pos_name = EXCLUDED.pos_name, merchant_name = EXCLUDED.merchant_name`,
      [
        d.device_id,
        d.serial,
        d.kind,
        d.app_mode,
        d.status,
        b64(d.public_key),
        bytes(d.cert_sha256),
        b64(d.agreement_public_key),
        d.pos_id,
        d.cash_desk_account_id,
        d.os,
        d.nfc_enabled,
        d.station_name,
        d.pos_name,
        d.merchant_name,
      ],
    );
    if (primary && d.token_family) {
      await tx.query(
        `INSERT INTO edge_device_token_family (fid, device_id, status, refresh_token_sha256_current)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (fid) DO UPDATE SET device_id = EXCLUDED.device_id, status = EXCLUDED.status,
           refresh_token_sha256_current = EXCLUDED.refresh_token_sha256_current`,
        [
          d.token_family.fid,
          d.device_id,
          d.token_family.status,
          bytes(d.token_family.refresh_token_sha256_current),
        ],
      );
    }
  }

  // Configurations : par terminal, l'ensemble servi remplace celui qu'on tenait.
  if (ref.device_configs.length > 0) {
    // Ligne d'événement absente (réglages en page suivante) : statut inconnu, qui refuse tout.
    await tx.query(
      `INSERT INTO edge_event_setting (id, status, currency, minor_units, timezone)
       VALUES (true, 'UNKNOWN', 'XXX', 0, 'UTC') ON CONFLICT (id) DO NOTHING`,
    );
    const { rows } = await tx.query<{
      offline_policy: Record<string, unknown>;
      policy_in_force: unknown[];
    }>('SELECT offline_policy, policy_in_force FROM edge_event_setting');
    const touched = new Set(ref.device_configs.map((c) => c.device_id));
    const history = (rows[0]?.policy_in_force ?? []).filter(
      (entry) => !touched.has((entry as { device_id: string }).device_id),
    );
    const effective: Record<string, unknown> = { ...(rows[0]?.offline_policy ?? {}) };
    for (const raw of ref.device_configs) {
      const c = { ...raw, offline_policy: withAgeSeconds(raw.offline_policy) };
      history.push(c);
      if (c.in_force)
        effective[c.device_id] = { config_id: c.config_id, ...asObject(c.offline_policy) };
    }
    const latest = ref.device_configs.filter((c) => c.in_force).map((c) => c.config_id);
    await tx.query(
      `UPDATE edge_event_setting SET offline_policy = $1, policy_in_force = $2,
         config_id = COALESCE($3, config_id)`,
      [
        JSON.stringify(effective),
        JSON.stringify(history),
        latest.length > 0 ? String(Math.max(...latest)) : null,
      ],
    );
  }

  // Personnes avant les sessions : l'identité du guichetier vient de `edge_staff`.
  for (const s of ref.staff) {
    await tx.query('DELETE FROM edge_staff WHERE user_id = $1 AND (iss, sub) <> ($2, $3)', [
      s.user_id,
      s.issuer,
      s.subject,
    ]);
    await tx.query(
      `INSERT INTO edge_staff (iss, sub, status, roles, user_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (iss, sub) DO UPDATE SET status = EXCLUDED.status, roles = EXCLUDED.roles,
         user_id = EXCLUDED.user_id`,
      [s.issuer, s.subject, s.status, s.roles, s.user_id],
    );
  }

  for (const s of ref.cash_sessions) {
    // R-24 : seules les sessions ouvertes AVANT la bascule servent hors central. Tant que
    // `activated_at` est NULL la valeur est fausse ; le déclencheur `edge_cash_session_activation`
    // (edge-0003) la réévalue quand il est posé. Une session déjà connue garde sa valeur (jamais
    // relevée) ; fermée, elle ne sert plus.
    await tx.query(
      `INSERT INTO edge_cash_session (cash_session_id, device_id, opened_by_user_id, opened_by_iss,
                                      opened_by_sub, opened_at, status, usable_on_edge, closed_at,
                                      cash_account_id)
       VALUES ($1, $2, $3, '', '', $4::timestamptz, $5::text,
               ($5::text = 'OPEN' AND COALESCE((SELECT $4::timestamptz < activated_at
                                                  FROM edge_authority), false)),
               $6, (SELECT cash_desk_account_id FROM edge_device WHERE device_id = $2))
       ON CONFLICT (cash_session_id) DO UPDATE SET device_id = EXCLUDED.device_id,
         opened_by_user_id = EXCLUDED.opened_by_user_id, opened_at = EXCLUDED.opened_at,
         status = EXCLUDED.status, closed_at = EXCLUDED.closed_at,
         usable_on_edge = (EXCLUDED.status = 'OPEN' AND edge_cash_session.usable_on_edge),
         cash_account_id = EXCLUDED.cash_account_id`,
      [s.cash_session_id, s.device_id, s.opened_by, s.opened_at, s.status, s.closed_at],
    );
  }
  // Identité de la personne qui a ouvert (réparée aussi si les personnes arrivent après).
  if (ref.cash_sessions.length > 0 || ref.staff.length > 0) {
    await tx.query(
      `UPDATE edge_cash_session cs SET opened_by_iss = s.iss, opened_by_sub = s.sub
         FROM edge_staff s WHERE s.user_id = cs.opened_by_user_id
          AND (cs.opened_by_iss, cs.opened_by_sub) IS DISTINCT FROM (s.iss, s.sub)`,
    );
  }

  for (const v of ref.vendors) {
    await tx.query(
      `INSERT INTO edge_vendor (vendor_id, display_name, status, blocked) VALUES ($1, $2, $3, $4)
       ON CONFLICT (vendor_id) DO UPDATE SET display_name = EXCLUDED.display_name,
         status = EXCLUDED.status, blocked = EXCLUDED.blocked`,
      [v.vendor_id, v.display_name, v.status, v.locked],
    );
  }
  for (const s of ref.vendor_sessions) {
    await tx.query(
      `INSERT INTO edge_vendor_session (vendor_session_id, vendor_id, device_id, expires_at, closed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (vendor_session_id) DO UPDATE SET vendor_id = EXCLUDED.vendor_id,
         device_id = EXCLUDED.device_id, expires_at = EXCLUDED.expires_at,
         closed_at = EXCLUDED.closed_at`,
      [s.vendor_session_id, s.vendor_id, s.device_id, s.expires_at, s.closed_at],
    );
  }

  for (const c of ref.catalogs) {
    await tx.query('DELETE FROM edge_catalog_item WHERE pos_id = $1', [c.pos_id]);
    for (const it of c.items) {
      await tx.query(
        `INSERT INTO edge_catalog_item (pos_id, item_id, version, price, lines)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          c.pos_id,
          it.product_id,
          c.version,
          it.unit_price.toString(),
          JSON.stringify({
            name_fr: it.name_fr,
            name_en: it.name_en,
            category_fr: it.category_fr,
            category_en: it.category_en,
            vat_rate_bps: it.vat_rate_bps,
          }),
        ],
      );
    }
  }

  for (const m of ref.media_refs) {
    await tx.query(
      `INSERT INTO edge_media (token_hash, media_id, wallet_id, status, batch_status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token_hash) DO UPDATE SET media_id = EXCLUDED.media_id,
         wallet_id = EXCLUDED.wallet_id, status = EXCLUDED.status,
         batch_status = EXCLUDED.batch_status, version = edge_media.version + 1`,
      [bytes(m.token_hash), m.media_id, m.wallet_id, m.status, m.batch_status],
    );
  }
  for (const m of ref.unassigned_media) {
    await tx.query(
      `INSERT INTO edge_media (token_hash, media_id, wallet_id, status, batch_status, uid,
                               key_index, originality_sig_sha256, pwd_pack_enc, pwd_pack_sha256)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (token_hash) DO UPDATE SET media_id = EXCLUDED.media_id, status = EXCLUDED.status,
         batch_status = EXCLUDED.batch_status, uid = EXCLUDED.uid, key_index = EXCLUDED.key_index,
         originality_sig_sha256 = EXCLUDED.originality_sig_sha256,
         pwd_pack_enc = EXCLUDED.pwd_pack_enc, pwd_pack_sha256 = EXCLUDED.pwd_pack_sha256,
         version = edge_media.version + 1`,
      [
        bytes(m.token_hash),
        m.media_id,
        m.status,
        m.batch_status,
        Buffer.from(m.nfc_uid, 'hex'),
        m.key_index,
        bytes(m.originality_sig_sha256),
        primary ? encodeBlob(m.pwd_pack_enc) : null,
        primary ? bytes(m.pwd_pack_sha256) : null,
      ],
    );
  }
}

/**
 * Le central rend `max_snapshot_age` en intervalle PostgreSQL (`00:15:00`, `1 day 00:00:00`) ; les
 * règles de la passerelle (lot hors ligne, constructeur de snapshots, configuration servie) lisent
 * `max_snapshot_age_seconds`. Sans ce champ, la règle hors ligne lisait 0 et refusait toute vente
 * (`SNAPSHOT_TOO_OLD`). Valeur illisible : champ absent, donc le refus (échec fermé).
 */
export function withAgeSeconds(policy: unknown): Record<string, unknown> {
  const p = { ...asObject(policy) };
  const text = p.max_snapshot_age;
  if (p.max_snapshot_age_seconds === undefined && typeof text === 'string') {
    const m = /^(?:(\d+) days?\s+)?(\d+):([0-5]\d):([0-5]\d)(?:\.\d+)?$/.exec(text.trim());
    if (m)
      p.max_snapshot_age_seconds = Number(m[1] ?? 0) * 86400 + +m[2]! * 3600 + +m[3]! * 60 + +m[4]!;
  }
  return p;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
