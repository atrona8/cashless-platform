// Tests de check-baseline-decision.mjs : dépôt git d'essai (jamais le dépôt réel).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), 'check-baseline-decision.mjs');
const FILE = 'tools/contract-stability/contract-baseline.json';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-decision-'));
  const git = (...a) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
      cwd: dir,
      stdio: 'pipe',
    });
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'tools/contract-stability'), { recursive: true });
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, FILE), '{"v":1}\n');
  writeFileSync(join(dir, 'docs/DECISIONS_ADR.md'), '# ADR\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feat');
  return { dir, git };
}
const run = (dir, extra = []) => {
  const r = spawnSync('node', [TOOL, '--repo', dir, '--main-ref', 'main', ...extra], {
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout + r.stderr };
};

test('référence inchangée : 0', () => {
  const { dir } = repo();
  assert.equal(run(dir).code, 0);
});
test('référence changée sans décision : 2 (un contrôle toujours 0 échouerait ici)', () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, FILE), '{"v":2}\n');
  git('commit', '-q', '-am', 'change sans décision');
  const r = run(dir);
  assert.equal(r.code, 2, r.out);
});
test('référence changée avec décision dans le commit : 0', () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, FILE), '{"v":2}\n');
  git('commit', '-q', '-am', 'change\n\nDécision du porteur : 2026-11-05 ADR-157');
  assert.equal(run(dir).code, 0);
});
test('référence changée avec décision dans DECISIONS_ADR.md : 0', () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, FILE), '{"v":2}\n');
  writeFileSync(join(dir, 'docs/DECISIONS_ADR.md'), 'Décision du porteur : 05/11/2026 ADR-157\n');
  git('commit', '-q', '-am', 'change');
  assert.equal(run(dir).code, 0);
});
test('pannes : référence main absente, option inconnue : 1', () => {
  const { dir } = repo();
  assert.equal(run(dir, ['--main-ref', 'nexiste-pas']).code, 1);
  assert.equal(run(dir, ['--bogus', 'x']).code, 1);
});
