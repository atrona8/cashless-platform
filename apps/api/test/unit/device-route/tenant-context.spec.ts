// Prestataire d'une route de terminal seul (mission 5b, lot WP08, T035 ; R-03) : celui du terminal
// posé par `DeviceGuard`, jamais d'une autre source ; chemin `/operators/:operator_id/…` → 404 ;
// guichet (personne ET terminal) inchangé.
import type { Request } from 'express';
import { ProblemException } from '../../../src/errors/problem';
import { IdentityTenantContext } from '../../../src/identity/identity-tenant-context';

const OP_DEVICE = '00000000-0000-0000-0000-00000000a001';
const OP_PERSON = '00000000-0000-0000-0000-00000000a002';
const OP_OTHER = '00000000-0000-0000-0000-00000000a003';

const device = {
  deviceId: '00000000-0000-0000-0000-00000000d001',
  operatorId: OP_DEVICE,
  eventId: '00000000-0000-0000-0000-00000000e001',
  posId: null,
};
const principal = { userId: 'u', operatorId: OP_PERSON, assignments: [] };

function req(parts: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return {
    params: {},
    body: {},
    header: (name: string) => headers[name.toLowerCase()],
    ...parts,
  } as unknown as Request;
}

function outcome(r: Request): string {
  try {
    return new IdentityTenantContext().current(r).operatorId;
  } catch (error) {
    return error instanceof ProblemException ? `${error.status} ${error.code}` : String(error);
  }
}

describe('IdentityTenantContext : route de terminal seul (T035)', () => {
  it('terminal seul : prestataire du terminal', () => {
    expect(outcome(req({ device }))).toBe(OP_DEVICE);
  });

  it('terminal seul sur un chemin /operators/:operator_id/… → 404, même son propre prestataire', () => {
    expect(outcome(req({ device, params: { operator_id: OP_OTHER } }))).toBe('404 NOT_FOUND');
    expect(outcome(req({ device, params: { operator_id: OP_DEVICE } }))).toBe('404 NOT_FOUND');
  });

  it('aucune autre source ne décide : en-têtes et corps ignorés', () => {
    const r = req(
      { device, body: { operator_id: OP_OTHER, operatorId: OP_OTHER } },
      { 'x-operator-id': OP_OTHER, 'x-test-operator-id': OP_OTHER },
    );
    expect(outcome(r)).toBe(OP_DEVICE);
  });

  it('guichet (personne ET terminal) : chemin de la personne, inchangé', () => {
    expect(outcome(req({ device, principal }))).toBe(OP_PERSON);
    expect(outcome(req({ device, principal, params: { operator_id: OP_OTHER } }))).toBe(
      '404 NOT_FOUND',
    );
  });

  it('pas de repli : une route de personne sans terminal posé ni personne → 401', () => {
    // Une route de personne sans `@DeviceAuth` ne voit jamais `req.device` (seule `DeviceGuard` le
    // pose) ; les en-têtes du faux terminal ne suffisent pas.
    const r = req({}, { 'x-test-device-id': device.deviceId, 'x-test-operator-id': OP_DEVICE });
    expect(outcome(r)).toBe('401 UNAUTHENTICATED');
  });

  it('festivalier seul : inchangé', () => {
    expect(outcome(req({ customer: { customerId: 'c', operatorId: OP_OTHER } }))).toBe(OP_OTHER);
  });
});
