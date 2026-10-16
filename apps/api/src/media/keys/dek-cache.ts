// Cache court de la clé de données en clair, dans le SEUL processus des clés de bracelet (décision du porteur n° 5 ;
// research R-05). Le contrat (`getMediaAuthKey`) prévoit un cache mémoire ; §7.4 demande que le service de clés ne
// soit pas appelé bracelet par bracelet. Une entrée par version de clé de données, gardée `tagDekCacheSeconds` au
// plus à partir de son déchiffrement (300 s au plus ; 0 : aucun cache, un déchiffrement par demande). Le tampon est
// mis à zéro à l'expiration, à l'éviction et à l'arrêt.
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { zeroize } from '../../kms/zeroize';

interface Entry {
  key: Buffer;
  timer: NodeJS.Timeout | null;
  users: number;
  dropped: boolean;
}

@Injectable()
export class DekCache implements OnModuleDestroy {
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<Entry>>();

  constructor(@Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'tagDekCacheSeconds'>) {}

  /**
   * Exécute `fn` avec la clé de données `dekId`. `load` (un déchiffrement par le service de clés) n'est appelé que
   * si la clé n'est pas en cache ; plusieurs demandes simultanées partagent le même déchiffrement.
   */
  async withKey<T>(
    dekId: string,
    load: () => Promise<Buffer>,
    fn: (dek: Buffer) => Promise<T> | T,
  ): Promise<T> {
    const entry = await this.entry(dekId, load);
    entry.users += 1;
    try {
      return await fn(entry.key);
    } finally {
      entry.users -= 1;
      if (this.config.tagDekCacheSeconds === 0) this.drop(dekId, entry);
      if (entry.dropped && entry.users === 0) zeroize(entry.key);
    }
  }

  /** Retire une clé du cache (rotation terminée, clé retirée). */
  evict(dekId: string): void {
    const entry = this.entries.get(dekId);
    if (entry) this.drop(dekId, entry);
  }

  size(): number {
    return this.entries.size;
  }

  onModuleDestroy(): void {
    for (const [id, entry] of [...this.entries]) this.drop(id, entry);
  }

  private async entry(dekId: string, load: () => Promise<Buffer>): Promise<Entry> {
    const cached = this.entries.get(dekId);
    if (cached) return cached;
    let pending = this.loading.get(dekId);
    if (!pending) {
      pending = load()
        .then((key) => {
          const entry: Entry = { key, timer: null, users: 0, dropped: false };
          const ttl = this.config.tagDekCacheSeconds * 1000;
          if (ttl > 0) {
            this.entries.set(dekId, entry);
            // Durée absolue : compte à partir du déchiffrement, pas de la dernière utilisation.
            entry.timer = setTimeout(() => this.drop(dekId, entry), ttl);
            entry.timer.unref();
          }
          return entry;
        })
        .finally(() => this.loading.delete(dekId));
      this.loading.set(dekId, pending);
    }
    return pending;
  }

  private drop(dekId: string, entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.dropped = true;
    if (this.entries.get(dekId) === entry) this.entries.delete(dekId);
    if (entry.users === 0) zeroize(entry.key);
  }
}
