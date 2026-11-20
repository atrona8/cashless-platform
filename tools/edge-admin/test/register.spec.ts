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
  LEDGER,
  OPERATOR,
  readIfExists,
  registerArgv,
  tmp,
  type Recorded,
} from './support';

const ENV = { EDGE_CA: 'fake', DATABASE_URL_EDGEADMIN: 'postgres://cashless_edgeadmin:x@h/db' };

async function run(
  argv: string[],
  env: NodeJS.ProcessEnv = ENV,
  fail?: { code: string; message: string },
  row?: unknown,
) {
  const calls: Recorded[] = [];
  const { io, got } = capture();
  const code = await main(argv, env, io, (e, i) => fileDeps(e, i, () => mockDb(calls, fail, row)));
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

  it('grand livre du fichier = grand livre rendu par la base, neuf arguments sans grand livre', async () => {
    const dir = tmp();
    const { code, calls } = await run(await registerArgv(dir));
    expect(code).toBe(0);
    const register = calls.find((c) => c.fn === 'register_edge_gateway')!;
    expect(register.args).toHaveLength(9);
    expect(register.args).not.toContain(LEDGER);
    const other = '44444444-4444-4444-8444-444444444444';
    const dir2 = tmp();
    const row = { gateway_id: '55555555-5555-4555-8555-555555555555', ledger_id: other };
    const again = await run(await registerArgv(dir2), ENV, undefined, row);
    expect(again.code).toBe(0);
    const file = JSON.parse(readIfExists(join(dir2, 'enrolment.json'))!);
    expect(file.ledger_id).toBe(other);
    expect(file.gateway_id).toBe(row.gateway_id);
    expect(JSON.parse(readIfExists(join(dir, 'enrolment.json'))!).ledger_id).toBe(LEDGER);
  });

  it.each([
    ['autre UUID', '66666666-6666-4666-8666-666666666666'],
    ['même UUID que la base', LEDGER],
    ['vide', ''],
  ])('--ledger fourni (%s) : refus, aucune écriture', async (_name, value) => {
    const dir = tmp();
    const { code, calls, got } = await run(await registerArgv(dir, {}, { ledger: value }));
    expect(code).toBe(1);
    expect(got.err.join('\n')).toMatch(/--ledger/);
    expect(calls).toEqual([]);
    expect(readIfExists(join(dir, 'enrolment.json'))).toBeNull();
  });

  it('grand livre introuvable ou ambigu (CL058) : rien écrit, aucune alerte, aucun secret', async () => {
    const dir = tmp();
    const fail = { code: 'CL058', message: "Inscription : grand livre de l'événement introuvable" };
    const { code, got } = await run(await registerArgv(dir), ENV, fail);
    expect(code).toBe(2);
    const all = [...got.out, ...got.err].join('\n');
    expect(all).toMatch(/CL058/);
    expect(all).not.toMatch(/EDGE_REGISTERED/);
    expect(all).not.toMatch(/PRIVATE KEY/);
    expect(readIfExists(join(dir, 'enrolment.json'))).toBeNull();
  });

  it.each([
    ['aucune ligne', undefined, null],
    ['ledger_id nul', { gateway_id: '55555555-5555-4555-8555-555555555555', ledger_id: null }, 1],
    ['non-UUID', { gateway_id: '55555555-5555-4555-8555-555555555555', ledger_id: 'abc' }, 1],
    ['gateway_id absent', { ledger_id: LEDGER }, 1],
  ])('retour de la base mal formé (%s) : refus, aucun fichier', async (_n, row, _x) => {
    const dir = tmp();
    const { code, got } = await run(await registerArgv(dir), ENV, undefined, row ?? {});
    expect(code).toBe(1);
    expect(got.out.join('\n')).not.toMatch(/EDGE_REGISTERED/);
    expect(readIfExists(join(dir, 'enrolment.json'))).toBeNull();
  });
});
