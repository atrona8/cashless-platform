// Unitaires : qui peut attribuer quoi (contracts/identity.md « Attribution des rôles ») — table de vérité de
// canGrant, compatibilité rôle ↔ portée, rôles non attribuables.
import type { Assignment, Principal } from '../../../src/identity/principal';
import type { ScopeLink } from '../../../src/identity/scope-resolver';
import { canGrant, grantTarget, staffAdminRole, type GrantableRole } from '../../../src/identity/users/role-rules';

const OP = 'op-1';
const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const EVT = 'evt-1';
const MER = 'mer-1';

const person = (...assignments: Assignment[]): Principal => ({
  userId: 'granter',
  operatorId: OP,
  assignments,
  issuer: 'https://idp.test',
  subject: 's',
});
const platformAdmin = person({ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM', scopeId: null });
const operatorAdmin = person({ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: OP });
const organizerAdmin = person({ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ORG });
const otherOrganizerAdmin = person({ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: OTHER_ORG });
const supervisor = person({ role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: ORG });

const PLATFORM: ScopeLink = { scope: { type: 'PLATFORM' } };
const chains: Record<'operator' | 'organizer' | 'event' | 'merchant', ScopeLink[]> = {
  operator: [{ scope: { type: 'OPERATOR', id: OP } }, PLATFORM],
  organizer: [{ scope: { type: 'ORGANIZER', id: ORG } }, { scope: { type: 'OPERATOR', id: OP } }, PLATFORM],
  event: [
    { scope: { type: 'EVENT', id: EVT } },
    { scope: { type: 'ORGANIZER', id: ORG } },
    { scope: { type: 'OPERATOR', id: OP } },
    PLATFORM,
  ],
  // Commerçant qui participe à un événement de ORG.
  merchant: [
    { scope: { type: 'MERCHANT', id: MER } },
    { scope: { type: 'EVENT', id: EVT }, viaParticipation: true },
    { scope: { type: 'ORGANIZER', id: ORG }, viaParticipation: true },
    { scope: { type: 'OPERATOR', id: OP } },
    PLATFORM,
  ],
};

/** Portée naturelle de chaque rôle attribuable dans cette table. */
const target: Record<GrantableRole, ScopeLink[]> = {
  OPERATOR_ADMIN: chains.operator,
  ORGANIZER_ADMIN: chains.organizer,
  SUPERVISOR: chains.event,
  CASHIER: chains.event,
  MERCHANT_ADMIN: chains.merchant,
};

// Table de vérité du contrat : attribuant → rôles attribuables.
const TRUTH: Array<[string, Principal, Record<GrantableRole, boolean>]> = [
  ['PLATFORM_ADMIN', platformAdmin, { OPERATOR_ADMIN: true, ORGANIZER_ADMIN: false, SUPERVISOR: false, CASHIER: false, MERCHANT_ADMIN: false }],
  ['OPERATOR_ADMIN', operatorAdmin, { OPERATOR_ADMIN: true, ORGANIZER_ADMIN: true, SUPERVISOR: true, CASHIER: true, MERCHANT_ADMIN: true }],
  ['ORGANIZER_ADMIN', organizerAdmin, { OPERATOR_ADMIN: false, ORGANIZER_ADMIN: false, SUPERVISOR: true, CASHIER: true, MERCHANT_ADMIN: true }],
  ['ORGANIZER_ADMIN (autre organisateur)', otherOrganizerAdmin, { OPERATOR_ADMIN: false, ORGANIZER_ADMIN: false, SUPERVISOR: false, CASHIER: false, MERCHANT_ADMIN: false }],
  ['SUPERVISOR', supervisor, { OPERATOR_ADMIN: false, ORGANIZER_ADMIN: false, SUPERVISOR: false, CASHIER: false, MERCHANT_ADMIN: false }],
];

describe('canGrant : table de vérité', () => {
  for (const [label, granter, expected] of TRUTH) {
    for (const role of Object.keys(expected) as GrantableRole[]) {
      it(`${label} → ${role} : ${expected[role] ? 'permis' : 'refusé'}`, () => {
        expect(canGrant(granter, role, target[role]) !== undefined).toBe(expected[role]);
      });
    }
  }

  it('ORGANIZER_ADMIN : SUPERVISOR sur tout son organisateur aussi', () => {
    expect(canGrant(organizerAdmin, 'SUPERVISOR', chains.organizer)).toBe('ORGANIZER_ADMIN');
  });

  it('ORGANIZER_ADMIN : MERCHANT_ADMIN refusé pour un commerçant sans participation à ses événements', () => {
    const notParticipating: ScopeLink[] = [{ scope: { type: 'MERCHANT', id: MER } }, { scope: { type: 'OPERATOR', id: OP } }, PLATFORM];
    expect(canGrant(organizerAdmin, 'MERCHANT_ADMIN', notParticipating)).toBeUndefined();
  });

  it('OPERATOR_ADMIN d’un autre prestataire : refusé', () => {
    const foreign = person({ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: 'op-2' });
    expect(canGrant(foreign, 'CASHIER', chains.event)).toBeUndefined();
  });

  it('rôle exercé rendu : le plus spécifique qui autorise', () => {
    const both = person(
      { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: OP },
      { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ORG },
    );
    expect(canGrant(both, 'ORGANIZER_ADMIN', chains.organizer)).toBe('OPERATOR_ADMIN');
    expect(canGrant(both, 'CASHIER', chains.event)).toBe('OPERATOR_ADMIN');
  });
});

describe('grantTarget : rôle et portée', () => {
  it.each([
    ['OPERATOR_ADMIN', 'OPERATOR'],
    ['ORGANIZER_ADMIN', 'ORGANIZER'],
    ['SUPERVISOR', 'ORGANIZER'],
    ['SUPERVISOR', 'EVENT'],
    ['CASHIER', 'EVENT'],
    ['MERCHANT_ADMIN', 'MERCHANT'],
  ])('%s sur %s : accepté', (role, scope) => {
    expect(grantTarget(role, scope, 'x')).toEqual({ role, type: scope, id: 'x' });
  });

  it.each([
    ['CASHIER', 'MERCHANT'],
    ['OPERATOR_ADMIN', 'ORGANIZER'],
    ['MERCHANT_ADMIN', 'EVENT'],
    ['ORGANIZER_ADMIN', 'PLATFORM'],
  ])('%s sur %s : 422', (role, scope) => {
    expect(() => grantTarget(role, scope, 'x')).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED', status: 422 }));
  });

  it.each(['VENDOR', 'CUSTOMER', 'PLATFORM_ADMIN'])('%s : non attribuable ici (422)', (role) => {
    expect(() => grantTarget(role, 'OPERATOR', 'x')).toThrow(expect.objectContaining({ status: 422 }));
  });

  it('portée sans objet : 422', () => {
    expect(() => grantTarget('CASHIER', 'EVENT', null)).toThrow(expect.objectContaining({ status: 422 }));
  });
});

describe('staffAdminRole', () => {
  it('rôle le plus large tenu parmi ceux permis', () => {
    expect(staffAdminRole(platformAdmin)).toBe('PLATFORM_ADMIN');
    expect(staffAdminRole(organizerAdmin)).toBe('ORGANIZER_ADMIN');
    expect(() => staffAdminRole(organizerAdmin, ['PLATFORM_ADMIN', 'OPERATOR_ADMIN'])).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => staffAdminRole(supervisor)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
