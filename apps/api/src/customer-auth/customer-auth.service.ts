// Authentification des festivaliers par code à usage unique (SPECIFICATION §8.5, ADR-66 ; hors Spec Kitty, porteur,
// 10/11/2026). Trois opérations : demander un code, l'échanger contre des jetons, renouveler les jetons.
//
// Le prestataire est connu par le code public (demande) ou retrouvé par une fonction SECURITY DEFINER qui ne rend que
// son identifiant (défi, jeton de renouvellement) ; tout le reste se lit et s'écrit sous la RLS du prestataire.
// `TenantTx.run` annule sur exception : les opérations dont l'effet doit survivre à l'erreur rendue (essai faux
// compté, blocage du numéro, famille révoquée) RENDENT un résultat et lèvent l'erreur après la transaction.
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import {
  CustomerAccessTokens,
  CUSTOMER_TOKEN_TTL_SECONDS,
} from '../customer-identity/customer-access-token';
import { deriveCustomerKey } from '../customer-identity/customer-keys';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { OTP_SENDER, type OtpChannel, type OtpSender } from './otp-sender';

export const OTP_TTL_SECONDS = 300;
export const OTP_PHONE_MAX = 3;
export const OTP_PHONE_WINDOW_MINUTES = 15;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_BLOCK_MINUTES = 30;
export const REFRESH_TTL_DAYS = 30;
const REQUEST_ID = /^otp_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const REFRESH_TOKEN = /^crt_[A-Za-z0-9_-]{43}$/;

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
}

const rateLimited = (retryAfter: number) =>
  new ProblemException('OTP_RATE_LIMITED', {
    status: 429,
    headers: { 'Retry-After': String(Math.max(1, retryAfter)) },
  });
const otpInvalid = () => new ProblemException('OTP_INVALID', { status: 422 });
const unauthenticated = () => new ProblemException('UNAUTHENTICATED');

type Exchange =
  | { kind: 'OK'; tokens: TokenResponse }
  | { kind: 'INVALID' }
  | { kind: 'BLOCKED'; retryAfter: number };
type Renewal = { kind: 'OK'; tokens: TokenResponse } | { kind: 'REFUSED' };

@Injectable()
export class CustomerAuthService {
  private readonly otpKey: Buffer;
  private readonly clientKey: Buffer;

  constructor(
    private readonly tx: TenantTx,
    private readonly tokens: CustomerAccessTokens,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    @Inject(APP_CONFIG)
    private readonly config: Pick<AppConfig, 'customerAuthHmacKey' | 'customerOtpIpHourlyMax'>,
  ) {
    this.otpKey = deriveCustomerKey(config.customerAuthHmacKey, 'otpCode');
    this.clientKey = deriveCustomerKey(config.customerAuthHmacKey, 'clientRef');
  }

  /** Vrai si l'envoyeur est un faux : la route rend alors le code en en-tête de test (jamais en production). */
  get senderIsFake(): boolean {
    return this.sender.isFake === true;
  }

  private codeHash(challengeId: string, code: string): Buffer {
    return createHmac('sha256', this.otpKey).update(`${challengeId}:${code}`, 'utf8').digest();
  }

  /** Verrou de transaction par numéro : deux demandes ou échanges du même numéro se suivent. */
  private async lockPhone(client: TxClient, operatorId: string, phone: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `customer-otp:${operatorId}:${phone}`,
    ]);
  }

  // ----- Demande de code ---------------------------------------------------------------------------------------

  async requestOtp(
    input: { phone: string; operatorCode: string; channel: OtpChannel },
    address: string,
  ): Promise<{ otp_request_id: string; expires_in: number; code: string }> {
    const operatorId = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{ id: string | null }>(
        'SELECT operator_by_public_code($1) AS id',
        [input.operatorCode],
      );
      return rows[0]?.id ?? null;
    });
    if (!operatorId)
      throw new ProblemException('VALIDATION_FAILED', {
        status: 400,
        detail: 'operator_code : code de prestataire inconnu.',
      });
    const clientRef = createHmac('sha256', this.clientKey).update(address, 'utf8').digest('hex');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = randomUUID();
    await this.tx.run(operatorId, async (client) => {
      await this.lockPhone(client, operatorId, input.phone);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `customer-otp-client:${operatorId}:${clientRef}`,
      ]);
      const wait = await this.waitBeforeRequest(client, operatorId, input.phone, clientRef);
      if (wait !== null) throw rateLimited(wait);
      // Un seul code vivant par numéro : le nouveau remplace les précédents (moins de codes à deviner).
      await client.query(
        `UPDATE otp_challenge SET invalidated_at = clock_timestamp()
          WHERE operator_id = $1 AND phone = $2 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [operatorId, input.phone],
      );
      await client.query(
        `INSERT INTO otp_challenge (id, operator_id, phone, channel, code_hash, client_ref, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp() + make_interval(secs => $7))`,
        [
          challengeId,
          operatorId,
          input.phone,
          input.channel,
          this.codeHash(challengeId, code),
          clientRef,
          OTP_TTL_SECONDS,
        ],
      );
    });
    // Après validation du défi : l'envoi n'a lieu que pour un défi enregistré. Même chemin, numéro connu ou non.
    await this.sender.send(input.phone, code, input.channel);
    return { otp_request_id: `otp_${challengeId}`, expires_in: OTP_TTL_SECONDS, code };
  }

  /** Secondes à attendre avant une nouvelle demande (numéro bloqué, 3 par 15 min, adresse par heure), sinon `null`. */
  private async waitBeforeRequest(
    client: TxClient,
    operatorId: string,
    phone: string,
    clientRef: string,
  ): Promise<number | null> {
    const waits: number[] = [];
    const blocked = await client.query<{ wait: number }>(
      `SELECT ceil(extract(epoch FROM blocked_until - clock_timestamp()))::int AS wait
         FROM otp_phone_block
        WHERE operator_id = $1 AND phone = $2 AND blocked_until > clock_timestamp()`,
      [operatorId, phone],
    );
    if (blocked.rows[0]) waits.push(blocked.rows[0].wait);
    // Fenêtre glissante : la demande suivante passe quand la n-ième plus récente sort de la fenêtre.
    const slot = async (
      column: 'phone' | 'client_ref',
      value: string,
      max: number,
      window: string,
    ) => {
      const { rows } = await client.query<{ wait: number }>(
        `SELECT ceil(extract(epoch FROM created_at + $4::interval - clock_timestamp()))::int AS wait
           FROM otp_challenge
          WHERE operator_id = $1 AND ${column} = $2 AND created_at > clock_timestamp() - $4::interval
          ORDER BY created_at DESC OFFSET $3 LIMIT 1`,
        [operatorId, value, max - 1, window],
      );
      if (rows[0]) waits.push(rows[0].wait);
    };
    await slot('phone', phone, OTP_PHONE_MAX, `${OTP_PHONE_WINDOW_MINUTES} minutes`);
    await slot('client_ref', clientRef, this.config.customerOtpIpHourlyMax, '1 hour');
    return waits.length > 0 ? Math.max(...waits) : null;
  }

  // ----- Échange du code ---------------------------------------------------------------------------------------

  async exchange(input: { requestId: string; code: string }): Promise<TokenResponse> {
    const match = REQUEST_ID.exec(input.requestId);
    if (!match) throw otpInvalid();
    const challengeId = match[1]!.toLowerCase();
    const operatorId = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{ id: string | null }>(
        'SELECT otp_challenge_operator($1) AS id',
        [challengeId],
      );
      return rows[0]?.id ?? null;
    });
    if (!operatorId) throw otpInvalid();
    const outcome = await this.tx.run(operatorId, (client) =>
      this.exchangeIn(client, operatorId, challengeId, input.code),
    );
    // Le résultat est validé (essai compté, blocage posé) AVANT que l'erreur soit levée.
    if (outcome.kind === 'BLOCKED') throw rateLimited(outcome.retryAfter);
    if (outcome.kind === 'INVALID') throw otpInvalid();
    return outcome.tokens;
  }

  private async exchangeIn(
    client: TxClient,
    operatorId: string,
    challengeId: string,
    code: string,
  ): Promise<Exchange> {
    const peek = await client.query<{ phone: string }>(
      'SELECT phone FROM otp_challenge WHERE id = $1',
      [challengeId],
    );
    if (!peek.rows[0]) return { kind: 'INVALID' };
    const phone = peek.rows[0].phone;
    await this.lockPhone(client, operatorId, phone);
    const { rows } = await client.query<{
      code_hash: Buffer;
      attempts: number;
      usable: boolean;
    }>(
      `SELECT code_hash, attempts,
              (consumed_at IS NULL AND invalidated_at IS NULL AND expires_at > clock_timestamp()) AS usable
         FROM otp_challenge WHERE id = $1 FOR UPDATE`,
      [challengeId],
    );
    const challenge = rows[0];
    if (!challenge) return { kind: 'INVALID' };
    const block = await client.query<{ wait: number }>(
      `SELECT ceil(extract(epoch FROM blocked_until - clock_timestamp()))::int AS wait
         FROM otp_phone_block WHERE operator_id = $1 AND phone = $2 AND blocked_until > clock_timestamp()`,
      [operatorId, phone],
    );
    if (block.rows[0]) return { kind: 'BLOCKED', retryAfter: block.rows[0].wait };
    if (!challenge.usable) return { kind: 'INVALID' };

    const expected = this.codeHash(challengeId, code);
    // Comparaison en temps constant des deux empreintes (32 octets chacune).
    if (!timingSafeEqual(expected, challenge.code_hash)) {
      const attempts = challenge.attempts + 1;
      await client.query('UPDATE otp_challenge SET attempts = $2 WHERE id = $1', [
        challengeId,
        attempts,
      ]);
      // Essais faux CUMULÉS du numéro sur la fenêtre glissante, tous défis confondus : demander un nouveau code
      // ne remet pas le compte à zéro (ADR-180).
      const total = await client.query<{ n: number }>(
        `SELECT coalesce(sum(attempts), 0)::int AS n FROM otp_challenge
          WHERE operator_id = $1 AND phone = $2 AND created_at > clock_timestamp() - make_interval(mins => $3)`,
        [operatorId, phone, OTP_BLOCK_MINUTES],
      );
      if (total.rows[0]!.n < OTP_MAX_ATTEMPTS && attempts < OTP_MAX_ATTEMPTS)
        return { kind: 'INVALID' };
      // 5e essai faux cumulé : défi invalidé, numéro bloqué.
      await client.query(
        'UPDATE otp_challenge SET invalidated_at = clock_timestamp() WHERE id = $1',
        [challengeId],
      );
      await client.query(
        `INSERT INTO otp_phone_block (operator_id, phone, blocked_until)
         VALUES ($1, $2, clock_timestamp() + make_interval(mins => $3))
         ON CONFLICT (operator_id, phone) DO UPDATE SET blocked_until = EXCLUDED.blocked_until`,
        [operatorId, phone, OTP_BLOCK_MINUTES],
      );
      return { kind: 'BLOCKED', retryAfter: OTP_BLOCK_MINUTES * 60 };
    }

    await client.query('UPDATE otp_challenge SET consumed_at = clock_timestamp() WHERE id = $1', [
      challengeId,
    ]);
    const customerId = await this.customerFor(client, operatorId, phone);
    return { kind: 'OK', tokens: await this.issue(client, operatorId, customerId, randomUUID()) };
  }

  /** Compte du numéro dans ce prestataire ; créé au premier passage (nom neutre, jamais le numéro). */
  private async customerFor(client: TxClient, operatorId: string, phone: string): Promise<string> {
    const known = await client.query<{ customer_id: string }>(
      'SELECT customer_id FROM customer_identity WHERE operator_id = $1 AND phone = $2',
      [operatorId, phone],
    );
    if (known.rows[0]) return known.rows[0].customer_id;
    const customerId = randomUUID();
    await client.query(
      "INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'CUSTOMER', $2, $3)",
      [customerId, operatorId, `Festivalier ${customerId.slice(0, 8)}`],
    );
    await client.query(
      'INSERT INTO customer_identity (customer_id, operator_id, phone) VALUES ($1, $2, $3)',
      [customerId, operatorId, phone],
    );
    return customerId;
  }

  // ----- Renouvellement ----------------------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<TokenResponse> {
    if (!REFRESH_TOKEN.test(refreshToken)) throw unauthenticated();
    const hash = createHash('sha256').update(refreshToken, 'utf8').digest();
    const operatorId = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{ id: string | null }>(
        'SELECT customer_refresh_operator($1) AS id',
        [hash],
      );
      return rows[0]?.id ?? null;
    });
    if (!operatorId) throw unauthenticated();
    const outcome = await this.tx.run(operatorId, (client) =>
      this.refreshIn(client, operatorId, hash),
    );
    // La révocation de la famille (réemploi) est validée avant le refus.
    if (outcome.kind === 'REFUSED') throw unauthenticated();
    return outcome.tokens;
  }

  private async refreshIn(client: TxClient, operatorId: string, hash: Buffer): Promise<Renewal> {
    const { rows } = await client.query<{
      id: string;
      customer_id: string;
      family_id: string;
      used: boolean;
      revoked: boolean;
      expired: boolean;
    }>(
      `SELECT id, customer_id, family_id, used_at IS NOT NULL AS used, revoked_at IS NOT NULL AS revoked,
              expires_at <= clock_timestamp() AS expired
         FROM customer_refresh_token WHERE token_hash = $1 FOR UPDATE`,
      [hash],
    );
    const token = rows[0];
    if (!token || token.revoked) return { kind: 'REFUSED' };
    if (token.used) {
      // Jeton déjà utilisé présenté de nouveau : le jeton a pu être volé, toute la famille est révoquée.
      await client.query(
        `UPDATE customer_refresh_token SET revoked_at = clock_timestamp()
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [token.family_id],
      );
      return { kind: 'REFUSED' };
    }
    if (token.expired) return { kind: 'REFUSED' };
    await client.query(
      'UPDATE customer_refresh_token SET used_at = clock_timestamp() WHERE id = $1',
      [token.id],
    );
    return {
      kind: 'OK',
      tokens: await this.issue(client, operatorId, token.customer_id, token.family_id),
    };
  }

  // ----- Émission ----------------------------------------------------------------------------------------------

  /** Jeton d'accès et jeton de renouvellement neuf (gardé en SHA-256, 256 bits d'aléa), dans la famille donnée. */
  private async issue(
    client: TxClient,
    operatorId: string,
    customerId: string,
    familyId: string,
  ): Promise<TokenResponse> {
    const refresh = `crt_${randomBytes(32).toString('base64url')}`;
    await client.query(
      `INSERT INTO customer_refresh_token (operator_id, customer_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp() + make_interval(days => $5))`,
      [
        operatorId,
        customerId,
        familyId,
        createHash('sha256').update(refresh, 'utf8').digest(),
        REFRESH_TTL_DAYS,
      ],
    );
    return {
      access_token: await this.tokens.sign({ customerId, operatorId, familyId }),
      token_type: 'Bearer',
      expires_in: CUSTOMER_TOKEN_TTL_SECONDS,
      refresh_token: refresh,
    };
  }
}
