// Canari (research R-27, A22) : une valeur secrète fictive, toutes ses représentations, et la
// recherche de
// chacune dans un fichier, un répertoire, une sortie de `pg_dump`, un journal ou une sortie de
// processus enfant.
// CONTRÔLE POSITIF OBLIGATOIRE : `assertSearchersDetectLeak` plante une fuite volontaire sous
// chaque représentation
// et échoue si un chercheur la rate (une recherche qui ne trouve jamais rien ne prouve rien).
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Representation {
  name: string;
  needle: Buffer;
}

export interface Canary {
  /** Valeur textuelle (contient des caractères à échapper : guillemet, barre oblique inverse,
  /** apostrophe). */
  text: string;
  bytes: Buffer;
  representations: Representation[];
}

/** Base64 d'une sous-chaîne d'octets, aux trois alignements possibles dans un flux plus long. */
function base64Aligned(bytes: Buffer, url: boolean): Representation[] {
  const out: Representation[] = [];
  for (let shift = 0; shift < 3; shift += 1) {
    const padded = Buffer.concat([Buffer.alloc(shift), bytes]);
    let encoded = padded.toString(url ? 'base64url' : 'base64').replace(/=+$/, '');
    const first = Math.ceil((shift * 8) / 6);
    const last = Math.floor(((shift + bytes.length) * 8) / 6);
    encoded = encoded.slice(first, last);
    out.push({ name: `${url ? 'base64url' : 'base64'}@${shift}`, needle: Buffer.from(encoded) });
  }
  return out;
}

export function makeCanary(label = 'CANARI'): Canary {
  const body = randomBytes(18).toString('hex');
  const text = `${label}-${body}"q\\z'`;
  const bytes = Buffer.from(text, 'utf8');
  const hex = bytes.toString('hex');
  const representations: Representation[] = [
    { name: 'utf8', needle: bytes },
    { name: 'hex-lower', needle: Buffer.from(hex) },
    { name: 'hex-upper', needle: Buffer.from(hex.toUpperCase()) },
    ...base64Aligned(bytes, false),
    ...base64Aligned(bytes, true),
    { name: 'json-escaped', needle: Buffer.from(JSON.stringify(text).slice(1, -1)) },
    { name: 'sql-escaped', needle: Buffer.from(text.replace(/'/g, "''")) },
    { name: 'bytea-hex', needle: Buffer.from(`\\x${hex}`) },
    { name: 'reversed-utf8', needle: Buffer.from(text.split('').reverse().join('')) },
  ];
  // Octets bruts aussi pour une valeur binaire (clé, empreinte) : on garde le corps seul sous
  // toutes ses formes.
  const core = Buffer.from(body, 'utf8');
  representations.push({ name: 'core-utf8', needle: core });
  return { text, bytes, representations };
}

/**
 * Canari tiré d'une valeur réelle du flux (mot de passe de bracelet, jeton) : mêmes
 * représentations, la valeur étant donnée par le banc et non tirée au sort.
 */
export function canaryOf(bytes: Buffer): Canary {
  const hex = bytes.toString('hex');
  const text = bytes.toString('utf8');
  const printable = Buffer.from(text, 'utf8').equals(bytes);
  const representations: Representation[] = [
    ...(printable ? [{ name: 'utf8', needle: bytes }] : []),
    { name: 'hex-lower', needle: Buffer.from(hex) },
    { name: 'hex-upper', needle: Buffer.from(hex.toUpperCase()) },
    ...base64Aligned(bytes, false),
    ...base64Aligned(bytes, true),
    { name: 'bytea-hex', needle: Buffer.from(`\\x${hex}`) },
  ];
  if (printable) {
    representations.push(
      { name: 'json-escaped', needle: Buffer.from(JSON.stringify(text).slice(1, -1)) },
      { name: 'sql-escaped', needle: Buffer.from(text.replace(/'/g, "''")) },
    );
  }
  return { text, bytes, representations };
}

/** Noms des représentations trouvées dans `haystack`. */
export function findIn(canary: Canary, haystack: Buffer | string): string[] {
  const buf = typeof haystack === 'string' ? Buffer.from(haystack) : haystack;
  return canary.representations.filter((r) => buf.includes(r.needle)).map((r) => r.name);
}

export interface Hit {
  where: string;
  representations: string[];
}

export function searchFile(canary: Canary, file: string): Hit[] {
  const found = findIn(canary, readFileSync(file));
  return found.length ? [{ where: file, representations: found }] : [];
}

export function searchDirectory(canary: Canary, dir: string): Hit[] {
  const hits: Hit[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) hits.push(...searchDirectory(canary, path));
    else if (stat.size < 512 * 1024 * 1024) hits.push(...searchFile(canary, path));
  }
  return hits;
}

export function searchText(canary: Canary, where: string, text: string): Hit[] {
  const found = findIn(canary, text);
  return found.length ? [{ where, representations: found }] : [];
}

const PG_CONTAINER = process.env.M8_PG_CONTAINER ?? 'cashless-platform-pg17';

/** Sortie complète de `pg_dump` d'une base jetable du banc (refuse tout autre nom). */
export function pgDump(database: string): Buffer {
  if (!/^cashless_m8_[a-z0-9_]+$/.test(database)) throw new Error(`pg_dump refusé : ${database}`);
  return execFileSync('docker', ['exec', PG_CONTAINER, 'pg_dump', '-U', 'postgres', database], {
    maxBuffer: 1024 * 1024 * 1024,
  });
}

export function searchPgDump(canary: Canary, database: string): Hit[] {
  const found = findIn(canary, pgDump(database));
  return found.length ? [{ where: `pg_dump ${database}`, representations: found }] : [];
}

/**
 * Journal du serveur PostgreSQL du poste depuis `sinceIso` (`log_statement = all` à activer, par
 * base, par la suite). `docker logs --since` ne rend rien sur ce poste : on lit la fin du journal
 * et on filtre sur l'horodatage de chaque ligne (UTC, horloge de la VM, marge d'une minute).
 */
export function pgServerLog(sinceIso: string): string {
  // Le journal du serveur sort sur la sortie d'erreur du conteneur : on lit les deux flux.
  const run = spawnSync('docker', ['logs', '--tail', '150000', PG_CONTAINER], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  const out = `${run.stdout.toString()}\n${run.stderr.toString()}`;
  const since = new Date(Date.parse(sinceIso) - 60_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  const kept: string[] = [];
  let keep = false;
  let oldest = '9999';
  for (const line of out.split('\n')) {
    const stamp = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.\d+ UTC /.exec(line);
    if (stamp) {
      keep = stamp[1]! >= since;
      if (stamp[1]! < oldest) oldest = stamp[1]!;
    }
    if (keep) kept.push(line);
  }
  // Une très grande valeur de `--tail` fait perdre les lignes récentes à ce démon : on lit une
  // fenêtre bornée et on refuse de conclure si elle ne remonte pas jusqu'à `since`.
  if (oldest > since) throw new Error(`journal PostgreSQL trop court : débute à ${oldest}`);
  return kept.join('\n');
}

/**
 * Contrôle positif : pour CHAQUE représentation, une fuite volontaire est plantée dans un fichier,
 * un
 * répertoire ; chaque chercheur doit la trouver. Échoue sinon, avec la liste des ratés.
 */
export function assertSearchersDetectLeak(canary: Canary): void {
  const dir = mkdtempSync(join(tmpdir(), 'canary-control-'));
  const missed: string[] = [];
  try {
    for (const rep of canary.representations) {
      const file = join(dir, `${rep.name.replace(/[^a-z0-9]/gi, '_')}.txt`);
      writeFileSync(
        file,
        Buffer.concat([Buffer.from('avant '), rep.needle, Buffer.from(' après')]),
      );
      if (searchFile(canary, file).length === 0) missed.push(`fichier ${rep.name}`);
    }
    if (searchDirectory(canary, dir).length === 0) missed.push('répertoire');
    const clean = join(dir, 'propre');
    writeFileSync(clean, 'rien à voir ici');
    if (searchFile(canary, clean).length !== 0) missed.push('faux positif sur fichier propre');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (missed.length) throw new Error(`contrôle positif du canari raté : ${missed.join(', ')}`);
}

/** Échoue (liste les lieux) si une représentation est trouvée dans l'un des `hits`. */
export function assertNoLeak(hits: Hit[]): void {
  if (hits.length)
    throw new Error(
      `canari retrouvé : ${hits
        .map((h) => `${h.where} [${h.representations.join(', ')}]`)
        .join(' ; ')}`,
    );
}
