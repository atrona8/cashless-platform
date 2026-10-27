// Demandes de paiement QR (mission 5b, lot WP13, T061 à T063 ; FR-018 à FR-020, NFR-005, NFR-008, NFR-009,
// C-001, C-003 ; contracts/qr-payments.md, contracts/payments.md « Clé et registre des numéros » ;
// research R-08, R-11 A3, A10, A17, A24, A25).
//
// Les contrôles (usage unique, expiration, portefeuille, terminal, session) sont ceux des fonctions de la
// base (C-001) : l'API les appelle dans l'ordre global des verrous
//   terminal → vendeur → session → demande → portefeuille
// et traduit leurs refus. Le moteur d'écritures écrit la vente ENTRE `lock_payment_request_for_pay` et
// `confirm_payment_request`, dans UNE transaction (A10) : un refus du moteur annule tout, la demande reste
// `PENDING` sans `wallet_id` posé.
//
// Secrets (NFR-008) : le jeton n'est rendu que par les deux créations ; seule son empreinte SHA-256 passe à la
// base. Aucun jeton dans un message d'erreur, une métadonnée, un contenu de registre ou un journal.
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { CustomerContext } from '../customer-identity/customer-identity.port';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import type { DeviceContext } from '../device-identity/device-identity.port';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { Language } from '../http/language';
import type { IdempotentTx } from '../idempotency/idempotent.decorator';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { conflict, notFound } from '../organization/platform/platform.dto';
import { contentSha256, DeviceSeqRegistry, isRegistrable } from '../payments/device-seq-registry';
import { PaymentReadService } from '../payments/payment-read.service';
import { linesJson, type PaymentResult } from '../payments/payments.dto';
import { VendorSessionGuard } from '../vendors/vendor-session-guard';
import {
  parseCreateRequest,
  parsePay,
  parseWalletBody,
  type CreateRequestInput,
  type PaymentRequestObject,
} from './payment-request.dto';
import { newCustomerToken, newMerchantToken, nonceHash } from './qr-token';

/** Tentatives de tirage d'un jeton dont l'empreinte est déjà prise (23505) ; jamais atteint en pratique. */
const TOKEN_ATTEMPTS = 3;
/** Pas de la relecture du long-polling (`?wait`) : une transaction courte par lecture, aucune ouverte entre deux. */
const POLL_MS = 250;

export interface DeviceWriteArgs {
  device: DeviceContext;
  /** `<seq>` de l'`Idempotency-Key`, contrôlé par l'intercepteur. */
  seq: bigint;
  /** `Idempotency-Key` complète `<serial>:<seq>` : clé de la vente qui suivra. */
  key: string;
  body: unknown;
}

interface RequestRow {
  id: string;
  direction: 'MERCHANT_QR' | 'CUSTOMER_QR';
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  amount: string | null;
  currency: string;
  expires_at: Date;
  transaction_id: string | null;
  merchant_name: string | null;
}

/** Lecture d'une demande : statut relu à l'heure de la base (une `PENDING` échue est `EXPIRED`, sans réécriture). */
const READ_REQUEST = `
SELECT pr.id, pr.direction,
       CASE WHEN pr.status = 'PENDING' AND pr.expires_at <= clock_timestamp()
            THEN 'EXPIRED' ELSE pr.status END AS status,
       pr.amount::text AS amount, pr.currency, pr.expires_at, pr.transaction_id,
       (SELECT pa.legal_name
          FROM device d
          JOIN point_of_sale p ON p.id = d.pos_id AND p.operator_id = d.operator_id
          JOIN merchant_participation mp ON mp.id = p.participation_id AND mp.operator_id = d.operator_id
          JOIN party pa ON pa.id = mp.merchant_id
         WHERE d.id = pr.device_id AND d.operator_id = pr.operator_id) AS merchant_name
  FROM payment_request pr
 WHERE pr.id = $1 AND ($2::uuid IS NULL OR (pr.device_id = $2 AND pr.direction = 'MERCHANT_QR'))`;

function toObject(row: RequestRow, qrPayload: string | null = null): PaymentRequestObject {
  return {
    payment_request_id: row.id,
    direction: row.direction,
    status: row.status,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency.trim(),
    merchant_name: row.merchant_name,
    qr_payload: qrPayload,
    expires_at: row.expires_at.toISOString(),
    transaction_id: row.transaction_id,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `CL037` → la traduction donnée ; tout autre refus passe tel quel. */
function onCL037(error: unknown, replacement: () => ProblemException): unknown {
  return isSqlError(error) && error.code === 'CL037' ? replacement() : error;
}

@Injectable()
export class PaymentRequestService {
  constructor(
    private readonly engine: LedgerEngineService,
    private readonly sessions: VendorSessionGuard,
    private readonly registry: DeviceSeqRegistry,
    private readonly reads: PaymentReadService,
    private readonly tx: TenantTx,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------------ QR commerçant : terminal

  /** `createPaymentRequest` : trois preuves, clé `<serial>:<seq>`, jeton rendu une seule fois (route `transient`). */
  async createMerchantRequest(
    args: DeviceWriteArgs,
    tx: IdempotentTx,
  ): Promise<PaymentRequestObject> {
    const content = createContent(args.seq, args.body);
    try {
      const input = parseCreateRequest(args.body);
      return await tx.run((client) => this.writeMerchantRequest(client, args, input, content));
    } catch (error) {
      return this.refuseDevice(error, args.device, args.seq, content);
    }
  }

  private async writeMerchantRequest(
    client: TxClient,
    args: DeviceWriteArgs,
    input: CreateRequestInput,
    content: Buffer | null,
  ): Promise<PaymentRequestObject> {
    const { device } = args;
    // 1. Le numéro, en premier : `record_device_seq` prend le terminal FOR UPDATE (ordre global).
    await this.recordSeq(client, device, args.seq, content);
    // 2. Terminal actif, puis session de vendeur (dans cette transaction, après le terminal).
    await client.query('SELECT assert_device_active($1)', [device.deviceId]);
    if (input.vendorSessionId === null) throw new ProblemException('VENDOR_SESSION_INVALID');
    await this.sessions.assert(client, device, input.vendorSessionId);
    // 3. La demande : lignes contrôlées comme une vente, sans écriture de vente.
    for (let attempt = 1; ; attempt += 1) {
      const token = newMerchantToken();
      await client.query('SAVEPOINT qr_token');
      try {
        const { rows } = await client.query<{ payment_request_id: string; expires_at: Date }>(
          'SELECT payment_request_id, expires_at FROM create_merchant_payment_request($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NULL)',
          [
            device.deviceId,
            input.vendorSessionId,
            input.amount.toString(),
            input.currency,
            input.ttlSeconds,
            nonceHash(token),
            args.key,
            input.lines ? linesJson(input.lines) : null,
          ],
        );
        await client.query('RELEASE SAVEPOINT qr_token');
        const created = rows[0]!;
        const merchant = await this.readRow(client, created.payment_request_id, device.deviceId);
        // Le contrat (`PaymentRequestObject`) ne porte le jeton que dans `qr_payload`, rendu à la création seule.
        return toObject(merchant!, this.merchantPayload(created.payment_request_id, token));
      } catch (error) {
        // Empreinte déjà prise : nouveau tirage (jamais traduit en succès). Tout autre refus part tel quel.
        const taken = isSqlError(error) && error.code === '23505' && attempt < TOKEN_ATTEMPTS;
        if (!taken) throw error;
        await client.query('ROLLBACK TO SAVEPOINT qr_token');
      }
    }
  }

  /** `getPaymentRequest` d'un terminal : terminal d'origine seulement (sinon `404`) ; `?wait` sans transaction ouverte. */
  async getForDevice(
    device: DeviceContext,
    id: string,
    waitSeconds: number,
  ): Promise<PaymentRequestObject> {
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
      const row = await this.tx.run(device.operatorId, (client) =>
        this.readRow(client, id, device.deviceId),
      );
      if (!row) throw notFound();
      const remaining = deadline - Date.now();
      if (row.status !== 'PENDING' || remaining <= 0) return toObject(row);
      await sleep(Math.min(POLL_MS, remaining));
    }
  }

  /** `cancelPaymentRequest` d'un terminal : terminal d'origine, numéro enregistré, `409` si non `PENDING`. */
  async cancelForDevice(
    args: Omit<DeviceWriteArgs, 'body' | 'key'> & { id: string },
    tx: IdempotentTx,
  ): Promise<PaymentRequestObject> {
    const content = cancelContent(args.seq, args.id);
    try {
      return await tx.run(async (client) => {
        const { device } = args;
        await this.recordSeq(client, device, args.seq, content);
        await client.query('SELECT assert_device_active($1)', [device.deviceId]);
        // Demande d'un autre terminal, inconnue ou d'un autre prestataire : `404` (le même).
        if (!(await this.readRow(client, args.id, device.deviceId))) throw notFound();
        try {
          await client.query('SELECT cancel_payment_request($1, $2, NULL)', [
            args.id,
            device.deviceId,
          ]);
        } catch (error) {
          throw onCL037(error, () => new ProblemException('PAYMENT_REQUEST_NOT_PENDING'));
        }
        return toObject((await this.readRow(client, args.id, device.deviceId))!);
      });
    } catch (error) {
      return this.refuseDevice(error, args.device, args.seq, content);
    }
  }

  // ------------------------------------------------------------------------ QR commerçant : festivalier

  /** `getPaymentRequest` du festivalier : jeton exigé ; absent, faux ou demande inconnue → `404`, le même. */
  getForCustomer(
    customer: CustomerContext,
    id: string,
    token: string | undefined,
  ): Promise<PaymentRequestObject> {
    return this.tx.run(customer.operatorId, async (client) => {
      await this.assertToken(client, id, token);
      const row = await this.readRow(client, id, null);
      if (!row) throw notFound();
      return toObject(row);
    });
  }

  /** `cancelPaymentRequest` du festivalier : seulement avec le jeton (A10) ; ensuite `409` si non `PENDING`. */
  cancelForCustomer(
    id: string,
    token: string | undefined,
    tx: IdempotentTx,
  ): Promise<PaymentRequestObject> {
    return tx.run(async (client) => {
      const hash = await this.assertToken(client, id, token);
      try {
        await client.query('SELECT cancel_payment_request($1, NULL, $2)', [id, hash]);
      } catch (error) {
        throw onCL037(error, () => new ProblemException('PAYMENT_REQUEST_NOT_PENDING'));
      }
      return toObject((await this.readRow(client, id, null))!);
    });
  }

  /**
   * `payPaymentRequest` : verrouiller → moteur `PURCHASE` → confirmer, UNE transaction. Inconnue, payée, annulée,
   * expirée, mauvais jeton, portefeuille d'autrui ou bloqué : le même `409 PAYMENT_REQUEST_NOT_PENDING` (`CL037`),
   * rien d'écrit. La réponse ne contient aucun jeton.
   */
  pay(
    customer: CustomerContext,
    id: string,
    body: unknown,
    language: Language,
    tx: IdempotentTx,
  ): Promise<PaymentResult> {
    const input = parsePay(body);
    return tx.run(async (client) => {
      const hash = nonceHash(input.token);
      // 1. Verrous dans l'ordre global et contrôles (portefeuille ACTIVE `FOR SHARE`, A17) ; pose `wallet_id`.
      const { rows } = await client.query<{
        device_id: string;
        vendor_session_id: string;
        event_id: string;
        ledger_id: string;
        amount: string;
        currency: string;
        idempotency_key: string;
        lines: Array<{ product_id: string; quantity: number; unit_price: number }> | null;
      }>('SELECT * FROM lock_payment_request_for_pay($1, $2, $3, $4)', [
        id,
        hash,
        input.walletId,
        customer.customerId,
      ]);
      const lock = rows[0]!;
      // Le terminal est tenu `FOR SHARE` par la fonction : son point de vente ne change pas sous nous.
      const context = await client.query<{ participation_id: string | null; now: Date }>(
        `SELECT pos.participation_id, clock_timestamp() AS now
           FROM device d
           LEFT JOIN point_of_sale pos ON pos.id = d.pos_id AND pos.operator_id = d.operator_id
          WHERE d.id = $1`,
        [lock.device_id],
      );
      const participationId = context.rows[0]?.participation_id;
      if (!participationId) throw new ProblemException('PAYMENT_REQUEST_NOT_PENDING');
      // 2. Le moteur d'écritures : la vente reprend la clé et les lignes de la demande.
      const written = await this.engine.execute(client, {
        type: 'PURCHASE',
        source: 'ONLINE',
        idempotencyKey: lock.idempotency_key,
        occurredAt: context.rows[0]!.now,
        ledgerId: lock.ledger_id,
        eventId: lock.event_id,
        currency: lock.currency.trim(),
        deviceId: lock.device_id,
        payload: {
          walletId: input.walletId,
          participationId,
          amount: BigInt(lock.amount),
        },
        metadata: { vendor_session_id: lock.vendor_session_id, channel: 'MERCHANT_QR' },
      });
      // La clé de la demande a déjà servi : même réponse que les autres refus, rien n'est lié.
      if (!written.transactionId || written.replayed)
        throw new ProblemException('PAYMENT_REQUEST_NOT_PENDING');
      // 3. Lignes copiées du catalogue, puis confirmation (attribution `MERCHANT_QR` par la session de la demande).
      if (lock.lines)
        await client.query('SELECT record_sale_lines($1, $2, $3::jsonb)', [
          written.transactionId,
          lock.device_id,
          JSON.stringify(lock.lines),
        ]);
      await client.query('SELECT confirm_payment_request($1, $2, $3)', [
        id,
        written.transactionId,
        hash,
      ]);
      const result = await this.reads.read(client, {
        transactionId: written.transactionId,
        language,
      });
      if (!result) throw new Error('vente écrite introuvable');
      return result;
    });
  }

  // ------------------------------------------------------------------------ QR client : festivalier

  /** `createCustomerQrToken` : jeton de 12 caractères base32, rendu une seule fois (route `transient`). */
  createCustomerQr(
    customer: CustomerContext,
    body: unknown,
    tx: IdempotentTx,
  ): Promise<{
    payment_request_id: string;
    token: string;
    qr_payload: string;
    expires_at: string;
  }> {
    const walletId = parseWalletBody(body);
    return tx.run(async (client) => {
      for (let attempt = 1; ; attempt += 1) {
        const token = newCustomerToken();
        await client.query('SAVEPOINT qr_token');
        try {
          const { rows } = await client.query<{ payment_request_id: string; expires_at: Date }>(
            'SELECT payment_request_id, expires_at FROM create_customer_qr_token($1, $2, $3)',
            [customer.customerId, walletId, nonceHash(token)],
          );
          await client.query('RELEASE SAVEPOINT qr_token');
          return {
            payment_request_id: rows[0]!.payment_request_id,
            token,
            qr_payload: `CSHL1:${token}`,
            expires_at: rows[0]!.expires_at.toISOString(),
          };
        } catch (error) {
          const taken = isSqlError(error) && error.code === '23505' && attempt < TOKEN_ATTEMPTS;
          if (taken) {
            await client.query('ROLLBACK TO SAVEPOINT qr_token');
            continue;
          }
          // Portefeuille d'un autre festivalier, bloqué ou inconnu : le même `404`, sans dire lequel.
          throw onCL037(error, notFound);
        }
      }
    });
  }

  // ------------------------------------------------------------------------ outils

  /** Contrôle le jeton du festivalier sans verrou (`payment_request_for_token`) ; `404` sinon. */
  private async assertToken(
    client: TxClient,
    id: string,
    token: string | undefined,
  ): Promise<Buffer> {
    if (token === undefined) throw notFound();
    const hash = nonceHash(token);
    try {
      await client.query('SELECT status FROM payment_request_for_token($1, $2)', [id, hash]);
    } catch (error) {
      throw onCL037(error, notFound);
    }
    return hash;
  }

  private async readRow(
    client: TxClient,
    id: string,
    deviceId: string | null,
  ): Promise<RequestRow | null> {
    const { rows } = await client.query<RequestRow>(READ_REQUEST, [id, deviceId]);
    return rows[0] ?? null;
  }

  private merchantPayload(id: string, token: string): string {
    return `https://${this.config.claimCodeDomain}/r/${id}#t=${token}`;
  }

  /** Numéro du terminal enregistré (`ACCEPTED`, sans vente) dans la transaction de l'écriture, terminal tenu `FOR UPDATE`. */
  private async recordSeq(
    client: TxClient,
    device: DeviceContext,
    seq: bigint,
    content: Buffer | null,
  ): Promise<void> {
    if (content === null) throw new Error('contenu du registre : corps non objet après validation');
    const { rows } = await client.query<{ replayed: boolean }>(
      `SELECT replayed FROM record_device_seq($1, $2, $3, 'ACCEPTED', 'ONLINE')`,
      [device.deviceId, seq.toString(), content],
    );
    if (rows[0]?.replayed !== false) throw conflict('Ce numéro du terminal est déjà enregistré.');
  }

  /**
   * Transaction annulée : le refus définitif 4xx est rangé au registre (transaction séparée, validée), puis
   * l'erreur repart. Un refus du registre lui-même ne masque jamais l'effet durable : il est gardé puis relancé
   * après (modèle de `PaymentsService.refuse`). Non définitifs et 5xx : rien n'est rangé.
   */
  private async refuseDevice(
    error: unknown,
    device: DeviceContext,
    seq: bigint,
    content: Buffer | null,
  ): Promise<never> {
    const problem = resolveProblem(error);
    if (content !== null && isRegistrable(problem, error)) {
      await this.registry.reject(device.operatorId, {
        deviceId: device.deviceId,
        seq,
        content,
        reason: problem.code,
      });
    }
    throw error;
  }
}

/** Contenu chaîné d'une création de demande : les champs reçus, jamais le jeton ni l'état (sync_protocol §3.3). */
function createContent(seq: bigint, body: unknown): Buffer | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  return contentSha256({
    seq: Number(seq),
    type: 'PAYMENT_REQUEST',
    amount: raw.amount,
    currency: raw.currency,
    ttl_seconds: raw.ttl_seconds,
    lines: raw.lines,
  });
}

/** Contenu chaîné d'une annulation : le numéro et la demande visée. */
function cancelContent(seq: bigint, id: string): Buffer {
  return contentSha256({
    seq: Number(seq),
    type: 'PAYMENT_REQUEST_CANCEL',
    payment_request_id: id,
  });
}
