import { GatewayTx } from '../../src/db/gateway-tx';
import {
  ACK_REFUSAL_MS,
  FLOOR_WRITE_INTERVAL_MS,
  GatewayClockService,
  TOKEN_TOLERANCE_MS,
  type ClockSources,
} from '../../src/clock/gateway-clock';
import { createTestDb, type TestDb } from './_support/db';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

/** Sources de temps injectées : l'horloge de Node n'est jamais comparée à une date posée par la base. */
class Sources implements ClockSources {
  constructor(public system: number) {}
  mono = 0n;
  systemNow = (): number => this.system;
  monotonicNow = (): bigint => this.mono;
  advance(ms: number): void {
    this.system += ms;
    this.mono += BigInt(ms) * 1_000_000n;
  }
}

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.drop();
});

const boot = async (src: Sources): Promise<GatewayClockService> => {
  const clock = new GatewayClockService(new GatewayTx(db.pool), src);
  await clock.start();
  return clock;
};
const floorMs = async (): Promise<number> =>
  Number(
    (
      await db.pool.query(
        'SELECT (extract(epoch FROM time_floor)*1000)::bigint AS f FROM edge_clock',
      )
    ).rows[0].f,
  );

describe('horloge de la passerelle (A14)', () => {
  it('heure servie = t0 + temps monotone écoulé', async () => {
    const src = new Sources(T0);
    const clock = await boot(src);
    expect(clock.now().getTime()).toBe(T0);
    src.mono += 5_000_000_000n; // 5 s monotones, sans que l'heure système suive
    expect(clock.now().getTime()).toBe(T0 + 5000);
  });

  it('corrections centrales de +2 h et -2 h : jamais sous le plafond', async () => {
    const src = new Sources(T0);
    const clock = await boot(src);
    await clock.observeCentral(new Date(T0 + 2 * H));
    expect(clock.now().getTime()).toBe(T0 + 2 * H);
    expect(clock.skewAlert()).toBe(true);
    const audit = await db.pool.query("SELECT 1 FROM edge_audit WHERE kind = 'CLOCK_SKEW'");
    expect(audit.rows).toHaveLength(1);
    const before = clock.now().getTime();
    await clock.observeCentral(new Date(T0 - 2 * H));
    expect(clock.now().getTime()).toBeGreaterThanOrEqual(before);
    expect(await floorMs()).toBeGreaterThanOrEqual(T0 + 2 * H);
  });

  it.each([2, 13])(
    'redémarrage avec horloge système reculée de %i h : l’heure reste au moins au plafond',
    async (back) => {
      const first = new Sources(T0);
      const clock = await boot(first);
      first.advance(60_000);
      await db.pool.query('SELECT 1');
      const served = clock.now().getTime();
      await db.pool.query('UPDATE edge_clock SET time_floor = greatest(time_floor, $1)', [
        new Date(served),
      ]);

      const second = new Sources(served - back * H); // machine arrêtée, horloge système reculée
      const restarted = await boot(second);
      expect(restarted.now().getTime()).toBeGreaterThanOrEqual(served);
      second.advance(1000);
      expect(restarted.now().getTime()).toBeGreaterThanOrEqual(served + 1000);
      expect(restarted.skewAlert()).toBe(true);
      expect(
        (await db.pool.query("SELECT 1 FROM edge_audit WHERE kind = 'CLOCK_SKEW'")).rows.length,
      ).toBeGreaterThan(0);
    },
  );

  it('fenêtre de 12 h des jetons calculée sur l’heure servie, pas sur l’heure système', async () => {
    const src = new Sources(T0);
    const clock = await boot(src);
    const activated = clock.now();
    src.mono += BigInt(TOKEN_TOLERANCE_MS) * 1_000_000n;
    expect(clock.elapsedMs(activated)).toBe(TOKEN_TOLERANCE_MS);
    expect(clock.elapsedMs(activated) > TOKEN_TOLERANCE_MS).toBe(false);
    src.mono += 1_000_000_000n; // 12 h + 1 s
    expect(clock.elapsedMs(activated) > TOKEN_TOLERANCE_MS).toBe(true);
    // L'heure système reculée n'y change rien.
    src.system -= 20 * H;
    expect(clock.elapsedMs(activated) > TOKEN_TOLERANCE_MS).toBe(true);
  });

  it('écart de plus de 24 h à une mesure centrale : refusesAck(), levé par une mesure cohérente', async () => {
    const src = new Sources(T0);
    const clock = await boot(src);
    await clock.observeCentral(new Date(T0 + ACK_REFUSAL_MS - 1000));
    expect(clock.refusesAck()).toBe(false);
    await clock.observeCentral(new Date(T0 + ACK_REFUSAL_MS - 1000 + ACK_REFUSAL_MS + 1000));
    expect(clock.refusesAck()).toBe(true);
    expect((await db.pool.query('SELECT ack_refused FROM edge_clock')).rows[0].ack_refused).toBe(
      true,
    );
    await clock.observeCentral(new Date(clock.now().getTime() + 1000));
    expect(clock.refusesAck()).toBe(false);
  });

  it('time_floor écrit au plus une fois par seconde', async () => {
    const src = new Sources(T0);
    const clock = await boot(src);
    const writes: number[] = [];
    const tx = {
      query: async () => {
        writes.push(1);
        return { rows: [] };
      },
    } as never;
    for (let i = 0; i < 200; i += 1) {
      src.advance(5); // 1 s au total sur 200 appels
      await clock.touchFloor(tx);
    }
    expect(writes.length).toBeLessThanOrEqual(2);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const before = writes.length;
    src.advance(FLOOR_WRITE_INTERVAL_MS);
    await clock.touchFloor(tx);
    expect(writes.length).toBe(before + 1);
  });

  it('now() avant start() refuse', () => {
    const clock = new GatewayClockService(new GatewayTx(db.pool), new Sources(T0));
    expect(() => clock.now()).toThrow(/non démarrée/);
  });
});
