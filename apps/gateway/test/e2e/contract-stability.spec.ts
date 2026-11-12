// T116 / NFR-012, SC-006 : contrôle de stabilité du contrat, lancé comme la CI le lance
// (`node tools/contract-stability/check.mjs`). Codes de sortie : 0 rien de refusé, 2 différence
// refusée (seul code qui prouve un refus), 1 panne de l'outil. Le test distingue 2 de 1 : un
// contrôle qui « refuse » parce qu'il plante ne prouve rien (A23).
//   - dépôt tel quel : 0 (témoin positif) ;
//   - copie dont une route HORS `/edge/*` change : 2, le pointeur est nommé ;
//   - copie où une valeur d'énumération est ajoutée : 2 ;
//   - référence introuvable, falsifiée ou option inconnue, fichier absent : 1, jamais 0 ni 2.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..');
const CHECK = join(REPO, 'tools', 'contract-stability', 'check.mjs');
const OPENAPI = join(REPO, 'packages', 'contracts', 'openapi.yaml');

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'm8-stability-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function check(args: string[]): { code: number | null; out: string } {
  const run = spawnSync(process.execPath, [CHECK, ...args], { cwd: REPO, encoding: 'utf8' });
  return { code: run.status, out: `${run.stdout}\n${run.stderr}` };
}

/** Copie de `openapi.yaml` dont `from` (présent une fois) devient `to`. */
function candidate(name: string, from: string, to: string): string {
  const text = readFileSync(OPENAPI, 'utf8');
  // Une seule occurrence : la copie ne change qu'à cet endroit.
  expect(text.split(from).length - 1).toBe(1);
  const file = join(dir, name);
  writeFileSync(file, text.replace(from, to));
  return file;
}

describe('NFR-012 : stabilité du contrat', () => {
  it('le contrat du dépôt : sortie 0, uniquement des ajouts admis (témoin positif)', () => {
    const { code, out } = check([]);
    expect(code).toBe(0);
    expect(out).toMatch(/0 refusée/);
    expect(out).not.toMatch(/REFUSÉE/);
  });

  it('une route hors /edge/* modifiée dans une copie : sortie 2, pointeur nommé', () => {
    const file = candidate(
      'summary.yaml',
      "summary: Lister les personnes du personnel d'un prestataire",
      "summary: Lister les personnes du personnel d'un prestataire (modifié)",
    );
    const { code, out } = check(['--candidate', file]);
    expect(code).toBe(2);
    expect(out).toMatch(/REFUSÉE/);
    expect(out).toMatch(/\/paths\/~1operators~1\{operator_id\}~1users/);
  });

  it('une valeur d’énumération ajoutée dans une copie : sortie 2', () => {
    const file = candidate(
      'enum.yaml',
      'enum: [ACTIVE, BLOCKED, CLOSED]\n    TapInput:',
      'enum: [ACTIVE, BLOCKED, CLOSED, ARCHIVED]\n    TapInput:',
    );
    const { code, out } = check(['--candidate', file]);
    expect(code).toBe(2);
    expect(out).toMatch(/WalletStatus/);
  });

  it('un champ obligatoire ajouté à un schéma partagé : sortie 2', () => {
    const file = candidate(
      'required.yaml',
      '      required: [nfc_uid, token_hash, counter, key_index, pack_verified, occurred_at]',
      '      required: [nfc_uid, token_hash, counter, key_index, pack_verified, occurred_at, x]',
    );
    expect(check(['--candidate', file]).code).toBe(2);
  });

  it('une route /edge/* modifiée (description) : sortie 2 aussi, le texte est le contrat', () => {
    const file = candidate(
      'edge-summary.yaml',
      'summary: Flux de réplication central → passerelle',
      'summary: Flux de réplication central → passerelle (modifié)',
    );
    expect(check(['--candidate', file]).code).toBe(2);
  });
});

describe('NFR-012 : les pannes de l’outil sortent 1, jamais 0 ni 2 (A23)', () => {
  it('fichier candidat absent : sortie 1', () => {
    expect(check(['--candidate', join(dir, 'absent.yaml')]).code).toBe(1);
  });

  it('YAML invalide : sortie 1', () => {
    const file = join(dir, 'invalide.yaml');
    writeFileSync(file, 'openapi: [3.1\n  paths: {{{');
    expect(check(['--candidate', file]).code).toBe(1);
  });

  it('référence falsifiée (SHA-256 différente de la valeur épinglée) : sortie 1', () => {
    const forged = join(dir, 'baseline-falsifiee.yaml');
    writeFileSync(forged, `${readFileSync(OPENAPI, 'utf8')}\n# falsifié\n`);
    const { code, out } = check(['--baseline-file', forged]);
    expect(code).toBe(1);
    expect(out).not.toMatch(/Total : /);
  });

  it('référence introuvable (fichier absent) : sortie 1', () => {
    expect(check(['--baseline-file', join(dir, 'pas-de-reference.yaml')]).code).toBe(1);
  });

  it('option inconnue : sortie 1', () => {
    expect(check(['--option-inconnue']).code).toBe(1);
  });

  it('empreinte de référence épinglée modifiée : sortie 1, pas un refus', () => {
    const baseline = JSON.parse(
      readFileSync(join(REPO, 'tools', 'contract-stability', 'contract-baseline.json'), 'utf8'),
    ) as Record<string, unknown>;
    const wrong = join(dir, 'baseline-json-faux.json');
    writeFileSync(
      wrong,
      JSON.stringify({
        ...baseline,
        baseline: { ...(baseline.baseline as Record<string, unknown>), sha256: '0'.repeat(64) },
      }),
    );
    const { code } = check(['--baseline-json', wrong]);
    expect(code).toBe(1);
  });

  it('les trois sorties sont bien distinctes : 0, 2 et 1', () => {
    const codes = [
      check([]).code,
      check([
        '--candidate',
        candidate(
          'd.yaml',
          'enum: [ACTIVE, BLOCKED, CLOSED]\n    TapInput:',
          'enum: [ACTIVE, BLOCKED, CLOSED, X]\n    TapInput:',
        ),
      ]).code,
      check(['--candidate', join(dir, 'nope.yaml')]).code,
    ];
    expect(codes).toEqual([0, 2, 1]);
  });
});
