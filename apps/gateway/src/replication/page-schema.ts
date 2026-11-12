// Validation d'une page du flux de réplication contre le SEUL schéma de la mission
// (contracts/replication-page-additions.yaml + ReplicationPage de openapi.yaml). Règle : un champ
// inconnu est ignoré, un champ requis absent ou mal typé refuse la page ENTIÈRE (jamais une
// application partielle). Aucune dépendance : validation écrite à la main.

export class ReplicationPageError extends Error {
  constructor(
    message: string,
    /** `FOREIGN` : donnée d'un autre événement ou grand livre (alerte). */
    readonly kind: 'INVALID' | 'FOREIGN' | 'CURSOR' = 'INVALID',
  ) {
    super(message);
    this.name = 'ReplicationPageError';
  }
}

type Obj = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32 = /^[0-9a-f]{64}$/;

function fail(path: string, expected: string): never {
  throw new ReplicationPageError(`page refusée : ${path} (${expected} attendu)`);
}
function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'objet');
  return value as Obj;
}
function arr(value: unknown, path: string, optional = false): unknown[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) fail(path, 'tableau');
  return value as unknown[];
}
function str(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'chaîne');
  return value as string;
}
function strOrNull(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  return str(value, path);
}
function oneOf(value: unknown, allowed: readonly string[], path: string): string {
  const v = str(value, path);
  if (!allowed.includes(v)) fail(path, allowed.join(' | '));
  return v;
}
function uuid(value: unknown, path: string): string {
  const v = str(value, path);
  if (!UUID.test(v)) fail(path, 'uuid');
  return v.toLowerCase();
}
function uuidOrNull(value: unknown, path: string): string | null {
  return value === undefined || value === null ? null : uuid(value, path);
}
function int(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(path, 'entier');
  return value as number;
}
function nat(value: unknown, path: string): number {
  const v = int(value, path);
  if (v < 0) fail(path, 'entier positif ou nul');
  return v;
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'booléen');
  return value as boolean;
}
function hex32(value: unknown, path: string): string {
  const v = str(value, path);
  if (!HEX32.test(v)) fail(path, 'empreinte hexadécimale de 32 octets');
  return v;
}
function hex32OrNull(value: unknown, path: string): string | null {
  return value === undefined || value === null ? null : hex32(value, path);
}
function base64(value: unknown, path: string): string {
  const v = str(value, path);
  if (v === '' || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) fail(path, 'base64');
  return v;
}

export interface EncryptedBlob {
  alg?: string;
  epk?: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}
export interface WrappedKey {
  alg: string;
  epk: string;
  iv: string;
  wrapped_key: string;
}

function blob(value: unknown, path: string): EncryptedBlob {
  const o = obj(value, path);
  const out: EncryptedBlob = {
    nonce: base64(o.nonce, `${path}.nonce`),
    ciphertext: base64(o.ciphertext, `${path}.ciphertext`),
    tag: base64(o.tag, `${path}.tag`),
  };
  if (o.alg !== undefined) out.alg = str(o.alg, `${path}.alg`);
  if (o.epk !== undefined) out.epk = str(o.epk, `${path}.epk`);
  return out;
}
function wrappedKey(value: unknown, path: string): WrappedKey {
  const o = obj(value, path);
  return {
    alg: str(o.alg, `${path}.alg`),
    epk: base64(o.epk, `${path}.epk`),
    iv: base64(o.iv, `${path}.iv`),
    wrapped_key: base64(o.wrapped_key, `${path}.wrapped_key`),
  };
}

export interface PageWallet {
  wallet_id: string;
  status: string;
  paid: bigint;
  promo: bigint;
  kyc_verified: boolean | null;
  topup_month_paid: bigint | null;
}
export interface PageMedia {
  token_hash: string;
  nfc_uid: string | null;
  key_index: number | null;
  originality_sig_sha256: string | null;
  status: string;
  batch_event_id: string | null;
  batch_status: string | null;
  last_counter: bigint | null;
  pwd_pack_enc: EncryptedBlob | null;
  pwd_pack_sha256: string | null;
}
export interface SeqAcked {
  device_id: string;
  contiguous_acked_seq: number;
  as_of: string;
}
export interface RefDevice {
  device_id: string;
  serial: string;
  kind: string;
  app_mode: string | null;
  status: string;
  pos_id: string | null;
  /** Blocs `device` et `pos` de getDeviceConfig (WP19) ; null tant que le flux ne les porte pas. */
  os: string | null;
  nfc_enabled: boolean | null;
  station_name: string | null;
  pos_name: string | null;
  merchant_name: string | null;
  cash_desk_account_id: string | null;
  public_key: string | null;
  cert_sha256: string | null;
  agreement_public_key: string | null;
  token_family: { fid: string; status: string; refresh_token_sha256_current: string } | null;
}
export interface Reference {
  from_change_seq: number;
  to_change_seq: number;
  has_more: boolean;
  gateway: { gateway_id: string; role: 'PRIMARY' | 'STANDBY' } | null;
  event: {
    event_id: string;
    name: string | null;
    status: string;
    currency: string;
    minor_units: number;
    timezone: string;
    activation_modes: string[];
    terminal_settings: unknown;
    wallet_limits: unknown;
  } | null;
  wallet_states: Array<{ wallet_id: string; status: string; kyc_verified: boolean }>;
  devices: RefDevice[];
  device_configs: Array<{
    config_id: number;
    device_id: string;
    in_force: boolean;
    offline_policy: unknown;
  }>;
  cash_sessions: Array<{
    cash_session_id: string;
    device_id: string;
    status: string;
    opened_by: string;
    opened_at: string;
    closed_at: string | null;
  }>;
  vendors: Array<{ vendor_id: string; display_name: string; status: string; locked: boolean }>;
  vendor_sessions: Array<{
    vendor_session_id: string;
    vendor_id: string;
    device_id: string;
    expires_at: string;
    closed_at: string | null;
  }>;
  staff: Array<{
    user_id: string;
    issuer: string;
    subject: string;
    status: string;
    roles: string[];
  }>;
  catalogs: Array<{
    pos_id: string;
    version: number;
    items: Array<{
      product_id: string;
      name_fr: string;
      name_en: string;
      category_fr: string | null;
      category_en: string | null;
      unit_price: bigint;
      vat_rate_bps: number;
    }>;
  }>;
  media_refs: Array<{
    media_id: string;
    token_hash: string;
    wallet_id: string | null;
    status: string;
    batch_status: string | null;
  }>;
  unassigned_media: Array<
    PageMedia & { media_id: string; nfc_uid: string; batch_event_id: string | null }
  >;
}
/** `edge_terms` (décision 36) : chaque clé facultative, absente = inconnue (échec fermé). */
export interface EdgeTerms {
  max_cash_topup?: bigint;
  activation_fee?: bigint;
  /** Ordre de dépense de l'événement (décision 45, ADR-185) ; absent : inconnu, ventes mêlées refusées. */
  spend_order?: 'PROMO_FIRST' | 'PAID_FIRST';
  deposit_batches?: Array<{
    batch_id: string;
    deposit_amount: bigint;
    deposit_mode: 'FROM_BALANCE' | 'SEPARATE' | null;
  }>;
}
export interface ReplicationPage {
  ledger_id: string;
  epoch: number;
  from_posting_id: number;
  to_posting_id: number;
  has_more: boolean;
  wallets: PageWallet[];
  media: PageMedia[];
  edge_seq_applied: number;
  device_seq_acked: SeqAcked[] | null;
  pwd_pack_key: WrappedKey | null;
  reference: Reference;
  /** Dernière page d'une passe seulement ; absent : inconnu. */
  edge_terms?: EdgeTerms | null;
}

function big(value: unknown, path: string): bigint {
  return BigInt(nat(value, path));
}

function parseMedia(value: unknown, path: string): PageMedia {
  const o = obj(value, path);
  return {
    token_hash: hex32(o.token_hash, `${path}.token_hash`),
    nfc_uid: strOrNull(o.nfc_uid, `${path}.nfc_uid`),
    key_index: o.key_index === undefined ? null : int(o.key_index, `${path}.key_index`),
    originality_sig_sha256: hex32OrNull(o.originality_sig_sha256, `${path}.originality_sig_sha256`),
    status: str(o.status, `${path}.status`),
    batch_event_id: uuidOrNull(o.batch_event_id, `${path}.batch_event_id`),
    batch_status: strOrNull(o.batch_status, `${path}.batch_status`),
    last_counter:
      o.last_counter === undefined || o.last_counter === null
        ? null
        : big(o.last_counter, `${path}.last_counter`),
    pwd_pack_enc:
      o.pwd_pack_enc === undefined || o.pwd_pack_enc === null
        ? null
        : blob(o.pwd_pack_enc, `${path}.pwd_pack_enc`),
    pwd_pack_sha256: hex32OrNull(o.pwd_pack_sha256, `${path}.pwd_pack_sha256`),
  };
}

function parseDevice(value: unknown, path: string): RefDevice {
  const o = obj(value, path);
  const pos = o.pos === undefined || o.pos === null ? null : obj(o.pos, `${path}.pos`);
  let tokenFamily: RefDevice['token_family'] = null;
  if (o.token_family !== undefined && o.token_family !== null) {
    const t = obj(o.token_family, `${path}.token_family`);
    tokenFamily = {
      fid: uuid(t.fid, `${path}.token_family.fid`),
      status: str(t.status, `${path}.token_family.status`),
      refresh_token_sha256_current: hex32(
        t.refresh_token_sha256_current,
        `${path}.token_family.refresh_token_sha256_current`,
      ),
    };
  }
  return {
    device_id: uuid(o.device_id, `${path}.device_id`),
    serial: str(o.serial, `${path}.serial`),
    kind: str(o.kind, `${path}.kind`),
    app_mode: strOrNull(o.app_mode, `${path}.app_mode`),
    status: str(o.status, `${path}.status`),
    pos_id: pos === null ? null : uuid(pos.pos_id, `${path}.pos.pos_id`),
    os: o.os === undefined || o.os === null ? null : oneOf(o.os, ['ANDROID', 'IOS'], `${path}.os`),
    nfc_enabled: typeof o.nfc_enabled === 'boolean' ? o.nfc_enabled : null,
    station_name: strOrNull(o.station_name ?? null, `${path}.station_name`),
    pos_name: pos === null ? null : strOrNull(pos.name ?? null, `${path}.pos.name`),
    merchant_name:
      pos === null ? null : strOrNull(pos.merchant_name ?? null, `${path}.pos.merchant_name`),
    cash_desk_account_id: uuidOrNull(o.cash_desk_account_id, `${path}.cash_desk_account_id`),
    public_key: o.public_key === undefined ? null : base64(o.public_key, `${path}.public_key`),
    cert_sha256: hex32OrNull(o.cert_sha256, `${path}.cert_sha256`),
    agreement_public_key:
      o.agreement_public_key === undefined || o.agreement_public_key === null
        ? null
        : base64(o.agreement_public_key, `${path}.agreement_public_key`),
    token_family: tokenFamily,
  };
}

function parseReference(value: unknown): Reference {
  const p = 'reference';
  const o = obj(value, p);
  const list = <T>(key: string, f: (item: Obj, path: string) => T): T[] =>
    arr(o[key], `${p}.${key}`, true).map((item, i) =>
      f(obj(item, `${p}.${key}[${i}]`), `${p}.${key}[${i}]`),
    );
  let gateway: Reference['gateway'] = null;
  if (o.gateway !== undefined) {
    const g = obj(o.gateway, `${p}.gateway`);
    const role = str(g.role, `${p}.gateway.role`);
    if (role !== 'PRIMARY' && role !== 'STANDBY') fail(`${p}.gateway.role`, 'PRIMARY ou STANDBY');
    gateway = { gateway_id: uuid(g.gateway_id, `${p}.gateway.gateway_id`), role };
  }
  let event: Reference['event'] = null;
  if (o.event !== undefined) {
    const e = obj(o.event, `${p}.event`);
    event = {
      event_id: uuid(e.event_id, `${p}.event.event_id`),
      name: strOrNull(e.name, `${p}.event.name`),
      status: str(e.status, `${p}.event.status`),
      currency: str(e.currency, `${p}.event.currency`),
      minor_units: nat(e.minor_units, `${p}.event.minor_units`),
      timezone: str(e.timezone, `${p}.event.timezone`),
      activation_modes: arr(e.activation_modes, `${p}.event.activation_modes`).map((m, i) =>
        str(m, `${p}.event.activation_modes[${i}]`),
      ),
      terminal_settings: e.terminal_settings ?? {},
      wallet_limits: e.wallet_limits ?? {},
    };
  }
  return {
    from_change_seq: nat(o.from_change_seq, `${p}.from_change_seq`),
    to_change_seq: nat(o.to_change_seq, `${p}.to_change_seq`),
    has_more: bool(o.has_more, `${p}.has_more`),
    gateway,
    event,
    wallet_states: list('wallet_states', (w, path) => ({
      wallet_id: uuid(w.wallet_id, `${path}.wallet_id`),
      status: str(w.status, `${path}.status`),
      kyc_verified: bool(w.kyc_verified, `${path}.kyc_verified`),
    })),
    devices: list('devices', (d, path) => parseDevice(d, path)),
    device_configs: list('device_configs', (c, path) => ({
      config_id: nat(c.config_id, `${path}.config_id`),
      device_id: uuid(c.device_id, `${path}.device_id`),
      in_force: bool(c.in_force, `${path}.in_force`),
      offline_policy: obj(c.offline_policy, `${path}.offline_policy`),
    })),
    cash_sessions: list('cash_sessions', (s, path) => ({
      cash_session_id: uuid(s.cash_session_id, `${path}.cash_session_id`),
      device_id: uuid(s.device_id, `${path}.device_id`),
      status: str(s.status, `${path}.status`),
      opened_by: uuid(s.opened_by, `${path}.opened_by`),
      opened_at: str(s.opened_at, `${path}.opened_at`),
      closed_at: strOrNull(s.closed_at, `${path}.closed_at`),
    })),
    vendors: list('vendors', (v, path) => ({
      vendor_id: uuid(v.vendor_id, `${path}.vendor_id`),
      display_name: str(v.display_name, `${path}.display_name`),
      status: str(v.status, `${path}.status`),
      locked: bool(v.locked, `${path}.locked`),
    })),
    vendor_sessions: list('vendor_sessions', (s, path) => ({
      vendor_session_id: uuid(s.vendor_session_id, `${path}.vendor_session_id`),
      vendor_id: uuid(s.vendor_id, `${path}.vendor_id`),
      device_id: uuid(s.device_id, `${path}.device_id`),
      expires_at: str(s.expires_at, `${path}.expires_at`),
      closed_at: strOrNull(s.closed_at, `${path}.closed_at`),
    })),
    staff: list('staff', (s, path) => ({
      user_id: uuid(s.user_id, `${path}.user_id`),
      issuer: str(s.issuer, `${path}.issuer`),
      subject: str(s.subject, `${path}.subject`),
      status: str(s.status, `${path}.status`),
      roles: [
        ...new Set(
          arr(s.roles, `${path}.roles`).map((r, i) =>
            str(obj(r, `${path}.roles[${i}]`).role, `${path}.roles[${i}].role`),
          ),
        ),
      ],
    })),
    catalogs: list('catalogs', (c, path) => ({
      pos_id: uuid(c.pos_id, `${path}.pos_id`),
      version: nat(c.version, `${path}.version`),
      items: arr(c.items, `${path}.items`).map((raw, i) => {
        const ip = `${path}.items[${i}]`;
        const it = obj(raw, ip);
        return {
          product_id: uuid(it.product_id, `${ip}.product_id`),
          name_fr: str(it.name_fr, `${ip}.name_fr`),
          name_en: str(it.name_en, `${ip}.name_en`),
          category_fr: strOrNull(it.category_fr, `${ip}.category_fr`),
          category_en: strOrNull(it.category_en, `${ip}.category_en`),
          unit_price: big(it.unit_price, `${ip}.unit_price`),
          vat_rate_bps: nat(it.vat_rate_bps, `${ip}.vat_rate_bps`),
        };
      }),
    })),
    media_refs: list('media_refs', (m, path) => ({
      media_id: uuid(m.media_id, `${path}.media_id`),
      token_hash: hex32(m.token_hash, `${path}.token_hash`),
      wallet_id: uuidOrNull(m.wallet_id, `${path}.wallet_id`),
      status: str(m.status, `${path}.status`),
      batch_status: strOrNull(m.batch_status, `${path}.batch_status`),
    })),
    unassigned_media: list('unassigned_media', (m, path) => {
      const base = parseMedia(m, path);
      return {
        ...base,
        media_id: uuid(m.media_id, `${path}.media_id`),
        nfc_uid: str(m.nfc_uid, `${path}.nfc_uid`),
      };
    }),
  };
}

function parseEdgeTerms(value: unknown): EdgeTerms | null {
  if (value === undefined || value === null) return null;
  const o = obj(value, 'edge_terms');
  const out: EdgeTerms = {};
  if (o.max_cash_topup !== undefined) {
    const v = big(o.max_cash_topup, 'edge_terms.max_cash_topup');
    if (v < 1n) fail('edge_terms.max_cash_topup', 'entier strictement positif');
    out.max_cash_topup = v;
  }
  if (o.activation_fee !== undefined) {
    out.activation_fee = big(o.activation_fee, 'edge_terms.activation_fee');
  }
  if (o.spend_order !== undefined) {
    out.spend_order = oneOf(
      o.spend_order,
      ['PROMO_FIRST', 'PAID_FIRST'],
      'edge_terms.spend_order',
    ) as 'PROMO_FIRST' | 'PAID_FIRST';
  }
  if (o.deposit_batches !== undefined) {
    out.deposit_batches = arr(o.deposit_batches, 'edge_terms.deposit_batches').map((raw, i) => {
      const p = `edge_terms.deposit_batches[${i}]`;
      const b = obj(raw, p);
      const mode = b.deposit_mode === undefined ? null : b.deposit_mode;
      if (mode !== null) oneOf(mode, ['FROM_BALANCE', 'SEPARATE'], `${p}.deposit_mode`);
      return {
        batch_id: uuid(b.batch_id, `${p}.batch_id`),
        deposit_amount: big(b.deposit_amount, `${p}.deposit_amount`),
        deposit_mode: mode as 'FROM_BALANCE' | 'SEPARATE' | null,
      };
    });
  }
  return out;
}

export function parseReplicationPage(body: unknown): ReplicationPage {
  const o = obj(body, 'page');
  const wallets = arr(o.wallets, 'wallets').map((raw, i): PageWallet => {
    const p = `wallets[${i}]`;
    const w = obj(raw, p);
    return {
      wallet_id: uuid(w.wallet_id, `${p}.wallet_id`),
      status: str(w.status, `${p}.status`),
      paid: big(w.paid, `${p}.paid`),
      promo: big(w.promo, `${p}.promo`),
      kyc_verified: w.kyc_verified === undefined ? null : bool(w.kyc_verified, `${p}.kyc_verified`),
      topup_month_paid:
        w.topup_month_paid === undefined ? null : big(w.topup_month_paid, `${p}.topup_month_paid`),
    };
  });
  const media = arr(o.media, 'media').map((raw, i) => parseMedia(raw, `media[${i}]`));
  let seqAcked: SeqAcked[] | null = null;
  if (o.device_seq_acked !== undefined) {
    seqAcked = arr(o.device_seq_acked, 'device_seq_acked').map((raw, i) => {
      const p = `device_seq_acked[${i}]`;
      const s = obj(raw, p);
      return {
        device_id: uuid(s.device_id, `${p}.device_id`),
        contiguous_acked_seq: nat(s.contiguous_acked_seq, `${p}.contiguous_acked_seq`),
        as_of: str(s.as_of, `${p}.as_of`),
      };
    });
  }
  return {
    ledger_id: uuid(o.ledger_id, 'ledger_id'),
    epoch: nat(o.epoch, 'epoch'),
    from_posting_id: nat(o.from_posting_id, 'from_posting_id'),
    to_posting_id: nat(o.to_posting_id, 'to_posting_id'),
    has_more: bool(o.has_more, 'has_more'),
    wallets,
    media,
    edge_seq_applied: nat(o.edge_seq_applied, 'edge_seq_applied'),
    device_seq_acked: seqAcked,
    pwd_pack_key:
      o.pwd_pack_key === undefined || o.pwd_pack_key === null
        ? null
        : wrappedKey(o.pwd_pack_key, 'pwd_pack_key'),
    reference: parseReference(o.reference),
    edge_terms: parseEdgeTerms(o.edge_terms),
  };
}
