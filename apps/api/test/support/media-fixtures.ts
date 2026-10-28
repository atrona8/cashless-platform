// Jeu d'essai des bracelets, commun aux suites de la mission : deux prestataires, leurs organisateurs, un événement
// et son grand livre, une clé de bracelet par prestataire (celle de A est la clé de test du kit), des lots, un poste
// de personnalisation factice avec sa paire de clés, et de quoi poser des bracelets personnalisés en nombre avec le
// faux service de clés (mêmes octets que par la route).
import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  derivationMessage,
  openForRecipient,
  pwdPackAad,
  sealPwdPack,
  splitPwdPack,
  stationAad,
  type EncryptedBlob,
} from '@cashless/tag-format';
import type { Client } from 'pg';
import { FakeKms, KIT_VECTOR_HMAC_KEY_REF, TEST_WRAPPING_KEY_REF } from '../../src/kms/fake-kms';
import { createOperators, type Operators } from '../integration/transverse/fixtures';
import { withOwner } from './db';
import { FakeIdp, type TestPerson } from './fake-idp';

export const MEDIA_KEY_INDEX = 1;

export interface MediaWorld {
  idp: FakeIdp;
  ops: Operators;
  ids: { organizerA: string; organizerB: string; eventA: string; ledgerA: string; walletA: string };
  /** Référence de la clé de dérivation de chaque prestataire (index `MEDIA_KEY_INDEX`). */
  keyRef: { a: string; b: string };
  personalizerA: TestPerson;
  personalizerB: TestPerson;
  operatorAdminA: TestPerson;
  organizerAdminA: TestPerson;
  platformAdmin: TestPerson;
  /** CASHIER de l'événement A ; SUPERVISOR de l'organisateur A ; CASHIER de l'organisateur B (autre prestataire). */
  cashierA: TestPerson;
  supervisorA: TestPerson;
  cashierB: TestPerson;
}

export const ownerRows = <T>(sql: string, params: unknown[] = []) =>
  withOwner(async (db) => (await db.query(sql, params)).rows as T[]);

export async function createMediaWorld(): Promise<MediaWorld> {
  const idp = await FakeIdp.create();
  const ops = await createOperators();
  const ids = {
    organizerA: randomUUID(),
    organizerB: randomUUID(),
    eventA: randomUUID(),
    ledgerA: '',
    walletA: randomUUID(),
  };
  const keyRef = { a: KIT_VECTOR_HMAC_KEY_REF, b: `fake-kms:hmac:${randomUUID()}` };
  const people = {} as Pick<
    MediaWorld,
    | 'personalizerA'
    | 'personalizerB'
    | 'operatorAdminA'
    | 'organizerAdminA'
    | 'platformAdmin'
    | 'cashierA'
    | 'supervisorA'
    | 'cashierB'
  >;
  await withOwner(async (db) => {
    await db.query(
      `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
    );
    await db.query(
      `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $3, 'Organisateur A', 'SN'), ($2, 'ORGANIZER', $4, 'Organisateur B', 'SN')`,
      [ids.organizerA, ids.organizerB, ops.a, ops.b],
    );
    const profile = randomUUID();
    await db.query(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
      [profile],
    );
    await db.query(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES ($1, $2, $3, 'Événement A', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
      [ids.eventA, ops.a, ids.organizerA, profile],
    );
    await db.query(`SELECT set_config('app.operator_id', $1, false)`, [ops.a]);
    ids.ledgerA = (
      await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [ids.eventA])
    ).rows[0]!.ledger;
    await db.query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
      ids.walletA,
      ops.a,
      ids.ledgerA,
    ]);
    await db.query(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, ${MEDIA_KEY_INDEX}, $3), ($2, ${MEDIA_KEY_INDEX}, $4)`,
      [ops.a, ops.b, keyRef.a, keyRef.b],
    );
    const person = (
      operatorId: string | null,
      roles: Parameters<FakeIdp['createPerson']>[1]['roles'],
    ) => idp.createPerson(db, { operatorId, roles });
    people.personalizerA = await person(ops.a, [
      { role: 'PERSONALIZER', scopeType: 'OPERATOR', scopeId: ops.a },
    ]);
    people.personalizerB = await person(ops.b, [
      { role: 'PERSONALIZER', scopeType: 'OPERATOR', scopeId: ops.b },
    ]);
    people.operatorAdminA = await person(ops.a, [
      { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a },
    ]);
    people.organizerAdminA = await person(ops.a, [
      { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.organizerA },
    ]);
    people.platformAdmin = await person(null, [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }]);
    people.cashierA = await person(ops.a, [
      { role: 'CASHIER', scopeType: 'EVENT', scopeId: ids.eventA },
    ]);
    people.supervisorA = await person(ops.a, [
      { role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: ids.organizerA },
    ]);
    people.cashierB = await person(ops.b, [
      { role: 'CASHIER', scopeType: 'ORGANIZER', scopeId: ids.organizerB },
    ]);
  });
  return { idp, ops, ids, keyRef, ...people };
}

export interface BatchOptions {
  operatorId: string;
  organizerId: string;
  eventId?: string | null;
  kind?: 'PUBLIC' | 'STAFF' | 'VIP';
  quantity?: number;
  keyIndex?: number;
  status?: 'ORDERED' | 'PERSONALIZED' | 'DELIVERED' | 'ACTIVE';
  depositAmount?: number;
  depositMode?: 'FROM_BALANCE' | 'SEPARATE';
  preloadPromoAmount?: number;
}

/** Lot posé directement (sa création par la route est prouvée dans sa propre suite) ; rend son identifiant. */
export async function createBatch(db: Client, options: BatchOptions): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index, status, deposit_amount, deposit_mode, preload_promo_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      options.operatorId,
      options.organizerId,
      options.eventId ?? null,
      options.kind ?? 'PUBLIC',
      options.quantity ?? 100,
      options.keyIndex ?? MEDIA_KEY_INDEX,
      options.status ?? 'ORDERED',
      options.depositAmount ?? 0,
      options.depositMode ?? null,
      options.preloadPromoAmount ?? 0,
    ],
  );
  return rows[0]!.id;
}

/** Poste de personnalisation factice : une paire de clés à usage unique, et l'ouverture de l'enveloppe reçue. */
export function createStation() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    /** Ouvre l'enveloppe de `registerPersonalizedMedia` : rend `PWD‖PACK`. */
    open: (blob: EncryptedBlob, mediaId: string, uid: string | Uint8Array): Buffer =>
      openForRecipient({
        recipientPrivateKey: privateKey,
        blob,
        aad: stationAad(mediaId, typeof uid === 'string' ? Buffer.from(uid, 'hex') : uid),
      }),
  };
}

/** Puce neuve lue par le poste : identité (jamais envoyée), son empreinte, UID, signature d'originalité. */
export function createChip() {
  const identity = randomBytes(16);
  return {
    identity,
    tokenHash: createHash('sha256').update(identity).digest('hex'),
    uid: Buffer.concat([Buffer.from([0x04]), randomBytes(6)]).toString('hex'),
    signature: randomBytes(32),
  };
}

export function personalizationBody(
  batchId: string,
  chip: ReturnType<typeof createChip>,
  station: Pick<ReturnType<typeof createStation>, 'publicKey'>,
  overrides: Record<string, unknown> = {},
) {
  return {
    batch_id: batchId,
    token_hash: chip.tokenHash,
    nfc_uid: chip.uid,
    originality_signature: chip.signature.toString('base64'),
    signature_ok: true,
    station_public_key: station.publicKey,
    ...overrides,
  };
}

/** `PWD‖PACK` attendu pour une puce, calculé comme le fait le service de clés (faux : mêmes clés que les processus). */
export async function expectedPwdPack(
  kmsKeyRef: string,
  operatorId: string,
  keyIndex: number,
  uid: string,
): Promise<Buffer> {
  const mac = await new FakeKms().generateMac(
    kmsKeyRef,
    derivationMessage({ operatorId, keyIndex, uid: Buffer.from(uid, 'hex') }),
  );
  return splitPwdPack(mac).pwdPack;
}

export interface SeededMedia {
  id: string;
  uid: string;
  identity: Buffer;
  tokenHash: Buffer;
  /** Signature d'originalité de la puce (32 octets) : la base n'en garde que l'empreinte. */
  signature: Buffer;
  pwdPack: Buffer;
}

/**
 * Bracelets personnalisés posés directement, pour les gros volumes : mot de passe calculé par le faux service de clés,
 * scellé sous une clé de données ACTIVE ouverte pour l'occasion (les précédentes ne servent plus qu'à déchiffrer).
 */
export async function seedPersonalizedMedia(
  db: Client,
  input: {
    operatorId: string;
    batchId: string;
    kmsKeyRef: string;
    keyIndex?: number;
    count: number;
    status?: 'PERSONALIZED' | 'ISSUED';
  },
): Promise<SeededMedia[]> {
  const kms = new FakeKms();
  const keyIndex = input.keyIndex ?? MEDIA_KEY_INDEX;
  const { plaintext, encrypted } = await kms.generateDataKey(TEST_WRAPPING_KEY_REF);
  await db.query(
    `UPDATE tag_data_key SET status = 'DECRYPT_ONLY' WHERE operator_id = $1 AND key_index = $2 AND status = 'ACTIVE'`,
    [input.operatorId, keyIndex],
  );
  const dek = await db.query<{ id: string }>(
    `INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek, status)
     VALUES ($1, $2, 1 + coalesce((SELECT max(version) FROM tag_data_key WHERE operator_id = $1 AND key_index = $2), 0), $3, $4, 'ACTIVE') RETURNING id`,
    [input.operatorId, keyIndex, TEST_WRAPPING_KEY_REF, encrypted],
  );
  const media: SeededMedia[] = [];
  const blobs: Buffer[] = [];
  for (let i = 0; i < input.count; i += 1) {
    const chip = createChip();
    const id = randomUUID();
    const pwdPack = await expectedPwdPack(input.kmsKeyRef, input.operatorId, keyIndex, chip.uid);
    blobs.push(
      sealPwdPack({
        dek: plaintext,
        nonce: randomBytes(12),
        pwdPack,
        aad: pwdPackAad({
          mediaId: id,
          operatorId: input.operatorId,
          keyIndex,
          uid: Buffer.from(chip.uid, 'hex'),
        }),
      }),
    );
    media.push({
      id,
      uid: chip.uid,
      identity: chip.identity,
      tokenHash: Buffer.from(chip.tokenHash, 'hex'),
      signature: chip.signature,
      pwdPack,
    });
  }
  plaintext.fill(0);
  await db.query(
    `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, batch_id, status, personalized_at, signature_ok, originality_sig_sha256, pwd_pack_enc, pwd_pack_dek_id)
     SELECT m.id, $1, 'NFC_TAG', m.token_hash, m.uid, $2, $3, $4, clock_timestamp(), true, sha256(m.signature), m.blob, $5
       FROM unnest($6::uuid[], $7::bytea[], $8::bytea[], $9::bytea[], $10::bytea[]) AS m(id, token_hash, uid, blob, signature)`,
    [
      input.operatorId,
      keyIndex,
      input.batchId,
      input.status ?? 'PERSONALIZED',
      dek.rows[0]!.id,
      media.map((m) => m.id),
      media.map((m) => m.tokenHash),
      media.map((m) => Buffer.from(m.uid, 'hex')),
      blobs,
      media.map((m) => m.signature),
    ],
  );
  return media;
}

/** Active des bracelets posés directement (remise et rattachement à un portefeuille), par la fonction du schéma. */
export async function activateMedia(
  db: Client,
  input: { operatorId: string; eventId: string; walletId: string; mediaIds: string[] },
): Promise<void> {
  await db.query(`SELECT set_config('app.operator_id', $1, false)`, [input.operatorId]);
  for (const id of input.mediaIds)
    await db.query(`SELECT activate_media($1, $2, 'DESK', $3)`, [
      id,
      input.walletId,
      input.eventId,
    ]);
}

/** Corps de `POST /taps` (ou lecture embarquée) pour un bracelet du jeu d'essai. */
export function tapBody(
  media: Pick<SeededMedia, 'uid' | 'tokenHash' | 'signature'>,
  counter: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    nfc_uid: media.uid,
    token_hash: media.tokenHash.toString('hex'),
    counter,
    key_index: MEDIA_KEY_INDEX,
    format_major: 1,
    format_minor: 0,
    pack_verified: true,
    originality_signature: media.signature.toString('hex'),
    occurred_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Met un événement en service par la fonction du schéma (le passage par l'API est prouvé à la mission 3). */
export async function goLive(
  db: Client,
  operatorId: string,
  eventId: string,
  actorId: string,
): Promise<void> {
  await db.query(`SELECT set_config('app.operator_id', $1, false)`, [operatorId]);
  await db.query(`SELECT set_event_status($1, 'LIVE', $2)`, [eventId, actorId]);
}

/**
 * Compte de caisse d'un terminal (`A-CAISSE-<n° de série>`), posé directement, hors `cash_desk` : pour les tests qui
 * n'écrivent pas d'espèces. Toute écriture d'espèces passe par `openCashSession`, qui reprend ce compte.
 */
export async function openCashDesk(
  db: Client,
  input: { operatorId: string; ledgerId: string; organizerId: string; serial: string },
): Promise<string> {
  const code = `A-CAISSE-${input.serial}`;
  await db.query(
    `INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative) VALUES ($1, $2, $3, 'ASSET', 'CASH_DESK', $4, 'D', false)`,
    [input.operatorId, input.ledgerId, code, input.organizerId],
  );
  return code;
}

/**
 * Session de caisse OUVERTE d'un terminal `TOPUP_DESK` d'un événement en service (`open_cash_session`, mission des
 * caisses) : crée au besoin le compte `A-CAISSE-<série>` et l'inscrit à la caisse. Aucune écriture au grand livre.
 */
export async function openCashSession(
  db: Client,
  input: { operatorId: string; deviceId: string; userId: string },
): Promise<{ sessionId: string; accountId: string; code: string }> {
  await db.query(`SELECT set_config('app.operator_id', $1, false)`, [input.operatorId]);
  const { rows } = await db.query<{
    cash_session_id: string;
    cash_account_id: string;
    account_code: string;
  }>('SELECT cash_session_id, cash_account_id, account_code FROM open_cash_session($1, $2)', [
    input.deviceId,
    input.userId,
  ]);
  const row = rows[0]!;
  return { sessionId: row.cash_session_id, accountId: row.cash_account_id, code: row.account_code };
}

/** Crédit payé sur un portefeuille (recharge confirmée), écrit directement au grand livre. */
export async function creditWallet(
  db: Client,
  input: { operatorId: string; ledgerId: string; walletId: string; amount: number },
): Promise<void> {
  await db.query(`SELECT set_config('app.operator_id', $1, false)`, [input.operatorId]);
  await db.query(
    `SELECT post_transaction($1, 'TOPUP', $2, now(), 'PSP_WEBHOOK', jsonb_build_array(
       jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'BANK'), 'amount', $4::bigint),
       jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $3 AND purpose = 'WALLET_PAID'), 'amount', -$4::bigint)))`,
    [input.ledgerId, `test-topup:${randomUUID()}`, input.walletId, input.amount],
  );
}

/** Le grand livre est-il équilibré, et ses soldes en cache égaux au recalcul ? */
export async function ledgerIsSound(
  ledgerId: string,
): Promise<{ unbalanced: number; drift: number }> {
  return withOwner(async (db) => {
    const unbalanced = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT p.transaction_id FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id WHERE t.ledger_id = $1
                                        GROUP BY p.transaction_id HAVING sum(p.amount) <> 0) x`,
      [ledgerId],
    );
    const drift = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM balance_drift d JOIN account a ON a.id = d.account_id WHERE a.ledger_id = $1`,
      [ledgerId],
    );
    return { unbalanced: unbalanced.rows[0]!.n, drift: drift.rows[0]!.n };
  });
}
