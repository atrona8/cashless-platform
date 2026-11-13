// File des décisions de la passerelle (WP20, interfaces.md § 4 et § 10, data-model.md B.2 et B.7).
//
// `EdgeQueue.append` attribue `edge_seq` et la chaîne DANS LA TRANSACTION DE L'OPÉRATION, ouverte
// par l'appelant : `append` n'ouvre, ne commite et ne referme JAMAIS de transaction (invariant
// B.7-1). Le numéro, l'opération, ses deltas, l'idempotence, le nonce et le tap consommé sont donc
// commités ensemble, avant toute réponse au terminal.
//
// Points d'arrêt :
//  - `before-local-write` est franchi ICI, avant toute écriture ;
//  - `kill-local-database` est franchi en fin d'`append`, tout écrit et rien commité ;
//  - `after-local-write-before-reply` est placé PAR L'APPELANT, après le `COMMIT` de sa
//    transaction et avant la réponse HTTP (`await failpoint('after-local-write-before-reply')`) :
//    `append` ne peut pas le franchir, il ne voit pas le commit.
//
// Numéro : `edge_chain_head FOR UPDATE`, `last_edge_seq + 1`, jamais une séquence PostgreSQL (qui
// laisse des trous après un arrêt brutal). Un `ROLLBACK` ne laisse aucun trou : le numéro n'a
// jamais été commité. Chaîne : le code partagé UNIQUEMENT (`edgeContentSha256`, `chainStep`).
import { Injectable } from '@nestjs/common';
import { chainStep, edgeContentSha256 } from '@cashless/shared-rules';
import type { TxClient } from '../db/gateway-tx';
import { failpoint } from '../testing/failpoints';

export const EDGE_QUEUE = Symbol('EDGE_QUEUE');

export const EDGE_OP_TYPES = [
  'PURCHASE',
  'REVERSAL',
  'TOPUP_CASH',
  'VOID',
  'ONLINE_REF',
  'ACTIVATION',
  'DEPOSIT_CASH',
] as const;
export type EdgeOpType = (typeof EDGE_OP_TYPES)[number];
export type AuthorizedMode = 'EDGE_ONLINE' | 'DEVICE_OFFLINE';

/** Entier sûr de JavaScript : au-delà, JCS et `Number` ne sont plus exacts. */
export const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export class QueueError extends Error {
  constructor(
    readonly code:
      | 'INVALID_OPERATION'
      | 'ORIGIN_KEY_EXISTS'
      | 'SEQ_OUT_OF_RANGE'
      | 'DELTA_OUT_OF_RANGE'
      | 'HEAD_MISSING'
      | 'EXTRA_WRITE_REFUSED',
    message: string,
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

/** Variation de solde d'un portefeuille (négative pour un débit, positive pour une recharge). */
export interface WalletDelta {
  walletId: string;
  paidDelta: bigint;
  promoDelta: bigint;
}

export interface EdgeOpInput {
  /** `Idempotency-Key` du terminal `<serial>:<seq>` ; suffixe `#deposit` pour une caution (A10). */
  originKey: string;
  type: EdgeOpType;
  authorizedMode: AuthorizedMode;
  deviceSerial: string;
  deviceId: string;
  /** Obligatoire si et seulement si `authorizedMode = DEVICE_OFFLINE`. */
  deviceBatchId?: string | null;
  /**
   * Champs de l'`EdgeSyncOperation` AUTRES que `edge_seq`, `device_serial`, `authorized_mode` et
   * `device_batch_id` (posés par `append`, refusés ici). `chain_hash` : posé par `append` pour
   * `EDGE_ONLINE` (chaîne de la passerelle) ; OBLIGATOIRE pour `DEVICE_OFFLINE` (maillon du
   * terminal, R-12). `seq` (numéro du terminal) est obligatoire.
   */
  operation: Record<string, unknown>;
  occurredAt: Date;
  recordedAt: Date;
}

export interface EdgeOpRow {
  edgeSeq: number;
  contentSha256: Buffer;
  /** Maillon de la chaîne de la passerelle au `edgeSeq`. */
  chainHash: Buffer;
  /** L'objet complet tel qu'il sera envoyé. */
  operation: Record<string, unknown>;
}

const FORBIDDEN_FIELDS = ['edge_seq', 'device_serial', 'authorized_mode', 'device_batch_id'];
const HEX32 = /^[0-9a-f]{64}$/;

function checkInput(op: EdgeOpInput, deltas: WalletDelta[]): void {
  const bad = (message: string): never => {
    throw new QueueError('INVALID_OPERATION', message);
  };
  if (typeof op.originKey !== 'string' || op.originKey === '') bad('clé d’origine absente');
  if (!EDGE_OP_TYPES.includes(op.type)) bad('type d’opération inconnu');
  if (op.operation.type !== op.type) bad('operation.type différent du type déclaré');
  if (op.authorizedMode !== 'EDGE_ONLINE' && op.authorizedMode !== 'DEVICE_OFFLINE') {
    bad('mode autorisé inconnu');
  }
  const hasBatch = op.deviceBatchId !== undefined && op.deviceBatchId !== null;
  if ((op.authorizedMode === 'DEVICE_OFFLINE') !== hasBatch) {
    bad('device_batch_id exigé si et seulement si DEVICE_OFFLINE');
  }
  for (const field of FORBIDDEN_FIELDS) {
    if (op.operation[field] !== undefined) bad(`${field} est posé par la file, pas par l’appelant`);
  }
  if (!Number.isSafeInteger(op.operation.seq) || (op.operation.seq as number) < 1) {
    bad('seq du terminal : entier sûr positif attendu');
  }
  if (op.type === 'VOID' && typeof op.operation.void_reason !== 'string') bad('void_reason absent');
  if (op.authorizedMode === 'DEVICE_OFFLINE') {
    const link = op.operation.chain_hash;
    if (typeof link !== 'string' || !HEX32.test(link)) bad('chain_hash du terminal absent');
  } else if (op.operation.chain_hash !== undefined) {
    bad('chain_hash est posé par la file pour EDGE_ONLINE');
  }
  if (!(op.occurredAt instanceof Date) || Number.isNaN(op.occurredAt.getTime())) bad('occurredAt');
  if (!(op.recordedAt instanceof Date) || Number.isNaN(op.recordedAt.getTime())) bad('recordedAt');
  const wallets = new Set<string>();
  for (const delta of deltas) {
    for (const value of [delta.paidDelta, delta.promoDelta]) {
      if (typeof value !== 'bigint' || value > MAX_SAFE || value < -MAX_SAFE) {
        throw new QueueError('DELTA_OUT_OF_RANGE', 'delta hors des entiers sûrs');
      }
    }
    if (wallets.has(delta.walletId)) bad('deux deltas pour le même portefeuille');
    wallets.add(delta.walletId);
  }
}

/**
 * Écriture annexe de l'appelant, versée dans l'instruction unique de `append` (une expression
 * `UPDATE ... RETURNING 1` ou `INSERT ... RETURNING 1`). `$1` est le `edge_seq` posé ; les
 * paramètres propres sont `$2...`. `expectRows` : nombre de lignes exigé, sinon `QueueError`
 * (transaction annulée).
 */
export interface AppendExtra {
  sql: string;
  params: unknown[];
  expectRows?: number;
  what: string;
}

@Injectable()
export class EdgeQueue {
  /**
   * À appeler DANS la transaction de l'opération (`tx`), après les contrôles d'autorité et
   * d'idempotence. Rend la ligne écrite. Refuse (erreur interne, RIEN d'écrit) : opération mal
   * formée, `edge_seq` ou delta hors des entiers sûrs, clé d'origine déjà présente (l'appelant doit
   * avoir consulté l'idempotence).
   */
  async append(
    tx: TxClient,
    op: EdgeOpInput,
    deltas: WalletDelta[],
    extras: AppendExtra[] = [],
  ): Promise<EdgeOpRow> {
    checkInput(op, deltas);
    await failpoint('before-local-write');
    // Clé d'origine : lue AVANT le verrou de la tête de chaîne (le verrou est tenu jusqu'au COMMIT
    // et sérialise tous les paiements : moins il y a d'allers-retours dessous, plus le débit monte,
    // NFR-005). La colonne est UNIQUE : un doublon qui passerait entre-temps échouerait à
    // l'écriture.
    const known = await tx.query('SELECT 1 FROM edge_op WHERE origin_key = $1', [op.originKey]);
    if (known.rowCount !== 0) {
      throw new QueueError('ORIGIN_KEY_EXISTS', 'clé d’origine déjà présente dans la file');
    }
    const { rows: heads } = await tx.query<{ last_edge_seq: string; last_chain_hash: Buffer }>(
      'SELECT last_edge_seq, last_chain_hash FROM edge_chain_head FOR UPDATE',
    );
    const head = heads[0];
    if (!head) throw new QueueError('HEAD_MISSING', 'edge_chain_head absente (non enrôlée)');
    const next = BigInt(head.last_edge_seq) + 1n;
    if (next > MAX_SAFE) throw new QueueError('SEQ_OUT_OF_RANGE', 'edge_seq hors des entiers sûrs');
    const edgeSeq = Number(next);

    const full: Record<string, unknown> = {
      ...op.operation,
      edge_seq: edgeSeq,
      device_serial: op.deviceSerial,
      authorized_mode: op.authorizedMode,
      ...(op.deviceBatchId ? { device_batch_id: op.deviceBatchId } : {}),
    };
    // `chain_hash` n'entre pas dans le contenu haché : aucun cercle.
    const content = edgeContentSha256(full as never);
    const chainHash = chainStep(head.last_chain_hash, content);
    if (op.authorizedMode === 'EDGE_ONLINE') full.chain_hash = chainHash.toString('hex');

    // UNE instruction (les trois écritures et les écritures annexes de l'appelant) : un seul
    // aller-retour sous le verrou. Les contraintes (clé étrangère des deltas) se vérifient à la fin
    // de l'instruction, comme avec des instructions séparées de la même transaction.
    const params: unknown[] = [
      edgeSeq,
      op.originKey,
      op.type,
      op.authorizedMode,
      op.deviceSerial,
      op.deviceId,
      op.deviceBatchId ?? null,
      JSON.stringify(full),
      content,
      chainHash,
      op.occurredAt,
      op.recordedAt,
      deltas.map((d) => d.walletId),
      deltas.map((d) => d.paidDelta.toString()),
      deltas.map((d) => d.promoDelta.toString()),
    ];
    const ctes: string[] = [];
    extras.forEach((extra, i) => {
      const base = params.length;
      // `$1` = edge_seq ; les paramètres propres de l'écriture annexe commencent à `$2`.
      const sql = extra.sql.replace(/\$(\d+)/g, (_m, n: string) =>
        Number(n) === 1 ? '$1' : '$' + String(base + Number(n) - 1),
      );
      params.push(...extra.params);
      ctes.push(`x${i} AS (${sql})`);
    });
    const counts = extras.map((_e, i) => `(SELECT count(*) FROM x${i})::int AS x${i}`);
    const { rows: written } = await tx.query<Record<string, number>>(
      `WITH o AS (
         INSERT INTO edge_op (edge_seq, origin_key, type, authorized_mode, device_serial, device_id,
                              device_batch_id, operation, content_sha256, chain_hash, occurred_at,
                              recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12) RETURNING 1),
       d AS (
         INSERT INTO edge_op_delta (edge_seq, wallet_id, paid_delta, promo_delta)
         SELECT $1, w, p, q FROM unnest($13::uuid[], $14::bigint[], $15::bigint[]) AS t(w, p, q)
         RETURNING 1),
       h AS (UPDATE edge_chain_head SET last_edge_seq = $1, last_chain_hash = $10 RETURNING 1)
       ${ctes.length > 0 ? `, ${ctes.join(', ')}` : ''}
       SELECT ${['1 AS ok', ...counts].join(', ')}`,
      params,
    );
    extras.forEach((extra, i) => {
      if (extra.expectRows !== undefined && written[0]![`x${i}`] !== extra.expectRows)
        throw new QueueError('EXTRA_WRITE_REFUSED', extra.what);
    });
    // `kill-local-database` : le banc coupe la base ICI, tout écrit et rien commité ; le processus
    // attend sans valider (A28). Inerte sans le point armé.
    await failpoint('kill-local-database');
    return { edgeSeq, contentSha256: content, chainHash, operation: full };
  }
}

/** Jeton d'injection consommé par les lots 21 à 23 : `@Inject(EDGE_QUEUE) queue: EdgeQueue`. */
export type EdgeQueuePort = Pick<EdgeQueue, 'append'>;
