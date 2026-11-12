import { join } from 'node:path';
import { configureFailpoints, parseFailpoint } from '../../src/testing/failpoints';
import { createTestDb, type TestDb } from './_support/db';
import { enrolledFixture } from './_support/fixture';
import { CHILD_MAIN, runGateway } from './_support/child';

const CHILD = join(__dirname, '_support', 'failpoint-child.ts');
const run = (env: Record<string, string>) => runGateway(env, { entry: CHILD, timeoutMs: 30_000 });

describe('points d’arrêt', () => {
  it('syntaxe <nom>[:<n>] ; nom inconnu refusé', () => {
    expect(parseFailpoint('before-local-write')).toEqual({ name: 'before-local-write', at: 1 });
    expect(parseFailpoint('after-releasing-persisted:3').at).toBe(3);
    expect(() => parseFailpoint('nope')).toThrow(/inconnu/);
    expect(() => parseFailpoint('before-local-write:0')).toThrow();
  });

  it('sans EDGE_ALLOW_FAILPOINTS, le point ne tue rien et le refus est signalé', async () => {
    const r = await run({ NODE_ENV: 'test', EDGE_FAILPOINT: 'before-local-write' });
    expect(r.stdout).toContain('armed=false refused=true');
    expect(r.stdout).toContain('SURVIVED');
    expect(r.code).toBe(0);
  });

  it('en production, même avec les deux variables, le point est inerte (et la garde refuse le démarrage)', async () => {
    const r = await run({
      NODE_ENV: 'production',
      EDGE_FAILPOINT: 'before-local-write',
      EDGE_ALLOW_FAILPOINTS: '1',
    });
    expect(r.stdout).toContain('armed=false');
    expect(r.stdout).toContain('SURVIVED');
    expect(
      configureFailpoints({
        nodeEnv: 'production',
        failpoint: 'before-local-write',
        allowFailpoints: '1',
      }).armed,
    ).toBe(false);
  });

  it.each([
    'before-local-write',
    'after-local-write-before-reply',
    'during-drain-after-send-before-result',
    'after-releasing-persisted',
  ])('en test avec les deux conditions, %s tue le processus (SIGKILL)', async (name) => {
    const r = await run({
      NODE_ENV: 'test',
      EDGE_FAILPOINT: name,
      EDGE_ALLOW_FAILPOINTS: '1',
      PASS_NAME: name,
    });
    expect(r.signal).toBe('SIGKILL');
    expect(r.stdout).not.toContain('SURVIVED');
  });

  it('le n-ième passage seulement', async () => {
    const r = await run({
      NODE_ENV: 'development',
      EDGE_FAILPOINT: 'before-local-write:3',
      EDGE_ALLOW_FAILPOINTS: '1',
      PASSES: '5',
    });
    expect(r.signal).toBe('SIGKILL');
    expect(r.stdout).toContain('PASSED 2');
    expect(r.stdout).not.toContain('PASSED 3');
  });

  it('kill-local-database écrit sa ligne puis attend sans valider', async () => {
    const r = await run({
      NODE_ENV: 'test',
      EDGE_FAILPOINT: 'kill-local-database',
      EDGE_ALLOW_FAILPOINTS: '1',
      PASS_NAME: 'kill-local-database',
    });
    // Le processus attend : c'est le délai du banc qui l'arrête, jamais une sortie normale.
    expect(r.stdout).toContain('FAILPOINT kill-local-database reached');
    expect(r.stdout).not.toContain('SURVIVED');
  }, 40_000);

  it('hors des conditions, un démarrage réel écrit FAILPOINT_REFUSED dans l’audit', async () => {
    const db: TestDb = await createTestDb();
    try {
      await enrolledFixture(db);
      const r = await runGateway({
        NODE_ENV: 'test',
        GATEWAY_DATABASE_URL: db.url,
        GATEWAY_LISTEN_PORT: '0',
        EDGE_FAILPOINT: 'before-local-write',
      });
      if (!r.listening) throw new Error(`${r.stderr} | ${r.stdout}`);
      const { rows } = await db.pool.query(
        "SELECT detail FROM edge_audit WHERE kind = 'FAILPOINT_REFUSED'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].detail.failpoint).toBe('before-local-write');
    } finally {
      await db.drop();
    }
    expect(CHILD_MAIN).toBeTruthy();
  }, 60_000);
});
