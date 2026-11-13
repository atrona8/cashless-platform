// Le banc refuse `cashless_test`, tout nom hors préfixe, le port 80 et le port 5434 ; il crée et
// détruit
// ses bases sans résidu.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  assertClusterPort,
  assertDisposableName,
  assertNoReservedDatabase,
  BenchRefusal,
  createCentralDatabase,
  createEdgeDatabase,
  newId,
  residualDatabases,
} from '../support/disposable-databases';

describe('bases jetables du banc', () => {
  it.each([
    'cashless_test',
    'cashless_test_x',
    'cashless_dev',
    'postgres',
    'cashless_wp25',
    'x; DROP',
  ])('refuse le nom %s', (name) => {
    expect(() => assertDisposableName(name)).toThrow(BenchRefusal);
  });

  it.each(['80', '5434', '080', ' 80', '80 ', '05434', '+80', '8e1', 'abc'])(
    'refuse le port %s',
    (port) => {
      expect(() => assertClusterPort(port)).toThrow(BenchRefusal);
    },
  );

  it('refuse un cluster sur le port 5434 ou 80 par la configuration', () => {
    const { cluster } = jest.requireActual('../support/disposable-databases');
    expect(() => cluster({ PGPORT: '5434' })).toThrow(/BANC REFUSÉ/);
    expect(() => cluster({ PGPORT: '80' })).toThrow(/BANC REFUSÉ/);
  });

  it('refuse PGDATABASE=cashless_test, explicitement, par le banc', () => {
    expect(() => assertNoReservedDatabase({ PGDATABASE: 'cashless_test' })).toThrow(/réservée/);
    expect(() => assertNoReservedDatabase({ PGDATABASE: 'cashless_test_x' })).toThrow(BenchRefusal);
    expect(() => assertNoReservedDatabase({ PGDATABASE: 'cashless_wp25' })).not.toThrow();
    const { cluster } = jest.requireActual('../support/disposable-databases');
    expect(() => cluster({ PGDATABASE: 'cashless_test' })).toThrow(/BANC REFUSÉ/);
  });

  describe('env-setup.cjs (setupFiles de la configuration e2e)', () => {
    const setup = join(__dirname, 'env-setup.cjs');
    const load = (env: Record<string, string>) =>
      spawnSync(process.execPath, ['-e', `require(${JSON.stringify(setup)})`], {
        env: { PATH: process.env.PATH ?? '', ...env },
        encoding: 'utf8',
      });
    it('refuse PGDATABASE=cashless_test avec un message explicite', () => {
      const r = load({ PGDATABASE: 'cashless_test' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/BANC REFUSÉ.*cashless_test/);
    });
    it.each(['80', '080', ' 80', '5434', '05434'])('refuse PGPORT=%s', (port) => {
      const r = load({ PGPORT: port });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/BANC REFUSÉ/);
    });
    it('accepte le cluster local et pose une base jetable', () => {
      const r = load({ PGPORT: '5433', PGDATABASE: 'cashless_wp25' });
      expect(r.status).toBe(0);
    });
  });

  it('crée puis détruit une base du central et une base locale, sans résidu', async () => {
    const id = newId();
    const central = await createCentralDatabase(id);
    const edge = await createEdgeDatabase(id);
    const during = await residualDatabases();
    expect(during).toEqual(expect.arrayContaining([central.name, edge.name]));
    const { rows } = await edge.pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'edge_op'`,
    );
    expect(rows[0].n).toBe(1);
    await central.drop();
    await edge.drop();
    const after = await residualDatabases();
    expect(after).not.toContain(central.name);
    expect(after).not.toContain(edge.name);
  }, 300_000);
});
