// `createPayment` : paiement d'un bracelet ou d'un QR client par un terminal (mission 5b, lot WP11,
// T048 à T052 ; FR-006, FR-009 à FR-015, FR-019, FR-020, NFR-005, NFR-006, NFR-008, C-005, C-007 ;
// contracts/payments.md, contracts/qr-payments.md « QR client » point 2 ; research R-03, R-06, R-11).
//
// UNE transaction (`IdempotentTx.run`), tout ou rien, verrous dans l'ordre global
//   terminal → vendeur → session de vendeur → demande QR → bracelet → portefeuille :
//   1. le terminal est pris `FOR UPDATE` en PREMIÈRE instruction (`SELECT … FOR UPDATE OF d`, qui lit aussi le
//      contexte : mode, événement, grand livre, époque, heure de la base) ; `record_device_seq` n'est appelée
//      qu'en fin de transaction, verrou déjà tenu (elle exige l'issue et `transaction_id`, connus à la fin) ;
//   2. mode du terminal, devise, époque d'autorité (`X-Authority-Epoch`), heure bornée à ±120 s de la base ;
//   3. `assert_device_active`, puis la garde de session : le vendeur est TOUJOURS celui de la session, jamais
//      un champ du corps (FR-006) ;
//   4. le moyen : lecture embarquée (`TapService.registerOrRefuse`), `tap_id` (`assert_tap_payable`, jamais
//      `TapService.byId`, A1) ou QR client (`lock_customer_qr_token`) → bracelet et portefeuille ;
//   5. `assert_wallet_payable` sur les trois moyens (A17) ;
//   6. le moteur d'écritures (`PURCHASE`, source `ONLINE`, clé = `Idempotency-Key`) ;
//   7. lignes (un seul `jsonb`), attribution par la session (`record_sale_attribution`, canal fixé par le
//      serveur), puis `consume_tap` (A18) ou `confirm_payment_request` ;
//   8. enregistrement du numéro (`ACCEPTED`) dans la même transaction.
// Tout refus annule tout (NFR-006) ; le refus définitif 4xx est rangé au registre dans une transaction
// séparée, validée, puis `TapService.settleRefusal` rend durables les effets d'une lecture suspecte.
import { Injectable } from '@nestjs/common';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import type { TxClient } from '../db/tenant-tx';
import type { DeviceContext } from '../device-identity/device-identity.port';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { Language } from '../http/language';
import type { IdempotentTx } from '../idempotency/idempotent.decorator';
import { TapRefused, TapService } from '../media/taps/tap.service';
import { tapProblem, type TapInput } from '../media/taps/taps.dto';
import { conflict } from '../organization/platform/platform.dto';
import { VendorSessionGuard } from '../vendors/vendor-session-guard';
import { DeviceSeqRegistry, isRegistrable, purchaseContent } from './device-seq-registry';
import { PaymentReadService } from './payment-read.service';
import { linesJson, parsePayment, type PaymentInput, type PaymentResult } from './payments.dto';
import { assertAuthorityEpoch, resolveOperationTime } from './operation-time';
import { qrTokenHash } from './qr-token-hash';

export interface CreatePaymentArgs {
  device: DeviceContext;
  /** `<seq>` de l'`Idempotency-Key`, contrôlé par l'intercepteur. */
  seq: bigint;
  /** `Idempotency-Key` complète `<serial>:<seq>` : clé du moteur d'écritures. */
  key: string;
  body: unknown;
  language: Language;
  /** En-tête `X-Authority-Epoch` tel que reçu (absent : refusé). */
  authorityEpoch: string | undefined;
}

/** Ce que le terminal et son événement permettent, lu en même temps que le verrou du terminal. */
interface TerminalRow {
  app_mode: string;
  os: string;
  nfc_enabled: boolean;
  event_id: string | null;
  participation_id: string | null;
  event_currency: string | null;
  ledger_id: string | null;
  authority_epoch: number | null;
  db_now: Date;
}

/** Ce que la transaction sait au moment d'un refus (solde d'un `INSUFFICIENT_FUNDS`, lecture à rendre durable). */
interface Progress {
  walletId: string | null;
  currency: string | null;
  tap: TapInput | null;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly engine: LedgerEngineService,
    private readonly taps: TapService,
    private readonly sessions: VendorSessionGuard,
    private readonly registry: DeviceSeqRegistry,
    private readonly reads: PaymentReadService,
  ) {}

  async create(args: CreatePaymentArgs, tx: IdempotentTx): Promise<PaymentResult> {
    const progress: Progress = { walletId: null, currency: null, tap: null };
    try {
      const input = parsePayment(args.body);
      if (input.means.kind === 'tap') progress.tap = input.means.tap;
      return await tx.run((client) => this.write(client, args, input, progress));
    } catch (error) {
      return this.refuse(error, args, progress);
    }
  }

  // ------------------------------------------------------------------------------ l'écriture

  private async write(
    client: TxClient,
    args: CreatePaymentArgs,
    input: PaymentInput,
    progress: Progress,
  ): Promise<PaymentResult> {
    const { device } = args;
    // 1. Terminal pris FOR UPDATE en première instruction (ordre global des verrous).
    const terminal = await this.lockTerminal(client, device);
    // 2. Mode, devise, époque, heure.
    this.assertTerminal(terminal, input);
    if (!terminal.ledger_id || !terminal.event_id || !terminal.participation_id)
      throw conflict('Ce terminal n’est affecté à aucun point de vente d’un événement ouvert.');
    progress.currency = terminal.event_currency;
    assertAuthorityEpoch(args.authorityEpoch, terminal.authority_epoch!);
    const time = resolveOperationTime(input.occurredAt, terminal.db_now);
    // 3. Terminal actif (relu dans cette transaction), puis session de vendeur.
    await client.query('SELECT assert_device_active($1)', [device.deviceId]);
    if (input.vendorSessionId === null) throw new ProblemException('VENDOR_SESSION_INVALID');
    await this.sessions.assert(client, device, input.vendorSessionId);

    // 4. Le moyen : bracelet (lecture embarquée ou `tap_id`) ou demande QR, puis portefeuille.
    let mediaId: string | null = null;
    let tapId: string | null = null;
    let requestId: string | null = null;
    let walletId: string;
    let channel: 'NFC' | 'CUSTOMER_QR';
    const means = input.means;
    if (means.kind === 'tap') {
      const reading = await this.taps.registerOrRefuse(client, device, means.tap);
      if (!reading.mediaId || reading.tapId === null) throw new TapRefused('UNKNOWN');
      mediaId = reading.mediaId;
      tapId = reading.tapId;
      walletId = await this.walletOf(client, mediaId);
      channel = 'NFC';
    } else if (means.kind === 'tap_id') {
      const { rows } = await client.query<{ media_id: string; wallet_id: string }>(
        'SELECT media_id, wallet_id FROM assert_tap_payable($1, $2)',
        [means.tapId.toString(), device.deviceId],
      );
      mediaId = rows[0]!.media_id;
      walletId = rows[0]!.wallet_id;
      tapId = means.tapId.toString();
      channel = 'NFC';
    } else {
      try {
        const { rows } = await client.query<{ payment_request_id: string; wallet_id: string }>(
          'SELECT payment_request_id, wallet_id FROM lock_customer_qr_token($1, $2)',
          [qrTokenHash(means.token), device.deviceId],
        );
        requestId = rows[0]!.payment_request_id;
        walletId = rows[0]!.wallet_id;
      } catch (error) {
        throw qrRefusal(error);
      }
      channel = 'CUSTOMER_QR';
    }
    progress.walletId = walletId;
    // 5. Portefeuille payable (dernier échelon de l'ordre global).
    await client.query('SELECT assert_wallet_payable($1)', [walletId]);

    // 6. Le moteur d'écritures (le montant vient du corps validé, jamais d'un calcul du terminal).
    const written = await this.engine.execute(client, {
      type: 'PURCHASE',
      source: 'ONLINE',
      idempotencyKey: args.key,
      occurredAt: time.occurredAt,
      ledgerId: terminal.ledger_id,
      eventId: terminal.event_id,
      currency: input.currency,
      deviceId: device.deviceId,
      ...(mediaId ? { mediaId } : {}),
      payload: { walletId, participationId: terminal.participation_id, amount: input.amount },
      metadata: {
        vendor_session_id: input.vendorSessionId,
        channel,
        ...(time.deviceOccurredAt
          ? { device_occurred_at: time.deviceOccurredAt.toISOString() }
          : {}),
      },
    });
    if (!written.transactionId || written.replayed)
      // La clé du grand livre existait déjà : l'idempotence aurait dû rejouer la réponse. Rien n'est lié.
      throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
        detail: 'Cette clé a déjà servi à une écriture.',
      });
    const transactionId = written.transactionId;

    // 7. Anomalie d'heure, lignes (un seul jsonb), attribution, passage ou demande consommés.
    if (time.skewed)
      await client.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, transaction_id, amount)
         VALUES ($1, $2, 'CLOCK_SKEW', $3, $4, 0)`,
        [device.operatorId, terminal.ledger_id, device.deviceId, transactionId],
      );
    if (input.lines)
      await client.query('SELECT record_sale_lines($1, $2, $3::jsonb)', [
        transactionId,
        device.deviceId,
        linesJson(input.lines),
      ]);
    await client.query('SELECT record_sale_attribution($1, $2, $3)', [
      transactionId,
      input.vendorSessionId,
      channel,
    ]);
    if (tapId !== null) await this.taps.consume(client, tapId, transactionId);
    if (requestId !== null && means.kind === 'customer_qr') {
      try {
        await client.query('SELECT confirm_payment_request($1, $2, $3)', [
          requestId,
          transactionId,
          qrTokenHash(means.token),
        ]);
      } catch (error) {
        throw qrRefusal(error);
      }
    }
    // 8. Le numéro, dans la même transaction que l'écriture.
    const content = purchaseContent(args.seq, args.body);
    if (content === null) throw new Error('contenu du registre : corps non objet après validation');
    await this.registry.accept(client, {
      deviceId: device.deviceId,
      seq: args.seq,
      content,
      transactionId,
    });
    // Réponse : relue de la base (vendeur, lignes copiées, solde après écriture).
    const result = await this.reads.read(client, { transactionId, language: args.language });
    if (!result) throw new Error('vente écrite introuvable');
    return result;
  }

  /** `SELECT … FOR UPDATE OF d` : prend le terminal et lit son contexte en une seule instruction. */
  private async lockTerminal(client: TxClient, device: DeviceContext): Promise<TerminalRow> {
    const { rows } = await client.query<TerminalRow>(
      `SELECT d.app_mode, d.os, d.nfc_enabled, d.event_id, pos.participation_id,
              e.currency AS event_currency, l.id AS ledger_id, l.authority_epoch,
              clock_timestamp() AS db_now
         FROM device d
         LEFT JOIN point_of_sale pos ON pos.id = d.pos_id AND pos.operator_id = d.operator_id
         LEFT JOIN event e ON e.id = d.event_id
         LEFT JOIN ledger l
                ON l.scope_type = 'EVENT' AND l.scope_id = e.id AND l.currency = e.currency
        WHERE d.id = $1 AND d.operator_id = $2
          FOR UPDATE OF d`,
      [device.deviceId, device.operatorId],
    );
    if (!rows[0]) throw new ProblemException('NOT_FOUND');
    return rows[0];
  }

  /** Contrôles du terminal (FR-015) sur ce que la base en dit, pas sur le contexte lu avant la transaction. */
  private assertTerminal(terminal: TerminalRow, input: PaymentInput): void {
    const notAllowed = (detail: string) =>
      new ProblemException('DEVICE_MODE_NOT_ALLOWED', { detail });
    if (terminal.app_mode === 'TOPUP_DESK')
      throw notAllowed('Un terminal de guichet de recharge n’encaisse pas de vente.');
    if (terminal.app_mode === 'CATALOG_POS' && input.lines === null)
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'lines : une caisse catalogue envoie les lignes de la vente.',
      });
    if (terminal.app_mode === 'KEYPAD_TPE' && input.lines !== null)
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'lines : un terminal à saisie du montant n’envoie pas de lignes.',
      });
    if (
      (input.means.kind === 'tap' || input.means.kind === 'tap_id') &&
      (terminal.os !== 'ANDROID' || !terminal.nfc_enabled)
    )
      throw notAllowed('Le paiement par bracelet exige un terminal Android au NFC actif.');
    if (terminal.event_currency !== null && terminal.event_currency.trim() !== input.currency)
      throw new ProblemException('CURRENCY_MISMATCH');
  }

  private async walletOf(client: TxClient, mediaId: string): Promise<string> {
    const { rows } = await client.query<{ wallet_id: string | null }>(
      'SELECT wallet_id FROM media WHERE id = $1',
      [mediaId],
    );
    if (!rows[0]?.wallet_id) throw new ProblemException('MEDIA_NOT_ACTIVATED');
    return rows[0].wallet_id;
  }

  // ------------------------------------------------------------------------------ le refus

  /**
   * Transaction annulée : le refus définitif 4xx est rangé au registre (transaction séparée, validée), puis les
   * effets durables d'une lecture suspecte sont rejoués seuls (`settleRefusal`), et l'erreur repart.
   * Non définitifs, 5xx et refus du registre lui-même : rien n'est rangé.
   */
  private async refuse(
    error: unknown,
    args: CreatePaymentArgs,
    progress: Progress,
  ): Promise<never> {
    const visible =
      error instanceof TapRefused
        ? error.alreadyActive
          ? new ProblemException('MEDIA_STATE_INVALID', { status: 409 })
          : tapProblem(error.result)
        : error;
    const problem = resolveProblem(visible);
    const content = purchaseContent(args.seq, args.body);
    let thrown: unknown = visible;
    // Un refus du registre (CL002, CL021, panne) ne doit jamais empêcher l'effet durable du refus : l'erreur est
    // gardée, `settleRefusal` a lieu dans tous les cas, puis l'erreur du registre est relancée.
    let registryError: { error: unknown } | null = null;
    if (content !== null && isRegistrable(problem, visible)) {
      const insufficient = problem.code === 'INSUFFICIENT_FUNDS' && progress.walletId !== null;
      try {
        const spendable = await this.registry.reject(
          args.device.operatorId,
          { deviceId: args.device.deviceId, seq: args.seq, content, reason: problem.code },
          'ONLINE',
          insufficient ? (client) => this.spendable(client, progress.walletId!) : undefined,
        );
        if (insufficient && spendable !== undefined)
          thrown = new ProblemException('INSUFFICIENT_FUNDS', {
            extensions: { available_balance: Number(spendable), currency: progress.currency },
          });
      } catch (registry) {
        registryError = { error: registry };
      }
    }
    if (error instanceof TapRefused) {
      try {
        await this.taps.settleRefusal(error, args.device, progress.tap);
      } catch (settled) {
        throw registryError ? registryError.error : settled;
      }
    }
    throw registryError ? registryError.error : thrown;
  }

  private async spendable(client: TxClient, walletId: string): Promise<bigint> {
    const { rows } = await client.query<{ spendable: string }>(
      'SELECT wallet_spendable($1)::text AS spendable',
      [walletId],
    );
    return BigInt(rows[0]!.spendable);
  }
}

/** `CL037` (jeton QR inconnu, expiré, utilisé, annulé, d'un autre événement) → réponse unique (ADR-123). */
function qrRefusal(error: unknown): unknown {
  return isSqlError(error) && error.code === 'CL037'
    ? new ProblemException('QR_TOKEN_INVALID')
    : error;
}
