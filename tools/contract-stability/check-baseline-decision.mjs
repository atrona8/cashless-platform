#!/usr/bin/env node
// Garde-fou de propriété de la référence (A23, mission 8) : `contract-baseline.json` ne change que sur décision
// du porteur. Échoue si le fichier diffère de celui de `main` sans une ligne
// `Décision du porteur : <date> <référence ADR>` dans le dernier commit qui le touche ou dans
// `docs/DECISIONS_ADR.md`. Absent de `main` : compté comme différent.
//
// Codes : 0 inchangé ou décision consignée ; 2 changé sans décision ; 1 panne (git absent, référence `main`
// introuvable, option inconnue).
// Usage : node check-baseline-decision.mjs [--repo <dossier>] [--main-ref <réf>] [--file <chemin relatif>]
//         [--adr <chemin relatif>]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECISION = /Décision du porteur : (\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}) (ADR-\d+)/u;

class Failure extends Error {}

export function run(argv) {
  const opts = {
    repo: resolve(HERE, '..', '..'),
    'main-ref': '',
    file: 'tools/contract-stability/contract-baseline.json',
    adr: 'docs/DECISIONS_ADR.md',
  };
  const known = new Set(['--repo', '--main-ref', '--file', '--adr']);
  for (let i = 0; i < argv.length; i += 2) {
    if (!known.has(argv[i]) || argv[i + 1] === undefined) {
      throw new Failure(`usage : option inconnue ou sans valeur : ${argv[i]}`);
    }
    opts[argv[i].slice(2)] = argv[i + 1];
  }
  const git = (...args) => {
    try {
      return execFileSync('git', args, {
        cwd: opts.repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      throw new Failure(`git ${args.join(' ')} : ${String(err.stderr ?? err.message).trim()}`);
    }
  };
  const candidates = opts['main-ref'] ? [opts['main-ref']] : ['origin/main', 'main'];
  const ref = candidates.find((r) => {
    try {
      git('rev-parse', '--verify', '--quiet', `${r}^{commit}`);
      return true;
    } catch {
      return false;
    }
  });
  if (!ref) throw new Failure(`référence de main introuvable (${candidates.join(', ')})`);

  const path = resolve(opts.repo, opts.file);
  if (!existsSync(path)) throw new Failure(`fichier absent : ${opts.file}`);
  const current = readFileSync(path, 'utf8');
  let onMain = null;
  if (git('ls-tree', '--name-only', ref, '--', opts.file).trim())
    onMain = git('show', `${ref}:${opts.file}`);
  if (onMain === current) {
    console.log(`Référence inchangée par rapport à ${ref}`);
    return 0;
  }
  const message = git('log', '-1', '--format=%B', '--', opts.file);
  const adrPath = resolve(opts.repo, opts.adr);
  const adr = existsSync(adrPath) ? readFileSync(adrPath, 'utf8') : '';
  const found = DECISION.exec(message) ?? DECISION.exec(adr);
  if (found) {
    console.log(`Référence modifiée, décision du porteur consignée : ${found[1]} ${found[2]}`);
    return 0;
  }
  console.log(
    `REFUSÉE : ${opts.file} diffère de ${ref} sans ligne « Décision du porteur : <date> <référence ADR> »`,
  );
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(
      `[baseline-decision] PANNE : ${err instanceof Failure ? err.message : err.stack}`,
    );
    process.exitCode = 1;
  }
}
