// WP22 / T102 : bornes de la tolérance du jeton de personne expiré (R-20, décision 3, OP-N103).
// Chaque borne échoue SEULE ; limites exactes (12 h accepté, 12 h + 1 s refusé). Ces tests échouent
// si la limite s'élargit (règle 3 du porteur). Horloge de test pilotée, jamais celle de Node.
import { GatewayClockService, type ClockSources } from '../../src/clock/gateway-clock';
import { GatewayTx } from '../../src/db/gateway-tx';
import {
  epochSeconds,
  opCount,
  postTopup,
  readyBench,
  seedMedia,
  seedSession,
  seedStaff,
  staffToken,
  toleratedToken,
  type Bench,
  type TestDevice,
} from './_support/bench';

const HOUR = 3_600_000;
let bench: Bench;
let device: TestDevice;
let activatedAt: Date;
let sessionId: string;

beforeAll(async () => {
  let session;
  ({ bench, device, activatedAt, session } = await readyBench({
    activatedAgoMs: 2 * HOUR,
    sessionOpenedAgoMs: HOUR,
  }));
  sessionId = session.id;
}, 120_000);
afterAll(async () => bench.close());
afterEach(() => {
  delete (bench.clock as unknown as { now?: unknown }).now;
});

const freeze = (at: Date): void => {
  (bench.clock as unknown as { now: () => Date }).now = () => new Date(at);
};
const atOffset = (ms: number): Date => new Date(activatedAt.getTime() + ms);
const audits = async (): Promise<number> =>
  (await bench.q('SELECT 1 FROM edge_audit WHERE kind = $1', ['STAFF_TOKEN_TOLERATED'])).length;

/** Jeton expiré toléré, avec la clé d'audit ; rend le statut et vérifie qu'un refus n'écrit rien. */
async function attempt(
  token: string,
  o: { device?: TestDevice; body?: Record<string, unknown> } = {},
): Promise<number> {
  const media = await seedMedia(bench);
  const ops = await opCount(bench);
  const lines = await audits();
  const r = await postTopup(bench, o.device ?? device, media, { staff: token, body: o.body });
  if (r.status !== 201) {
    expect(await opCount(bench)).toBe(ops);
    expect(await audits()).toBe(lines);
  } else {
    expect(await audits()).toBe(lines + 1);
  }
  return r.status;
}

const base = (): number => epochSeconds(activatedAt);

describe('borne fixe de 12 h après la bascule', () => {
  it('à 12 h pile : accepté ; à 12 h + 1 s : refusé 401 ; à 13 h : refusé', async () => {
    freeze(atOffset(12 * HOUR));
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(201);
    freeze(atOffset(12 * HOUR + 1000));
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    freeze(atOffset(13 * HOUR));
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
  });

  it('la borne ne se prolonge pas : token_tolerance_until élargi en base ne compte pas', async () => {
    await bench.q('UPDATE edge_authority SET token_tolerance_until = $1', [atOffset(48 * HOUR)]);
    freeze(atOffset(13 * HOUR));
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    await bench.q('UPDATE edge_authority SET token_tolerance_until = $1', [atOffset(12 * HOUR)]);
  });

  it('borne enregistrée plus courte que 12 h : la plus courte l’emporte', async () => {
    await bench.q('UPDATE edge_authority SET token_tolerance_until = $1', [atOffset(HOUR)]);
    freeze(atOffset(HOUR + 1000));
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    await bench.q('UPDATE edge_authority SET token_tolerance_until = $1', [atOffset(12 * HOUR)]);
  });

  it('horloge reculée de 13 h puis redémarrage : jamais plus de 12 h de tolérance', async () => {
    // Le plafond persisté (`time_floor`) à activated_at + 13 h ; la machine redémarre avec une
    // horloge système revenue à activated_at + 1 h : l'heure servie ne recule pas (WP16).
    const sources = (ms: number): ClockSources => ({
      systemNow: () => ms,
      monotonicNow: () => 0n,
    });
    const gatewayTx = new GatewayTx(bench.db.pool);
    await new GatewayClockService(gatewayTx, sources(atOffset(13 * HOUR).getTime())).start();
    const rebooted = new GatewayClockService(gatewayTx, sources(atOffset(HOUR).getTime()));
    await rebooted.start();
    expect(rebooted.now().getTime()).toBeGreaterThanOrEqual(atOffset(13 * HOUR).getTime());
    (bench.clock as unknown as { now: () => Date }).now = () => rebooted.now();
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
  });
});

describe('chaque condition échoue seule', () => {
  beforeEach(() => freeze(atOffset(HOUR)));

  it('référence : toutes les conditions réunies, accepté', async () => {
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(201);
  });

  it('exp antérieur à la bascule : refusé, même sur une session ouverte depuis des jours', async () => {
    await bench.q('UPDATE edge_cash_session SET opened_at = $1', [atOffset(-10 * 24 * HOUR)]);
    const stale = await staffToken(bench, { iat: base() - 7200, exp: base() - 1 });
    expect(await attempt(stale)).toBe(401);
    // exp à la première seconde pleine >= activated_at : accepté (A15).
    const edge = await staffToken(bench, {
      iat: base() - 7200,
      exp: Math.ceil(activatedAt.getTime() / 1000),
    });
    expect(await attempt(edge)).toBe(201);
  });

  it('iat après la bascule : refusé ; absent : refusé', async () => {
    expect(await attempt(await toleratedToken(bench, activatedAt, { iat: base() + 60 }))).toBe(401);
    expect(await attempt(await toleratedToken(bench, activatedAt, { iat: null }))).toBe(401);
    // iat exactement à la bascule : accepté.
    expect(await attempt(await toleratedToken(bench, activatedAt, { iat: base() }))).toBe(201);
  });

  it('autre personne que celle qui a ouvert la session : refusé', async () => {
    await seedStaff(bench, 'cashier-2');
    const other = await toleratedToken(bench, activatedAt, { sub: 'cashier-2' });
    expect(await attempt(other)).toBe(401);
  });

  it('même sub, autre émetteur de session : refusé', async () => {
    await bench.q('UPDATE edge_cash_session SET opened_by_iss = $1', ['https://autre.test']);
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    await bench.q('UPDATE edge_cash_session SET opened_by_iss = $1', ['https://id.test/realm']);
  });

  it('autre terminal : refusé (session d’un autre terminal citée, ou aucune session)', async () => {
    const other = await bench.newDevice();
    const token = await toleratedToken(bench, activatedAt);
    expect(await attempt(token, { device: other })).toBe(401);
    expect(await attempt(token, { device: other, body: { cash_session_id: sessionId } })).toBe(401);
  });

  it('session fermée : refusé', async () => {
    await bench.q(`UPDATE edge_cash_session SET status = 'CLOSED', closed_at = $1`, [atOffset(0)]);
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    await bench.q(`UPDATE edge_cash_session SET status = 'OPEN', closed_at = NULL`);
  });

  it('session ouverte APRÈS la bascule (usable_on_edge faux) : refusé', async () => {
    await bench.q('UPDATE edge_cash_session SET usable_on_edge = false');
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    await bench.q('UPDATE edge_cash_session SET usable_on_edge = true');
  });

  it('personne devenue inactive ou sans rôle dans l’état répliqué : refusé', async () => {
    await seedStaff(bench, 'cashier-1', { status: 'SUSPENDED' });
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    await seedStaff(bench, 'cashier-1', { roles: ['VENDOR'] });
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    await seedStaff(bench, 'cashier-1');
  });

  it('autorité non ACTIVE : aucune tolérance', async () => {
    await bench.q(`UPDATE edge_authority SET state = 'STALE'`);
    expect(await attempt(await toleratedToken(bench, activatedAt))).toBe(401);
    await bench.q(`UPDATE edge_authority SET state = 'ACTIVE'`);
  });

  it('jeton expiré : aucune session citée ni ouverte pour ce terminal : refusé', async () => {
    const lone = await bench.newDevice();
    expect(await attempt(await toleratedToken(bench, activatedAt), { device: lone })).toBe(401);
    void seedSession;
  });
});

describe('la tolérance ne vaut que pour les trois routes du guichet', () => {
  it('une route de paiement ne connaît pas le garde de personne (aucun autre garde ne l’appelle)', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
      });
    const users = walk(join(__dirname, '../../src'))
      .filter((file) => readFileSync(file, 'utf8').includes('StaffTokenGuard'))
      .map((file) => file.split('/src/')[1]!)
      .filter((file) => !file.startsWith('staff/'))
      .sort();
    expect(users).toEqual(['operations/counter/counter.controller.ts']);
  });
});
