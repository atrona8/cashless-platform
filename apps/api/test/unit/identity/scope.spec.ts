// Unitaires : chaînes de portées et englobement (contracts/identity.md « Rôles et portées », R-05). Chaque ligne du
// tableau d'englobement a un cas positif et un cas négatif (un englobement trop large = escalade de droits).
import type { TxClient } from '../../../src/db/tenant-tx';
import type { Assignment, Principal } from '../../../src/identity/principal';
import { exercisedRole, hasRole, PLATFORM_CHAIN, resolveChain, type ScopeLink } from '../../../src/identity/scope-resolver';

const OP = '00000000-0000-4000-8000-0000000000a1';
const OTHER_OP = '00000000-0000-4000-8000-0000000000a2';
const ORG = '00000000-0000-4000-8000-0000000000b1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b2';
const EVT = '00000000-0000-4000-8000-0000000000c1';
const OTHER_EVT = '00000000-0000-4000-8000-0000000000c2';
const MER = '00000000-0000-4000-8000-0000000000d1';
const OTHER_MER = '00000000-0000-4000-8000-0000000000d2';

const person = (...assignments: Assignment[]): Principal => ({
  userId: 'u',
  operatorId: OP,
  assignments,
  issuer: 'https://idp.test',
  subject: 's',
});
const on = (role: Assignment['role'], scopeType: Assignment['scopeType'], scopeId: string | null = null): Assignment => ({
  role,
  scopeType,
  scopeId,
});

/** Faux client : rend les lignes prévues selon la table interrogée (lectures sous RLS simulées). */
function fakeClient(rows: Record<'party' | 'event' | 'participation', Record<string, unknown>[]>): TxClient {
  const query = (sql: string, params: unknown[] = []) => {
    const id = params[0];
    const table = sql.includes('merchant_participation') ? 'participation' : sql.includes('FROM event') ? 'event' : 'party';
    const kind = params[1] ?? (sql.includes("'OPERATOR'") ? 'OPERATOR' : undefined);
    const found = rows[table].filter((row) =>
      table === 'participation' ? row.merchant_id === id : row.id === id && (table === 'event' || row.kind === kind),
    );
    return Promise.resolve({ rows: found });
  };
  return { query } as unknown as TxClient;
}

const db = fakeClient({
  party: [
    { id: OP, kind: 'OPERATOR', operator_id: null },
    { id: ORG, kind: 'ORGANIZER', operator_id: OP },
    { id: OTHER_ORG, kind: 'ORGANIZER', operator_id: OP },
    { id: MER, kind: 'MERCHANT', operator_id: OP },
    { id: OTHER_MER, kind: 'MERCHANT', operator_id: OP },
  ],
  event: [
    { id: EVT, organizer_id: ORG, operator_id: OP },
    { id: OTHER_EVT, organizer_id: OTHER_ORG, operator_id: OP },
  ],
  participation: [{ merchant_id: MER, event_id: EVT, organizer_id: ORG }],
});

describe('resolveChain', () => {
  it('plateforme : elle seule, sans lecture', async () => {
    await expect(resolveChain(fakeClient({ party: [], event: [], participation: [] }), { type: 'PLATFORM' })).resolves.toEqual(
      PLATFORM_CHAIN,
    );
  });

  it('événement → organisateur → prestataire → plateforme', async () => {
    const chain = await resolveChain(db, { type: 'EVENT', id: EVT });
    expect(chain.map((l) => l.scope)).toEqual([
      { type: 'EVENT', id: EVT },
      { type: 'ORGANIZER', id: ORG },
      { type: 'OPERATOR', id: OP },
      { type: 'PLATFORM' },
    ]);
  });

  it('commerçant → événements de participation (marqués) → prestataire → plateforme', async () => {
    const chain = await resolveChain(db, { type: 'MERCHANT', id: MER });
    expect(chain).toEqual([
      { scope: { type: 'MERCHANT', id: MER } },
      { scope: { type: 'EVENT', id: EVT }, viaParticipation: true },
      { scope: { type: 'ORGANIZER', id: ORG }, viaParticipation: true },
      { scope: { type: 'OPERATOR', id: OP } },
      { scope: { type: 'PLATFORM' } },
    ]);
  });

  it('objet introuvable sous RLS (autre prestataire) ou identifiant invalide : NOT_FOUND', async () => {
    await expect(resolveChain(db, { type: 'OPERATOR', id: OTHER_OP })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(resolveChain(db, { type: 'ORGANIZER', id: MER })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(resolveChain(db, { type: 'EVENT', id: 'pas-un-uuid' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('englobement des portées', () => {
  let chains: Record<'operator' | 'organizer' | 'event' | 'merchant', ScopeLink[]>;

  beforeAll(async () => {
    chains = {
      operator: await resolveChain(db, { type: 'OPERATOR', id: OP }),
      organizer: await resolveChain(db, { type: 'ORGANIZER', id: ORG }),
      event: await resolveChain(db, { type: 'EVENT', id: EVT }),
      merchant: await resolveChain(db, { type: 'MERCHANT', id: MER }),
    };
  });

  it('PLATFORM ⊃ OPERATOR : oui pour PLATFORM_ADMIN ; pas l’inverse', () => {
    expect(hasRole(person(on('PLATFORM_ADMIN', 'PLATFORM')), ['PLATFORM_ADMIN'], chains.operator)).toBe(true);
    expect(hasRole(person(on('OPERATOR_ADMIN', 'OPERATOR', OP)), ['OPERATOR_ADMIN', 'PLATFORM_ADMIN'], PLATFORM_CHAIN)).toBe(false);
  });

  it('OPERATOR ⊃ ORGANIZER : oui ; un administrateur d’organisateur ne couvre pas le prestataire', () => {
    expect(hasRole(person(on('OPERATOR_ADMIN', 'OPERATOR', OP)), ['OPERATOR_ADMIN'], chains.organizer)).toBe(true);
    expect(hasRole(person(on('OPERATOR_ADMIN', 'OPERATOR', OTHER_OP)), ['OPERATOR_ADMIN'], chains.organizer)).toBe(false);
    expect(hasRole(person(on('ORGANIZER_ADMIN', 'ORGANIZER', ORG)), ['ORGANIZER_ADMIN'], chains.operator)).toBe(false);
  });

  it('ORGANIZER ⊃ EVENT : oui pour son organisateur, non pour un autre ; un rôle d’événement ne couvre pas l’organisateur', () => {
    expect(hasRole(person(on('ORGANIZER_ADMIN', 'ORGANIZER', ORG)), ['ORGANIZER_ADMIN'], chains.event)).toBe(true);
    expect(hasRole(person(on('ORGANIZER_ADMIN', 'ORGANIZER', OTHER_ORG)), ['ORGANIZER_ADMIN'], chains.event)).toBe(false);
    expect(hasRole(person(on('SUPERVISOR', 'EVENT', EVT)), ['SUPERVISOR'], chains.organizer)).toBe(false);
    expect(hasRole(person(on('SUPERVISOR', 'ORGANIZER', ORG)), ['SUPERVISOR'], chains.event)).toBe(true);
  });

  it('OPERATOR ⊃ MERCHANT : oui ; MERCHANT_ADMIN seulement sur son commerçant', () => {
    expect(hasRole(person(on('OPERATOR_ADMIN', 'OPERATOR', OP)), ['OPERATOR_ADMIN'], chains.merchant)).toBe(true);
    expect(hasRole(person(on('MERCHANT_ADMIN', 'MERCHANT', MER)), ['MERCHANT_ADMIN'], chains.merchant)).toBe(true);
    expect(hasRole(person(on('MERCHANT_ADMIN', 'MERCHANT', OTHER_MER)), ['MERCHANT_ADMIN'], chains.merchant)).toBe(false);
    expect(hasRole(person(on('MERCHANT_ADMIN', 'MERCHANT', MER)), ['MERCHANT_ADMIN'], chains.operator)).toBe(false);
  });

  it('EVENT ⊃ MERCHANT (participation) : seulement si la route le déclare', () => {
    const organizerAdmin = person(on('ORGANIZER_ADMIN', 'ORGANIZER', ORG));
    expect(hasRole(organizerAdmin, ['ORGANIZER_ADMIN'], chains.merchant)).toBe(false);
    expect(hasRole(organizerAdmin, ['ORGANIZER_ADMIN'], chains.merchant, { participations: true })).toBe(true);
    const otherOrganizer = person(on('ORGANIZER_ADMIN', 'ORGANIZER', OTHER_ORG));
    expect(hasRole(otherOrganizer, ['ORGANIZER_ADMIN'], chains.merchant, { participations: true })).toBe(false);
    expect(hasRole(person(on('SUPERVISOR', 'EVENT', EVT)), ['SUPERVISOR'], chains.merchant, { participations: true })).toBe(true);
    expect(hasRole(person(on('SUPERVISOR', 'EVENT', OTHER_EVT)), ['SUPERVISOR'], chains.merchant, { participations: true })).toBe(
      false,
    );
  });

  it('rôle tenu mais non demandé par la route : refusé', () => {
    expect(hasRole(person(on('CASHIER', 'ORGANIZER', ORG)), ['SUPERVISOR', 'ORGANIZER_ADMIN'], chains.event)).toBe(false);
  });

  it('rôle exercé : le plus spécifique', () => {
    const both = person(on('OPERATOR_ADMIN', 'OPERATOR', OP), on('ORGANIZER_ADMIN', 'ORGANIZER', ORG));
    expect(exercisedRole(both, ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'], chains.event)).toBe('ORGANIZER_ADMIN');
    expect(exercisedRole(both, ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'], chains.operator)).toBe('OPERATOR_ADMIN');
  });
});
