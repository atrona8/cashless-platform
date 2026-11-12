// `getCurrentEdgeHandover` avec attente longue (NFR-007, research R-17). `wait` = 0 : l'état courant, tout de suite.
// `wait` > 0 : l'état lu à l'entrée de la requête sert de référence ; la réponse part dès que l'état diffère (réveil
// immédiat sur `NOTIFY edge_handover_changed` de CETTE passerelle, repli par relecture toutes les 2 s si la
// notification est perdue), ou à l'échéance avec l'état courant. Aucune transaction ni connexion du pool n'est tenue
// pendant que la requête dort : chaque relecture est une transaction courte. `touch_edge_gateway` (battement de
// cœur, FR-005) à l'entrée et à la sortie. Un client qui coupe arrête l'attente (écoute et minuterie libérées).
import { Injectable, Logger } from '@nestjs/common';
import { ProblemException } from '../../errors/problem';
import type { EdgeGateway } from '../auth/edge-gateway';
import { EdgeTx } from '../edge-tx';
import { DebitAuthorityReader, type DebitAuthorityState } from './debit-authority-reader';
import { HandoverListener } from './handover-listener';

export const FALLBACK_POLL_MS = 2_000;
/** Attentes longues simultanées au plus par passerelle ; au-delà, réponse immédiate (comme `wait=0`). */
export const MAX_LONG_WAITS_PER_GATEWAY = 4;

@Injectable()
export class CurrentHandoverService {
  private readonly logger = new Logger('CurrentHandover');
  private readonly longWaits = new Map<string, number>();

  constructor(
    private readonly tx: EdgeTx,
    private readonly reader: DebitAuthorityReader,
    private readonly listener: HandoverListener,
  ) {}

  async current(
    gateway: EdgeGateway,
    requestedWait: number,
    signal: AbortSignal,
  ): Promise<DebitAuthorityState> {
    // Borne par passerelle (réservation synchrone, libérée à toute sortie) : au-delà, pas d'attente.
    const running = this.longWaits.get(gateway.gatewayId) ?? 0;
    const waitSeconds =
      requestedWait > 0 && running >= MAX_LONG_WAITS_PER_GATEWAY ? 0 : requestedWait;
    if (waitSeconds > 0) this.longWaits.set(gateway.gatewayId, running + 1);
    try {
      return await this.run(gateway, waitSeconds, signal);
    } finally {
      if (waitSeconds > 0) {
        const left = (this.longWaits.get(gateway.gatewayId) ?? 1) - 1;
        if (left <= 0) this.longWaits.delete(gateway.gatewayId);
        else this.longWaits.set(gateway.gatewayId, left);
      }
    }
  }

  private async run(
    gateway: EdgeGateway,
    waitSeconds: number,
    signal: AbortSignal,
  ): Promise<DebitAuthorityState> {
    let wake: (() => void) | null = null;
    let woken = false;
    const poke = (): void => {
      woken = true;
      wake?.();
    };
    // S'abonner AVANT la lecture d'entrée : un changement entre la lecture et l'abonnement ne serait pas vu.
    const unwatch =
      waitSeconds > 0 && !signal.aborted
        ? this.listener.watch(gateway.gatewayId, poke)
        : () => undefined;
    // Dort jusqu'au réveil, au repli de 2 s, à `left` ms ou à l'abandon du client ; libère tout à la sortie.
    const sleep = (left: number): Promise<void> =>
      new Promise<void>((resolve) => {
        const onAbort = (): void => done();
        const timer = setTimeout(() => done(), Math.min(FALLBACK_POLL_MS, left));
        const done = (): void => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          wake = null;
          resolve();
        };
        wake = done;
        signal.addEventListener('abort', onAbort, { once: true });
      });
    try {
      await this.touch(gateway);
      const entry = await this.observe(gateway);
      let latest = entry;
      if (waitSeconds > 0) {
        const deadline = Date.now() + waitSeconds * 1000;
        while (latest.fingerprint === entry.fingerprint && !signal.aborted) {
          const left = deadline - Date.now();
          if (left <= 0) break;
          if (!woken) await sleep(left);
          woken = false;
          if (signal.aborted) break;
          latest = await this.observe(gateway);
        }
      }
      return await this.finish(gateway, latest.state, signal);
    } finally {
      unwatch();
    }
  }

  private async finish(
    gateway: EdgeGateway,
    state: DebitAuthorityState,
    signal: AbortSignal,
  ): Promise<DebitAuthorityState> {
    if (!signal.aborted) {
      // Battement de sortie : un échec ici ne fait pas perdre la réponse.
      await this.touch(gateway).catch((error: unknown) =>
        this.logger.warn(`battement de sortie non écrit : ${(error as Error).message}`),
      );
    }
    return state;
  }

  private touch(gateway: EdgeGateway): Promise<void> {
    return this.guarded(() =>
      this.tx.run(gateway, async (client) => {
        await client.query('SELECT touch_edge_gateway($1)', [gateway.gatewayId]);
      }),
    );
  }

  private observe(gateway: EdgeGateway): ReturnType<DebitAuthorityReader['read']> {
    return this.guarded(() => this.reader.read(gateway));
  }

  /** Passerelle révoquée ou retirée entre la garde et l'appel (`42501`) : même 401 que la garde. */
  private async guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if ((error as { code?: string }).code === '42501')
        throw new ProblemException('UNAUTHENTICATED');
      throw error;
    }
  }
}
