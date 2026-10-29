// Jeu d'essai des contestations (mission 6, lot WP13, T068) : s'appuie sur les mondes de WP11 (recharges PSP) et de WP12
// (notification signée, HTTPS réel), importés et jamais copiés. Écritures directes en base : amorçage et lectures
// seulement (dépense du solde payé, verrouillage du grand livre, seconde personne).
import { randomUUID } from 'node:crypto';
import { PspDisputeHandler } from '../../../src/chargebacks/dispute-handler';
import { ChargebackService } from '../../../src/chargebacks/chargeback.service';
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import { fakeEvents, type FakeEvent } from '../../../src/psp/fake/fake-notification-signer';
import type { NormalizedNotification } from '../../../src/psp/psp.types';
import type { DispatchOutcome, PspEventRef } from '../../../src/webhooks/event-dispatcher';
import type { PspTopupRow } from '../../../src/topups/psp/psp-topup-lookup';
import { withOwner } from '../../support/db';
import type { TestCustomer } from '../../support/fake-customer';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import type { TerminalResponse } from '../../support/test-terminal';
import { WebhookWorld, closeBacklog } from '../webhooks/webhook-fixtures';

export interface Credited {
  row: PspTopupRow;
  customer: TestCustomer;
  walletId: string;
  /** Net crédité au portefeuille (lignes de la recharge). */
  net: bigint;
}

export class ChargebackWorld {
  handler!: PspDisputeHandler;
  service!: ChargebackService;
  engine!: LedgerEngineService;

  constructor(readonly w: WebhookWorld) {}

  static async create(): Promise<ChargebackWorld> {
    const world = new ChargebackWorld(await WebhookWorld.create());
    await closeBacklog();
    const app = world.p.sw.api.app;
    world.handler = app.get(PspDisputeHandler, { strict: false });
    world.service = app.get(ChargebackService, { strict: false });
    world.engine = app.get(LedgerEngineService, { strict: false });
    return world;
  }

  get p() {
    return this.w.p;
  }
  get cw() {
    return this.w.p.sw;
  }
  close(): Promise<void> {
    return this.w.close();
  }

  // ----- recharges et notifications

  /** Recharge CARD créditée (notification de succès traitée), au nom d'un portefeuille neuf. */
  async credited(
    over: { amount?: number; method?: 'CARD' | 'WAVE'; status?: 'ACTIVE' | 'BLOCKED' } = {},
  ): Promise<Credited> {
    const method = over.method ?? 'CARD';
    const wallet = await this.p.wallet(over.status ? { status: over.status } : {});
    const t = await this.p.topup({
      method,
      wallet,
      ...(over.amount ? { amount: over.amount } : {}),
    });
    const out = await this.p.pay(t.row);
    if (out.outcome !== 'CREDITED') throw new Error(`recharge non créditée : ${out.outcome}`);
    const row = (await this.p.read(t.row.topupId))!;
    const [net] = await ownerRows<{ net: string }>(
      `SELECT coalesce(-sum(p.amount), 0)::text AS net FROM posting p
         JOIN account a ON a.id = p.account_id
        WHERE p.transaction_id = $1 AND a.purpose = 'WALLET_PAID' AND a.wallet_id = $2`,
      [row.topupTxId, row.walletId],
    );
    return { row, customer: wallet.customer, walletId: row.walletId, net: BigInt(net!.net) };
  }

  disputeId(): string {
    return `dp-${randomUUID()}`;
  }

  /** Notification normalisée de contestation (référence marchande et paiement de la recharge). */
  notification(
    topup: PspTopupRow,
    disputeId: string,
    amount: number | bigint,
    over: Parameters<ChargebackWorld['p']['notification']>[1] = {},
  ): NormalizedNotification {
    return {
      ...this.p.notification(topup, { kind: 'DISPUTE', ...over }),
      dispute: { providerDisputeId: disputeId, amount: BigInt(amount) },
    };
  }

  eventRef(topup: PspTopupRow, over: Partial<PspEventRef> = {}): PspEventRef {
    return {
      pspEventId: randomUUID(),
      operatorId: this.p.op,
      configurationId: topup.configurationId,
      receivedAt: new Date(),
      ...over,
    };
  }

  /** Le gestionnaire dans sa propre transaction (comme `EventDispatcher.apply`). */
  handle(
    topup: PspTopupRow,
    notification: NormalizedNotification,
    ref: PspEventRef = this.eventRef(topup),
  ): Promise<DispatchOutcome> {
    return this.p.tx.run(this.p.op, (client) => this.handler.handle(client, ref, notification));
  }

  /** Notification signée complète, envoyée par HTTPS (réception, aiguillage, écriture). */
  postDispute(
    topup: PspTopupRow,
    disputeId: string,
    amount: number,
    over: { id?: string } = {},
  ): Promise<TerminalResponse> {
    const event: FakeEvent = fakeEvents.dispute({
      id: over.id ?? `evt-dp-${randomUUID()}`,
      merchantReference: topup.topupId,
      paymentId: `pay-${topup.topupId.slice(0, 8)}`,
      amount: Number(topup.amount),
      currency: topup.currency,
      disputeId,
      disputeAmount: amount,
    });
    return this.w.post(event, { method: 'CARD' });
  }

  // ----- amorçage

  /** Dépense `amount` du solde payé (écriture réelle du propriétaire, deux personnes distinctes). */
  async spend(walletId: string, amount: number): Promise<void> {
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [this.p.op]);
      await db.query(
        `SELECT post_transaction($1, 'ADJUSTMENT', $2, clock_timestamp(), 'BACKOFFICE', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $3 AND purpose = 'WALLET_PAID'), 'amount', $4::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-PSP-CARTE'), 'amount', -$4::bigint)),
           NULL, NULL, $5, $6)`,
        [
          this.p.ev.ledgerId,
          `test-spend:${randomUUID()}`,
          walletId,
          amount,
          this.cw.w.operatorAdminA.userId,
          this.cw.w.organizerAdminA.userId,
        ],
      );
    });
  }

  /** Verrouille le grand livre de l'événement A (réclamations tardives jusqu'à `lateUntil`). */
  lockLedger(lateUntilSql = "clock_timestamp() + interval '1 year'"): Promise<unknown[]> {
    return ownerRows(
      `UPDATE ledger SET status = 'LOCKED', locked_until = clock_timestamp() - interval '1 hour',
              late_claims_until = ${lateUntilSql} WHERE id = $1`,
      [this.p.ev.ledgerId],
    );
  }
  unlockLedger(): Promise<unknown[]> {
    return ownerRows(
      `UPDATE ledger SET status = 'OPEN', locked_until = NULL, late_claims_until = NULL WHERE id = $1`,
      [this.p.ev.ledgerId],
    );
  }

  /** Seconde personne `ORGANIZER_ADMIN` de l'organisateur de l'événement A. */
  secondOrganizerAdmin(): Promise<TestPerson> {
    const w = this.cw.w;
    return withOwner((db) =>
      w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: w.ids.organizerA }],
      }),
    );
  }

  // ----- lectures en base

  chargebacks(topupId: string) {
    return ownerRows<{
      psp_chargeback_id: string;
      provider_dispute_id: string;
      amount: string;
      chargeback_tx_id: string | null;
      wallet_blocked: boolean;
      late: boolean;
      anomaly_id: string | null;
      unblocked_by_request: string | null;
    }>(
      `SELECT psp_chargeback_id, provider_dispute_id, amount::text, chargeback_tx_id, wallet_blocked,
              late, anomaly_id, unblocked_by_request
         FROM psp_chargeback WHERE psp_topup_id = $1 ORDER BY created_at`,
      [topupId],
    );
  }

  /** Écritures `CHARGEBACK` de la contestation (clé du moteur `psp:<configuration>:<contestation>`). */
  chargebackTxs(configurationId: string, disputeId: string) {
    return ownerRows<{
      id: string;
      source: string;
      created_by: string | null;
      approved_by: string | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, source, created_by, approved_by, metadata FROM journal_transaction
        WHERE ledger_id = $1 AND type = 'CHARGEBACK' AND idempotency_key = $2`,
      [this.p.ev.ledgerId, `psp:${configurationId}:${disputeId}`],
    );
  }

  /** Montant net des lignes d'un compte (par code ou fonction) dans une transaction. */
  async lines(txId: string): Promise<Record<string, number>> {
    const rows = await ownerRows<{ code: string; purpose: string; amount: string }>(
      `SELECT a.code, a.purpose, sum(p.amount)::text AS amount FROM posting p
         JOIN account a ON a.id = p.account_id WHERE p.transaction_id = $1 GROUP BY 1, 2`,
      [txId],
    );
    const result: Record<string, number> = {};
    for (const row of rows)
      result[row.purpose === 'WALLET_PAID' ? 'WALLET_PAID' : row.code] = Number(row.amount);
    return result;
  }

  async walletStatus(walletId: string): Promise<string> {
    const [row] = await ownerRows<{ status: string }>('SELECT status FROM wallet WHERE id = $1', [
      walletId,
    ]);
    return row!.status;
  }

  chargebackCount(): Promise<number> {
    return ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM psp_chargeback').then(
      (r) => r[0]!.n,
    );
  }

  mismatchAnomalies(amount?: number) {
    return ownerRows<{ id: string }>(
      `SELECT id FROM anomaly WHERE ledger_id = $1 AND kind = 'PSP_MISMATCH'
          AND ($2::bigint IS NULL OR amount = $2)`,
      [this.p.ev.ledgerId, amount ?? null],
    );
  }
}
