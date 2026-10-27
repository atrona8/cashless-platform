// Issues de l'ouverture de session (mission 5b, lot WP09, T041), sur des doublures : quelles
// transactions s'ouvrent, quand l'empreinte factice sert, quelles lignes d'audit s'écrivent, et
// la traduction de l'unicité « une session ouverte par terminal » (relecture WP02, mineur 2 :
// jamais un 500).
import type { AuditService } from '../../../src/audit/audit.service';
import type { TenantTx, TxClient } from '../../../src/db/tenant-tx';
import type { DeviceContext } from '../../../src/device-identity/device-identity.port';
import { ProblemException } from '../../../src/errors/problem';
import type { IdempotentTx } from '../../../src/idempotency/idempotent.decorator';
import type { VendorPinHasher } from '../../../src/vendor-pin/vendor-pin.hasher';
import {
  OPEN_SESSION_INDEX,
  VendorSessionsService,
} from '../../../src/vendors/vendor-sessions.service';

const DEVICE: DeviceContext = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  operatorId: '22222222-2222-4222-8222-222222222222',
  eventId: null,
  posId: null,
  agreementPublicKey: null,
  appMode: 'CATALOG_POS',
  merchantId: '33333333-3333-4333-8333-333333333333',
};
const VENDOR = '44444444-4444-4444-8444-444444444444';
const AUDIT = { actorId: null, actorRole: null, origin: 'device:x', requestId: null };
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

interface Harness {
  service: VendorSessionsService;
  verified: Array<string | null>;
  actions: string[];
  bRuns: number;
}

function harness(options: {
  check: { check_id: string; pin_hash: string; locked: boolean } | null;
  matches: boolean;
  bError?: unknown;
}): Harness {
  const h = { verified: [] as Array<string | null>, actions: [] as string[], bRuns: 0 };
  const client = (rows: unknown[]): TxClient =>
    ({ query: async () => ({ rows }) }) as unknown as TxClient;
  const tenantTx = {
    run: async <T>(_op: string, fn: (c: TxClient) => Promise<T>) =>
      fn(client(options.check ? [options.check] : [])),
  } as unknown as TenantTx;
  const hasher = {
    verify: async (hash: string | null) => {
      h.verified.push(hash);
      return options.matches;
    },
  } as unknown as VendorPinHasher;
  const audit = {
    record: async (_c: TxClient, entry: { action: string }) => {
      h.actions.push(entry.action);
    },
  } as unknown as AuditService;
  const service = new VendorSessionsService(tenantTx, hasher, audit);
  return Object.assign(h, { service });
}

const tx = (h: { bRuns: number }, error?: unknown): IdempotentTx => ({
  run: async <T>(fn: (c: TxClient) => Promise<T>): Promise<T> => {
    h.bRuns += 1;
    if (error) throw error;
    const row = {
      vendor_session_id: '55555555-5555-4555-8555-555555555555',
      vendor_id: VENDOR,
      vendor_display_name: 'Awa',
      expires_at: new Date(),
    };
    return fn({ query: async () => ({ rows: [row] }) } as unknown as TxClient);
  },
});

async function outcome(h: Harness, error?: unknown): Promise<unknown> {
  try {
    return await h.service.open(DEVICE, { vendorId: VENDOR, pin: '123456' }, tx(h, error), AUDIT);
  } catch (caught) {
    return caught;
  }
}

const problem = (value: unknown) =>
  value instanceof ProblemException ? [value.status, value.code, value.headers] : value;

describe('ouverture de session : issues', () => {
  it('bon PIN : B ouvre la session, audit VENDOR_SESSION_OPENED seul', async () => {
    const h = harness({ check: { check_id: 'c', pin_hash: HASH, locked: false }, matches: true });
    const result = (await outcome(h)) as { vendor_id: string };
    expect(result.vendor_id).toBe(VENDOR);
    expect(h.verified).toEqual([HASH]);
    expect(h.actions).toEqual(['VENDOR_SESSION_OPENED']);
  });

  it('A ne rend rien (vendeur inconnu…) : empreinte factice, ni B ni audit, 401', async () => {
    const h = harness({ check: null, matches: false });
    expect(problem(await outcome(h))).toEqual([401, 'VENDOR_PIN_INVALID', undefined]);
    expect(h.verified).toEqual([null]);
    expect(h.bRuns).toBe(0);
    expect(h.actions).toEqual([]);
  });

  it('PIN faux, essai compté : audit VENDOR_PIN_FAILED, 401', async () => {
    const h = harness({ check: { check_id: 'c', pin_hash: HASH, locked: false }, matches: false });
    expect(problem(await outcome(h))).toEqual([401, 'VENDOR_PIN_INVALID', undefined]);
    expect(h.bRuns).toBe(0);
    expect(h.actions).toEqual(['VENDOR_PIN_FAILED']);
  });

  it('5e essai avec le bon PIN : bloqué par A, B jamais appelée, VENDOR_LOCKED audité', async () => {
    const h = harness({ check: { check_id: 'c', pin_hash: HASH, locked: true }, matches: true });
    expect(problem(await outcome(h))).toEqual([401, 'VENDOR_PIN_INVALID', undefined]);
    expect(h.bRuns).toBe(0);
    expect(h.actions).toEqual(['VENDOR_PIN_FAILED', 'VENDOR_LOCKED']);
  });

  it('B refusée par la base (CL033) : 401, même corps, essai audité', async () => {
    const h = harness({ check: { check_id: 'c', pin_hash: HASH, locked: false }, matches: true });
    const refused = Object.assign(new Error('Ouverture de session refusée'), { code: 'CL033' });
    expect(problem(await outcome(h, refused))).toEqual([401, 'VENDOR_PIN_INVALID', undefined]);
    expect(h.actions).toEqual(['VENDOR_PIN_FAILED']);
  });

  it('23505 sur une session ouverte du terminal : 429 RATE_LIMITED, jamais 500', async () => {
    const h = harness({ check: { check_id: 'c', pin_hash: HASH, locked: false }, matches: true });
    const unique = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: OPEN_SESSION_INDEX,
    });
    expect(problem(await outcome(h, unique))).toEqual([
      429,
      'RATE_LIMITED',
      { 'Retry-After': '1' },
    ]);
    expect(h.actions).toEqual(['VENDOR_PIN_FAILED']);
  });

  it('autre erreur de B : relancée telle quelle (500, clé relâchée par l’intercepteur)', async () => {
    const h = harness({ check: { check_id: 'c', pin_hash: HASH, locked: false }, matches: true });
    const other = Object.assign(new Error('autre'), { code: '23505', constraint: 'autre' });
    expect(await outcome(h, other)).toBe(other);
    expect(h.actions).toEqual([]);
  });
});
