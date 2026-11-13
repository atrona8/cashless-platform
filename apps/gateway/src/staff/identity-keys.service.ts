// Copie locale des clés publiques du serveur d'identité (`edge_identity_key`, data-model.md B.4,
// research R-20). Le central ne réplique AUCUNE clé d'identité : la passerelle les rafraîchit
// elle-même, tant que le serveur d'identité est joignable, et ne vérifie que ce qu'elle tient.
//
// Règles (fichier à faire relire par une personne) :
//  - une clé n'est acceptée que de l'URL configurée (`GATEWAY_IDENTITY_JWKS_URL`), sans suivre de
//    redirection, et seulement si l'émetteur attendu (`GATEWAY_IDENTITY_ISSUER`) est configuré :
//    l'émetteur est rangé avec la clé, un jeton d'un autre émetteur est refusé ;
//  - une clé sans `kid` est refusée ; une clé privée (`d`, `p`, `q`, `k`...) n'est JAMAIS rangée ;
//  - une erreur réseau ou une réponse illisible ne supprime ni ne modifie aucune clé connue ;
//  - aucune clé ni jeton n'entre dans un journal.
// Un vérificateur de clés « en mémoire » (`GATEWAY_IDENTITY_VERIFIER=test`) est un faux : il fait
// refuser le démarrage en production (règle enregistrée ci-dessous, en plus de celle de WP16).
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { GatewayTx, type TxClient } from '../db/gateway-tx';
import { registerProductionRule } from '../processes/startup-guard';

try {
  registerProductionRule('IDENTITY_KEYS_IN_MEMORY', ({ config }) =>
    config.identityVerifier !== null
      ? 'edge_identity_key : clés d’identité en mémoire (faux) interdites en production'
      : null,
  );
} catch {
  // Module chargé deux fois (tests) : la règle est déjà enregistrée.
}

export interface IdentityKeyRow {
  kid: string;
  jwk: Record<string, unknown>;
  issuer: string;
}

const REFRESH_EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000;
const FETCH_TIMEOUT_MS = 3_000;
const MAX_BYTES = 1_048_576;
const PRIVATE_PARAMS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth'];

/** Clé publique acceptable : `kid`, `kty` EC ou RSA, aucune partie privée, `use` absent ou `sig`. */
export function acceptableJwk(candidate: unknown): Record<string, unknown> | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const jwk = candidate as Record<string, unknown>;
  if (typeof jwk.kid !== 'string' || jwk.kid === '') return null;
  if (jwk.kty !== 'EC' && jwk.kty !== 'RSA') return null;
  if (PRIVATE_PARAMS.some((name) => jwk[name] !== undefined)) return null;
  if (jwk.use !== undefined && jwk.use !== 'sig') return null;
  if (jwk.alg !== undefined && jwk.alg !== 'ES256' && jwk.alg !== 'RS256') return null;
  return jwk;
}

@Injectable()
export class IdentityKeys implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('IdentityKeys');
  private timer: NodeJS.Timeout | null = null;
  private lastAttemptMs = -Infinity;

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  async find(tx: TxClient, kid: string): Promise<IdentityKeyRow | null> {
    const { rows } = await tx.query<IdentityKeyRow>(
      'SELECT kid, jwk, issuer FROM edge_identity_key WHERE kid = $1',
      [kid],
    );
    return rows[0] ?? null;
  }

  onApplicationBootstrap(): void {
    if (this.config.identityJwksUrl === null) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Tente un rafraîchissement si le dernier remonte à plus de 30 s (clé inconnue rencontrée). */
  async refreshIfStale(nowMs: number): Promise<void> {
    if (nowMs - this.lastAttemptMs < MIN_GAP_MS) return;
    await this.refresh(nowMs);
  }

  /** Rafraîchit depuis l'URL configurée ; ne lève jamais, ne retire jamais une clé connue. */
  async refresh(nowMs: number = Date.now()): Promise<number> {
    const url = this.config.identityJwksUrl;
    const issuer = this.config.identityIssuer;
    if (url === null || issuer === null) return 0;
    this.lastAttemptMs = nowMs;
    let keys: Array<Record<string, unknown>>;
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`statut ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error('réponse trop grande');
      const body = JSON.parse(text) as { keys?: unknown };
      if (!Array.isArray(body.keys)) throw new Error('JWKS sans liste de clés');
      keys = body.keys.map(acceptableJwk).filter((k): k is Record<string, unknown> => k !== null);
    } catch (error) {
      // Aucun message de la réponse : seulement la nature de l'échec.
      this.logger.warn(
        JSON.stringify({ event: 'identity_keys_refresh_failed', kind: (error as Error).name }),
      );
      return 0;
    }
    if (keys.length === 0) return 0;
    await this.gatewayTx.run(async (tx) => {
      for (const jwk of keys) {
        await tx.query(
          `INSERT INTO edge_identity_key (kid, jwk, issuer) VALUES ($1, $2, $3)
           ON CONFLICT (kid) DO UPDATE SET jwk = EXCLUDED.jwk, issuer = EXCLUDED.issuer`,
          [jwk.kid, JSON.stringify(jwk), issuer],
        );
      }
    });
    return keys.length;
  }
}
