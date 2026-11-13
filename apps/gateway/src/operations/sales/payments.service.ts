// `createPayment` et `getPayment` (T094). FICHIER À FAIRE RELIRE PAR UNE PERSONNE : l'ordre des
// étapes 3 à 11 est ce qui interdit le double débit et le débit hors autorité.
//
// Tout se passe dans UNE `GatewayTx` ; le `COMMIT` précède la réponse :
//   0. forme du corps et de l'en-tête (rien n'est écrit en cas d'erreur) ;
//   1. preuves (garde) ; nonce consommé dans CETTE transaction ;
//   2. idempotence : même clé et même empreinte -> même réponse, sans nouvelle entrée ;
//   3. `AuthorityService.assertCanDebit(époque, tx)` : un refus ici n'écrit RIEN, ne consomme
//      aucun numéro (le QR client est refusé au même endroit : note 7) ;
//   4 à 8. contrôles métier ; tout refus FINAL à ce stade est enregistré comme entrée `VOID` (le
//      numéro du terminal est consommé : aucun trou au registre du central, note 4) ;
//   9. `EdgeQueue.append(tx, op, deltas)` avec `edge_decision` ; 10. idempotence et passage
//      consommé ; 11. `COMMIT` ; 12. point d'arrêt `after-local-write-before-reply`, puis réponse.
// Le portefeuille est pris `FOR UPDATE` avant la lecture du solde effectif : deux paiements
// simultanés sur le même bracelet s'exécutent l'un après l'autre (jamais de solde négatif).
import { Inject, Injectable } from '@nestjs/common';
import { InsufficientFundsError, spendSplit } from '@cashless/shared-rules';
import {
  AUTHORITY,
  AuthorityRefusal,
  type AuthorityService,
} from '../../authority/authority.service';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../../db/gateway-tx';
import type { AuthenticatedDevice } from '../../device-proofs/device-proofs.guard';
import { NonceStore } from '../../device-proofs/nonce-store';
import { ProblemException } from '../../device-proofs/problem';
import { requestFingerprint, IdempotencyService } from '../../device/idempotency.service';
import { EDGE_QUEUE, type EdgeQueuePort } from '../../queue/edge-queue';
import { ReplicationService } from '../../replication/replication.service';
import { failpoint } from '../../testing/failpoints';
import {
  assertNotRevoked,
  authorityProblem,
  iso,
  intField,
  invalid,
  isUuid,
  newTransactionId,
  objectBody,
  parseAuthorityEpoch,
  parseIdempotencyKey,
  parseTapReading,
  readEventSettings,
  resolveOperationTime,
  restoreRefusal,
  SALE_CEILING,
  storeRefusal,
  TERMINAL_HOURLY_CEILING,
  dateTimeField,
  finalRefusal,
  type EventSettings,
  type SpendOrder,
  type StoredRefusal,
  type TapReading,
} from './sales-support';
import { TapsService, statusResult, tapRefusal, type MediaRow } from './taps.service';
import { unavailableDuringEdge } from './unavailable-operations';

type Means =
  | { kind: 'tap_id'; tapId: string }
  | { kind: 'tap'; reading: TapReading }
  | { kind: 'customer_qr' }
  | { kind: 'payment_intent' };

interface SaleLineInput {
  productId: string | null;
  quantity: number;
  unitPrice: number;
  wire: Record<string, unknown>;
}

export interface PaymentInput {
  amount: number;
  currency: string;
  occurredAt: Date;
  vendorSessionId: string | null;
  lines: SaleLineInput[] | null;
  means: Means;
  body: unknown;
}

/** Résultat rendu au contrôleur : statut, corps et indication de rejeu. */
export interface SaleResponse {
  status: number;
  body: Record<string, unknown>;
  replayed: boolean;
}

export function parsePayment(raw: unknown): PaymentInput {
  const body = objectBody(raw);
  const amount = intField(body, 'amount', 1);
  const currency = body.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
    throw invalid('currency : code ISO sur trois lettres attendu.');
  const occurredAt = dateTimeField(body, 'occurred_at');
  let vendorSessionId: string | null = null;
  if (body.vendor_session_id !== undefined) {
    if (!isUuid(body.vendor_session_id)) throw invalid('vendor_session_id : uuid attendu.');
    vendorSessionId = body.vendor_session_id;
  }
  let lines: SaleLineInput[] | null = null;
  if (body.lines !== undefined) {
    if (!Array.isArray(body.lines) || body.lines.length === 0)
      throw invalid('lines : tableau non vide attendu.');
    lines = body.lines.map((item: unknown, index) => {
      const line = objectBody(item);
      if (line.product_id !== undefined && !isUuid(line.product_id))
        throw invalid(`lines[${index}].product_id : uuid attendu.`);
      const quantity = intField(line, 'quantity', 1);
      const unitPrice = intField(line, 'unit_price', 1);
      return {
        productId: (line.product_id as string | undefined) ?? null,
        quantity,
        unitPrice,
        wire: {
          ...(line.product_id === undefined ? {} : { product_id: line.product_id }),
          quantity,
          unit_price: unitPrice,
          ...(typeof line.label === 'string' ? { label: line.label } : {}),
        },
      };
    });
  }
  const present = ['tap_id', 'tap', 'customer_qr_token', 'payment_intent_id'].filter(
    (name) => body[name] !== undefined,
  );
  if (present.length !== 1) throw invalid('Exactement un moyen de paiement est attendu.');
  let means: Means;
  switch (present[0]) {
    case 'tap_id': {
      const id = body.tap_id;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
        throw invalid('tap_id : entier positif attendu.');
      means = { kind: 'tap_id', tapId: String(id) };
      break;
    }
    case 'tap':
      means = { kind: 'tap', reading: parseTapReading(body.tap, 'tap') };
      break;
    case 'customer_qr_token': {
      const token = body.customer_qr_token;
      if (typeof token !== 'string' || token.length < 12 || token.length > 64)
        throw invalid('customer_qr_token : 12 à 64 caractères attendus.');
      means = { kind: 'customer_qr' };
      break;
    }
    default:
      means = { kind: 'payment_intent' };
  }
  return { amount, currency, occurredAt, vendorSessionId, lines, means, body };
}

interface DeviceRow {
  app_mode: string | null;
  os: string | null;
  nfc_enabled: boolean | null;
  pos_id: string | null;
}

interface VendorRow {
  vendor_id: string;
  display_name: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(AUTHORITY) private readonly authority: AuthorityService,
    @Inject(EDGE_QUEUE) private readonly queue: EdgeQueuePort,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(NonceStore) private readonly nonces: NonceStore,
    @Inject(ReplicationService) private readonly replication: ReplicationService,
    @Inject(TapsService) private readonly taps: TapsService,
  ) {}

  async create(
    device: AuthenticatedDevice,
    args: {
      body: unknown;
      idempotencyKey: string | undefined;
      authorityEpoch: string | undefined;
      language: 'fr' | 'en';
    },
  ): Promise<SaleResponse> {
    // 0. Forme : une erreur ici n'écrit rien et ne consomme aucun numéro.
    const input = parsePayment(args.body);
    const { key, seq } = parseIdempotencyKey(args.idempotencyKey, device.serial);
    const epoch = parseAuthorityEpoch(args.authorityEpoch);
    const fingerprint = requestFingerprint('POST', '/v1/payments', device.deviceId, args.body);

    let outcome: { response: SaleResponse } | { refusal: ProblemException };
    try {
      outcome = await this.gatewayTx.run((tx) =>
        this.write(tx, device, { input, key, seq, epoch, fingerprint, language: args.language }),
      );
    } catch (error) {
      if (error instanceof AuthorityRefusal) {
        // Une époque supérieure vue dans l'en-tête d'un terminal : la passerelle en juge (A12),
        // hors de la transaction annulée.
        if (error.code === 'STALE_AUTHORITY_EPOCH' && epoch > error.authorityEpoch)
          await this.authority.observeEpoch(epoch, 'request').catch(() => undefined);
        throw authorityProblem(error);
      }
      throw error;
    }
    // 12. Le COMMIT est fait ; si le processus meurt ici, le rejeu rend la même réponse.
    await failpoint('after-local-write-before-reply');
    if ('refusal' in outcome) throw outcome.refusal;
    return outcome.response;
  }

  // ----------------------------------------------------------------------- transaction unique

  private async write(
    tx: TxClient,
    device: AuthenticatedDevice,
    ctx: {
      input: PaymentInput;
      key: string;
      seq: number;
      epoch: number;
      fingerprint: Buffer;
      language: 'fr' | 'en';
    },
  ): Promise<{ response: SaleResponse } | { refusal: ProblemException }> {
    const { input, key } = ctx;
    // 1. Preuves : le nonce est consommé dans la transaction de l'opération.
    await this.nonces.consumeOrThrow(tx, device.deviceId, device.proof);
    // 2. Idempotence (avant l'autorité : un rejeu d'une vente déjà validée rend sa réponse).
    const found = await this.idempotency.lookup(tx, device.deviceId, key, ctx.fingerprint);
    if (found.hit) {
      if (found.statusCode >= 400)
        return { refusal: restoreRefusal(found.response as StoredRefusal) };
      return {
        response: {
          status: found.statusCode,
          body: found.response as Record<string, unknown>,
          replayed: true,
        },
      };
    }
    // 3. Autorité, avec la transaction de l'opération (verrou partagé sur `edge_authority`).
    const authority = await this.authority.assertCanDebit(ctx.epoch, tx);
    if (input.means.kind === 'customer_qr')
      throw unavailableDuringEdge('CUSTOMER_QR_PAYMENT', authority.epoch);

    const now = this.clock.now();
    const time = resolveOperationTime(input.occurredAt, now);
    // 4 à 8. Contrôles métier : tout refus final est enregistré (VOID) dans cette transaction.
    try {
      const sale = await this.decide(tx, device, input, ctx.language, now);
      return { response: await this.commit(tx, device, ctx, sale, time.occurredAt, now) };
    } catch (error) {
      if (!(error instanceof ProblemException)) throw error;
      const refusal = finalRefusal(error);
      await this.recordVoid(tx, device, ctx, refusal, time.occurredAt, now);
      return { refusal };
    }
  }

  /** Refus final : le numéro du terminal est consommé sans effet comptable (`VOID`). */
  private async recordVoid(
    tx: TxClient,
    device: AuthenticatedDevice,
    ctx: { key: string; seq: number; fingerprint: Buffer; input: PaymentInput },
    problem: ProblemException,
    occurredAt: Date,
    now: Date,
  ): Promise<void> {
    const row = await this.queue.append(
      tx,
      {
        originKey: ctx.key,
        type: 'VOID',
        authorizedMode: 'EDGE_ONLINE',
        deviceSerial: device.serial,
        deviceId: device.deviceId,
        operation: {
          seq: ctx.seq,
          type: 'VOID',
          occurred_at: iso(occurredAt),
          void_reason: 'ONLINE_REJECTED',
        },
        occurredAt,
        recordedAt: now,
      },
      [],
    );
    await this.idempotency.record(tx, {
      deviceId: device.deviceId,
      key: ctx.key,
      fingerprint: ctx.fingerprint,
      statusCode: problem.status,
      response: storeRefusal(problem),
      edgeSeq: row.edgeSeq,
      at: now,
    });
  }

  // ------------------------------------------------------------------------- décision locale

  private async decide(
    tx: TxClient,
    device: AuthenticatedDevice,
    input: PaymentInput,
    language: 'fr' | 'en',
    now: Date,
  ): Promise<Decision> {
    const row = (
      await tx.query<DeviceRow>(
        'SELECT app_mode, os, nfc_enabled, pos_id FROM edge_device WHERE device_id = $1',
        [device.deviceId],
      )
    ).rows[0];
    if (!row) throw new ProblemException('NOT_FOUND');
    if (row.app_mode === 'TOPUP_DESK')
      throw new ProblemException('DEVICE_MODE_NOT_ALLOWED', {
        detail: 'Un terminal de guichet de recharge n’encaisse pas de vente.',
      });
    if (input.means.kind === 'payment_intent')
      throw new ProblemException('DEVICE_MODE_NOT_ALLOWED', {
        detail: 'payment_intent_id est réservé à la V2.',
      });
    if (row.app_mode === 'CATALOG_POS' && input.lines === null)
      throw invalid('lines : une caisse catalogue envoie les lignes de la vente.', 422);
    if (row.app_mode === 'KEYPAD_TPE' && input.lines !== null)
      throw invalid('lines : un terminal à saisie du montant n’envoie pas de lignes.', 422);
    if (row.os !== 'ANDROID' || row.nfc_enabled !== true)
      throw new ProblemException('DEVICE_MODE_NOT_ALLOWED', {
        detail: 'Le paiement par bracelet exige un terminal Android au NFC actif.',
      });
    const settings = await readEventSettings(tx);
    if (!settings) throw new ProblemException('CONFLICT_STATE', { detail: 'EVENT_UNKNOWN' });
    if (settings.currency !== input.currency) throw new ProblemException('CURRENCY_MISMATCH');
    if (settings.status !== 'LIVE') throw new ProblemException('EVENT_CLOSING');

    const vendor = await this.vendorOf(tx, device, input.vendorSessionId, now);
    const tap = await this.resolveTap(tx, device, input, settings, now);
    const media = tap.media;

    // Portefeuille : verrou d'abord, solde ensuite.
    const wallet = await tx.query<{ status: string }>(
      'SELECT status FROM edge_wallet WHERE wallet_id = $1 FOR UPDATE',
      [media.wallet_id],
    );
    if (!wallet.rows[0]) throw new ProblemException('MEDIA_NOT_ACTIVATED');
    if (wallet.rows[0].status !== 'ACTIVE') throw new ProblemException('WALLET_BLOCKED');

    const lines = input.lines ? await this.checkLines(tx, row.pos_id, input, language) : null;
    const amount = BigInt(input.amount);
    if (amount > SALE_CEILING)
      throw new ProblemException('AMOUNT_OUT_OF_RANGE', {
        detail: 'EDGE_SALE_CEILING : montant au-dessus du plafond par vente de la passerelle.',
      });
    const hour = await tx.query<{ total: string }>(
      `SELECT COALESCE(sum((operation ->> 'amount')::bigint), 0) AS total FROM edge_op
        WHERE device_id = $1 AND type = 'PURCHASE' AND recorded_at > $2`,
      [device.deviceId, new Date(now.getTime() - 3_600_000)],
    );
    if (BigInt(hour.rows[0]!.total) + amount > TERMINAL_HOURLY_CEILING)
      throw new ProblemException('AMOUNT_OUT_OF_RANGE', {
        detail: 'EDGE_HOURLY_CEILING : plafond horaire du terminal atteint.',
      });

    const balance = await this.replication.effectiveBalance(tx, media.wallet_id!);
    let split;
    try {
      split = splitBySpendOrder(settings.spendOrder, amount, balance.promo, balance.paid);
    } catch (error) {
      if (!(error instanceof InsufficientFundsError)) throw error;
      throw new ProblemException('INSUFFICIENT_FUNDS', {
        detail: `Solde disponible ${balance.paid + balance.promo} ${settings.currency}, montant demandé ${amount} ${settings.currency}.`,
        extensions: {
          available_balance: Number(balance.paid + balance.promo),
          currency: settings.currency,
        },
      });
    }
    return {
      vendor,
      tap,
      media,
      lines,
      amount,
      balance,
      fromPaid: split.fromPaid,
      fromPromo: split.fromPromo,
      settings,
    };
  }

  private async vendorOf(
    tx: TxClient,
    device: AuthenticatedDevice,
    sessionId: string | null,
    now: Date,
  ): Promise<VendorRow> {
    if (sessionId === null) throw new ProblemException('VENDOR_SESSION_INVALID');
    const { rows } = await tx.query<VendorRow>(
      `SELECT v.vendor_id, v.display_name
         FROM edge_vendor_session s JOIN edge_vendor v ON v.vendor_id = s.vendor_id
        WHERE s.vendor_session_id = $1 AND s.device_id = $2 AND s.closed_at IS NULL
          AND s.expires_at > $3 AND v.status = 'ACTIVE' AND NOT v.blocked`,
      [sessionId, device.deviceId, now],
    );
    if (!rows[0]) throw new ProblemException('VENDOR_SESSION_INVALID');
    return rows[0];
  }

  private async resolveTap(
    tx: TxClient,
    device: AuthenticatedDevice,
    input: PaymentInput,
    settings: EventSettings,
    now: Date,
  ): Promise<ResolvedTap> {
    const means = input.means;
    if (means.kind === 'tap') {
      const outcome = await this.taps.register(tx, device.deviceId, means.reading, settings);
      if (outcome.result !== 'OK') throw tapRefusal(outcome.result);
      if (outcome.tapId === null || !outcome.media || !outcome.wire)
        throw new ProblemException('MEDIA_UNKNOWN');
      return this.usable(outcome.tapId, outcome.wire, outcome.media);
    }
    if (means.kind !== 'tap_id') throw new ProblemException('TAP_UNUSABLE');
    // `tap_id` : un passage LOCAL, de CE terminal, jamais consommé, dans la fenêtre.
    const { rows } = await tx.query<{
      tap_id: string;
      token_hash: Buffer;
      device_id: string;
      consumed_by_edge_seq: string | null;
      created_at: Date;
      reading: Record<string, unknown> | null;
    }>(
      `SELECT tap_id, token_hash, device_id, consumed_by_edge_seq, created_at, reading
         FROM edge_tap WHERE tap_id = $1 FOR UPDATE`,
      [means.tapId],
    );
    const tap = rows[0];
    if (
      !tap ||
      tap.device_id !== device.deviceId ||
      tap.consumed_by_edge_seq !== null ||
      tap.reading === null ||
      now.getTime() - tap.created_at.getTime() > settings.tapReplayWindowSeconds * 1000 ||
      now.getTime() < tap.created_at.getTime()
    )
      throw new ProblemException('TAP_UNUSABLE');
    const media = await this.mediaOf(tx, tap.token_hash);
    return this.usable(tap.tap_id, tap.reading, media);
  }

  private async mediaOf(tx: TxClient, tokenHash: Buffer): Promise<MediaRow> {
    const { rows } = await tx.query<MediaRow>(
      `SELECT token_hash, media_id, wallet_id, status, batch_status, uid, counter_last,
              originality_sig_sha256 FROM edge_media WHERE token_hash = $1`,
      [tokenHash],
    );
    const media = rows[0];
    if (!media || media.media_id === null) throw new ProblemException('MEDIA_UNKNOWN');
    return media;
  }

  /** Statut du bracelet relu au moment de payer (il a pu changer depuis le passage). */
  private usable(tapId: string, wire: Record<string, unknown>, media: MediaRow): ResolvedTap {
    const status = statusResult(media.status);
    if (status !== 'ACTIVE') throw tapRefusal(status);
    if (media.batch_status !== null && media.batch_status !== 'ACTIVE')
      throw tapRefusal('BATCH_INACTIVE');
    if (media.wallet_id === null || media.media_id === null)
      throw new ProblemException('MEDIA_NOT_ACTIVATED');
    return { tapId, wire, media };
  }

  /** Lignes contre `edge_catalog_item` : prix et taux du catalogue, jamais ceux du corps. */
  private async checkLines(
    tx: TxClient,
    posId: string | null,
    input: PaymentInput,
    language: 'fr' | 'en',
  ): Promise<SaleLineResult[]> {
    const lines = input.lines!;
    const bad = (detail: string): ProblemException =>
      new ProblemException('SALE_LINES_INVALID', { detail });
    if (posId === null) throw bad('Terminal sans point de vente.');
    const result: SaleLineResult[] = [];
    let total = 0n;
    for (const line of lines) {
      if (line.productId === null) throw bad('Chaque ligne porte un product_id.');
      const { rows } = await tx.query<{
        price: string;
        version: string;
        lines: Record<string, unknown>;
      }>('SELECT price, version, lines FROM edge_catalog_item WHERE pos_id = $1 AND item_id = $2', [
        posId,
        line.productId,
      ]);
      const item = rows[0];
      if (!item) throw bad('Article inconnu de ce point de vente.');
      if (BigInt(item.price) !== BigInt(line.unitPrice))
        throw bad('Prix différent de celui du catalogue servi.');
      const names = item.lines;
      const label =
        (language === 'en' ? names.name_en : names.name_fr) ?? names.name_fr ?? names.name_en;
      const vat = names.vat_rate_bps;
      if (typeof label !== 'string' || typeof vat !== 'number')
        throw bad('Article incomplet dans la copie locale.');
      const lineTotal = BigInt(line.quantity) * BigInt(line.unitPrice);
      total += lineTotal;
      result.push({
        product_id: line.productId,
        label,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        vat_rate_bps: vat,
        line_total: Number(lineTotal),
        catalog_version: Number(item.version),
      });
    }
    if (total !== BigInt(input.amount)) throw bad('La somme des lignes diffère du montant.');
    return result;
  }

  // --------------------------------------------------------------------------- écriture

  private async commit(
    tx: TxClient,
    device: AuthenticatedDevice,
    ctx: { key: string; seq: number; fingerprint: Buffer; input: PaymentInput },
    sale: Decision,
    occurredAt: Date,
    now: Date,
  ): Promise<SaleResponse> {
    const { input } = ctx;
    const op: Record<string, unknown> = {
      seq: ctx.seq,
      type: 'PURCHASE',
      occurred_at: iso(occurredAt),
      amount: input.amount,
      currency: input.currency,
      tap: sale.tap.wire,
      ...(input.lines ? { lines: input.lines.map((line) => line.wire) } : {}),
      vendor_session_id: input.vendorSessionId,
      local_available_before: Number(sale.balance.paid + sale.balance.promo),
      edge_decision: {
        status: 'ACCEPTED',
        charged_to_wallet: input.amount,
        shortfall_amount: 0,
      },
    };
    const row = await this.queue.append(
      tx,
      {
        originKey: ctx.key,
        type: 'PURCHASE',
        authorizedMode: 'EDGE_ONLINE',
        deviceSerial: device.serial,
        deviceId: device.deviceId,
        operation: op,
        occurredAt,
        recordedAt: now,
      },
      [
        {
          walletId: sale.media.wallet_id!,
          paidDelta: -sale.fromPaid,
          promoDelta: -sale.fromPromo,
        },
      ],
      // Passage consommé dans la même instruction que la file (un seul aller-retour sous le verrou
      // de la chaîne, NFR-005) : une ligne exactement, sinon la transaction est annulée.
      [
        {
          sql: `UPDATE edge_tap SET consumed_by_edge_seq = $1 WHERE tap_id = $2
                  AND consumed_by_edge_seq IS NULL RETURNING 1`,
          params: [sale.tap.tapId],
          expectRows: 1,
          what: 'passage déjà consommé (verrou rompu)',
        },
      ],
    );
    if (input.occurredAt.getTime() !== occurredAt.getTime())
      await tx.query(
        `INSERT INTO edge_audit (kind, actor, device_id, edge_seq, detail)
         VALUES ('OPERATION_CLOCK_SKEW', 'gateway', $1, $2, $3)`,
        [
          device.deviceId,
          row.edgeSeq,
          JSON.stringify({ device_occurred_at: iso(input.occurredAt), used: iso(occurredAt) }),
        ],
      );
    const spendable = sale.balance.paid + sale.balance.promo - sale.amount;
    const body: Record<string, unknown> = {
      transaction_id: newTransactionId(),
      idempotency_key: ctx.key,
      type: 'PURCHASE',
      status: 'SUCCEEDED',
      amount: input.amount,
      currency: input.currency,
      occurred_at: iso(occurredAt),
      recorded_at: iso(now),
      media_id: sale.media.media_id,
      wallet_id: sale.media.wallet_id,
      balance_after: {
        spendable: Number(spendable),
        paid: Number(sale.balance.paid - sale.fromPaid),
        promo: Number(sale.balance.promo - sale.fromPromo),
      },
      vendor: { vendor_id: sale.vendor.vendor_id, display_name: sale.vendor.display_name },
      channel: 'NFC',
      ...(sale.lines ? { lines: sale.lines } : {}),
    };
    await this.idempotency.record(tx, {
      deviceId: device.deviceId,
      key: ctx.key,
      fingerprint: ctx.fingerprint,
      statusCode: 201,
      response: body,
      edgeSeq: row.edgeSeq,
      sale: {
        wallet_id: sale.media.wallet_id,
        paid: sale.fromPaid.toString(),
        promo: sale.fromPromo.toString(),
        seq: ctx.seq,
      },
      at: now,
    });
    return { status: 201, body, replayed: false };
  }

  // ------------------------------------------------------------------------------ lecture

  /** Ses propres ventes seulement ; toute autre : `404` neutre. */
  async get(device: AuthenticatedDevice, transactionId: string): Promise<Record<string, unknown>> {
    if (!isUuid(transactionId)) throw new ProblemException('NOT_FOUND');
    return this.gatewayTx.run(async (tx) => {
      await assertNotRevoked(tx);
      const { rows } = await tx.query<{ response: Record<string, unknown> }>(
        `SELECT response FROM edge_idempotency
          WHERE device_id = $1 AND status_code = 201 AND response ->> 'transaction_id' = $2`,
        [device.deviceId, transactionId.toLowerCase()],
      );
      if (!rows[0]) throw new ProblemException('NOT_FOUND');
      return rows[0].response;
    });
  }
}

interface ResolvedTap {
  tapId: string;
  wire: Record<string, unknown>;
  media: MediaRow;
}

interface SaleLineResult {
  product_id: string;
  label: string;
  quantity: number;
  unit_price: number;
  vat_rate_bps: number;
  line_total: number;
  catalog_version: number;
}

interface Decision {
  vendor: VendorRow;
  tap: ResolvedTap;
  media: MediaRow;
  lines: SaleLineResult[] | null;
  amount: bigint;
  balance: { paid: bigint; promo: bigint };
  fromPaid: bigint;
  fromPromo: bigint;
  settings: EventSettings;
}

/**
 * Répartition payé/offert d'une vente (décision 45, ADR-185). Ordre répliqué : appliqué tel quel, comme au rejeu central
 * (`edge_spend_promo_first`). Ordre inconnu (champ absent) : aucune valeur supposée ; la vente est refusée dès que
 * les deux ordres donnent une répartition différente (crédit payé et crédit offert mêlés), acceptée sinon (même
 * répartition quel que soit l'ordre). Un solde insuffisant reste `InsufficientFundsError`, quel que soit l'ordre.
 */
export function splitBySpendOrder(
  order: SpendOrder | null,
  amount: bigint,
  promoBalance: bigint,
  paidBalance: bigint,
): { fromPaid: bigint; fromPromo: bigint } {
  const at = (promoFirst: boolean) =>
    spendSplit({ amount, promoBalance, paidBalance, promoFirst, mode: 'ONLINE' });
  if (order !== null) return at(order === 'PROMO_FIRST');
  const promoFirst = at(true);
  const paidFirst = at(false);
  if (promoFirst.fromPaid !== paidFirst.fromPaid || promoFirst.fromPromo !== paidFirst.fromPromo)
    throw new ProblemException('CONFLICT_STATE', {
      detail:
        'SPEND_ORDER_UNKNOWN : ordre de dépense non répliqué, vente mêlant crédit payé et crédit offert refusée.',
    });
  return promoFirst;
}
