// Écoute `edge_handover_changed` (payload = identifiant de la passerelle, rien d'autre) : UNE connexion dédiée par
// processus, ouverte avec `cashless_edge` (`DATABASE_URL_EDGE`). Le réveil sur notification tient NFR-007 ; le repli
// à 2 s du service couvre toute notification perdue. La connexion elle-même vit dans `db/notify-listener.ts`.
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { NotifyListener } from '../../db/notify-listener';

export const HANDOVER_CHANNEL = 'edge_handover_changed';

@Injectable()
export class HandoverListener implements OnApplicationShutdown {
  private listener: NotifyListener | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Prévient `wake` à chaque changement de CETTE passerelle (et à chaque (ré)ouverture de l'écoute). */
  watch(gatewayId: string, wake: () => void): () => void {
    this.listener ??= new NotifyListener(this.config.edgeDatabaseUrl, HANDOVER_CHANNEL);
    return this.listener.subscribe((payload) => {
      if (payload === gatewayId) wake();
    }, wake);
  }

  /** Attentes en cours (test de non-fuite). */
  watchers(): number {
    return this.listener?.subscriberCount() ?? 0;
  }

  /** Coupe l'écoute sans la rouvrir : les attentes ne comptent plus que sur le repli (essais). */
  async halt(): Promise<void> {
    await this.listener?.halt();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.halt();
  }
}
