// FAUX fournisseur d'identité du festivalier : croit les en-têtes `X-Test-Customer-Id`, `X-Test-Operator-Id` et
// `X-Test-Customer-Device`. N'importe qui peut donc se dire festivalier : JAMAIS en production.
import type { Request } from 'express';
import type { CustomerClaims, CustomerIdentityPort } from './customer-identity.port';

export const TEST_CUSTOMER_HEADER = 'x-test-customer-id';
export const TEST_CUSTOMER_OPERATOR_HEADER = 'x-test-operator-id';
export const TEST_CUSTOMER_DEVICE_HEADER = 'x-test-customer-device';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_REF = /^[A-Za-z0-9._:-]{1,100}$/;

export class FakeCustomerIdentity implements CustomerIdentityPort {
  readonly isFake = true;

  async identify(req: Request): Promise<CustomerClaims | null> {
    const customerId = req.header(TEST_CUSTOMER_HEADER);
    const operatorId = req.header(TEST_CUSTOMER_OPERATOR_HEADER);
    const deviceRef = req.header(TEST_CUSTOMER_DEVICE_HEADER) ?? 'appareil-inconnu';
    if (
      !customerId ||
      !operatorId ||
      !UUID.test(customerId) ||
      !UUID.test(operatorId) ||
      !DEVICE_REF.test(deviceRef)
    )
      return null;
    return {
      customerId: customerId.toLowerCase(),
      operatorId: operatorId.toLowerCase(),
      deviceRef,
    };
  }
}
