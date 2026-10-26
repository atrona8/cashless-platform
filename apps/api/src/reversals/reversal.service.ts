// `reversePayment` depuis un terminal (mission 5b, lot WP12, T055 et T057 ; FR-016, FR-017, NFR-005, C-001, C-003 ;
// contracts/payments.md « reversePayment » ; research R-05, R-11 A5, A8, A9, A19 ; ADR-122, ADR-123).
//
// UNE transaction (`IdempotentTx.run`), tout ou rien, verrous dans l'ordre global
//   terminal → vendeur → session de vendeur → … → portefeuille :
//   1. le terminal est pris `FOR UPDATE` en PREMIÈRE instruction (même requête de contexte que `createPayment` :
//      événement, grand livre, époque, heure de la base) ; `record_device_seq` n'est appelée qu'en fin de
//      transaction, verrou déjà tenu (elle exige l'issue et `transaction_id`, connus à la fin) ;
//   2. époque d'autorité (`X-Authority-Epoch`), heure bornée à ±120 s de la base (WP11, `operation-time.ts`) ;
//   3. `assert_device_active`, puis la garde de session de vendeur (WP09, `VendorSessionGuard`) ;
//   4. SUPERVISOR au terminal : consommation du jeton sur place (`consumeDeviceOnsiteApproval`) AVANT la garde de
//      la vente ; dans cette transaction, donc annulée avec elle si l'annulation échoue ;
//   5. `assert_reversible` (A9) : TOUTES les règles d'annulation sont dans la base (C-001) : vente du prestataire,
//      `PURCHASE`, non annulée, terminal et vendeur (mode VENDOR) ou terminal du même événement et preuve du
//      jeton (mode SUPERVISOR_DEVICE), et, en dernier (ADR-123), la fenêtre à l'heure de la base ;
//   6. le moteur d'écritures (`REVERSAL`, `reversesId`, source `ONLINE`, clé = `Idempotency-Key`, lignes miroir) ;
//   7. `record_sale_attribution` (vendeur par la session ; le valideur comme `actor_user_id`) ;
//   8. le numéro du terminal (`ACCEPTED`), dans la même transaction.
// Seconde annulation : `CL035` ou violation de `journal_transaction_reverses_once` (traduite par le NOM de la
// contrainte) → `409 ALREADY_REVERSED`. Tout refus annule tout ; le refus définitif 4xx est rangé au registre dans
// une transaction séparée, validée (`DeviceSeqRegistry.reject`, WP11), puis l'erreur repart.
import { Injectable } from '@nestjs/common';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import type { TxClient } from '../db/tenant-tx';
import type { DeviceContext } from '../device-identity/device-identity.port';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import type { DeviceOnsiteState } from '../approval/onsite/device-onsite-approval';
import type { IdempotentTx } from '../idempotency/idempotent.decorator';
import { conflict, requireUuid } from '../organization/platform/platform.dto';
import { DeviceSeqRegistry, isRegistrable } from '../payments/device-seq-registry';
import { assertAuthorityEpoch, resolveOperationTime } from '../payments/operation-time';
import type { PaymentResult } from '../payments/payments.dto';
import { VendorSessionGuard } from '../vendors/vendor-session-guard';
import { parseReversal, reversalContent, type ReversalInput } from './reversal.dto';

export interface ReversePaymentArgs {
  device: DeviceContext;
  /** `<seq>` de l'`Idempotency-Key`, contrôlé par l'intercepteur. */
  seq: bigint;
  /** `Idempotency-Key` complète `<serial>:<seq>` : clé du moteur d'écritures. */
  key: string;
  /** Vente à annuler, telle que reçue dans le chemin. */
  transactionId: string;
  body: unknown;
  /** En-tête `X-Authority-Epoch` tel que reçu (absent : refusé). */
  authorityEpoch: string | undefined;
  /** Ce que la garde du jeton sur place a décidé (variante d'appelant terminal). */
  onsite: DeviceOnsiteState;
  /** Consommation du jeton dans la transaction (`consumeDeviceOnsiteApproval`) ; rend le valideur. */
  consume: (
    client: TxClient,
    target: { vendorSessionId: string; targetId: string },
  ) => Promise<string>;
}

interface TerminalRow {
  event_id: string | null;
  ledger_id: string | null;
  authority_epoch: number | null;
  db_now: Date;
}

interface Reversible {
  ledger_id: string;
  event_id: string;
  wallet_id: string | null;
  media_id: string | null;
}

interface ReversalRow {
  transaction_id: string;
  idempotency_key: string;
  occurred_at: Date;
  recorded_at: Date;
  media_id: string | null;
  reverses_id: string | null;
  currency: string;
  vendor_id: string | null;
  vendor_name: string | null;
  wallet_id: string | null;
  amount: string;
  paid: string;
  promo: string;
}

/** Lecture de l'annulation écrite : mêmes sources que `getPayment` (vendeur par `sale_attribution`, solde par les écritures). */
const READ_REVERSAL = `
WITH h AS (
  SELECT t.id, t.idempotency_key, t.occurred_at, t.recorded_at, t.media_id, t.reverses_id,
         l.currency, sa.vendor_id,
         (SELECT v.display_name FROM vendor_public v WHERE v.id = sa.vendor_id) AS vendor_name,
         (SELECT a.wallet_id FROM posting p JOIN account a ON a.id = p.account_id
           WHERE p.transaction_id = t.id AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')
           LIMIT 1) AS wallet_id,
         (SELECT coalesce(-sum(p.amount), 0) FROM posting p JOIN account a ON a.id = p.account_id
           WHERE p.transaction_id = t.id AND p.amount < 0
             AND a.purpose IN ('WALLET_PAID','WALLET_PROMO')) AS amount,
         (SELECT max(p.id) FROM posting p WHERE p.transaction_id = t.id) AS last_posting
    FROM journal_transaction t
    JOIN ledger l ON l.id = t.ledger_id
    LEFT JOIN sale_attribution sa ON sa.transaction_id = t.id
   WHERE t.id = $1 AND t.type = 'REVERSAL'
)
SELECT h.id AS transaction_id, h.idempotency_key, h.occurred_at, h.recorded_at, h.media_id,
       h.reverses_id, h.currency, h.vendor_id, h.vendor_name, h.wallet_id, h.amount::text AS amount,
       (SELECT coalesce(-sum(p.amount), 0)::text FROM posting p JOIN account a ON a.id = p.account_id
         WHERE a.wallet_id = h.wallet_id AND a.purpose = 'WALLET_PAID' AND p.id <= h.last_posting)
         AS paid,
       (SELECT coalesce(-sum(p.amount), 0)::text FROM posting p JOIN account a ON a.id = p.account_id
         WHERE a.wallet_id = h.wallet_id AND a.purpose = 'WALLET_PROMO' AND p.id <= h.last_posting)
         AS promo
  FROM h`;

@Injectable()
export class ReversalService {
  constructor(
    private readonly engine: LedgerEngineService,
    private readonly sessions: VendorSessionGuard,
    private readonly registry: DeviceSeqRegistry,
  ) {}

  async reverse(args: ReversePaymentArgs, tx: IdempotentTx): Promise<PaymentResult> {
    try {
      const input = parseReversal(args.body);
      return await tx.run((client) => this.write(client, args, input));
    } catch (error) {
      return this.refuse(error, args);
    }
  }

  // ------------------------------------------------------------------------------ l'écriture

  private async write(
    client: TxClient,
    args: ReversePaymentArgs,
    input: ReversalInput,
  ): Promise<PaymentResult> {
    const { device } = args;
    // Jeton présenté puis refusé par la garde : aucune écriture, le refus est enregistré avec le numéro (T057).
    if (args.onsite.kind === 'refused') throw args.onsite.error;
    const transactionId = requireUuid(args.transactionId);

    // 1. Terminal pris FOR UPDATE en première instruction (ordre global des verrous).
    const terminal = await this.lockTerminal(client, device);
    if (!terminal.ledger_id || !terminal.event_id)
      throw conflict('Ce terminal n’est affecté à aucun point de vente d’un événement ouvert.');
    // 2. Époque d'autorité, heure (bornée à ±120 s de la base).
    assertAuthorityEpoch(args.authorityEpoch, terminal.authority_epoch!);
    const time = resolveOperationTime(input.occurredAt, terminal.db_now);
    // 3. Terminal actif (relu dans cette transaction), puis session de vendeur.
    await client.query('SELECT assert_device_active($1)', [device.deviceId]);
    if (input.vendorSessionId === null) throw new ProblemException('VENDOR_SESSION_INVALID');
    const sessionId = input.vendorSessionId;
    await this.sessions.assert(client, device, sessionId);

    // 4. Jeton sur place du SUPERVISOR, consommé dans CETTE transaction (annulé si l'annulation échoue).
    const approverId =
      args.onsite.kind === 'valid'
        ? await args.consume(client, { vendorSessionId: sessionId, targetId: transactionId })
        : null;
    const jti = args.onsite.kind === 'valid' ? args.onsite.approval.jti : null;

    // 5. Toutes les règles d'annulation sont dans la base (A9, C-001) : sur ce chemin, mode VENDOR ou
    //    SUPERVISOR_DEVICE. La fenêtre y est contrôlée en dernier (ADR-123), à l'heure de la base (A5).
    const { rows } = await client.query<Reversible>(
      'SELECT * FROM assert_reversible($1, $2, $3, $4, $5, NULL)',
      [
        transactionId,
        approverId === null ? 'VENDOR' : 'SUPERVISOR_DEVICE',
        device.deviceId,
        sessionId,
        jti,
      ],
    );
    const sale = rows[0]!;
    const currency = await this.currencyOf(client, sale.ledger_id);

    // 6. Le moteur d'écritures : contre-passation totale, lignes miroir (aucun recalcul).
    const written = await this.engine.execute(client, {
      type: 'REVERSAL',
      source: 'ONLINE',
      idempotencyKey: args.key,
      occurredAt: time.occurredAt,
      ledgerId: sale.ledger_id,
      eventId: sale.event_id,
      currency,
      deviceId: device.deviceId,
      ...(sale.media_id ? { mediaId: sale.media_id } : {}),
      reversesId: transactionId,
      ...(approverId !== null ? { approvedBy: approverId } : {}),
      payload: {},
      metadata: {
        vendor_session_id: sessionId,
        reason: input.reason,
        ...(input.comment !== null ? { comment: input.comment } : {}),
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
    const reversalId = written.transactionId;

    // 7. Anomalie d'heure ; attribution (vendeur par la session ; le SUPERVISOR comme `actor_user_id`).
    if (time.skewed)
      await client.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, device_id, transaction_id, amount)
         VALUES ($1, $2, 'CLOCK_SKEW', $3, $4, 0)`,
        [device.operatorId, sale.ledger_id, device.deviceId, reversalId],
      );
    await client.query('SELECT record_sale_attribution($1, $2, NULL, $3)', [
      reversalId,
      sessionId,
      approverId,
    ]);
    // 8. Le numéro, dans la même transaction que l'écriture.
    const content = reversalContent(args.seq, args.transactionId, args.body);
    if (content === null) throw new Error('contenu du registre : corps non objet après validation');
    await this.registry.accept(client, {
      deviceId: device.deviceId,
      seq: args.seq,
      content,
      transactionId: reversalId,
    });
    const result = await this.read(client, reversalId);
    if (!result) throw new Error('annulation écrite introuvable');
    return result;
  }

  /** `SELECT … FOR UPDATE OF d` : prend le terminal et lit son contexte en une seule instruction. */
  private async lockTerminal(client: TxClient, device: DeviceContext): Promise<TerminalRow> {
    const { rows } = await client.query<TerminalRow>(
      `SELECT d.event_id, l.id AS ledger_id, l.authority_epoch, clock_timestamp() AS db_now
         FROM device d
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

  private async currencyOf(client: TxClient, ledgerId: string): Promise<string> {
    const { rows } = await client.query<{ currency: string }>(
      'SELECT currency FROM ledger WHERE id = $1',
      [ledgerId],
    );
    return rows[0]!.currency.trim();
  }

  /** `PaymentResult` de l'annulation écrite (type `REVERSAL`, `reverses_id`), relu de la base. */
  private async read(client: TxClient, reversalId: string): Promise<PaymentResult | null> {
    const { rows } = await client.query<ReversalRow>(READ_REVERSAL, [reversalId]);
    const row = rows[0];
    if (!row) return null;
    const paid = Number(row.paid);
    const promo = Number(row.promo);
    return {
      transaction_id: row.transaction_id,
      idempotency_key: row.idempotency_key,
      type: 'REVERSAL',
      status: 'SUCCEEDED',
      reverses_id: row.reverses_id,
      amount: Number(row.amount),
      currency: row.currency.trim(),
      occurred_at: row.occurred_at.toISOString(),
      recorded_at: row.recorded_at.toISOString(),
      media_id: row.media_id,
      ...(row.wallet_id ? { wallet_id: row.wallet_id } : {}),
      balance_after: { spendable: paid + promo, paid, promo },
      ...(row.vendor_id && row.vendor_name
        ? { vendor: { vendor_id: row.vendor_id, display_name: row.vendor_name } }
        : {}),
    };
  }

  // ------------------------------------------------------------------------------ le refus

  /**
   * Transaction annulée : le refus définitif 4xx est rangé au registre (transaction séparée, validée), puis
   * l'erreur repart. Non définitifs, 5xx : rien n'est rangé. Un refus du registre lui-même (CL002, CL021, panne)
   * remplace l'erreur d'origine, comme pour `createPayment` (modèle de `PaymentsService.refuse`).
   */
  private async refuse(error: unknown, args: ReversePaymentArgs): Promise<never> {
    const problem = resolveProblem(error);
    const content = reversalContent(args.seq, args.transactionId, args.body);
    if (content !== null && isRegistrable(problem, error)) {
      await this.registry.reject(
        args.device.operatorId,
        { deviceId: args.device.deviceId, seq: args.seq, content, reason: problem.code },
        'ONLINE',
      );
    }
    throw error;
  }
}
