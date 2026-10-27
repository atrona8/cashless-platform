// Festivalier de test (mission bracelets-nfc) : une partie `CUSTOMER` réelle et les en-têtes que lit le faux
// fournisseur d'identité.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import {
  TEST_CUSTOMER_DEVICE_HEADER,
  TEST_CUSTOMER_HEADER,
  TEST_CUSTOMER_OPERATOR_HEADER,
} from '../../src/customer-identity/fake-customer-identity';

export interface TestCustomer {
  customerId: string;
  operatorId: string;
  headers: Record<string, string>;
  /** Mêmes en-têtes, depuis un autre appareil. */
  onDevice(deviceRef: string): Record<string, string>;
}

/** À appeler avec une connexion propriétaire (`withOwner`). */
export async function createTestCustomer(
  db: Client,
  operatorId: string,
  deviceRef = `app-${randomUUID().slice(0, 8)}`,
): Promise<TestCustomer> {
  const customerId = randomUUID();
  await db.query(
    "INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'CUSTOMER', $2, $3)",
    [customerId, operatorId, `Festivalier ${customerId.slice(0, 8)}`],
  );
  const headers = (ref: string) => ({
    [TEST_CUSTOMER_HEADER]: customerId,
    [TEST_CUSTOMER_OPERATOR_HEADER]: operatorId,
    [TEST_CUSTOMER_DEVICE_HEADER]: ref,
  });
  return { customerId, operatorId, headers: headers(deviceRef), onDevice: headers };
}

export interface CustomerWallet {
  walletId: string;
}

/**
 * Portefeuille rattaché au festivalier de test (mission 5b, lot WP13) : propriétaire, AMORÇAGE seulement. Crée le
 * portefeuille (`ACTIVE` par défaut) avec ses deux comptes (payé, offert), comme la route d'activation, puis le
 * crédite de `funds` (payé) par `post_transaction` quand `funds > 0`.
 */
export async function createCustomerWallet(
  db: Client,
  input: {
    operatorId: string;
    ledgerId: string;
    customerId: string;
    funds?: number;
    status?: 'ACTIVE' | 'BLOCKED';
  },
): Promise<CustomerWallet> {
  const walletId = randomUUID();
  await db.query(
    'INSERT INTO wallet (id, operator_id, ledger_id, customer_id, status) VALUES ($1, $2, $3, $4, $5)',
    [walletId, input.operatorId, input.ledgerId, input.customerId, input.status ?? 'ACTIVE'],
  );
  for (const [suffix, purpose] of [
    ['P', 'WALLET_PAID'],
    ['X', 'WALLET_PROMO'],
  ] as const)
    await db.query(
      `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
       VALUES ($1, $2, $3, 'CLAIM', $4, $5, 'C')`,
      [input.operatorId, input.ledgerId, `L-WAL-${walletId}-${suffix}`, purpose, walletId],
    );
  if ((input.funds ?? 0) > 0) {
    await db.query(`SELECT set_config('app.operator_id', $1, false)`, [input.operatorId]);
    await db.query(
      `SELECT post_transaction($1, 'TOPUP', $2, now(), 'PSP_WEBHOOK', jsonb_build_array(
         jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'BANK'), 'amount', $4::bigint),
         jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $3 AND purpose = 'WALLET_PAID'), 'amount', -$4::bigint)))`,
      [input.ledgerId, `test-topup:${randomUUID()}`, walletId, input.funds],
    );
  }
  return { walletId };
}
