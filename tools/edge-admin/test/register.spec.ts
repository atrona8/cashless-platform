// `register` (T066, T067) : les neuf paramètres exacts, fichier 0600 sans secret, refus avant la base.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { checkEnrollmentFile } from '../src/enrollment-format';
import { main } from '../src/main';
import {
  agreementPoint,
  capture,
  fileDeps,
  mockDb,
  OPERATOR,
  readIfExists,
  registerArgv,
  tmp,
  type Recorded,
} from './support';

const ENV = { EDGE_CA: 'fake', DATABASE_URL_EDGEADMIN: 'postgres://cashless_edgeadmin:x@h/db' };

async function run(argv: string[], env: NodeJS.ProcessEnv = ENV) {
  const calls: Recorded[] = [];
  const { io, got } = capture();
  const code = await main(argv, env, io, (e, i) => fileDeps(e, i, () => mockDb(calls)));
  return { code, calls, got };
}

describe('edge-admin register', () => {
  it('demande valide : neuf paramètres exacts, enrôlement 0600, aucun secret, alerte annoncée', async () => {
    const dir = tmp();
    const { code, calls, got } = await run(await registerArgv(dir));
    expect(got.err).toEqual([]);
    expect(code).toBe(0);
    const register = calls.find((c) => c.fn === 'register_edge_gateway')!;
    expect(register.operator).toBe(OPERATOR);
    expect(register.args).toHaveLength(9);
    expect(register.args[2]).toBe('GW-001');
    expect(register.args[3]).toBe('PRIMARY');
    expect((register.args[4] as Buffer).length).toBe(32);
    expect((register.args[6] as Buffer).length).toBe(65);
    expect(register.args[7]).toBe('https://192.168.1.10:8443');
    expect(register.args[8]).toBe('Awa Diop');
    expect(calls.map((c) => c.fn)).toEqual(['register_edge_gateway', 'edge_register_snapshot_key']);
    const file = join(dir, 'enrolment.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const raw = readIfExists(file)!;
    expect(raw).not.toMatch(/PRIVATE KEY/);
    expect(Object.keys(checkEnrollmentFile(raw))).not.toContain('version');
    expect(got.out.join('\n')).toMatch(/EDGE_REGISTERED/);
    expect(got.out.join('\n')).not.toContain(raw.slice(0, 40));
  });

  it.each([
    ['clé du CSR non P-256', { curve: 'P-384' as const }, {}],
    ["clé d'accord de 64 octets", { agreement: agreementPoint().subarray(0, 64) }, {}],
    ['--by vide', {}, { by: '  ' }],
    ['rôle différent de la demande', {}, { role: 'STANDBY' }],
    ['titulaires identiques', {}, { 'site-holder-b': ' moussa  NDIAYE ' }],
  ])('refus avant la base : %s', async (_name, request, overrides) => {
    const dir = tmp();
    const { code, calls, got } = await run(await registerArgv(dir, request, overrides));
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(got.err.join('\n')).toMatch(/Refus/);
    expect(readIfExists(join(dir, 'enrolment.json'))).toBeNull();
  });

  it('deux clés de site identiques : refus (décision 27)', async () => {
    const dir = tmp();
    const argv = await registerArgv(dir);
    argv[argv.indexOf('--site-key-b') + 1] = argv[argv.indexOf('--site-key-a') + 1]!;
    const { code, calls } = await run(argv);
    expect(code).toBe(1);
    expect(calls).toEqual([]);
  });

  it("un fichier d'enrôlement existant n'est jamais écrasé", async () => {
    const dir = tmp();
    const argv = await registerArgv(dir);
    expect((await run(argv)).code).toBe(0);
    const again = await run(argv);
    expect(again.code).toBe(1);
    expect(again.calls).toEqual([]);
  });

  it("faux EDGE_CA en production : code 1, rien d'écrit, base non appelée", async () => {
    const dir = tmp();
    const { code, calls, got } = await run(await registerArgv(dir), {
      ...ENV,
      NODE_ENV: 'production',
    });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(got.err.join('\n')).toMatch(/faux est interdit en production/);
    expect(readIfExists(join(dir, 'enrolment.json'))).toBeNull();
  });

  it("refus d'une URL de connexion qui n'est pas celle de cashless_edgeadmin", async () => {
    const dir = tmp();
    const { io, got } = capture();
    const code = await main(
      await registerArgv(dir),
      { ...ENV, DATABASE_URL_EDGEADMIN: 'postgres://cashless_app:pw@h/db' },
      io,
    );
    expect(code).toBe(1);
    expect(got.err.join('\n')).not.toContain('pw@');
  });
});
