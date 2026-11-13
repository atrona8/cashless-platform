// WP22, cycle 2 : conditions de R-20 de `StaffAuthorizer` testées SEULES, par appel direct (les
// mutants de la relecture : terminal, `OPEN`, `closed_at`, garde de route, HS256). Dans chaque
// cas toutes les autres conditions sont vraies : le refus ne peut venir que de la condition visée.
import { SignJWT } from 'jose';
import { createPublicKey } from 'node:crypto';
import { GatewayTx } from '../../src/db/gateway-tx';
import {
  StaffAuthorizer,
  StaffTokenRefused,
  type StaffPrincipal,
} from '../../src/staff/staff-token.guard';
import {
  AUDIENCE,
  ISSUER,
  epochSeconds,
  readyBench,
  type Bench,
  type TestDevice,
} from './_support/bench';

const HOUR = 3_600_000;
let bench: Bench;
let device: TestDevice;
let other: TestDevice;
let activatedAt: Date;
let sessionId: string;
let authorizer: StaffAuthorizer;
let gatewayTx: GatewayTx;

beforeAll(async () => {
  let session;
  ({ bench, device, activatedAt, session } = await readyBench({
    activatedAgoMs: 2 * HOUR,
    sessionOpenedAgoMs: HOUR,
  }));
  sessionId = session.id;
  other = await bench.newDevice();
  authorizer = bench.app.get(StaffAuthorizer);
  gatewayTx = new GatewayTx(bench.db.pool);
  (bench.clock as unknown as { now: () => Date }).now = () =>
    new Date(activatedAt.getTime() + HOUR);
}, 120_000);
afterAll(async () => bench.close());

const base = (): number => epochSeconds(activatedAt);
const expiredPrincipal = (): StaffPrincipal => ({
  claims: {
    issuer: ISSUER,
    subject: 'cashier-1',
    jti: 'jti-1',
    exp: base() + 1800,
    iat: base() - 1800,
  },
  expired: true,
});

async function condition(
  who: TestDevice,
  o: { route?: string; cited?: string | null } = {},
): Promise<number | 'accepted'> {
  try {
    await gatewayTx.run((tx) =>
      authorizer.authorize(tx, expiredPrincipal(), {
        device: { deviceId: who.deviceId, serial: who.serial } as never,
        route: o.route ?? 'createCashTopup',
        citedSessionId: o.cited === undefined ? sessionId : o.cited,
      }),
    );
    return 'accepted';
  } catch (error) {
    if (error instanceof StaffTokenRefused) return error.condition;
    throw error;
  }
}

describe('chaque condition de R-20 échoue SEULE (appel direct de authorize)', () => {
  it('référence : toutes les conditions vraies, accepté', async () => {
    expect(await condition(device)).toBe('accepted');
  });

  it('condition 3 : session du bon prêteur et de la bonne personne, autre terminal', async () => {
    expect(await condition(other)).toBe(3);
  });

  it('condition 4 : status différent de OPEN (closed_at nul, usable_on_edge vrai)', async () => {
    await bench.q(`UPDATE edge_cash_session SET status = 'CLOSED'`);
    expect(await condition(device)).toBe(4);
    await bench.q(`UPDATE edge_cash_session SET status = 'OPEN'`);
  });

  it('condition 4 : closed_at renseigné (status OPEN, usable_on_edge vrai)', async () => {
    await bench.q('UPDATE edge_cash_session SET closed_at = $1', [activatedAt]);
    expect(await condition(device)).toBe(4);
    await bench.q('UPDATE edge_cash_session SET closed_at = NULL');
  });

  it('condition 4 : usable_on_edge faux (status OPEN, closed_at nul)', async () => {
    await bench.q('UPDATE edge_cash_session SET usable_on_edge = false');
    expect(await condition(device)).toBe(4);
    await bench.q('UPDATE edge_cash_session SET usable_on_edge = true');
  });

  it('garde de route : hors des trois routes, aucune tolérance (défense en profondeur)', async () => {
    for (const route of ['createTap', 'getOfflineSnapshot', 'postDeviceHeartbeat', '']) {
      expect(await condition(device, { route })).toBe(0);
    }
    for (const route of ['activateMedia', 'takeDeposit', 'createCashTopup']) {
      expect(await condition(device, { route })).toBe('accepted');
    }
  });
});

describe('algorithmes admis : liste fermée', () => {
  it('HS256 avec la clé publique comme secret, kid connu : refusé par la liste, pas par la signature', async () => {
    const jwk = createPublicKey(bench.identity.privateKey).export({ format: 'jwk' });
    const secret = Buffer.from(JSON.stringify(jwk));
    const token = await new SignJWT({ sub: 'cashier-1' })
      .setProtectedHeader({ alg: 'HS256', kid: bench.identity.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(base() - 60)
      .setExpirationTime(base() + 3600)
      .sign(secret);
    const error = await authorizer.verify(token).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StaffTokenRefused);
    // Le refus vient de l'allowlist (`kid ou alg`), avant toute lecture de clé ou de signature.
    expect((error as StaffTokenRefused).why).toBe('kid ou alg');
    expect((error as StaffTokenRefused).condition).toBe(1);
  });
});
