// Aucun secret en sortie (T067) : un canari dans le mot de passe de DATABASE_URL_EDGEADMIN et dans une extension du CSR
// est absent de stdout, stderr et du fichier d'enrôlement, sous toutes ses représentations. Contrôle positif : un log
// volontairement fautif fait échouer la même vérification.
import { join } from 'node:path';
import { main } from '../src/main';
import { redact } from '../src/redact';
import { capture, fileDeps, mockDb, readIfExists, registerArgv, tmp } from './support';

const CANARY = 'CANARI-9f3a7c51d2e84b60';

function forms(secret: string): string[] {
  const raw = Buffer.from(secret, 'utf8');
  return [secret, raw.toString('hex'), raw.toString('base64'), raw.toString('base64url')];
}

function leaks(haystacks: string[], secret: string): string[] {
  return forms(secret).filter((form) => haystacks.some((h) => h.includes(form)));
}

describe("aucun secret dans les sorties de l'outil", () => {
  const url = `postgres://cashless_edgeadmin:${CANARY}@127.0.0.1:1/db`;

  it('réussite : URL à canari, CSR à canari : rien dans stdout, stderr, fichier', async () => {
    const dir = tmp();
    const { io, got } = capture();
    const code = await main(
      await registerArgv(dir, { canary: CANARY }),
      { EDGE_CA: 'fake', DATABASE_URL_EDGEADMIN: url },
      io,
      (e, i) => fileDeps(e, i, () => mockDb([])),
    );
    expect(code).toBe(0);
    const file = readIfExists(join(dir, 'enrolment.json'))!;
    expect(file.length).toBeGreaterThan(100);
    expect(leaks([...got.out, ...got.err, file], CANARY)).toEqual([]);
  });

  it('panne de connexion (vraie tentative, URL à canari) : rien dans les sorties', async () => {
    const dir = tmp();
    const { io, got } = capture();
    const code = await main(
      await registerArgv(dir, { canary: CANARY }),
      { EDGE_CA: 'fake', DATABASE_URL_EDGEADMIN: url },
      io,
    );
    expect(code).toBe(1);
    expect(got.err.length).toBeGreaterThan(0);
    expect(leaks([...got.out, ...got.err], CANARY)).toEqual([]);
    expect(readIfExists(join(dir, 'enrolment.json'))).toBeNull();
  });

  it("redact masque mot de passe d'URL, PEM privé, nonce, empreinte complète", () => {
    const digest = 'ab'.repeat(32);
    const text = redact(
      `connexion ${url} nonce=abc123 -----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY----- ${digest}`,
    );
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('AAAA');
    expect(text).not.toContain(digest);
    expect(text).toContain('abababababababab…');
  });

  it('contrôle positif : un log fautif est détecté', async () => {
    const faulty = [`connexion ${url}`];
    expect(leaks(faulty, CANARY)).not.toEqual([]);
    expect(leaks([Buffer.from(CANARY).toString('base64')], CANARY)).not.toEqual([]);
  });
});
