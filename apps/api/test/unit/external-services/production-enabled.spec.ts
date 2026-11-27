// Borne de la liste des services réels autorisés en production (règle 3 du porteur ; D3 et D6, 26/11/2026).
// `PRODUCTION_ENABLED_SERVICES` est vide : ajouter un service se fait par une PR relue qui joint le compte rendu de
// son essai réussi (`docs/essais/<service>.json`, sans secret). Ce test échoue sinon.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isEnabledInProduction,
  PRODUCTION_ENABLED_SERVICES,
} from '../../../src/external-services/production-enabled';
import {
  EXTERNAL_SERVICES,
  OUT_OF_SCOPE,
  type ExternalService,
} from '../../../src/external-services/services';

const ESSAIS = join(__dirname, '../../../../../docs/essais');

/** Chaînes qui ressemblent à un secret : clé Stripe, secret de notification, clé Wave, clé PayDunya, clé AWS. */
const SECRET_LOOKING = [
  /sk_(live|test)_/,
  /rk_(live|test)_/,
  /whsec_/,
  /wave_sn_/,
  /AKIA[0-9A-Z]{8,}/,
  /ASIA[0-9A-Z]{8,}/,
  /[A-Za-z0-9_-]{30,}/, // clé PayDunya (30 caractères et plus) ou tout jeton long
];

interface Step {
  name: unknown;
  ok: unknown;
  httpStatus?: unknown;
  durationMs: unknown;
}

/** Les violations de la règle pour une liste donnée (la fonction rend la liste, le test l'exige vide). */
function violations(
  enabled: readonly string[],
  read: (service: string) => string | null = (service) => {
    const path = join(ESSAIS, `${service}.json`);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  },
): string[] {
  const found: string[] = [];
  for (const service of enabled) {
    if (!(EXTERNAL_SERVICES as readonly string[]).includes(service))
      found.push(`${service} : nom inconnu`);
    if ((OUT_OF_SCOPE as readonly string[]).includes(service))
      found.push(`${service} : hors périmètre`);
    const text = read(service);
    if (text === null) {
      found.push(`${service} : aucun compte rendu docs/essais/${service}.json`);
      continue;
    }
    let report: Record<string, unknown>;
    try {
      report = JSON.parse(text) as Record<string, unknown>;
    } catch {
      found.push(`${service} : compte rendu illisible`);
      continue;
    }
    if (report.service !== service) found.push(`${service} : champ service différent`);
    if (typeof report.startedAt !== 'string' || Number.isNaN(Date.parse(report.startedAt)))
      found.push(`${service} : startedAt absent ou invalide`);
    if (report.ok !== true) found.push(`${service} : ok n'est pas true`);
    const steps = report.steps;
    if (!Array.isArray(steps) || steps.length === 0) found.push(`${service} : aucune étape`);
    else
      for (const step of steps as Step[]) {
        if (
          typeof step.name !== 'string' ||
          step.name === '' ||
          typeof step.durationMs !== 'number'
        )
          found.push(`${service} : étape mal formée`);
        if (step.ok !== true) found.push(`${service} : étape ${String(step.name)} non réussie`);
      }
    if (SECRET_LOOKING.some((pattern) => pattern.test(text)))
      found.push(`${service} : le compte rendu ressemble à un secret`);
  }
  return found;
}

const goodReport = (service: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    service,
    startedAt: '2026-12-01T10:00:00Z',
    ok: true,
    steps: [{ name: 'lecture', ok: true, httpStatus: 200, durationMs: 120 }],
    ...over,
  });

describe('PRODUCTION_ENABLED_SERVICES : borne de la règle 3', () => {
  it('(a, b, c) chaque service listé est connu, dans le périmètre, avec un compte rendu réussi sans secret', () => {
    expect(violations(PRODUCTION_ENABLED_SERVICES)).toEqual([]);
  });

  it('(d) la liste est vide aujourd’hui : l’ajout d’un service met ce test à jour dans la même PR', () => {
    expect(PRODUCTION_ENABLED_SERVICES).toEqual([]);
    for (const service of EXTERNAL_SERVICES) expect(isEnabledInProduction(service)).toBe(false);
  });

  it('aucun nom hors périmètre ne figure parmi les services connus', () => {
    for (const service of OUT_OF_SCOPE)
      expect((EXTERNAL_SERVICES as readonly string[]).includes(service)).toBe(false);
  });

  it('mutation : un service listé sans compte rendu fait échouer la borne', () => {
    expect(violations(['kms'], () => null)).toEqual([
      'kms : aucun compte rendu docs/essais/kms.json',
    ]);
    // Avec le vrai dossier : `kms` n'a pas de compte rendu aujourd'hui.
    expect(violations(['kms'])).toHaveLength(1);
  });

  it('mutation : un compte rendu avec ok: false, ok absent, étape en échec ou vide fait échouer la borne', () => {
    expect(violations(['kms'], () => goodReport('kms', { ok: false }))).toContain(
      "kms : ok n'est pas true",
    );
    const noOk = JSON.parse(goodReport('kms')) as Record<string, unknown>;
    delete noOk.ok;
    expect(violations(['kms'], () => JSON.stringify(noOk))).toContain("kms : ok n'est pas true");
    expect(
      violations(['kms'], () =>
        goodReport('kms', { steps: [{ name: 'lecture', ok: false, durationMs: 1 }] }),
      ),
    ).toContain('kms : étape lecture non réussie');
    expect(violations(['kms'], () => goodReport('kms', { steps: [] }))).toContain(
      'kms : aucune étape',
    );
    expect(violations(['kms'], () => '')).toContain('kms : compte rendu illisible');
    expect(violations(['kms'], () => '{}')).toContain('kms : champ service différent');
  });

  it('mutation : un nom inconnu, un service hors périmètre, un autre service dans le fichier font échouer la borne', () => {
    expect(violations(['inconnu'], () => goodReport('inconnu'))).toContain('inconnu : nom inconnu');
    expect(violations(['psp.orange-money'], () => goodReport('psp.orange-money'))).toContain(
      'psp.orange-money : hors périmètre',
    );
    expect(violations(['kms'], () => goodReport('seal-copy'))).toContain(
      'kms : champ service différent',
    );
  });

  it('mutation : un compte rendu qui contient un secret fait échouer la borne', () => {
    for (const leak of [
      // Clé d'exemple publique de la documentation Stripe, découpée pour l'analyse des secrets.
      'sk_' + 'test_' + '4eC39HqLyjWDarjtT1zdp7dc',
      'whsec_abcdef',
      'wave_sn_API_live_key',
      'AKIAIOSFODNN7EXAMPLE',
      'a'.repeat(32),
    ])
      expect(violations(['kms'], () => goodReport('kms', { note: leak }))).toContain(
        'kms : le compte rendu ressemble à un secret',
      );
    expect(violations(['kms'], () => goodReport('kms'))).toEqual([]);
  });

  it('la liste ne se règle pas : aucune lecture de l’environnement ni de fichier dans production-enabled.ts', () => {
    const source = readFileSync(
      join(__dirname, '../../../src/external-services/production-enabled.ts'),
      'utf8',
    ).replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/process\.env|readFileSync|require\(|import\(|fs'/);
    expect(isEnabledInProduction('kms', ['kms' as ExternalService])).toBe(true);
    expect(isEnabledInProduction('kms')).toBe(false);
  });
});
