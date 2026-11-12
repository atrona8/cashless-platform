// Jeton de personne au guichet (`staffBearer`, en-tête `X-Staff-Authorization`), research R-20,
// décision 3 du porteur, `OP-N103`, `ADR-158`. FICHIER À FAIRE RELIRE PAR UNE PERSONNE
// (cryptographie, ordre des conditions, borne de 12 h).
//
// Jeton NON expiré : règle normale, aucune tolérance (signature, `iss`, `aud`, `exp`, puis
// personne relue dans `edge_staff` : `ACTIVE`, rôle `CASHIER` ou `SUPERVISOR`).
// Jeton EXPIRÉ : sept conditions, TOUTES exigées, dans cet ordre, la première qui échoue refuse
// (`401`, comme un jeton expiré au central) :
//   1. signature valide, `kid` dans la copie répliquée, `iss`, `aud` attendus ;
//   2. `sub` + `iss` = la personne qui a OUVERT la session de caisse citée ;
//   3. le terminal de la requête est celui de la session ;
//   4. session `OPEN` et `usable_on_edge` ;
//   5. `iat <= activated_at`, `exp >= activated_at` (A15), maintenant <= `activated_at + 12 h`
//      (borne FIXE `token_tolerance_until`, jamais prolongée) ; autorité `ACTIVE` ;
//   6. personne `ACTIVE` avec un rôle habilité dans l'état répliqué ;
//   7. ligne d'audit `STAFF_TOKEN_TOLERATED`, dans la transaction de l'opération (`tolerance-audit`).
// « Maintenant » est `GatewayClock.now()`, jamais l'horloge système. La tolérance ne vaut que pour
// `activateMedia`, `takeDeposit` et `createCashTopup`, jamais ailleurs ni au central.
//
// Le garde fait les conditions 1 à 6 dans une transaction de lecture ; chaque opération refait 2 à
// 6 dans SA transaction (`StaffAuthorizer.authorize`) puis écrit la condition 7 : l'état qui compte
// est celui de l'instant de l'écriture. Aucun jeton, aucune clé n'entre dans un journal.
import {
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose';
import { GATEWAY_CLOCK, TOKEN_TOLERANCE_MS, type GatewayClock } from '../clock/gateway-clock';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { GatewayTx, type TxClient } from '../db/gateway-tx';
import { requestDevice, type AuthenticatedDevice } from '../device-proofs/device-proofs.guard';
import { ProblemException } from '../device-proofs/problem';
import { SERVED_OPERATION_KEY } from '../processes/served-operations';
import { IdentityKeys } from './identity-keys.service';
import { TOLERANCE_ROUTES, type ToleranceRoute, type ToleranceUse } from './tolerance-audit';

export const COUNTER_ROLES: readonly string[] = ['CASHIER', 'SUPERVISOR'];
const ALGORITHMS = ['ES256', 'RS256'];
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
export const STAFF_HEADER = 'x-staff-authorization';

/** Refus d'un jeton de personne : `401`, sans dire laquelle des conditions a échoué. */
export class StaffTokenRefused extends ProblemException {
  constructor(
    /** Numéro de la condition de R-20 qui a échoué (0 : forme, 1 à 6). Jamais dans la réponse. */
    readonly condition: number,
    readonly why: string,
  ) {
    super('UNAUTHENTICATED');
    this.name = 'StaffTokenRefused';
  }
}

export interface StaffClaims {
  issuer: string;
  subject: string;
  jti: string | null;
  exp: number;
  iat: number | null;
}

/** Jeton vérifié (condition 1) : `expired` selon l'horloge de la passerelle. */
export interface StaffPrincipal {
  claims: StaffClaims;
  expired: boolean;
}

export interface CashSessionRow {
  cash_session_id: string;
  device_id: string;
  cash_account_id: string | null;
  opened_by_iss: string | null;
  opened_by_sub: string | null;
  status: string;
  usable_on_edge: boolean;
  closed_at: Date | null;
}

export interface StaffAuthorization {
  claims: StaffClaims;
  /** Session de caisse du terminal (ouverte), ou la session citée ; `null` si aucune. */
  session: CashSessionRow | null;
  /** Présent si, et seulement si, le jeton est expiré et toléré : à auditer (condition 7). */
  tolerated: ToleranceUse | null;
}

export type StaffRequest = Request & { staff?: StaffPrincipal };

export interface AuthorizeContext {
  device: AuthenticatedDevice;
  route: string;
  /** `cash_session_id` cité par la requête, s'il y en a un. */
  citedSessionId?: string | null;
}

const SESSION_COLUMNS = `cash_session_id, device_id, cash_account_id, opened_by_iss, opened_by_sub,
  status, usable_on_edge, closed_at`;

@Injectable()
export class StaffAuthorizer {
  private readonly logger = new Logger('StaffToken');

  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(IdentityKeys) private readonly keys: IdentityKeys,
  ) {}

  /** Condition 1 : signature, `kid` répliqué, `iss`, `aud`. Classe le jeton expiré ou non. */
  async verify(token: string): Promise<StaffPrincipal> {
    const issuer = this.config.identityIssuer;
    const audience = this.config.identityAudience;
    // Sans émetteur et audience configurés, aucun jeton de personne n'est accepté (échec fermé).
    if (issuer === null || audience === null)
      throw new StaffTokenRefused(1, 'identité non configurée');
    let kid: string | undefined;
    let alg: string | undefined;
    try {
      const header = decodeProtectedHeader(token);
      kid = header.kid;
      alg = header.alg;
    } catch {
      throw new StaffTokenRefused(1, 'en-tête illisible');
    }
    if (!kid || !alg || !ALGORITHMS.includes(alg)) throw new StaffTokenRefused(1, 'kid ou alg');
    let row = await this.gatewayTx.run((tx) => this.keys.find(tx, kid));
    if (row === null) {
      await this.keys.refreshIfStale(Date.now());
      row = await this.gatewayTx.run((tx) => this.keys.find(tx, kid));
    }
    if (row === null) throw new StaffTokenRefused(1, 'kid inconnu');
    if (row.issuer !== issuer) throw new StaffTokenRefused(1, 'émetteur de la clé');
    let payload: Record<string, unknown>;
    try {
      const key = await importJWK(row.jwk as JWK, alg);
      const verified = await compactVerify(token, key, { algorithms: [alg] });
      payload = JSON.parse(Buffer.from(verified.payload).toString('utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new StaffTokenRefused(1, 'signature');
    }
    if (payload.iss !== issuer) throw new StaffTokenRefused(1, 'iss');
    const aud = payload.aud;
    if (!(aud === audience || (Array.isArray(aud) && aud.includes(audience)))) {
      throw new StaffTokenRefused(1, 'aud');
    }
    const { sub, exp, iat, nbf, jti } = payload;
    if (typeof sub !== 'string' || sub === '') throw new StaffTokenRefused(1, 'sub');
    if (typeof exp !== 'number' || !Number.isFinite(exp)) throw new StaffTokenRefused(1, 'exp');
    const nowMs = this.clock.now().getTime();
    if (typeof nbf === 'number' && nbf * 1000 > nowMs) throw new StaffTokenRefused(1, 'nbf');
    return {
      claims: {
        issuer,
        subject: sub,
        jti: typeof jti === 'string' && jti !== '' ? jti : null,
        exp,
        iat: typeof iat === 'number' && Number.isFinite(iat) ? iat : null,
      },
      expired: exp * 1000 <= nowMs,
    };
  }

  /**
   * Conditions 2 à 6 (jeton expiré) ou rôle seul (jeton valide), DANS la transaction `tx`. Rend la
   * session de caisse du terminal et, si le jeton est toléré, l'usage à auditer (condition 7).
   */
  async authorize(
    tx: TxClient,
    principal: StaffPrincipal,
    ctx: AuthorizeContext,
  ): Promise<StaffAuthorization> {
    const { claims } = principal;
    const session = await this.findSession(tx, ctx);
    // Expiré ou non : jugé à l'instant de l'écriture, pas à celui du garde.
    const expired = claims.exp * 1000 <= this.clock.now().getTime();
    if (!expired) {
      await this.assertPerson(tx, claims, false);
      return { claims, session, tolerated: null };
    }
    // --- jeton expiré : tolérance R-20, dans l'ordre -------------------------------------------
    if (!TOLERANCE_ROUTES.has(ctx.route)) throw new StaffTokenRefused(0, 'route sans tolérance');
    // 2. la personne qui a ouvert la session citée.
    if (
      session === null ||
      session.opened_by_sub === null ||
      session.opened_by_iss === null ||
      session.opened_by_sub !== claims.subject ||
      session.opened_by_iss !== claims.issuer
    ) {
      throw new StaffTokenRefused(2, 'autre personne que celle qui a ouvert la session');
    }
    // 3. le terminal de la session.
    if (session.device_id !== ctx.device.deviceId) throw new StaffTokenRefused(3, 'autre terminal');
    // 4. session ouverte et utilisable sur la passerelle.
    if (session.status !== 'OPEN' || session.closed_at !== null || !session.usable_on_edge) {
      throw new StaffTokenRefused(4, 'session non ouverte ou non répliquée avant la bascule');
    }
    // 5. émission avant la bascule, validité à la bascule, borne fixe de 12 h.
    const authority = await tx.query<{
      state: string;
      activated_at: Date | null;
      token_tolerance_until: Date | null;
    }>('SELECT state, activated_at, token_tolerance_until FROM edge_authority');
    const row = authority.rows[0];
    if (!row || row.state !== 'ACTIVE' || row.activated_at === null) {
      throw new StaffTokenRefused(5, 'autorité non ACTIVE');
    }
    const activatedMs = row.activated_at.getTime();
    // Borne FIXE : jamais au-delà de `activated_at + 12 h`, même si la colonne était modifiée.
    const fixedLimit = activatedMs + TOKEN_TOLERANCE_MS;
    const limitMs = Math.min(row.token_tolerance_until?.getTime() ?? -Infinity, fixedLimit);
    const nowMs = this.clock.now().getTime();
    if (claims.iat === null || claims.iat * 1000 > activatedMs) {
      throw new StaffTokenRefused(5, 'jeton émis après la bascule');
    }
    if (claims.exp * 1000 < activatedMs) {
      throw new StaffTokenRefused(5, 'jeton déjà expiré à la bascule');
    }
    if (nowMs > limitMs) throw new StaffTokenRefused(5, 'au-delà de 12 h après la bascule');
    // 6. personne encore habilitée dans l'état répliqué.
    await this.assertPerson(tx, claims, true);
    // 7. (écrite par l'opération) : `jti` obligatoire pour pouvoir auditer.
    if (claims.jti === null) throw new StaffTokenRefused(7, 'jti absent : audit impossible');
    return {
      claims,
      session,
      tolerated: {
        subject: claims.subject,
        issuer: claims.issuer,
        jti: claims.jti,
        secondsPastExpiry: Math.max(1, Math.floor((nowMs - claims.exp * 1000) / 1000)),
        route: ctx.route as ToleranceRoute,
        deviceSerial: ctx.device.serial,
        deviceId: ctx.device.deviceId,
        cashSessionId: session.cash_session_id,
      },
    };
  }

  private async findSession(tx: TxClient, ctx: AuthorizeContext): Promise<CashSessionRow | null> {
    const cited = ctx.citedSessionId;
    if (typeof cited === 'string' && cited !== '') {
      if (!/^[0-9a-f-]{36}$/i.test(cited)) return null;
      const found = await tx.query<CashSessionRow>(
        `SELECT ${SESSION_COLUMNS} FROM edge_cash_session WHERE cash_session_id = $1`,
        [cited],
      );
      return found.rows[0] ?? null;
    }
    const open = await tx.query<CashSessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM edge_cash_session
        WHERE device_id = $1 AND status = 'OPEN' AND closed_at IS NULL
        ORDER BY opened_at DESC LIMIT 1`,
      [ctx.device.deviceId],
    );
    return open.rows[0] ?? null;
  }

  private async assertPerson(tx: TxClient, claims: StaffClaims, tolerated: boolean): Promise<void> {
    const { rows } = await tx.query<{ status: string; roles: string[] }>(
      'SELECT status, roles FROM edge_staff WHERE iss = $1 AND sub = $2',
      [claims.issuer, claims.subject],
    );
    const person = rows[0];
    const allowed =
      person !== undefined &&
      person.status === 'ACTIVE' &&
      person.roles.some((role) => COUNTER_ROLES.includes(role));
    if (allowed) return;
    if (tolerated) throw new StaffTokenRefused(6, 'personne non habilitée dans l’état répliqué');
    this.logger.warn(JSON.stringify({ event: 'staff_not_allowed' }));
    throw new ProblemException('FORBIDDEN');
  }
}

@Injectable()
export class StaffTokenGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(StaffAuthorizer) private readonly authorizer: StaffAuthorizer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StaffRequest>();
    const device = requestDevice(req);
    const header = req.headers[STAFF_HEADER];
    const bearer = typeof header === 'string' ? BEARER.exec(header) : null;
    if (!bearer) throw new StaffTokenRefused(0, 'jeton de personne absent ou mal formé');
    const route =
      this.reflector.get<string | undefined>(SERVED_OPERATION_KEY, context.getHandler()) ?? '';
    const principal = await this.authorizer.verify(bearer[1]!);
    const body = req.body as { cash_session_id?: unknown } | undefined;
    const cited = typeof body?.cash_session_id === 'string' ? body.cash_session_id : null;
    await this.gatewayTx.run((tx) =>
      this.authorizer.authorize(tx, principal, { device, route, citedSessionId: cited }),
    );
    req.staff = principal;
    return true;
  }
}

export function requestStaff(req: Request): StaffPrincipal {
  const staff = (req as StaffRequest).staff;
  if (!staff) throw new StaffTokenRefused(0, 'jeton de personne non vérifié');
  return staff;
}
