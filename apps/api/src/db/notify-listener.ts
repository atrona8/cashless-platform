// Écoute d'un canal `LISTEN/NOTIFY` sur UNE connexion dédiée du processus (mission passerelle-locale, WP10, R-17).
// Fichier de `db/` : seul `db/` ouvre des connexions `pg` (test d'architecture). Ce n'est pas un pool : une connexion
// unique, ouverte au premier abonné, qui se rouvre seule après une coupure ; les abonnés sont alors prévenus pour
// relire l'état complet (une notification perdue pendant la coupure ne se rattrape pas autrement).
import { Client } from 'pg';

export type NotifyHandler = (payload: string) => void;

const RECONNECT_MIN_MS = 250;
const RECONNECT_MAX_MS = 5_000;

export class NotifyListener {
  private readonly handlers = new Set<NotifyHandler>();
  private readonly resyncs = new Set<() => void>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private delay = RECONNECT_MIN_MS;
  private halted = false;

  constructor(
    private readonly connectionString: string,
    private readonly channel: string,
    private readonly applicationName = 'cashless-edge-listener',
  ) {}

  /** Abonne `handler` à tous les messages du canal ; rend la fonction de désabonnement. */
  subscribe(handler: NotifyHandler, resync?: () => void): () => void {
    this.handlers.add(handler);
    if (resync) this.resyncs.add(resync);
    this.ensureConnected();
    return () => {
      this.handlers.delete(handler);
      if (resync) this.resyncs.delete(resync);
    };
  }

  subscriberCount(): number {
    return this.handlers.size;
  }

  /** Vrai si la connexion d'écoute est ouverte. */
  connected(): boolean {
    return this.client !== null && !this.connecting;
  }

  /** Arrête l'écoute pour de bon (arrêt du processus, ou essais : les abonnés ne comptent plus que sur leur repli). */
  async halt(): Promise<void> {
    this.halted = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }

  private ensureConnected(): void {
    if (this.halted || this.client || this.connecting || this.timer) return;
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
  }

  private async connect(): Promise<void> {
    const client = new Client({
      connectionString: this.connectionString,
      application_name: this.applicationName,
    });
    // Une erreur de connexion ne doit jamais tuer le processus : elle déclenche la reconnexion.
    client.on('error', () => this.lost(client));
    client.on('end', () => this.lost(client));
    client.on('notification', (message) => {
      if (message.channel !== this.channel) return;
      for (const handler of [...this.handlers]) handler(message.payload ?? '');
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${this.channel}`);
    } catch {
      await client.end().catch(() => undefined);
      this.schedule();
      return;
    }
    if (this.halted) {
      await client.end().catch(() => undefined);
      return;
    }
    this.client = client;
    this.delay = RECONNECT_MIN_MS;
    // À chaque ouverture (première comprise : un changement a pu passer pendant la connexion) : relecture complète.
    for (const resync of [...this.resyncs]) resync();
  }

  private lost(client: Client): void {
    if (this.client !== client) return;
    this.client = null;
    client.end().catch(() => undefined);
    this.schedule();
  }

  private schedule(): void {
    if (this.halted || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.handlers.size > 0) this.ensureConnected();
    }, this.delay);
    this.timer.unref();
    this.delay = Math.min(this.delay * 2, RECONNECT_MAX_MS);
  }
}
