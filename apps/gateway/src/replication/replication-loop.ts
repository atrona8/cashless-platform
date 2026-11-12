// Boucle de fond : tire tant que `hasMore`, sinon toutes les `intervalMs` (1 s par défaut). Cet
// intervalle porte NFR-008 (un blocage du central s'applique en moins de 5 s au p95). Arrêt propre.
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { ReplicationService } from './replication.service';

export const BACKOFF_CEILING_MS = 5_000;

@Injectable()
export class ReplicationLoop implements OnApplicationShutdown {
  private readonly logger = new Logger('ReplicationLoop');
  private stopped = true;
  private done: Promise<void> = Promise.resolve();
  private sleeper: { timer: NodeJS.Timeout; resolve: () => void } | null = null;

  constructor(
    @Inject(ReplicationService) private readonly service: ReplicationService,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  /** Appelé par le démarrage, APRÈS migrations, enrôlement et reprise de l'autorité. */
  async start(): Promise<void> {
    if (!this.stopped) return;
    if (this.config.centralUrl === null || this.config.centralClientCertFile === null) return;
    this.stopped = false;
    await this.service.syncRole().catch(() => undefined);
    this.done = this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.sleeper) {
      clearTimeout(this.sleeper.timer);
      this.sleeper.resolve();
    }
    await this.done;
  }

  onApplicationShutdown(): Promise<void> {
    return this.stop();
  }

  private async loop(): Promise<void> {
    let failures = 0;
    while (!this.stopped) {
      let delay = this.service.intervalMs;
      try {
        const { hasMore } = await this.service.pullOnce();
        failures = 0;
        if (hasMore) delay = 0;
      } catch (error) {
        failures += 1;
        // Erreur du central : l'état local est gardé, rien n'est effacé.
        delay = Math.min(BACKOFF_CEILING_MS, this.service.intervalMs * 2 ** Math.min(failures, 3));
        this.logger.warn(
          `passe de réplication échouée (${error instanceof Error ? error.name : '?'})`,
        );
      }
      if (delay > 0 && !this.stopped) await this.sleep(delay);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.sleeper = null;
        resolve();
      }, ms);
      this.sleeper = { timer, resolve };
    });
  }
}
