// Vidage de la file vers le central (T090, R-13, R-16, A29, B.7-7).
//
//  - UN SEUL lot en vol : l'index unique de `edge_outgoing_batch` (edge-0001) ET un verrou de
//    processus. Deux `runOnce` simultanés n'en construisent qu'un.
//  - RENVOI À L'IDENTIQUE : le corps EXACT (signature comprise) est écrit dans
//    `edge_outgoing_batch.body` (edge-0004) AVANT l'envoi (`PREPARED`, puis `SENT`, commités).
// Après
//    une coupure, le même `batch_id` repart avec le même corps, la même signature : la passerelle
//    ne signe jamais deux contenus sous un même `batch_id`.
//  - LOT ABANDONNÉ (A29) : le central rend `abandoned: true` ; les résultats partiels sont
//    appliqués, le lot est clos et le reste repart sous un NOUVEAU `batch_id`, depuis le premier
//    numéro sans résultat. Jamais le même `batch_id` en boucle.
//  - Refus du central : `EDGE_NOT_CAUGHT_UP` (reprend depuis `missing_edge_seqs`) et
//    `SEQ_OUT_OF_ORDER` (reconstruit depuis le premier numéro sans résultat) closent le lot
//    (`SUPERSEDED`) sans toucher à la file ; `CHAIN_BROKEN` et `BATCH_SIGNATURE_INVALID` ARRÊTENT
// le
//    vidage de ce lot (alerte locale `DRAIN_HALTED`), aucune réécriture.
//  - LOT D'ORDRES SEULS (décision 50, ADR-187) : file résolue et ordres locaux à verser, le lot n'a
// aucune
//    opération (`edge_seq_to = edge_seq_from - 1`, chaîne inchangée). Refusé, il est clos
// (`SUPERSEDED`) sans jamais
//    bloquer les ventes, nouvelle tentative après 60 s ; il ne s'envoie jamais sans ordre.
//  - AUCUN ENVOI si la passerelle est `REVOKED`, ni si l'époque du lot est inférieure à
//    `highest_epoch_seen` hors `RELEASING` (le central l'a demandé) et `STALE` (le vidage ne débite
//    pas) : le lot reste, une alerte est écrite.
//  - Point d'arrêt `during-drain-after-send-before-result` entre l'envoi et les résultats.
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { batchSigningPayload, edgeChainGenesis } from '@cashless/shared-rules';
import { CentralClient } from '../central-client/central-client';
import { CentralError } from '../central-client/central-errors';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../db/gateway-tx';
import { HARDWARE_KEYSTORE, type HardwareKeystore } from '../key-store/hardware-keystore.port';
import { p1363ToDer } from '../snapshots/snapshot-signer';
import { failpoint } from '../testing/failpoints';
import {
  buildBatch,
  buildOrdersOnlyBatch,
  firstUnresolvedSeq,
  isOrdersOnly,
} from './batch-builder';
import {
  applyResults,
  DELTA_PURGE,
  MalformedResultError,
  parseBatchResult,
  resultOnlyDeltaPurge,
  type DeltaPurgePort,
} from './result-applier';

export interface DrainHooks {
  /** File vide et acquittée : réveille le canal de contrôle (`ControlChannel.notifyQueueDrained`).
  /** */
  onDrained?(): void;
  /** Le central a refusé le certificat de la passerelle. */
  onCertificateRejected?(): Promise<void>;
  /** Époque d'autorité rendue par le central dans un refus (`STALE_AUTHORITY_EPOCH`). */
  onCentralEpoch?(epoch: number): Promise<void>;
}

interface InFlight {
  batch_id: string;
  edge_seq_from: string;
  edge_seq_to: string;
  epoch: string;
  body_sha256: Buffer;
  status: 'PREPARED' | 'SENT' | 'DONE';
  body: string | null;
}

interface GatewayContext {
  gatewayId: string;
  ledgerId: string;
  state: string;
  epoch: number;
  highestEpochSeen: number;
}

export const IDLE_INTERVAL_MS = 1000;
export const BACKOFF_CEILING_MS = 5000;
const SEQ_OUT_OF_ORDER_LIMIT = 3;
const ALERT_EVERY_MS = 60_000;
/** Après le refus d'un lot d'ordres seuls : pas de nouvelle tentative avant ce délai (jamais de
/** boucle). */
const ORDERS_ONLY_RETRY_MS = 60_000;

@Injectable()
export class DrainService {
  private readonly logger = new Logger('Drain');
  private hooks: DrainHooks = {};
  private readonly purge: DeltaPurgePort;
  private chain: Promise<unknown> = Promise.resolve();
  private hint: number | null = null;
  private drainRequested = false;
  private seqOutOfOrderFor = '';
  private seqOutOfOrderCount = 0;
  private ordersOnlyRetryAt = 0;
  private readonly lastAlertAt = new Map<string, number>();
  private running = false;
  private stopped = true;
  private loopDone: Promise<void> = Promise.resolve();
  private wakeUp: (() => void) | null = null;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(CentralClient) private readonly client: CentralClient,
    @Inject(HARDWARE_KEYSTORE) private readonly keystore: HardwareKeystore,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Optional() @Inject(DELTA_PURGE) purge?: DeltaPurgePort,
  ) {
    this.purge = purge ?? resultOnlyDeltaPurge;
  }

  /** Faux si le repli `resultOnlyDeltaPurge` est actif : la garde de production le refuse. */
  get hasDeltaPurge(): boolean {
    return this.purge !== resultOnlyDeltaPurge;
  }

  bindHooks(hooks: DrainHooks): void {
    this.hooks = hooks;
  }

  // ----- signal (DRAIN_SIGNAL, WP17) ------------------------------------------------------------

  requestDrain(hint?: { missingEdgeSeqs?: number[] }): void {
    this.drainRequested = true;
    const missing = hint?.missingEdgeSeqs?.filter((n) => Number.isSafeInteger(n) && n >= 1) ?? [];
    if (missing.length > 0) {
      const lowest = Math.min(...missing);
      this.hint = this.hint === null ? lowest : Math.min(this.hint, lowest);
    }
    this.wakeUp?.();
  }

  // ----- boucle ---------------------------------------------------------------------------------

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loopDone = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wakeUp?.();
    await this.loopDone;
  }

  private async loop(): Promise<void> {
    let backoff = 250;
    while (!this.stopped) {
      let again = false;
      try {
        const outcome = await this.runOnce();
        again = outcome.sent > 0 && !outcome.empty;
        backoff = 250;
      } catch (error) {
        this.logger.error(`vidage : ${error instanceof Error ? error.message : 'erreur'}`);
        await this.pause(backoff);
        backoff = Math.min(backoff * 2, BACKOFF_CEILING_MS);
        continue;
      }
      if (!again) await this.pause(IDLE_INTERVAL_MS);
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      timer.unref();
      this.wakeUp = done;
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
    }).finally(() => {
      this.wakeUp = null;
    });
  }

  // ----- une passe ------------------------------------------------------------------------------

  /** Verrou de processus : deux appels simultanés s'exécutent l'un après l'autre. */
  runOnce(): Promise<{ sent: number; empty: boolean }> {
    const next = this.chain.then(() => this.once());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async once(): Promise<{ sent: number; empty: boolean }> {
    const ctx = await this.context();
    if (ctx === null) return { sent: 0, empty: true };
    const outcome = await this.drainOne(ctx);
    const empty = await this.isEmpty();
    if (empty && (outcome.progress || this.drainRequested)) {
      this.drainRequested = false;
      this.hooks.onDrained?.();
    }
    return { sent: outcome.sent, empty };
  }

  private async drainOne(ctx: GatewayContext): Promise<{ sent: number; progress: boolean }> {
    if (ctx.state === 'REVOKED') return { sent: 0, progress: false };
    let flight = await this.inFlight();
    if (flight === null) {
      const created = await this.prepare(ctx);
      if (created === null) return { sent: 0, progress: false };
      flight = created;
    }
    if (await this.halted(flight.batch_id)) return { sent: 0, progress: false };
    if (!(await this.epochAllows(ctx, Number(flight.epoch), flight.batch_id))) {
      return { sent: 0, progress: false };
    }
    const body = await this.verifiedBody(flight);
    if (body === null) return { sent: 0, progress: false };
    if (flight.status === 'PREPARED') await this.markSent(flight);

    let response: Awaited<ReturnType<CentralClient['submitEdgeSyncBatch']>>;
    try {
      response = await this.client.submitEdgeSyncBatch(flight.batch_id, JSON.parse(body));
    } catch (error) {
      await this.onSubmitError(flight, error);
      return { sent: 0, progress: false };
    }
    await failpoint('during-drain-after-send-before-result');

    const from = Number(flight.edge_seq_from);
    const to = Number(flight.edge_seq_to);
    let parsed;
    try {
      parsed = parseBatchResult(response.body, flight.batch_id);
    } catch (error) {
      if (!(error instanceof MalformedResultError)) throw error;
      await this.alert('DRAIN_RESULT_MALFORMED', { batch_id: flight.batch_id, why: error.message });
      return { sent: 0, progress: false };
    }
    const outcome = await this.gatewayTx.run(async (tx) => {
      const applied = await applyResults(
        tx,
        { batchId: flight.batch_id, from, to },
        parsed,
        this.purge,
        this.clock.now(),
      );
      await tx.query(
        `UPDATE edge_outgoing_batch SET status = 'DONE', done_reason = 'RESULTS'
          WHERE batch_id = $1`,
        [flight.batch_id],
      );
      return applied;
    });
    this.seqOutOfOrderCount = 0;
    if (parsed.missingSeqs.length > 0) this.requestHint(Math.min(...parsed.missingSeqs));
    return { sent: outcome.applied, progress: true };
  }

  private requestHint(seq: number): void {
    this.hint = this.hint === null ? seq : Math.min(this.hint, seq);
  }

  // ----- construction du lot --------------------------------------------------------------------

  private async prepare(ctx: GatewayContext): Promise<InFlight | null> {
    if (!(await this.epochAllows(ctx, ctx.epoch, null))) return null;
    const batchId = randomUUID();
    const built = await this.gatewayTx.run(async (tx) => {
      const first = await firstUnresolvedSeq(tx);
      const from = this.hint === null ? first : Math.min(this.hint, first ?? this.hint);
      if (from === null) {
        // File résolue : seuls des ordres locaux peuvent encore partir (décision 50, ADR-187).
        if (this.clock.now().getTime() < this.ordersOnlyRetryAt) return null;
        return buildOrdersOnlyBatch(tx, {
          batchId,
          gatewayId: ctx.gatewayId,
          ledgerId: ctx.ledgerId,
          epoch: ctx.epoch,
        });
      }
      const batch = await buildBatch(
        tx,
        { batchId, gatewayId: ctx.gatewayId, ledgerId: ctx.ledgerId, epoch: ctx.epoch, from },
        edgeChainGenesis(ctx.gatewayId),
      );
      return batch;
    });
    this.hint = null;
    if (built === null) return null;
    // Signature HORS transaction (port matériel) : un seul contenu par `batch_id`.
    // Le port rend du P1363 (r‖s) ; le central exige du DER (contrat, `edge-sync-signature.ts`) :
    // conversion ici.
    const raw = await this.keystore.sign('batch', batchSigningPayload({ ...built }));
    const signature = p1363ToDer(raw);
    const body = JSON.stringify({ ...built, signature: signature.toString('base64') });
    const sha = createHash('sha256').update(body, 'utf8').digest();
    try {
      await this.gatewayTx.run((tx) =>
        tx.query(
          `INSERT INTO edge_outgoing_batch
             (batch_id, edge_seq_from, edge_seq_to, epoch, body_sha256, status, body)
           VALUES ($1, $2, $3, $4, $5, 'PREPARED', $6)`,
          [batchId, built.edge_seq_from, built.edge_seq_to, built.epoch, sha, body],
        ),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null; // un autre lot est en vol
      throw error;
    }
    return {
      batch_id: batchId,
      edge_seq_from: String(built.edge_seq_from),
      edge_seq_to: String(built.edge_seq_to),
      epoch: String(built.epoch),
      body_sha256: sha,
      status: 'PREPARED',
      body,
    };
  }

  /** Le corps stocké est celui qui a été signé : une altération arrête le lot. */
  private async verifiedBody(flight: InFlight): Promise<string | null> {
    if (flight.body === null) {
      await this.halt(flight.batch_id, 'BODY_MISSING');
      return null;
    }
    const sha = createHash('sha256').update(flight.body, 'utf8').digest();
    if (!sha.equals(flight.body_sha256)) {
      await this.halt(flight.batch_id, 'BODY_ALTERED');
      return null;
    }
    return flight.body;
  }

  private async markSent(flight: InFlight): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      await tx.query(
        `UPDATE edge_outgoing_batch SET status = 'SENT', sent_at = $2 WHERE batch_id = $1`,
        [flight.batch_id, this.clock.now()],
      );
      await tx.query(
        `UPDATE edge_op SET central_status = CASE WHEN central_status = 'PENDING' THEN 'SENT'
                                                  ELSE central_status END,
                            sent_batch_id = $1
          WHERE edge_seq BETWEEN $2 AND $3 AND central_status IN ('PENDING', 'SENT')`,
        [flight.batch_id, flight.edge_seq_from, flight.edge_seq_to],
      );
    });
    flight.status = 'SENT';
  }

  // ----- refus du central -----------------------------------------------------------------------

  private async onSubmitError(flight: InFlight, error: unknown): Promise<void> {
    if (!(error instanceof CentralError)) throw error;
    if (error.isLinkFailure || error.code === 'ABORTED') return; // le même lot repartira
    if (isOrdersOnly(flight) && error.code !== 'CERTIFICATE_REJECTED') {
      // Un lot d'ordres seuls n'est jamais bloquant : refusé, il est clos et les ventes continuent
      // ; les ordres
      // restent à verser (nouvelle tentative après un délai), et une purge manuelle finit forcée
      // avec sa trace.
      await this.supersede(flight, error.code);
      this.ordersOnlyRetryAt = this.clock.now().getTime() + ORDERS_ONLY_RETRY_MS;
      await this.alert('DRAIN_ORDERS_ONLY_REFUSED', {
        batch_id: flight.batch_id,
        code: error.code,
      });
      return;
    }
    switch (error.code) {
      case 'CERTIFICATE_REJECTED':
        await this.hooks.onCertificateRejected?.();
        return;
      case 'EDGE_NOT_CAUGHT_UP': {
        const missing = error.details.missingEdgeSeqs ?? [];
        if (missing.length > 0) this.requestHint(Math.min(...missing));
        await this.supersede(flight, error.code);
        return;
      }
      case 'SEQ_OUT_OF_ORDER': {
        this.seqOutOfOrderCount =
          this.seqOutOfOrderFor === flight.edge_seq_from ? this.seqOutOfOrderCount + 1 : 1;
        this.seqOutOfOrderFor = flight.edge_seq_from;
        if (this.seqOutOfOrderCount >= SEQ_OUT_OF_ORDER_LIMIT) {
          await this.halt(flight.batch_id, error.code);
          return;
        }
        await this.supersede(flight, error.code);
        return;
      }
      case 'CHAIN_BROKEN':
      case 'BATCH_SIGNATURE_INVALID':
        await this.halt(flight.batch_id, error.code);
        return;
      case 'STALE_AUTHORITY_EPOCH':
        await this.alert('DRAIN_REFUSED', { batch_id: flight.batch_id, code: error.code });
        if (error.details.authorityEpoch !== undefined) {
          await this.hooks.onCentralEpoch?.(error.details.authorityEpoch);
        }
        return;
      default:
        await this.alert('DRAIN_REFUSED', { batch_id: flight.batch_id, code: error.code });
    }
  }

  /** Clôt le lot sans résultat : les opérations non résolues repartent dans un NOUVEAU lot. */
  private async supersede(flight: InFlight, why: string): Promise<void> {
    await this.gatewayTx.run(async (tx) => {
      await tx.query(
        `UPDATE edge_outgoing_batch SET status = 'DONE', done_reason = 'SUPERSEDED'
          WHERE batch_id = $1 AND status <> 'DONE'`,
        [flight.batch_id],
      );
      await tx.query(
        `INSERT INTO edge_audit (kind, actor, detail) VALUES ('DRAIN_SUPERSEDED', 'gateway', $1)`,
        [JSON.stringify({ batch_id: flight.batch_id, why })],
      );
    });
  }

  private async halt(batchId: string, reason: string): Promise<void> {
    this.haltedBatches.add(batchId);
    await this.gatewayTx.run((tx) =>
      tx.query(
        `INSERT INTO edge_audit (kind, actor, detail) VALUES ('DRAIN_HALTED', 'gateway', $1)`,
        [JSON.stringify({ batch_id: batchId, reason })],
      ),
    );
    this.logger.error(`vidage arrêté (${reason}) : alerte locale, examen manuel`);
  }

  private readonly haltedBatches = new Set<string>();

  private async halted(batchId: string): Promise<boolean> {
    if (this.haltedBatches.has(batchId)) return true;
    const found = await this.gatewayTx.run((tx) =>
      tx.query(
        `SELECT 1 FROM edge_audit WHERE kind = 'DRAIN_HALTED' AND detail->>'batch_id' = $1`,
        [batchId],
      ),
    );
    if (found.rowCount === 0) return false;
    this.haltedBatches.add(batchId);
    return true;
  }

  /** Alerte locale, au plus une fois par minute et par genre. */
  private async alert(kind: string, detail: Record<string, unknown>): Promise<void> {
    const key = `${kind}:${String(detail.code ?? detail.why ?? '')}`;
    const last = this.lastAlertAt.get(key) ?? -Infinity;
    const now = this.clock.now().getTime();
    if (now - last < ALERT_EVERY_MS) return;
    this.lastAlertAt.set(key, now);
    await this.gatewayTx.run((tx) =>
      tx.query(`INSERT INTO edge_audit (kind, actor, detail) VALUES ($1, 'gateway', $2)`, [
        kind,
        JSON.stringify(detail),
      ]),
    );
  }

  // ----- lectures -------------------------------------------------------------------------------

  private async context(): Promise<GatewayContext | null> {
    return this.gatewayTx.run(async (tx) => {
      const meta = await tx.query<{ gateway_id: string; ledger_id: string }>(
        'SELECT gateway_id, ledger_id FROM edge_meta',
      );
      const auth = await tx.query<{ state: string; epoch: string; highest_epoch_seen: string }>(
        'SELECT state, epoch, highest_epoch_seen FROM edge_authority',
      );
      if (!meta.rows[0] || !auth.rows[0]) return null;
      return {
        gatewayId: meta.rows[0].gateway_id,
        ledgerId: meta.rows[0].ledger_id,
        state: auth.rows[0].state,
        epoch: Number(auth.rows[0].epoch),
        highestEpochSeen: Number(auth.rows[0].highest_epoch_seen),
      };
    });
  }

  private async inFlight(): Promise<InFlight | null> {
    const { rows } = await this.gatewayTx.run((tx: TxClient) =>
      tx.query<InFlight>(
        `SELECT batch_id, edge_seq_from, edge_seq_to, epoch, body_sha256, status, body
           FROM edge_outgoing_batch WHERE status <> 'DONE'`,
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Un lot d'une époque inférieure à `highest_epoch_seen` ne part que si le central l'a demandé
   * (`RELEASING`) ou si la passerelle est `STALE` (le vidage ne débite pas). Sinon le lot reste.
   */
  private async epochAllows(
    ctx: GatewayContext,
    batchEpoch: number,
    batchId: string | null,
  ): Promise<boolean> {
    if (batchEpoch >= ctx.highestEpochSeen) return true;
    if (ctx.state === 'RELEASING' || ctx.state === 'STALE') return true;
    await this.alert('DRAIN_EPOCH_BEHIND', {
      batch_id: batchId,
      epoch: batchEpoch,
      highest_epoch_seen: ctx.highestEpochSeen,
      why: 'epoch',
    });
    return false;
  }

  /** File vide : tout numéro est acquitté et aucun lot n'est en vol. */
  private async isEmpty(): Promise<boolean> {
    return this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{ empty: boolean }>(
        `SELECT (h.acked_edge_seq = h.last_edge_seq)
                AND NOT EXISTS (SELECT 1 FROM edge_outgoing_batch
                                 WHERE status <> 'DONE' AND edge_seq_to >= edge_seq_from) AS empty
           FROM edge_chain_head h`,
      );
      return rows[0]?.empty ?? true;
    });
  }

  /** Résumé du rendu : quand la file est vide et `acked_*` à jour (WP17 calcule
  /** `operations_count`). */
  async finalSummary(): Promise<{ final_edge_seq: number; last_chain_hash: string } | null> {
    if (!(await this.isEmpty())) return null;
    return this.gatewayTx.run(async (tx) => {
      const { rows } = await tx.query<{
        acked_edge_seq: string;
        acked_chain_hash: Buffer | null;
        last_chain_hash: Buffer;
        last_edge_seq: string;
      }>(
        `SELECT acked_edge_seq, acked_chain_hash, last_edge_seq, last_chain_hash FROM edge_chain_head`,
      );
      const head = rows[0];
      if (!head || head.acked_edge_seq !== head.last_edge_seq) return null;
      const hash = head.acked_chain_hash ?? head.last_chain_hash;
      if (head.last_edge_seq !== '0' && !hash.equals(head.last_chain_hash)) return null;
      return { final_edge_seq: Number(head.last_edge_seq), last_chain_hash: hash.toString('hex') };
    });
  }
}
