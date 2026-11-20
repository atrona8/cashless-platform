// Traduction des issues du processus `vendor-pin` par l'API (mission 5b, lot WP09, T041 ; mission
// 11a, lot WP07) : l'API n'ouvre plus la session ni ne compte l'essai, elle traduit l'issue rendue
// par le client. Doublure du CLIENT seulement (test unitaire) : la preuve contre le vrai processus
// est dans `test/integration/vendors/vendor-sessions.spec.ts`.
import type { AuditService } from '../../../src/audit/audit.service';
import type { TenantTx } from '../../../src/db/tenant-tx';
import type { IdempotentTx } from '../../../src/idempotency/idempotent.decorator';
import type { DeviceContext } from '../../../src/device-identity/device-identity.port';
import { ProblemException } from '../../../src/errors/problem';
import type {
  VendorPinClient,
  VendorPinOpenCall,
  VendorPinOpenResult,
} from '../../../src/vendors/vendor-pin.client';
import { VendorSessionsService } from '../../../src/vendors/vendor-sessions.service';

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
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const AUDIT = { actorId: null, actorRole: null, origin: 'device:x', requestId: REQUEST_ID };
const SESSION = {
  vendor_session_id: '55555555-5555-4555-8555-555555555555',
  vendor_id: VENDOR,
  vendor_display_name: 'Awa',
  expires_at: '2026-11-19T20:00:00.000Z',
};

function harness(result: VendorPinOpenResult | Error) {
  const calls: VendorPinOpenCall[] = [];
  const client = {
    open: async (call: VendorPinOpenCall) => {
      calls.push(call);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as VendorPinClient;
  // Rien d'autre que le client ne doit être touché par `open` : base et audit lèvent s'ils le sont.
  const forbidden = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('touché par open()');
      },
    },
  );
  const service = new VendorSessionsService(
    forbidden as unknown as TenantTx,
    client,
    forbidden as unknown as AuditService,
  );
  // Transaction idempotente : ne sert qu'à enregistrer le refus de rejeu ; comptée pour prouver
  // qu'elle n'est ouverte qu'après une session ouverte.
  const tx = { runs: 0, run: async (fn: () => Promise<unknown>) => (tx.runs++, fn()) };
  return { service, calls, tx: tx as unknown as IdempotentTx & { runs: number } };
}

async function outcome(h: ReturnType<typeof harness>): Promise<unknown> {
  try {
    return await h.service.open(DEVICE, { vendorId: VENDOR, pin: '123456' }, h.tx, AUDIT);
  } catch (caught) {
    return caught;
  }
}

const problem = (value: unknown) =>
  value instanceof ProblemException ? [value.status, value.code, value.headers] : value;

describe('ouverture de session : traduction des issues du processus', () => {
  it('ouverte : la session du processus, appelée avec le terminal, le prestataire et le requestId', async () => {
    const h = harness({ kind: 'opened', session: SESSION });
    expect(await outcome(h)).toEqual(SESSION);
    expect(h.tx.runs).toBe(1);
    expect(h.calls).toEqual([
      {
        operatorId: DEVICE.operatorId,
        deviceId: DEVICE.deviceId,
        vendorId: VENDOR,
        pin: '123456',
        requestId: REQUEST_ID,
      },
    ]);
  });

  it('refusée : 401 VENDOR_PIN_INVALID, sans détail', async () => {
    const h = harness({ kind: 'refused' });
    expect(problem(await outcome(h))).toEqual([401, 'VENDOR_PIN_INVALID', undefined]);
    expect(h.tx.runs).toBe(0);
  });

  it('essai simultané : 429 RATE_LIMITED + Retry-After 1, jamais 500', async () => {
    expect(problem(await outcome(harness({ kind: 'concurrent' })))).toEqual([
      429,
      'RATE_LIMITED',
      { 'Retry-After': '1' },
    ]);
  });

  it('erreur de service du client : relancée telle quelle, aucune session (pas de repli)', async () => {
    const down = new ProblemException('INTERNAL_ERROR');
    expect(await outcome(harness(down))).toBe(down);
  });
});
