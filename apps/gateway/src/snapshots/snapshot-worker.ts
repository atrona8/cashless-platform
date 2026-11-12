// Travailleur des snapshots (WP23, T105) : un passage par pas (1 s par défaut), qui n'écrit qu'UNE version
// nouvelle par changement. Un changement bloquant est publié dès le passage suivant (≤ 5 s, SP:889) ; le
// régime courant attend 60 s (voir `SnapshotBuilder`). Démarré par `startGateway` APRÈS les migrations, la
// reprise de l'autorité et l'enrôlement (un `onApplicationBootstrap` passerait avant les migrations). Une
// panne (clé détruite, base) n'arrête jamais le processus : rien n'est publié, le code est journalisé.
import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from '@nestjs/common';
import { GatewayTx } from '../db/gateway-tx';
import { SnapshotBuilder, type BuildOutcome } from './snapshot-builder';

export const SNAPSHOT_WORKER_OPTIONS = Symbol('SNAPSHOT_WORKER_OPTIONS');
export interface SnapshotWorkerOptions {
  intervalMs: number;
}
export const DEFAULT_SNAPSHOT_WORKER_OPTIONS: SnapshotWorkerOptions = { intervalMs: 1000 };

@Injectable()
export class SnapshotWorker implements OnApplicationShutdown {
  private readonly logger = new Logger('SnapshotWorker');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private readonly options: SnapshotWorkerOptions;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(SnapshotBuilder) private readonly builder: SnapshotBuilder,
    @Optional() @Inject(SNAPSHOT_WORKER_OPTIONS) options?: SnapshotWorkerOptions,
  ) {
    this.options = options ?? DEFAULT_SNAPSHOT_WORKER_OPTIONS;
  }

  /** Un passage (exposé pour les tests et pour un déclenchement immédiat). */
  async tick(): Promise<BuildOutcome | null> {
    try {
      return await this.gatewayTx.run((tx) => this.builder.buildIfDue(tx));
    } catch (error) {
      // Code seulement : jamais de message d'erreur (il pourrait venir d'une couche qui cite une valeur).
      this.logger.error(
        JSON.stringify({
          event: 'snapshot_tick_failed',
          kind: (error as Error)?.name ?? 'unknown',
        }),
      );
      return null;
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.running !== null) return;
      this.running = this.tick().finally(() => {
        this.running = null;
      });
    }, this.options.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }
}
