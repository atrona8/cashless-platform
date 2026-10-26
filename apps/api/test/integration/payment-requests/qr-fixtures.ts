// Jeu d'essai des demandes de paiement QR (mission 5b, lot WP13) : le monde des paiements de WP11 (terminaux
// enrôlés, session de vendeur ouverte par la route, catalogue) plus des festivaliers (faux fournisseur
// d'identité, en-têtes de test) dont les portefeuilles sont crédités. Toute demande, tout paiement et toute
// annulation passent par la ROUTE ; les écritures directes (amorçage, recul d'`expires_at`, blocage d'un
// portefeuille) sont réservées au propriétaire.
import { randomUUID } from 'node:crypto';
import { createCustomerWallet } from '../../support/fake-customer';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { send, type TerminalResponse } from '../../support/test-terminal';
import { PaymentWorld, type PayTerminal } from '../payments/payments-fixtures';

export interface QrCustomer {
  customer: TestCustomer;
  walletId: string;
}

export interface Created {
  status: number;
  body: Record<string, unknown>;
  id: string;
  token: string;
}

export class QrWorld {
  constructor(readonly pw: PaymentWorld) {}

  static async create(): Promise<QrWorld> {
    return new QrWorld(await PaymentWorld.create());
  }

  close(): Promise<void> {
    return this.pw.close();
  }

  /** Festivalier neuf avec un portefeuille `ACTIVE` crédité de `funds` (payé). */
  customer(funds = 20_000, status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE'): Promise<QrCustomer> {
    return withOwner(async (db) => {
      const customer = await createTestCustomer(db, this.pw.w.ops.a);
      const { walletId } = await createCustomerWallet(db, {
        operatorId: this.pw.w.ops.a,
        ledgerId: this.pw.w.ids.ledgerA,
        customerId: customer.customerId,
        funds,
        status,
      });
      return { customer, walletId };
    });
  }

  /** Requête du festivalier (faux fournisseur d'identité) ; aucune preuve de terminal. */
  asCustomer(
    who: QrCustomer | TestCustomer | null,
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; key?: string | null; headers?: Record<string, string> } = {},
  ): Promise<TerminalResponse> {
    const identity = who === null ? {} : 'customer' in who ? who.customer.headers : who.headers;
    const body = options.body === undefined ? '' : JSON.stringify(options.body);
    return send(
      {
        url: new URL(`${this.pw.api.baseUrl}${path}`),
        method,
        headers: {
          'x-request-id': randomUUID(),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(method === 'POST' && options.key !== null
            ? { 'idempotency-key': options.key ?? randomUUID() }
            : {}),
          ...identity,
          ...options.headers,
        },
        body,
        cert: null,
        key: null,
      },
      this.pw.api.tls.serverCaPem,
    );
  }

  /** `POST /payment-requests` par le terminal (trois preuves). */
  async create(
    term: PayTerminal,
    body: Record<string, unknown> = this.keypad(term),
    key: string = term.t.seqKey(),
  ): Promise<Created> {
    const res = await term.t.request(this.pw.api.baseUrl, this.pw.api.tls.serverCaPem, {
      method: 'POST',
      path: '/payment-requests',
      body,
      idempotencyKey: key,
    });
    return {
      status: res.status,
      body: res.body,
      id: String(res.body.payment_request_id ?? ''),
      token: /#t=(.+)$/.exec(String(res.body.qr_payload ?? ''))?.[1] ?? '',
    };
  }

  keypad(term: PayTerminal, amount = 4000, extra: Record<string, unknown> = {}) {
    return {
      amount,
      currency: 'XOF',
      vendor_session_id: term.sessionId,
      ...extra,
    };
  }

  /** `POST /payment-requests/{id}/pay`. */
  pay(who: QrCustomer, id: string, token: string, key?: string): Promise<TerminalResponse> {
    return this.asCustomer(who, 'POST', `/payment-requests/${id}/pay`, {
      body: { token, wallet_id: who.walletId },
      key,
    });
  }

  /** Consultation / annulation par le terminal d'origine ou un autre (trois preuves). */
  byTerminal(
    term: PayTerminal,
    method: 'GET' | 'POST',
    id: string,
    suffix = '',
    key?: string,
  ): Promise<TerminalResponse> {
    return term.t.request(this.pw.api.baseUrl, this.pw.api.tls.serverCaPem, {
      method,
      path: `/payment-requests/${id}${suffix}`,
      ...(method === 'POST' ? { idempotencyKey: key ?? term.t.seqKey(), body: {} } : {}),
    });
  }

  /** Ligne de la demande lue par le propriétaire. */
  async row(id: string) {
    return (
      await ownerRows<{
        status: string;
        direction: string;
        wallet_id: string | null;
        transaction_id: string | null;
        nonce_hash: Buffer;
        amount: string | null;
        device_id: string | null;
      }>(
        'SELECT status, direction, wallet_id, transaction_id, nonce_hash, amount::text AS amount, device_id FROM payment_request WHERE id = $1',
        [id],
      )
    )[0]!;
  }

  /** Recule l'échéance d'une demande (propriétaire) : jamais l'horloge de Node contre `now()`. */
  expire(id: string): Promise<unknown> {
    return withOwner((db) =>
      db.query(
        `UPDATE payment_request SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
        [id],
      ),
    );
  }

  /** Nombre de ventes du portefeuille (écritures `PURCHASE`). */
  async sales(walletId: string): Promise<number> {
    return Number(
      (
        await ownerRows<{ n: number }>(
          `SELECT count(DISTINCT t.id)::int AS n FROM journal_transaction t JOIN posting p ON p.transaction_id = t.id
             JOIN account a ON a.id = p.account_id WHERE t.type = 'PURCHASE' AND a.wallet_id = $1`,
          [walletId],
        )
      )[0]!.n,
    );
  }
}

/** Corps d'un refus sans ce qui change d'un appel à l'autre (instance, identifiant de requête). */
export const stable = (body: Record<string, unknown>): string => {
  const { instance: _i, request_id: _r, ...rest } = body;
  return JSON.stringify(rest);
};
