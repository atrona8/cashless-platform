// Faux serveur d'identité (research R-01) : paire de clés ES256 en mémoire, JWKS locale, jetons valides et
// volontairement défectueux. Jamais utilisé hors des tests.
import { randomUUID } from 'node:crypto';
import type { Provider } from '@nestjs/common';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { Client } from 'pg';
import { loadConfig, type OidcConfig } from '../../src/config/config';
import { IDENTITY_VERIFIER, JoseIdentityVerifier } from '../../src/identity/oidc-verifier';
import type { Role, ScopeType } from '../../src/identity/principal';

const KID = 'fake-idp-key';

export type DefectiveKind = 'expired' | 'wrongIssuer' | 'wrongAudience' | 'otherKey' | 'noExp' | 'algNone' | 'malformed';
export const DEFECTIVE_KINDS: DefectiveKind[] = [
  'expired',
  'wrongIssuer',
  'wrongAudience',
  'otherKey',
  'noExp',
  'algNone',
  'malformed',
];

export interface ApprovalTokenInput {
  subject: string;
  act: string;
  actHash: string;
  jti?: string;
  ttlSeconds?: number;
}

export interface PersonInput {
  /** NULL : personne de la plateforme. */
  operatorId: string | null;
  roles?: Array<{ role: Role; scopeType: ScopeType; scopeId?: string | null }>;
  status?: 'ACTIVE' | 'DISABLED';
}

export interface TestPerson {
  userId: string;
  subject: string;
  token: string;
}

const base64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export class FakeIdp {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly otherKey: CryptoKey,
    readonly keys: JWTVerifyGetKey,
    readonly config: OidcConfig,
  ) {}

  static async create(config: OidcConfig = loadConfig().oidc): Promise<FakeIdp> {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const other = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
    return new FakeIdp(privateKey, other.privateKey, createLocalJWKSet({ keys: [jwk] }), config);
  }

  verifier(): JoseIdentityVerifier {
    return new JoseIdentityVerifier(this.keys, this.config);
  }

  provider(): Provider {
    return { provide: IDENTITY_VERIFIER, useValue: this.verifier() };
  }

  /** Jeton d'accès valide (5 min) ; `overrides` remplace ou ajoute des claims (ex. `operator_id`, `roles`). */
  accessToken(subject: string, overrides: JWTPayload = {}): Promise<string> {
    return this.sign({ aud: this.config.audience, ...overrides }, subject, 300);
  }

  approvalToken(input: ApprovalTokenInput): Promise<string> {
    return this.sign(
      { aud: this.config.approvalAudience, jti: input.jti ?? randomUUID(), act: input.act, act_hash: input.actHash },
      input.subject,
      input.ttlSeconds ?? 120,
    );
  }

  /** Jeton d'accès défectueux d'une sorte donnée, pour une personne par ailleurs valide. */
  async defective(kind: DefectiveKind, subject: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    switch (kind) {
      case 'expired':
        return this.sign({ aud: this.config.audience, iat: now - 600, exp: now - 60 }, subject, 0);
      case 'wrongIssuer':
        return this.sign({ aud: this.config.audience, iss: 'https://intrus.test' }, subject, 300);
      case 'wrongAudience':
        return this.sign({ aud: 'autre-api' }, subject, 300);
      case 'otherKey':
        return this.sign({ aud: this.config.audience }, subject, 300, this.otherKey);
      case 'noExp':
        return new SignJWT({ aud: this.config.audience })
          .setProtectedHeader({ alg: 'ES256', kid: KID })
          .setIssuer(this.config.issuer)
          .setSubject(subject)
          .setIssuedAt()
          .sign(this.privateKey);
      case 'algNone':
        return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
          iss: this.config.issuer,
          aud: this.config.audience,
          sub: subject,
          iat: now,
          exp: now + 300,
        })}.`;
      case 'malformed':
        return 'pas.un.jeton';
    }
  }

  /** Personne et attributions insérées en rôle propriétaire ; rend son jeton d'accès. */
  async createPerson(db: Client, input: PersonInput): Promise<TestPerson> {
    const subject = `sub-${randomUUID()}`;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO app_user (operator_id, issuer, subject, email, display_name)
       VALUES ($1, $2, $3, $4, 'Personne de test') RETURNING id`,
      [input.operatorId, this.config.issuer, subject, `${subject}@test.local`],
    );
    const userId = rows[0]!.id;
    for (const role of input.roles ?? []) {
      await db.query(`INSERT INTO role_assignment (user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4)`, [
        userId,
        role.role,
        role.scopeType,
        role.scopeId ?? null,
      ]);
    }
    if (input.status === 'DISABLED') {
      await db.query(`UPDATE app_user SET status = 'DISABLED', disabled_at = clock_timestamp() WHERE id = $1`, [userId]);
    }
    return { userId, subject, token: await this.accessToken(subject) };
  }

  private sign(claims: JWTPayload, subject: string, ttlSeconds: number, key: CryptoKey = this.privateKey): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: this.config.issuer, iat: now, exp: now + ttlSeconds, ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setSubject(subject)
      .sign(key);
  }
}
