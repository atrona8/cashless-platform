// Enrôlement de la passerelle (interfaces.md § 13.1 et § 13.2, T118).
//
//  - `buildRequest` / `writeRequest` (`gateway request`) : crée les clés dans `HARDWARE_KEYSTORE`
// (jamais exportées) et
//    produit la demande JSON `{ serial, role, csr_pem, batch_public_key, snapshot_key_id,
// snapshot_public_key,
//    token_public_key, agreement_public_key, lan_url }`, SANS aucun secret.
//  - `enroll` (`gateway enroll <fichier>`) : valide strictement le fichier d'enrôlement produit par
// l'outil (WP15),
//    remplit `edge_meta`, `edge_site_order_key` (exactement DEUX clés distinctes),
// `edge_chain_head` (genèse calculée
//    par `@cashless/shared-rules`, jamais en SQL) et `edge_authority` en UNE transaction, puis
// SUPPRIME le fichier.
//  - Sans enrôlement la passerelle refuse de servir (`assertEnrolled`, appelé par le démarrage).
//
// Formats des clés (le FORMATS.md de WP15 n'existe pas encore, signalé au rapport) : clés publiques
// de la demande en
// base64url d'un SPKI DER, sauf `agreement_public_key` : point non compressé de 65 octets
// (`agreement_public_key` du
// central). Clés de site : PEM SPKI ou base64/base64url d'un SPKI DER, courbe P-256 exigée.
import { createHash, createPublicKey, X509Certificate, type KeyObject } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { edgeChainGenesis } from '@cashless/shared-rules';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { GatewayTx } from '../db/gateway-tx';
import { HARDWARE_KEYSTORE, type HardwareKeystore } from '../key-store/hardware-keystore.port';
import { authorityViolation } from '../processes/startup-guard';
import { buildCsrPem } from './csr';

export type EnrollmentErrorCode =
  | 'REQUEST_INVALID'
  | 'FILE_UNREADABLE'
  | 'FILE_INVALID'
  | 'ALREADY_ENROLLED'
  | 'NOT_ENROLLED'
  | 'KEY_MISMATCH'
  | 'FILE_NOT_DELETED';

export class EnrollmentError extends Error {
  constructor(
    readonly code: EnrollmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EnrollmentError';
  }
}

export interface EnrollmentRequest {
  serial: string;
  role: 'PRIMARY' | 'STANDBY';
  csr_pem: string;
  batch_public_key: string;
  snapshot_key_id: string;
  snapshot_public_key: string;
  token_public_key: string;
  agreement_public_key: string;
  lan_url: string;
}

export interface SiteOrderKey {
  holder: string;
  public_key: string;
}

export interface EnrollmentFile {
  gateway_id: string;
  operator_id: string;
  event_id: string;
  ledger_id: string;
  serial: string;
  role: 'PRIMARY' | 'STANDBY';
  central_url: string;
  central_ca_pem: string;
  device_ca_pem: string;
  client_cert_pem: string;
  lan_authority: string;
  site_order_keys: [SiteOrderKey, SiteOrderKey];
}

const FILE_KEYS = [
  'gateway_id',
  'operator_id',
  'event_id',
  'ledger_id',
  'serial',
  'role',
  'central_url',
  'central_ca_pem',
  'device_ca_pem',
  'client_cert_pem',
  'lan_authority',
  'site_order_keys',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const b64url = (buffer: Buffer): string => buffer.toString('base64url');

function fail(code: EnrollmentErrorCode, message: string): never {
  throw new EnrollmentError(code, message);
}

function exactKeys(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('FILE_INVALID', `${what} : objet attendu`);
  }
  const record = value as Record<string, unknown>;
  const missing = keys.filter((key) => !(key in record));
  const extra = Object.keys(record).filter((key) => !keys.includes(key));
  if (missing.length > 0) fail('FILE_INVALID', `${what} : champ manquant (${missing.join(', ')})`);
  if (extra.length > 0) fail('FILE_INVALID', `${what} : champ inconnu (${extra.join(', ')})`);
  return record;
}

function text(record: Record<string, unknown>, key: string, max = 4096): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    return fail('FILE_INVALID', `${key} : texte non vide attendu`);
  }
  return value;
}

function uuid(record: Record<string, unknown>, key: string): string {
  const value = text(record, key, 64);
  if (!UUID.test(value)) fail('FILE_INVALID', `${key} : UUID attendu`);
  return value.toLowerCase();
}

function certificate(record: Record<string, unknown>, key: string): X509Certificate {
  const pem = text(record, key, 65536);
  try {
    return new X509Certificate(pem);
  } catch {
    return fail('FILE_INVALID', `${key} : certificat PEM illisible`);
  }
}

/** Clé de site : PEM SPKI ou base64/base64url d'un SPKI DER ; P-256 exigée. */
function siteKey(value: unknown): KeyObject {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4096) {
    return fail('FILE_INVALID', 'site_order_keys[].public_key : texte non vide attendu');
  }
  let key: KeyObject;
  try {
    key = value.includes('BEGIN')
      ? createPublicKey(value)
      : createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return fail('FILE_INVALID', 'site_order_keys[].public_key : clé publique illisible');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    fail('FILE_INVALID', 'site_order_keys[].public_key : clé P-256 attendue');
  }
  return key;
}

/** Valide le fichier d'enrôlement ; ne lit ni ne rend jamais de valeur secrète dans ses messages. */
export function parseEnrollmentFile(raw: string, config?: GatewayConfig): EnrollmentFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail('FILE_INVALID', 'fichier d’enrôlement : JSON illisible');
  }
  const record = exactKeys(json, FILE_KEYS, 'fichier d’enrôlement');
  // Aucun secret dans le fichier : une clé privée, où qu'elle soit, le fait refuser.
  if (/PRIVATE KEY/.test(raw)) fail('FILE_INVALID', 'fichier d’enrôlement : clé privée interdite');
  const role = text(record, 'role', 16);
  if (role !== 'PRIMARY' && role !== 'STANDBY') fail('FILE_INVALID', 'role : PRIMARY ou STANDBY');
  const centralUrl = text(record, 'central_url', 512);
  let protocol = '';
  try {
    protocol = new URL(centralUrl).protocol;
  } catch {
    fail('FILE_INVALID', 'central_url : URL illisible');
  }
  if (
    protocol !== 'https:' &&
    !(protocol === 'http:' && config !== undefined && !config.production)
  ) {
    fail('FILE_INVALID', 'central_url : https obligatoire');
  }
  const lanAuthority = text(record, 'lan_authority', 300);
  if (authorityViolation(lanAuthority) !== null) {
    fail('FILE_INVALID', 'lan_authority : hôte:port d’une seule adresse attendu, sans joker');
  }
  if (config?.requestAuthority && config.requestAuthority !== lanAuthority) {
    fail('FILE_INVALID', 'lan_authority : différent de GATEWAY_REQUEST_AUTHORITY');
  }
  certificate(record, 'central_ca_pem');
  certificate(record, 'device_ca_pem');
  certificate(record, 'client_cert_pem');

  const keys = record.site_order_keys;
  if (!Array.isArray(keys) || keys.length !== 2) {
    return fail('FILE_INVALID', 'site_order_keys : exactement deux clés de site attendues');
  }
  const parsed = keys.map((entry) => {
    const item = exactKeys(entry, ['holder', 'public_key'], 'site_order_keys[]');
    const holder = text(item, 'holder', 200);
    const der = siteKey(item.public_key).export({ type: 'spki', format: 'der' });
    return { holder, public_key: text(item, 'public_key'), fingerprint: der.toString('hex') };
  });
  if (parsed[0]!.holder === parsed[1]!.holder)
    fail('FILE_INVALID', 'site_order_keys : responsables identiques');
  if (parsed[0]!.fingerprint === parsed[1]!.fingerprint) {
    fail('FILE_INVALID', 'site_order_keys : les deux clés doivent être distinctes');
  }
  return {
    gateway_id: uuid(record, 'gateway_id'),
    operator_id: uuid(record, 'operator_id'),
    event_id: uuid(record, 'event_id'),
    ledger_id: uuid(record, 'ledger_id'),
    serial: text(record, 'serial', 128),
    role,
    central_url: centralUrl,
    central_ca_pem: text(record, 'central_ca_pem', 65536),
    device_ca_pem: text(record, 'device_ca_pem', 65536),
    client_cert_pem: text(record, 'client_cert_pem', 65536),
    lan_authority: lanAuthority,
    site_order_keys: [
      { holder: parsed[0]!.holder, public_key: parsed[0]!.public_key },
      { holder: parsed[1]!.holder, public_key: parsed[1]!.public_key },
    ],
  };
}

@Injectable()
export class EnrollmentService {
  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(HARDWARE_KEYSTORE) private readonly keystore: HardwareKeystore,
    @Optional() @Inject(GATEWAY_CONFIG) private readonly config?: GatewayConfig,
  ) {}

  async buildRequest(input: {
    serial: string;
    role: 'PRIMARY' | 'STANDBY';
    lanAuthority: string;
  }): Promise<EnrollmentRequest> {
    if (input.serial.trim() === '' || input.serial.length > 128) {
      fail('REQUEST_INVALID', 'serial : texte de 1 à 128 caractères attendu');
    }
    if (input.role !== 'PRIMARY' && input.role !== 'STANDBY') {
      fail('REQUEST_INVALID', 'role : PRIMARY ou STANDBY');
    }
    if (authorityViolation(input.lanAuthority) !== null) {
      fail('REQUEST_INVALID', 'GATEWAY_REQUEST_AUTHORITY : hôte:port d’une seule adresse attendu');
    }
    const snapshot = await this.keystore.publicKey('snapshot');
    const agreement = await this.keystore.publicKey('agreement');
    return {
      serial: input.serial,
      role: input.role,
      csr_pem: await buildCsrPem(this.keystore, 'batch', input.serial),
      batch_public_key: b64url(await this.keystore.publicKey('batch')),
      snapshot_key_id: `snap-${createHash('sha256').update(snapshot).digest('hex').slice(0, 16)}`,
      snapshot_public_key: b64url(snapshot),
      token_public_key: b64url(await this.keystore.publicKey('token')),
      // Point non compressé (65 octets) : la fin d'un SPKI P-256.
      agreement_public_key: b64url(agreement.subarray(agreement.length - 65)),
      lan_url: `https://${input.lanAuthority}`,
    };
  }

  async writeRequest(
    path: string,
    input: Parameters<EnrollmentService['buildRequest']>[0],
  ): Promise<void> {
    const request = await this.buildRequest(input);
    await writeFile(path, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  }

  async isEnrolled(): Promise<boolean> {
    return this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query('SELECT 1 FROM edge_meta');
      return rows.length === 1;
    });
  }

  /** Refuse de servir sans enrôlement. */
  async assertEnrolled(): Promise<void> {
    if (!(await this.isEnrolled())) {
      fail(
        'NOT_ENROLLED',
        'passerelle non enrôlée : produire la demande (gateway request) puis enrôler',
      );
    }
  }

  async enroll(path: string): Promise<{ gatewayId: string }> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return fail('FILE_UNREADABLE', 'fichier d’enrôlement illisible');
    }
    const file = parseEnrollmentFile(raw, this.config);
    // Le certificat client du central doit porter la clé de lot de CE matériel.
    const own = await this.keystore.publicKey('batch');
    const certKey = new X509Certificate(file.client_cert_pem).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    if (!own.equals(certKey)) {
      fail(
        'KEY_MISMATCH',
        'client_cert_pem : ne porte pas la clé de lot du matériel de cette passerelle',
      );
    }
    if (new Date(new X509Certificate(file.client_cert_pem).validTo).getTime() <= Date.now()) {
      fail('FILE_INVALID', 'client_cert_pem : certificat expiré');
    }
    await this.gatewayTx.run(async (tx) => {
      const existing = await tx.query('SELECT 1 FROM edge_meta');
      if (existing.rows.length > 0) fail('ALREADY_ENROLLED', 'passerelle déjà enrôlée');
      await tx.query(
        `INSERT INTO edge_meta (gateway_id, operator_id, event_id, ledger_id, serial, role, central_url,
                                lan_authority, central_ca_pem, device_ca_pem, client_cert_pem)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          file.gateway_id,
          file.operator_id,
          file.event_id,
          file.ledger_id,
          file.serial,
          file.role,
          file.central_url,
          file.lan_authority,
          file.central_ca_pem,
          file.device_ca_pem,
          file.client_cert_pem,
        ],
      );
      for (const key of file.site_order_keys) {
        await tx.query('INSERT INTO edge_site_order_key (holder, public_key) VALUES ($1, $2)', [
          key.holder,
          key.public_key,
        ]);
      }
      await tx.query('INSERT INTO edge_chain_head (last_chain_hash) VALUES ($1)', [
        edgeChainGenesis(file.gateway_id),
      ]);
      await tx.query('INSERT INTO edge_authority (state) VALUES ($1)', [
        file.role === 'PRIMARY' ? 'ARMED' : 'STANDBY',
      ]);
      await tx.query(
        `INSERT INTO edge_audit (kind, actor, detail) VALUES ('ENROLLED', 'gateway', $1)`,
        [JSON.stringify({ gateway_id: file.gateway_id, role: file.role, site_keys: 2 })],
      );
    });
    try {
      await unlink(path);
    } catch {
      fail(
        'FILE_NOT_DELETED',
        'enrôlement enregistré, mais le fichier n’a pas pu être supprimé : le supprimer',
      );
    }
    return { gatewayId: file.gateway_id };
  }
}
