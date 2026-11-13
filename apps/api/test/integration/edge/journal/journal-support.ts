// Décor des suites du journal après reprise forcée (mission 8, lot WP14). S'appuie sur `ProcessingWorld` de la mission 7
// (route réelle `POST /offline-batches`, vrai processeur). Un événement et un grand livre par monde : l'état de reprise
// (passerelle, bascule `TO_EDGE`) est posé par le propriétaire et remis à blanc entre deux scénarios. Le registre
// `EDGE_SYNC` est immuable : la passerelle de test est créée une fois et seul son statut change.
import { randomUUID } from 'node:crypto';
import { deviceKey } from '../../../../src/idempotency/device-key';
import type { JournalWorld } from '../../offline/journal-world';
import { withOwner } from '../../../support/db';
import { ownerRows } from '../../../support/media-fixtures';
import type { OfflineTerminal, ProcessingWorld } from '../../offline/processing-fixtures';

export type ReplayedVia = 'JOURNAL' | 'EDGE_REGISTRY' | 'ONLINE_IDEMPOTENCY';

/**
 * Écart entre l'horloge de la base (VM Docker, qui dérive : +2 s relevées le 11/11) et celle de Node. Les dates
 * d'opérations posées « il y a N secondes » doivent suivre l'horloge de la base : sinon une opération datée d'1 à 5 s
 * tombe AVANT la création du terminal vu par la base (`DEVICE_REVOKED`, `VENDOR_SESSION` à tort). Mesuré à chaque
 * remise en place d'un scénario (`Takeover.set`), jamais supposé nul.
 */
let dbClockSkewMs = 0;
export async function calibrateDbClock(): Promise<number> {
  const before = Date.now();
  const rows = await ownerRows<{ ms: string }>(
    `SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS ms`,
  );
  const after = Date.now();
  dbClockSkewMs = Number(rows[0]!.ms) - Math.round((before + after) / 2);
  return dbClockSkewMs;
}
/** « Maintenant » à l'heure de la base (à appeler après `calibrateDbClock`, fait par `Takeover.set`). */
export const dbNow = (): number => Date.now() + dbClockSkewMs;

export interface TakeoverOptions {
  /** Bascule accusée (`edge_seq_at_activation` posé). Défaut : oui. */
  acked?: boolean;
  /** Secondes écoulées depuis l'accord de la bascule. Défaut : 3600. */
  grantedAgo?: number;
  /** Secondes écoulées depuis la fin de la reprise (`completed_at`). Défaut : non posée (aucune borne haute). */
  endedAgo?: number;
  /** Statut de la bascule `TO_EDGE`. Défaut : `FORCED`. */
  handover?: 'FORCED' | 'COMPLETED';
  /** Statut de la passerelle. Défaut : `REVOKED`. */
  gateway?: 'REVOKED' | 'ACTIVE';
}

export class Takeover {
  private gatewayId: string | null = null;
  private edgeSeq = 0;
  constructor(private readonly world: ProcessingWorld) {}

  private get eventId(): string {
    return this.world.pw.w.ids.eventA;
  }

  async gateway(): Promise<string> {
    if (this.gatewayId) return this.gatewayId;
    const rows = await ownerRows<{ id: string }>(
      `INSERT INTO edge_gateway (operator_id, event_id, serial, role, status)
       VALUES ($1, $2, $3, 'PRIMARY', 'REVOKED') RETURNING id`,
      [this.world.operatorId, this.eventId, `GW-${randomUUID().slice(0, 8)}`],
    );
    this.gatewayId = rows[0]!.id;
    return this.gatewayId;
  }

  /** Remet à blanc, puis pose l'état voulu (`null` : aucune reprise, passerelle ordinaire). */
  async set(options: TakeoverOptions | null): Promise<{ handoverId: string | null }> {
    await calibrateDbClock();
    // REVOKED est un état terminal : la passerelle révoquée est créée une fois ; une passerelle « non révoquée » est
    // une autre ligne, créée à la demande.
    const gateway =
      options?.gateway === 'ACTIVE'
        ? (
            await ownerRows<{ id: string }>(
              `INSERT INTO edge_gateway (operator_id, event_id, serial, role, status)
               VALUES ($1, $2, $3, 'STANDBY', 'ACTIVE') RETURNING id`,
              [this.world.operatorId, this.eventId, `GW-${randomUUID().slice(0, 8)}`],
            )
          )[0]!.id
        : await this.gateway();
    await withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query('DELETE FROM debit_authority_handover WHERE ledger_id = $1', [
        this.world.ledgerId,
      ]);
      await db.query('COMMIT');
    });
    if (options === null) return { handoverId: null };
    const status = options.handover ?? 'FORCED';
    const rows = await ownerRows<{ id: string }>(
      `INSERT INTO debit_authority_handover (operator_id, ledger_id, edge_gateway_id, direction, status, epoch,
                                             watermark_posting_id, requested_by, approved_by, reason,
                                             requested_at, edge_seq_at_activation, completed_at)
       VALUES ($1, $2, $3, 'TO_EDGE', $4, 1, 0, $5, $6, 'passerelle perdue',
               now() - make_interval(secs => $7), $8,
               CASE WHEN $9::int IS NULL THEN NULL ELSE now() - make_interval(secs => $9::int) END)
       RETURNING id`,
      [
        this.world.operatorId,
        this.world.ledgerId,
        gateway,
        status,
        randomUUID(),
        randomUUID(),
        options.grantedAgo ?? 3600,
        options.acked === false ? null : 0,
        options.endedAgo ?? null,
      ],
    );
    return { handoverId: rows[0]!.id };
  }

  /** Marque la clé `<serial>:<seq>` comme déjà rejouée (ou exécutée en ligne) par l'un des trois registres. */
  async replayed(t: OfflineTerminal, seq: number, via: ReplayedVia, suffix = ''): Promise<void> {
    const key = deviceKey(t.t.serial, BigInt(seq)) + suffix;
    const { operatorId, ledgerId } = this.world;
    if (via === 'ONLINE_IDEMPOTENCY') {
      await ownerRows(
        `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash,
                                          occurred_at, source, device_id)
         VALUES (gen_random_uuid(), $1, $2, 'PURCHASE', $3, 'empreinte', now(), 'ONLINE', $4) RETURNING id`,
        [operatorId, ledgerId, `online-${randomUUID()}`, t.t.deviceId],
      );
      await ownerRows(
        `INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status,
                                      response_status, completed_at, expires_at)
         VALUES ($1, $2, $3, repeat('a', 64), 'COMPLETED', 200, now(), now() + interval '1 day')
         RETURNING id`,
        [operatorId, `device:${t.t.deviceId}:`, key],
      );
      return;
    }
    const txKey = via === 'JOURNAL' ? key : `edge-${randomUUID()}`;
    const tx = await ownerRows<{ id: string }>(
      `INSERT INTO journal_transaction (id, operator_id, ledger_id, type, idempotency_key, request_hash,
                                        occurred_at, source, device_id)
       VALUES (gen_random_uuid(), $1, $2, 'PURCHASE', $3, 'empreinte', now(),
               CASE WHEN $5 THEN 'EDGE_SYNC' ELSE 'ONLINE' END, $4) RETURNING id`,
      [operatorId, ledgerId, txKey, t.t.deviceId, via === 'EDGE_REGISTRY'],
    );
    if (via === 'EDGE_REGISTRY') {
      this.edgeSeq += 1;
      await ownerRows(
        `INSERT INTO edge_sync_registry (operator_id, gateway_id, edge_seq, origin_key, content_sha256,
                                         chain_hash, outcome, transaction_id)
         VALUES ($1, $2, $3, $4, decode(repeat('ab', 32), 'hex'), decode(repeat('cd', 32), 'hex'),
                 'ACCEPTED', $5) RETURNING edge_seq`,
        [operatorId, await this.gateway(), 1_000_000 + this.edgeSeq, key, tx[0]!.id],
      );
    }
  }
}

/** Entrée `ONLINE_REF` d'une activation (`activateMedia`) ou d'une caution (`takeDeposit`). */
export function onlineRef(
  operation: 'activateMedia' | 'takeDeposit' | 'refundDeposit',
  options: { agoSeconds?: number; amount?: number; extra?: Record<string, unknown> } = {},
): Record<string, unknown> & { type: string; occurred_at: string } {
  return {
    type: 'ONLINE_REF',
    occurred_at: new Date(dbNow() - (options.agoSeconds ?? 5) * 1000).toISOString(),
    online_operation: operation,
    online_status: 'UNKNOWN',
    ...(options.amount !== undefined ? { amount: options.amount, currency: 'XOF' } : {}),
    ...options.extra,
  };
}

export const edgeAnomalies = (deviceId: string, kind = 'EDGE_REPLAY_FAILED') =>
  ownerRows<{
    id: string;
    kind: string;
    seq: string;
    amount: string;
    loss_bearer: string;
    media_id: string | null;
    batch_id: string | null;
    detail: Record<string, unknown> | null;
    status: string;
  }>(
    `SELECT id, kind, seq::text, amount::text, loss_bearer, media_id, batch_id, detail, status FROM anomaly
      WHERE device_id = $1 AND kind = $2 ORDER BY seq`,
    [deviceId, kind],
  );

/** Demande, approuve (deux personnes) et applique l'import d'un export ; rend l'import clos. */
export async function runImport(jw: JournalWorld, t: OfflineTerminal, bodies: unknown[]) {
  const res = await jw.requestImport(jw.sup1, t.t.deviceId, bodies);
  if (res.status !== 202) throw new Error(`import refusé : ${res.status} ${res.text}`);
  const requestId = res.body.approval_request_id as string;
  const importId = (await jw.requestRow(requestId)).target_id;
  const approved = await jw.approve(requestId, jw.sup2);
  if (approved.status !== 200) throw new Error(`approbation refusée : ${approved.status}`);
  return jw.runUntilFinal(importId);
}
