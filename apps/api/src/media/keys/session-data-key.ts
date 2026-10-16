// Clé de données de session de la personnalisation (décision du porteur n° 7 du 13/10/2026 ; research R-05 bis).
// Le processus de personnalisation n'a PAS le droit de déchiffrer une clé de données (§3.2) : il ne peut donc pas
// rouvrir la clé active d'un index. Il en ouvre une par session : au premier bracelet d'une série, `GenerateDataKey`
// rend un clair et sa forme chiffrée ; la forme chiffrée devient la nouvelle version ACTIVE, le clair reste en
// mémoire ICI ET NULLE PART AILLEURS tant que la série dure. Il est effacé (tampon à zéro) :
//   - après `tagDekCacheSeconds` sans utilisation (300 s au plus ; 0 : une clé par appel, rien n'est gardé) ;
//   - dès que sa version n'est plus ACTIVE en base (autre instance, rotation, retrait) ;
//   - à l'arrêt du processus.
// La rotation ramène ensuite tous les bracelets de l'index sous une seule version.
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { TenantTx } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { DATA_KEY_PORT, type DataKeyPort } from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';
import { DataKeyRepository } from './data-key.repository';

interface Session {
  dekId: string;
  version: number;
  plaintext: Buffer;
  expiresAt: number;
  timer: NodeJS.Timeout | null;
  users: number;
  dropped: boolean;
}

export interface SessionKey {
  dekId: string;
  version: number;
  /** Clair de la clé de données : valable pendant `fn` seulement ; ne pas le copier ni le garder. */
  dek: Buffer;
}

@Injectable()
export class SessionDataKeyProvider implements OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private readonly opening = new Map<string, Promise<Session>>();

  constructor(
    @Inject(APP_CONFIG)
    private readonly config: Pick<AppConfig, 'tagDekCacheSeconds' | 'tagWrappingKeyRef'>,
    private readonly tx: TenantTx,
    private readonly dataKeys: DataKeyRepository,
    @Inject(DATA_KEY_PORT) private readonly kms: DataKeyPort,
  ) {}

  /** Exécute `fn` avec la clé de données de session de l'index (ouverte au besoin). */
  async withKey<T>(
    operatorId: string,
    keyIndex: number,
    fn: (key: SessionKey) => Promise<T>,
  ): Promise<T> {
    const session = await this.session(operatorId, keyIndex);
    session.users += 1;
    try {
      return await fn({ dekId: session.dekId, version: session.version, dek: session.plaintext });
    } finally {
      session.users -= 1;
      if (this.ttlMs() === 0) this.drop(this.id(operatorId, keyIndex), session);
      else this.touch(this.id(operatorId, keyIndex), session);
      if (session.dropped && session.users === 0) zeroize(session.plaintext);
    }
  }

  /** Oublie la session d'un index (rotation ou retrait exécutés par ce processus). */
  forget(operatorId: string, keyIndex: number): void {
    const id = this.id(operatorId, keyIndex);
    const session = this.sessions.get(id);
    if (session) this.drop(id, session);
  }

  /** Nombre de clés de données en clair gardées en mémoire (tests, supervision). */
  size(): number {
    return this.sessions.size;
  }

  onModuleDestroy(): void {
    for (const [id, session] of [...this.sessions]) this.drop(id, session);
  }

  private id(operatorId: string, keyIndex: number): string {
    return `${operatorId}:${keyIndex}`;
  }

  private ttlMs(): number {
    return this.config.tagDekCacheSeconds * 1000;
  }

  private async session(operatorId: string, keyIndex: number): Promise<Session> {
    const id = this.id(operatorId, keyIndex);
    const current = this.sessions.get(id);
    if (current) {
      const usable =
        current.expiresAt > Date.now() &&
        (await this.tx.run(operatorId, (client) => this.dataKeys.isActive(client, current.dekId)));
      if (usable) return current;
      this.drop(id, current);
    }
    // Une seule ouverture en vol par index : pas de rafale d'appels au service de clés.
    let pending = this.opening.get(id);
    if (!pending) {
      pending = this.open(operatorId, keyIndex).finally(() => this.opening.delete(id));
      this.opening.set(id, pending);
    }
    return pending;
  }

  private async open(operatorId: string, keyIndex: number): Promise<Session> {
    const status = await this.tx.run(operatorId, (client) =>
      this.dataKeys.keyStatus(client, operatorId, keyIndex),
    );
    if (status === null) throw new ProblemException('NOT_FOUND');
    if (status !== 'ACTIVE')
      throw new ProblemException('CONFLICT_STATE', {
        status: 409,
        detail: 'La clé de ce lot n’est pas active : elle ne personnalise plus de bracelet.',
      });
    const { plaintext, encrypted } = await this.kms.generateDataKey(this.config.tagWrappingKeyRef);
    try {
      const version = await this.tx.run(operatorId, (client) =>
        this.dataKeys.openVersion(
          client,
          operatorId,
          keyIndex,
          this.config.tagWrappingKeyRef,
          encrypted,
        ),
      );
      const session: Session = {
        dekId: version.id,
        version: version.version,
        plaintext,
        expiresAt: 0,
        timer: null,
        users: 0,
        dropped: false,
      };
      if (this.ttlMs() > 0) {
        this.sessions.set(this.id(operatorId, keyIndex), session);
        this.touch(this.id(operatorId, keyIndex), session);
      }
      return session;
    } catch (error) {
      zeroize(plaintext);
      throw error;
    }
  }

  /** Repousse l'expiration : la durée compte à partir de la dernière utilisation. */
  private touch(id: string, session: Session): void {
    if (session.dropped || this.sessions.get(id) !== session) return;
    if (session.timer) clearTimeout(session.timer);
    session.expiresAt = Date.now() + this.ttlMs();
    session.timer = setTimeout(() => this.drop(id, session), this.ttlMs());
    session.timer.unref();
  }

  private drop(id: string, session: Session): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    session.dropped = true;
    if (this.sessions.get(id) === session) this.sessions.delete(id);
    // Un bracelet en cours de scellement finit avec la clé ; le tampon est effacé dès qu'il n'a plus d'utilisateur.
    if (session.users === 0) zeroize(session.plaintext);
  }
}
