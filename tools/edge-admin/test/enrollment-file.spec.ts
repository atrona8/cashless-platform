// Format des fichiers d'inscription (T067) : champs exacts de interfaces.md § 13.1, longueurs, aucun secret.
import { join } from 'node:path';
import {
  checkEnrollmentFile,
  FormatError,
  parseRequestFile,
  serializeEnrollment,
  type EnrollmentFile,
} from '../src/enrollment-format';
import { main, realDeps } from '../src/main';
import {
  agreementPoint,
  capture,
  fileDeps,
  mockDb,
  readIfExists,
  registerArgv,
  requestJson,
  tmp,
} from './support';

async function enrolment(): Promise<{ raw: string; dir: string }> {
  const dir = tmp();
  const { io } = capture();
  const code = await main(await registerArgv(dir), { EDGE_CA: 'fake' }, io, (e, i) =>
    fileDeps(e, i, () => mockDb([])),
  );
  expect(code).toBe(0);
  return { raw: readIfExists(join(dir, 'enrolment.json'))!, dir };
}

describe("fichier d'enrôlement", () => {
  it('douze champs exacts, deux clés de site distinctes, ni version ni clé privée', async () => {
    const { raw } = await enrolment();
    const file = checkEnrollmentFile(raw);
    expect(Object.keys(file).sort()).toEqual(
      [
        'gateway_id',
        'operator_id',
        'event_id',
        'ledger_id',
        'serial',
        'role',
        'central_url',
        'central_ca_pem',
        'device_ca_pem',
        'client_cert_pem',
        'lan_authority',
        'site_order_keys',
      ].sort(),
    );
    expect(file.lan_authority).toBe('192.168.1.10:8443');
    expect(raw).not.toMatch(/PRIVATE KEY/);
  });

  it('refuse un champ inconnu (version), une clé privée, une seule clé de site, deux clés égales', async () => {
    const file = JSON.parse((await enrolment()).raw) as EnrollmentFile;
    const bad = (patch: Record<string, unknown>) => JSON.stringify({ ...file, ...patch });
    expect(() => checkEnrollmentFile(bad({ version: 1 }))).toThrow(FormatError);
    expect(() => checkEnrollmentFile(bad({ site_order_keys: [file.site_order_keys[0]] }))).toThrow(
      /deux clés/,
    );
    expect(() =>
      checkEnrollmentFile(
        bad({
          site_order_keys: [
            file.site_order_keys[0],
            { holder: 'Autre', public_key: file.site_order_keys[0].public_key },
          ],
        }),
      ),
    ).toThrow(/distinctes/);
    expect(() =>
      checkEnrollmentFile(bad({ client_cert_pem: '-----BEGIN PRIVATE KEY-----' })),
    ).toThrow(/privée/);
  });

  it('serializeEnrollment refuse un champ en trop', async () => {
    const file = JSON.parse((await enrolment()).raw);
    expect(() => serializeEnrollment({ ...file, extra: 1 })).toThrow(FormatError);
  });

  it("création exclusive en 0600 : jamais d'écrasement", async () => {
    const dir = tmp();
    const { io } = capture();
    const deps = realDeps({}, io);
    const path = join(dir, 'x.json');
    await deps.writeExclusive(path, 'a');
    await expect(deps.writeExclusive(path, 'b')).rejects.toThrow();
    expect(readIfExists(path)).toBe('a');
  });
});

describe('fichier de demande', () => {
  it("valide : clés SPKI 91 octets, point d'accord de 65 octets", async () => {
    const request = parseRequestFile(await requestJson());
    expect(request.batchPublicKey).toHaveLength(91);
    expect(request.agreementPublicKey).toHaveLength(65);
  });

  it.each([
    ["clé d'accord de 64 octets", { agreement: agreementPoint().subarray(0, 64) }],
    ['champ inconnu', { extra: { version: '1' } }],
    ['clé privée', { extra: { csr_pem: '-----BEGIN PRIVATE KEY-----' } }],
    ['rôle inconnu', { role: 'MASTER' }],
  ])('refuse : %s', async (_n, overrides) => {
    const raw = await requestJson(overrides);
    expect(() => parseRequestFile(raw)).toThrow(FormatError);
  });
});
