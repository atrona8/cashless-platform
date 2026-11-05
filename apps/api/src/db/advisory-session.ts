// Verrous consultatifs de SESSION (mission hors-ligne-snapshots-lots, WP11) : exclusivité d'une
// instance sur un objet (un grand livre). Une connexion dédiée du pool les porte tous ; la fermer, ou
// la perdre, libère tous les verrous côté base. Fichier de db/ : seul endroit autorisé à tenir le
// pool. Fonctions intégrées de PostgreSQL seulement : aucun droit de base à ajouter.
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from './pool.token';

@Injectable()
export class AdvisorySession implements OnModuleDestroy {
  private session: PoolClient | null = null;
  private lost = false;
  private readonly held = new Set<string>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Clé dérivée de façon stable du nom (espace de noms propre, passé par l'appelant). */
  private static key(namespace: string): string {
    return `hashtextextended('${namespace.replace(/'/g, "''")}:' || $1::text, 0)`;
  }

  /**
   * Prend ou confirme le verrou (non bloquant). Faux : une autre instance le tient. Gardé jusqu'à
   * `releaseExcept`, `close` ou la perte de la connexion (détectée ici, le verrou est alors repris).
   */
  async tryLock(namespace: string, id: string): Promise<boolean> {
    return this.serial(() => this.tryLockNow(namespace, id));
  }

  /** Les tâches de plusieurs grands livres appellent en même temps : une opération à la fois. */
  private chain: Promise<unknown> = Promise.resolve();
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.chain.then(operation, operation);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async tryLockNow(namespace: string, id: string): Promise<boolean> {
    if (this.session && !this.lost) {
      try {
        await this.session.query('SELECT 1');
      } catch {
        this.lost = true;
      }
    }
    if (this.lost) await this.drop();
    const name = `${namespace}:${id}`;
    if (this.held.has(name)) return true;
    if (!this.session) {
      const client = await this.pool.connect();
      client.on('error', () => {
        this.lost = true;
      });
      this.session = client;
      this.lost = false;
    }
    const { rows } = await this.session.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(${AdvisorySession.key(namespace)}) AS ok`,
      [id],
    );
    if (rows[0]!.ok) this.held.add(name);
    return rows[0]!.ok;
  }

  /** Libère les verrous de cet espace dont l'identifiant n'est plus dans `keep`. */
  async releaseExcept(namespace: string, keep: ReadonlySet<string>): Promise<void> {
    return this.serial(() => this.releaseExceptNow(namespace, keep));
  }

  private async releaseExceptNow(namespace: string, keep: ReadonlySet<string>): Promise<void> {
    if (!this.session || this.lost) return;
    for (const name of [...this.held]) {
      const [space, id] = [name.slice(0, namespace.length), name.slice(namespace.length + 1)];
      if (space !== namespace || keep.has(id)) continue;
      await this.session.query(`SELECT pg_advisory_unlock(${AdvisorySession.key(namespace)})`, [
        id,
      ]);
      this.held.delete(name);
    }
  }

  private async drop(): Promise<void> {
    const client = this.session;
    this.session = null;
    this.lost = false;
    this.held.clear();
    // Détruire la connexion libère tous ses verrous côté base.
    client?.release(true);
  }

  async close(): Promise<void> {
    await this.serial(() => this.drop());
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
