// Jeu d'essai des recharges PSP (mission 6, lot WP11, T059) : partagé avec WP12 et WP13 (à importer, jamais à
// copier). HTTPS réel (trois preuves du terminal, personnes par jetons du faux fournisseur d'identité), vraie
// base. Repose sur le monde des sessions de caisse (événement A en service, terminaux `TOPUP_DESK`, personnes) et
// ajoute : une configuration `ACTIVE` par moyen avec règle de frais (titulaire = détenteur des fonds du grand
// livre), leurs secrets dans le faux coffre, les faux adaptateurs, des festivaliers et des portefeuilles, un
// constructeur de recharge `PENDING` et de notification normalisée à la main, et l'appel direct des services.
// Écritures directes en base : amorçage et lectures seulement.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TenantTx } from '../../../src/db/tenant-tx';
import { PspAdapterRegistry } from '../../../src/psp/psp-adapter-registry';
import type { FakePspAdapter } from '../../../src/psp/fake/fake-psp-adapter';
import type { FakePspSecretStore } from '../../../src/psp/fake/fake-psp-secret-store';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../../../src/psp/psp.tokens';
import type {
  NormalizedCard,
  NormalizedNotification,
  PspProviderName,
} from '../../../src/psp/psp.types';
import { PspPaymentProcessor } from '../../../src/topups/psp/psp-payment-processor';
import type { PaymentInput, PaymentOutcome } from '../../../src/topups/psp/psp-payment-types';
import { PspTopupLookup, type PspTopupRow } from '../../../src/topups/psp/psp-topup-lookup';
import { withOwner } from '../../support/db';
import {
  createTestCustomer,
  createCustomerWallet,
  type TestCustomer,
} from '../../support/fake-customer';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import { send, type TestTerminal, type TerminalResponse } from '../../support/test-terminal';
import { CashWorld as SessionWorld, type WorldEvent } from '../cash-sessions/cash-session-fixtures';

export type Method = 'WAVE' | 'ORANGE_MONEY' | 'CARD';
const PROVIDER_OF: Record<Method, PspProviderName> = {
  WAVE: 'WAVE',
  ORANGE_MONEY: 'ORANGE_MONEY',
  CARD: 'STRIPE',
};

export interface TopupSpec {
  method?: Method;
  amount?: number;
  /** Portefeuille (défaut : un neuf, d'un festivalier neuf). */
  wallet?: { walletId: string; customer: TestCustomer };
}

export interface MadeTopup {
  row: PspTopupRow;
  customer: TestCustomer;
  walletId: string;
}

export class PspWorld {
  sw!: SessionWorld;
  tx!: TenantTx;
  processor!: PspPaymentProcessor;
  lookup!: PspTopupLookup;
  registry!: PspAdapterRegistry;
  store!: FakePspSecretStore;
  /** Configuration `ACTIVE` par moyen (événement A). */
  configs!: Record<Method, string>;
  holderId!: string;
  seq = 0;

  static async create(): Promise<PspWorld> {
    const pw = new PspWorld();
    pw.sw = await SessionWorld.create();
    const app = pw.sw.api.app;
    pw.tx = app.get(TenantTx, { strict: false });
    pw.processor = app.get(PspPaymentProcessor, { strict: false });
    pw.lookup = app.get(PspTopupLookup, { strict: false });
    pw.registry = app.get<PspAdapterRegistry>(PSP_ADAPTERS, { strict: false });
    pw.store = app.get<FakePspSecretStore>(PSP_SECRET_STORE, { strict: false });
    await pw.seedConfigurations();
    return pw;
  }

  get w() {
    return this.sw.w;
  }
  get op() {
    return this.sw.w.ops.a;
  }
  get ev(): WorldEvent {
    return this.sw.a;
  }
  adapter(method: Method): FakePspAdapter {
    return this.registry.forProvider(PROVIDER_OF[method]) as FakePspAdapter;
  }
  close(): Promise<void> {
    return this.sw.close();
  }

  // ----- amorçage

  private async seedConfigurations(): Promise<void> {
    const w = this.w;
    this.configs = { WAVE: '', ORANGE_MONEY: '', CARD: '' };
    await withOwner(async (db) => {
      const holder = await db.query<{ id: string }>(
        'SELECT funds_holder_id AS id FROM ledger WHERE id = $1',
        [this.ev.ledgerId],
      );
      this.holderId = holder.rows[0]!.id;
      for (const method of ['WAVE', 'ORANGE_MONEY', 'CARD'] as const) {
        const ref = `psp/${this.holderId}/test-${method.toLowerCase()}-${randomUUID().slice(0, 8)}`;
        const row = await db.query<{ id: string }>(
          `INSERT INTO psp_configuration (operator_id, organizer_id, method, provider, holder_party_id,
                  secret_ref, compliance_ref, status, is_default, valid_from, created_by, approved_by,
                  activated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'KYB-TEST', 'ACTIVE', true, '2026-01-01', $7, $8, now())
           RETURNING psp_configuration_id AS id`,
          [
            w.ops.a,
            w.ids.organizerA,
            method,
            PROVIDER_OF[method],
            this.holderId,
            ref,
            w.operatorAdminA.userId,
            w.organizerAdminA.userId,
          ],
        );
        this.configs[method] = row.rows[0]!.id;
        this.store.put(ref, {
          current: `test-secret-${randomUUID()}`,
          adapter: 'test-adapter-key',
        });
        await db.query(
          `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose,
                                 basis, rate_bps, trigger, valid_from)
           VALUES ($1, 'PSP_CONFIGURATION', $2, 'ORG_FPSP', 'PSP_FRAIS', 'TOPUP_AMOUNT', 150,
                   'REALTIME', '2026-01-01')`,
          [w.ops.a, this.configs[method]],
        );
      }
    });
  }

  customer(): Promise<TestCustomer> {
    return withOwner((db) => createTestCustomer(db, this.op));
  }

  /** Portefeuille d'un festivalier (neuf par défaut), `ACTIVE` ou `BLOCKED`, de l'événement A. */
  async wallet(
    options: {
      customer?: TestCustomer;
      status?: 'ACTIVE' | 'BLOCKED';
      funds?: number;
      ledgerId?: string;
    } = {},
  ): Promise<{ walletId: string; customer: TestCustomer }> {
    const customer = options.customer ?? (await this.customer());
    const { walletId } = await withOwner((db) =>
      createCustomerWallet(db, {
        operatorId: this.op,
        ledgerId: options.ledgerId ?? this.ev.ledgerId,
        customerId: customer.customerId,
        status: options.status,
        funds: options.funds,
      }),
    );
    return { walletId, customer };
  }

  // ----- recharges et notifications

  /** Recharge `PENDING` créée par la fonction de la base (comme la demande), demandeur festivalier. */
  async topup(spec: TopupSpec = {}): Promise<MadeTopup> {
    const wallet = spec.wallet ?? (await this.wallet());
    const method = spec.method ?? 'WAVE';
    const id = randomUUID();
    await this.tx.run(this.op, (client) =>
      client.query('SELECT * FROM create_psp_topup($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        id,
        wallet.walletId,
        method,
        String(spec.amount ?? 10000),
        'CUSTOMER',
        null,
        null,
        wallet.customer.customerId,
        new Date(Date.now() + 3_600_000),
      ]),
    );
    const row = await this.read(id);
    return { row: row!, customer: wallet.customer, walletId: wallet.walletId };
  }

  read(topupId: string): Promise<PspTopupRow | null> {
    return this.tx.run(this.op, (client) => this.lookup.find(client, topupId));
  }

  /** Notification normalisée construite à la main (référence marchande = identifiant de la recharge). */
  notification(
    topup: PspTopupRow,
    over: {
      kind?: NormalizedNotification['kind'];
      paymentRef?: string;
      merchantRef?: string | null;
      amount?: bigint;
      currency?: string;
      card?: NormalizedCard | null;
      notificationId?: string;
    } = {},
  ): NormalizedNotification {
    this.seq += 1;
    return {
      notificationId: over.notificationId ?? `n-${this.seq}-${randomUUID().slice(0, 6)}`,
      kind: over.kind ?? 'PAYMENT_SUCCEEDED',
      payment: {
        merchantReference: over.merchantRef === undefined ? topup.topupId : over.merchantRef,
        providerPaymentRef: over.paymentRef ?? `pay-${topup.topupId.slice(0, 8)}`,
        amount: over.amount ?? topup.amount,
        currency: over.currency ?? topup.currency,
        card:
          over.card === undefined
            ? topup.method === 'CARD'
              ? { fingerprint: `fp-${topup.walletId.slice(0, 8)}`, threeDs: 'SUCCEEDED' }
              : null
            : over.card,
      },
      dispute: null,
    };
  }

  input(
    topup: PspTopupRow,
    notification: NormalizedNotification,
    over: Partial<PaymentInput> = {},
  ): PaymentInput {
    return {
      configurationId: topup.configurationId,
      origin: 'NOTIFICATION',
      receivedAt: new Date(),
      pspEventId: null,
      notification,
      ...over,
    };
  }

  /** `process` dans sa propre transaction (comme le fera WP12). */
  run(input: PaymentInput): Promise<PaymentOutcome> {
    return this.tx.run(this.op, (client) => this.processor.process(client, input));
  }

  /** Notification de succès (montant et référence de la recharge par défaut), traitée. */
  pay(
    topup: PspTopupRow,
    over: Parameters<PspWorld['notification']>[1] = {},
    input: Partial<PaymentInput> = {},
  ): Promise<PaymentOutcome> {
    return this.run(this.input(topup, this.notification(topup, over), input));
  }

  // ----- requêtes HTTP

  /** Requête du terminal (trois preuves) avec la personne dans `X-Staff-Authorization`. */
  desk(
    t: TestTerminal,
    method: 'GET' | 'POST',
    path: string,
    staff: TestPerson | null,
    body?: unknown,
    key?: string,
  ): Promise<TerminalResponse> {
    return this.sw.term(t, method, path, staff, body, key);
  }

  /** Requête d'un festivalier (en-têtes du faux fournisseur), clé UUID. */
  cust(
    who: TestCustomer,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    key: string | null = method === 'POST' ? randomUUID() : null,
    extra: Record<string, string> = {},
  ): Promise<TerminalResponse> {
    const payload = method === 'POST' ? JSON.stringify(body ?? {}) : '';
    return send(
      {
        url: new URL(`${this.sw.api.baseUrl}${path}`),
        method,
        headers: {
          ...who.headers,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...(key !== null ? { 'idempotency-key': key } : {}),
          ...extra,
        },
        body: payload,
        cert: null,
        key: null,
      },
      this.sw.api.tls.serverCaPem,
    );
  }

  /** Corps valide d'une demande. */
  body(walletId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return { wallet_id: walletId, amount: 10000, currency: 'XOF', provider: 'WAVE', ...over };
  }

  // ----- lectures en base

  transactions(topupId: string) {
    return ownerRows<{ id: string; idempotency_key: string; type: string }>(
      `SELECT id, idempotency_key, type FROM journal_transaction
        WHERE metadata->>'psp_topup_id' = $1`,
      [topupId],
    );
  }

  anomalies(kind: string) {
    return ownerRows<{ id: string; amount: string; kind: string }>(
      `SELECT id, amount::text, kind FROM anomaly WHERE ledger_id = $1 AND kind = $2
        ORDER BY created_at`,
      [this.ev.ledgerId, kind],
    );
  }

  /** Solde payé d'un portefeuille (somme des lignes, crédit positif). */
  paidBalance(walletId: string): Promise<number> {
    return ownerRows<{ b: string }>(
      `SELECT coalesce(-sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id
        WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PAID'`,
      [walletId],
    ).then((r) => Number(r[0]!.b));
  }

  count(sql: string, params: unknown[] = []): Promise<number> {
    return ownerRows<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, params).then(
      (r) => r[0]!.n,
    );
  }
}
