// Décisions 19 et 20 du porteur (09/11/2026) et exigences de démarrage notées par les relectures.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../startup/_support/fixture';
import { GatewayTx } from '../../src/db/gateway-tx';
import { GatewayClockService, type ClockSources } from '../../src/clock/gateway-clock';
import { ConfigError, loadConfig } from '../../src/config/config';
import { createTestDb, type TestDb } from '../startup/_support/db';
import { makeQueueHarness, purchase, type QueueHarness } from './_support/queue-harness';

/** Fichier de clé client en 0600 dans un répertoire fermé (décision 32). */
function clientKeyFile(): string {
  const file = join(tempDir(), 'client.key');
  writeFileSync(file, 'x', { mode: 0o600 });
  return file;
}

const MIN = 60_000;
const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

class Sources implements ClockSources {
  mono = 0n;
  constructor(public system: number) {}
  systemNow = (): number => this.system;
  monotonicNow = (): bigint => this.mono;
}

describe('décision 19 : TRUNCATE refusé sur edge_authority, edge_op, edge_audit', () => {
  let h: QueueHarness;
  beforeEach(async () => {
    h = await makeQueueHarness();
    await h.addOp(purchase(1));
  });
  afterEach(async () => {
    await h.close();
  });

  it.each(['edge_authority', 'edge_op', 'edge_audit', 'edge_chain_head', 'edge_outgoing_batch'])(
    'TRUNCATE %s refusé, table intacte',
    async (table) => {
      await expect(h.db.pool.query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow(/interdit/);
      const { rows } = await h.db.pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n).toBeGreaterThanOrEqual(table === 'edge_outgoing_batch' ? 0 : 1);
    },
  );

  it('TRUNCATE puis INSERT ne remet pas l’époque à zéro', async () => {
    await h.db.pool.query('UPDATE edge_authority SET epoch = 4, highest_epoch_seen = 4');
    await expect(h.db.pool.query('TRUNCATE edge_authority')).rejects.toThrow();
    expect((await h.db.pool.query('SELECT epoch FROM edge_authority')).rows[0].epoch).toBe('4');
  });

  it('les cinq déclencheurs BEFORE TRUNCATE existent (migration edge-0004 jouée)', async () => {
    const { rows } = await h.db.pool.query(
      `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgtype & 32 = 32 AND t.tgtype & 2 = 2 AND NOT t.tgisinternal
          AND c.relname = ANY($1) ORDER BY 1`,
      [['edge_authority', 'edge_op', 'edge_audit', 'edge_chain_head', 'edge_outgoing_batch']],
    );
    expect(rows.map((r) => r.relname)).toEqual([
      'edge_audit',
      'edge_authority',
      'edge_chain_head',
      'edge_op',
      'edge_outgoing_batch',
    ]);
    expect(
      (await h.db.pool.query("SELECT 1 FROM edge_schema_migration WHERE name LIKE 'edge-0004%'"))
        .rowCount,
    ).toBe(1);
  });
});

describe('décision 20 : recul de l’heure du central borné à 5 minutes', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.drop();
  });

  async function boot(): Promise<GatewayClockService> {
    const clock = new GatewayClockService(new GatewayTx(db.pool), new Sources(T0));
    await clock.start();
    return clock;
  }
  const audit = async (): Promise<number> =>
    (await db.pool.query("SELECT 1 FROM edge_audit WHERE kind = 'CLOCK_CENTRAL_OUT_OF_BOUNDS'"))
      .rowCount!;
  const floor = async (): Promise<number> =>
    Number(
      (await db.pool.query('SELECT extract(epoch FROM time_floor) * 1000 AS f FROM edge_clock'))
        .rows[0].f,
    );

  it.each([
    ['−6 min', -6 * MIN],
    ['−23 h', -23 * H],
  ])(
    'central à %s : refusé, CLOCK_CENTRAL_OUT_OF_BOUNDS, horloge et plafond inchangés',
    async (_, delta) => {
      const clock = await boot();
      const before = clock.now().getTime();
      const floorBefore = await floor();
      await clock.observeCentral(new Date(before + delta));
      expect(clock.refusesAck()).toBe(true);
      expect(await audit()).toBe(1);
      expect(clock.now().getTime()).toBe(before);
      expect(await floor()).toBe(floorBefore);
      // Une mesure cohérente lève le refus.
      await clock.observeCentral(new Date(clock.now().getTime() + 1000));
      expect(clock.refusesAck()).toBe(false);
    },
  );

  it('central à −4 min et à −5 min exactement : adopté, pas de refus', async () => {
    const clock = await boot();
    await clock.observeCentral(new Date(clock.now().getTime() - 4 * MIN));
    expect(clock.refusesAck()).toBe(false);
    await clock.observeCentral(new Date(clock.now().getTime() - 5 * MIN));
    expect(clock.refusesAck()).toBe(false);
    expect(await audit()).toBe(0);
  });

  it('l’avance du central garde sa borne de 24 h (inchangée)', async () => {
    const clock = await boot();
    await clock.observeCentral(new Date(clock.now().getTime() + 23 * H));
    expect(clock.refusesAck()).toBe(false);
    await clock.observeCentral(new Date(clock.now().getTime() + 25 * H));
    expect(clock.refusesAck()).toBe(true);
  });
});

describe('production : l’absence de centralUrl ou du certificat client refuse la configuration', () => {
  const base = {
    NODE_ENV: 'production',
    GATEWAY_DATABASE_URL: 'postgres://edge_app:un-secret-long-1234@127.0.0.1:5432/x',
    GATEWAY_REQUEST_AUTHORITY: 'gw.example:8443',
    GATEWAY_LISTEN_PORT: '8443',
    GATEWAY_ADMIN_PORT: '8444',
    HARDWARE_KEYSTORE: 'hardware',
    GATEWAY_CENTRAL_URL: 'https://central.example',
    GATEWAY_CENTRAL_CLIENT_CERT_FILE: '/etc/gw/client.crt',
    GATEWAY_CENTRAL_CLIENT_KEY_FILE: clientKeyFile(),
  };

  it('le jeu complet passe ; sans URL ou sans certificat, ConfigError', () => {
    expect(() => loadConfig(base)).not.toThrow();
    expect(() => loadConfig({ ...base, GATEWAY_CENTRAL_URL: '' })).toThrow(ConfigError);
    const { GATEWAY_CENTRAL_CLIENT_CERT_FILE: _c, ...noCert } = base;
    expect(() => loadConfig(noCert)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, GATEWAY_CENTRAL_CLIENT_CERT_FILE: '' })).toThrow(
      ConfigError,
    );
  });

  it('le vidage ne démarre pas sans central ni certificat (hors production)', async () => {
    const { QueueRuntime } = await import('../../src/queue/queue.module');
    let started = 0;
    const drain = {
      bindHooks: () => undefined,
      start: () => void (started += 1),
      stop: async () => undefined,
    };
    const make = (centralUrl: string | null, cert: string | null) =>
      new QueueRuntime(
        drain as never,
        {} as never,
        {} as never,
        {
          centralUrl,
          centralClientCertFile: cert,
        } as never,
      );
    make(null, null).start();
    make('https://x', null).start();
    expect(started).toBe(0);
    make('https://x', '/c.crt').start();
    expect(started).toBe(1);
  });
});
