// Aides des suites de routes du processus `edge` (WP12) : requêtes HTTPS JSON avec certificat de passerelle, et
// scénarios posés par le PROPRIÉTAIRE (amorçage seulement : événement, passerelle, accord, demande de retour, écritures
// du registre). Tout ce que le test éprouve passe par les routes de la passerelle ; l'octroi et la demande de retour
// (côté humains, WP11) sont rejoués par les fonctions de la base.
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { request } from 'node:https';
import type { Client } from 'pg';
import {
  addGateway,
  edgeTls,
  newEvent,
  type ClientCert,
  type EdgeWorld,
  type Reply,
} from '../../../support/edge-fixtures';

export interface SendOptions {
  client?: ClientCert;
  body?: unknown;
  /** Corps brut (prioritaire sur `body`). */
  raw?: string;
  headers?: Record<string, string>;
}

/** Requête HTTPS sur le processus `edge` (GET sans corps, POST avec corps JSON). */
export async function edgeSend(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  options: SendOptions = {},
): Promise<Reply> {
  const { tls } = await edgeTls();
  const payload =
    options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const started = Date.now();
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: `/v1${path}`,
        method,
        ca: tls.serverCaPem,
        servername: 'localhost',
        ...(options.client ? { cert: options.client.certPem, key: options.client.keyPem } : {}),
        headers: {
          ...(payload !== undefined
            ? {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(payload)),
              }
            : {}),
          ...options.headers,
        },
        timeout: 40_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode ?? 0,
            body: text,
            json,
            elapsedMs: Date.now() - started,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** Corps d'erreur sans l'identifiant de requête (`instance`) : deux refus de même nature sont identiques. */
export function problemShape(reply: Reply): string {
  const { instance: _instance, ...rest } = reply.json ?? {};
  return JSON.stringify({ status: reply.status, ...rest });
}

export interface Gw {
  id: string;
  cert: ClientCert;
  eventId: string;
  ledgerId: string;
}

/** Nouvel événement du prestataire de `world` et sa passerelle (certificat émis par l'autorité de test). */
export async function newGateway(
  owner: Client,
  world: EdgeWorld,
  options: {
    role?: 'PRIMARY' | 'STANDBY';
    status?: string;
    eventId?: string;
    ledgerId?: string;
  } = {},
): Promise<Gw> {
  const { edgeCa } = await edgeTls();
  const cert = await edgeCa.issue(`gw-${randomUUID().slice(0, 8)}`);
  const event = options.eventId
    ? { eventId: options.eventId, ledgerId: options.ledgerId! }
    : await newEvent(owner, world);
  const id = await addGateway(owner, world, event.eventId, {
    sha256: cert.sha256,
    ...(options.role ? { role: options.role } : {}),
    ...(options.status ? { status: options.status } : {}),
  });
  return { id, cert, eventId: event.eventId, ledgerId: event.ledgerId };
}

export interface Granted {
  id: string;
  epoch: number;
  watermark: number;
  referenceWatermark: number;
}

const actor = (): string => randomUUID();

/** Octroi de l'autorité (humain, WP11) rejoué sous le propriétaire : handover `GRANTED`. */
export async function grant(owner: Client, world: EdgeWorld, gw: Gw): Promise<Granted> {
  await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
  const { rows } = await owner.query<{
    id: string;
    epoch: number;
    watermark_posting_id: string;
    reference_watermark_seq: string;
  }>('SELECT * FROM edge_grant_authority($1, $2, $3)', [gw.ledgerId, gw.id, actor()]);
  const row = rows[0]!;
  return {
    id: row.id,
    epoch: Number(row.epoch),
    watermark: Number(row.watermark_posting_id),
    referenceWatermark: Number(row.reference_watermark_seq),
  };
}

export const ackBody = (granted: Granted, overrides: Record<string, unknown> = {}) => ({
  epoch: granted.epoch,
  replicated_posting_id: granted.watermark,
  ...overrides,
});

/** La passerelle relit une page avec son curseur de référence final (preuve d'application, A03). */
export function applyReference(port: number, gw: Gw, granted: Granted): Promise<Reply> {
  return edgeSend(
    port,
    'GET',
    `/edge/replication-feed?after_posting_id=0&limit=200&after_change_seq=${granted.referenceWatermark}`,
    { client: gw.cert },
  );
}

/** Octroi puis accusé par la route : l'autorité est `ACTIVE` sur la passerelle. */
export async function activate(
  owner: Client,
  world: EdgeWorld,
  port: number,
  gw: Gw,
): Promise<Granted> {
  const granted = await grant(owner, world, gw);
  const page = await applyReference(port, gw, granted);
  if (page.status !== 200) throw new Error(`flux refusé : ${page.status} ${page.body}`);
  const ack = await edgeSend(port, 'POST', `/edge/handovers/${granted.id}/ack`, {
    client: gw.cert,
    body: ackBody(granted),
  });
  if (ack.status !== 200) throw new Error(`accusé refusé : ${ack.status} ${ack.body}`);
  return granted;
}

export interface ReleaseAsk {
  id: string;
  epoch: number;
}

/** Demande de retour au central (humain, WP11) : handover `RELEASE_REQUESTED`. */
export async function requestRelease(owner: Client, world: EdgeWorld, gw: Gw): Promise<ReleaseAsk> {
  await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
  const { rows } = await owner.query<{ id: string; epoch: number }>(
    'SELECT * FROM request_edge_release($1, $2)',
    [gw.ledgerId, actor()],
  );
  return { id: rows[0]!.id, epoch: Number(rows[0]!.epoch) };
}

/** Opérations `from..to` reçues au registre du central (amorçage) ; rend l'empreinte de chaîne finale. */
export async function recordOps(
  owner: Client,
  world: EdgeWorld,
  gw: Gw,
  from: number,
  to: number,
): Promise<string> {
  await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
  let hash = '';
  for (let seq = from; seq <= to; seq += 1) {
    const content = createHash('sha256').update(`op-${gw.id}-${seq}`).digest();
    const { rows } = await owner.query<{ chain_hash: Buffer }>(
      `SELECT chain_hash FROM record_edge_seq($1, $2, $3, $4, 'ACCEPTED')`,
      [gw.id, seq, `origin-${gw.id}-${seq}`, content],
    );
    hash = rows[0]!.chain_hash.toString('hex');
  }
  return hash;
}

/** Saute le registre jusqu'à `seq` (cycle précédent déjà vidangé) en posant la chaîne attendue. */
export async function jumpRegistry(owner: Client, gw: Gw, seq: number): Promise<string> {
  const hash = createHash('sha256').update(`jump-${gw.id}-${seq}`).digest();
  await owner.query(
    'UPDATE edge_gateway SET contiguous_edge_seq = $2, last_chain_hash = $3 WHERE id = $1',
    [gw.id, seq, hash],
  );
  return hash.toString('hex');
}

export const handoverRow = async (owner: Client, id: string) =>
  (
    await owner.query<{
      status: string;
      epoch: number;
      edge_seq_at_activation: string | null;
      updated_at: Date;
    }>(
      'SELECT status, epoch, edge_seq_at_activation, updated_at FROM debit_authority_handover WHERE id = $1',
      [id],
    )
  ).rows[0]!;

export const ledgerEpoch = async (owner: Client, ledgerId: string): Promise<number> =>
  Number(
    (await owner.query('SELECT authority_epoch FROM ledger WHERE id = $1', [ledgerId])).rows[0]
      .authority_epoch,
  );

/** Empreinte de chaîne après les opérations `from..to` (mêmes contenus que `recordOps`), sans les enregistrer. */
export function chainAfter(gw: Gw, prevHex: string | null, from: number, to: number): string {
  let hash =
    prevHex === null
      ? createHash('sha256')
          .update(Buffer.concat([Buffer.from('CASHLESS/EDGE-CHAIN/v1', 'utf8'), uuidBytes(gw.id)]))
          .digest()
      : Buffer.from(prevHex, 'hex');
  for (let seq = from; seq <= to; seq += 1) {
    const content = createHash('sha256').update(`op-${gw.id}-${seq}`).digest();
    hash = createHash('sha256')
      .update(Buffer.concat([hash, content]))
      .digest();
  }
  return hash.toString('hex');
}

const uuidBytes = (id: string): Buffer => Buffer.from(id.replace(/-/g, ''), 'hex');

const acc = async (owner: Client, ledgerId: string, code: string): Promise<string> =>
  (
    await owner.query<{ id: string }>('SELECT id FROM account WHERE ledger_id = $1 AND code = $2', [
      ledgerId,
      code,
    ])
  ).rows[0]!.id;

export interface SeededWallet {
  walletId: string;
  paidAccount: string;
  promoAccount: string;
  bankAccount: string;
  promoSource: string;
}

/** Portefeuille du grand livre de `gw` avec un bracelet rattaché (le secret, posé dans `claim_code_hash`, ne doit jamais sortir). */
export async function seedWallet(
  owner: Client,
  world: EdgeWorld,
  gw: Gw,
  options: { secret?: Buffer; pwdPackEnc?: Buffer } = {},
): Promise<SeededWallet> {
  await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
  const walletId = randomUUID();
  const tag = walletId.slice(0, 8);
  await owner.query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
    walletId,
    world.operatorId,
    gw.ledgerId,
  ]);
  await owner.query(
    `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side) VALUES
       ($1, $2, $3, 'CLAIM', 'WALLET_PAID', $5, 'C'), ($1, $2, $4, 'CLAIM', 'WALLET_PROMO', $5, 'C')`,
    [world.operatorId, gw.ledgerId, `L-WAL-${tag}-P`, `L-WAL-${tag}-X`, walletId],
  );
  const mediaId = randomUUID();
  await owner.query(
    `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, wallet_id, status, claim_code_hash)
     VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, 'ACTIVE', $6)`,
    [
      mediaId,
      world.operatorId,
      createHash('sha256').update(`media-${walletId}`).digest(),
      Buffer.from(`04${randomUUID().replace(/-/g, '').slice(0, 12)}`, 'hex'),
      walletId,
      options.secret ?? null,
    ],
  );
  // Colis réel de la base centrale (34 octets, chiffré sous la clé du central) : la page ne le sert jamais tel quel.
  if (options.pwdPackEnc) {
    const keyIndex = 1 + Math.floor(Math.random() * 60_000);
    await owner.query(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [world.operatorId, keyIndex, `test:hmac-${keyIndex}`],
    );
    const dek = await owner.query<{ id: string }>(
      `INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek)
       VALUES ($1, $2, 1, $3, $4) RETURNING id`,
      [world.operatorId, keyIndex, `test:wrap-${keyIndex}`, Buffer.alloc(32, 9)],
    );
    await owner.query('UPDATE media SET pwd_pack_enc = $2, pwd_pack_dek_id = $3 WHERE id = $1', [
      mediaId,
      options.pwdPackEnc,
      dek.rows[0]!.id,
    ]);
  }
  return {
    walletId,
    paidAccount: await acc(owner, gw.ledgerId, `L-WAL-${tag}-P`),
    promoAccount: await acc(owner, gw.ledgerId, `L-WAL-${tag}-X`),
    promoSource: await acc(owner, gw.ledgerId, 'L-ORG-PROMO'),
    bankAccount: await acc(owner, gw.ledgerId, 'A-BANQUE'),
  };
}

/** Recharge du portefeuille (une écriture de portefeuille) ; la session `db` choisit la transaction. */
export async function topup(
  db: Client,
  world: EdgeWorld,
  gw: Gw,
  wallet: SeededWallet,
  amount: number,
): Promise<void> {
  await db.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
  await db.query(`SELECT post_transaction($1, 'TOPUP', $2, now(), 'BATCH', $3::jsonb)`, [
    gw.ledgerId,
    `fund-${randomUUID()}`,
    JSON.stringify([
      { account_id: wallet.paidAccount, amount: -amount },
      { account_id: wallet.bankAccount, amount },
    ]),
  ]);
}

/** Crédit promotionnel : ne touche pas le compte `A-BANQUE` (deux sessions ouvertes ne se bloquent pas). */
export async function promo(
  db: Client,
  world: EdgeWorld,
  gw: Gw,
  wallet: SeededWallet,
  amount: number,
): Promise<void> {
  await db.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
  await db.query(`SELECT post_transaction($1, 'PROMO_CREDIT', $2, now(), 'BATCH', $3::jsonb)`, [
    gw.ledgerId,
    `promo-${randomUUID()}`,
    JSON.stringify([
      { account_id: wallet.promoAccount, amount: -amount },
      { account_id: wallet.promoSource, amount },
    ]),
  ]);
}
