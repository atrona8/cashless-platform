// Générateur de file du banc (NFR-002, NFR-006) : N opérations d'achat VALIDES, écrites dans la
// base de la
// passerelle par `EdgeQueue.append` (jamais par insertion SQL directe : numéro, chaîne, empreinte
// et variations de
// solde sont posés par la file elle-même). Les lectures de bracelet portent de vraies preuves
// (empreinte, UID,
// signature d'originalité du bracelet semé au central) avec un compteur strictement croissant par
// bracelet, et les
// numéros de terminal `seq` se suivent : le central accepte chaque opération.
// À appeler pendant que la passerelle est ARRÊTÉE ou non : `edge_chain_head` est pris `FOR UPDATE`.
import type {
  PayMedia,
  PayTerminal,
} from '../../../api/test/integration/payments/payments-fixtures';
import { tapBody } from '../../../api/test/support/media-fixtures';
import { EdgeQueue } from '../../src/queue/edge-queue';
import type { TwoProcessBench } from './two-process-bench';

export interface GeneratedQueue {
  count: number;
  firstEdgeSeq: number;
  lastEdgeSeq: number;
  /** Total débité par portefeuille. */
  debited: Map<string, bigint>;
  /** Dernier numéro de terminal utilisé. */
  lastSeq: number;
}

export interface QueueSpec {
  count: number;
  terminal: PayTerminal;
  media: PayMedia[];
  amount?: number;
  /** Prochain numéro de terminal (défaut : 1). */
  firstSeq?: number;
}

const queue = new EdgeQueue();
const pad = (n: number): string => String(n).padStart(4, '0');

export async function generateQueue(
  bench: TwoProcessBench,
  spec: QueueSpec,
): Promise<GeneratedQueue> {
  const { terminal, media } = spec;
  const amount = spec.amount ?? 100;
  const serial = terminal.t.serial;
  const debited = new Map<string, bigint>();
  let seq = spec.firstSeq ?? 1;
  let first = 0;
  let last = 0;
  for (let i = 0; i < spec.count; i += 1) {
    const m = media[i % media.length]!;
    m.counter += 1;
    const at = new Date();
    const client = await bench.edgeDb.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const row = await queue.append(
        client,
        {
          originKey: `${serial}:${pad(seq)}`,
          type: 'PURCHASE',
          authorizedMode: 'EDGE_ONLINE',
          deviceSerial: serial,
          deviceId: terminal.t.deviceId,
          operation: {
            seq,
            type: 'PURCHASE',
            occurred_at: at.toISOString(),
            amount,
            currency: 'XOF',
            tap: tapBody(m.media, m.counter, { occurred_at: at.toISOString() }),
            vendor_session_id: terminal.sessionId,
            local_available_before: 0,
            edge_decision: { status: 'ACCEPTED', charged_to_wallet: amount, shortfall_amount: 0 },
          },
          occurredAt: at,
          recordedAt: at,
        },
        [{ walletId: m.walletId, paidDelta: BigInt(-amount), promoDelta: 0n }],
      );
      await client.query('COMMIT');
      if (i === 0) first = row.edgeSeq;
      last = row.edgeSeq;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    debited.set(m.walletId, (debited.get(m.walletId) ?? 0n) + BigInt(amount));
    seq += 1;
  }
  return { count: spec.count, firstEdgeSeq: first, lastEdgeSeq: last, debited, lastSeq: seq - 1 };
}
