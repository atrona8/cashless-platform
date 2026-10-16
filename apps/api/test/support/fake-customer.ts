// Festivalier de test (mission bracelets-nfc) : une partie `CUSTOMER` réelle et les en-têtes que lit le faux
// fournisseur d'identité.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { TEST_CUSTOMER_DEVICE_HEADER, TEST_CUSTOMER_HEADER, TEST_CUSTOMER_OPERATOR_HEADER } from '../../src/customer-identity/fake-customer-identity';

export interface TestCustomer {
  customerId: string;
  operatorId: string;
  headers: Record<string, string>;
  /** Mêmes en-têtes, depuis un autre appareil. */
  onDevice(deviceRef: string): Record<string, string>;
}

/** À appeler avec une connexion propriétaire (`withOwner`). */
export async function createTestCustomer(db: Client, operatorId: string, deviceRef = `app-${randomUUID().slice(0, 8)}`): Promise<TestCustomer> {
  const customerId = randomUUID();
  await db.query("INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'CUSTOMER', $2, $3)", [customerId, operatorId, `Festivalier ${customerId.slice(0, 8)}`]);
  const headers = (ref: string) => ({ [TEST_CUSTOMER_HEADER]: customerId, [TEST_CUSTOMER_OPERATOR_HEADER]: operatorId, [TEST_CUSTOMER_DEVICE_HEADER]: ref });
  return { customerId, operatorId, headers: headers(deviceRef), onDevice: headers };
}
