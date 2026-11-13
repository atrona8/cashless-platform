// Pureté du paquet (mission 8, WP02) : aucun import de Nest, de `pg`, du disque, du réseau ni d'un chemin de `apps/`.
// Le contrôle positif prouve que la détection n'est pas vide.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SRC = join(__dirname, '../src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Ôte les commentaires de ligne et de bloc avant la recherche. */
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function specifiers(text: string): string[] {
  const t = code(text);
  return [
    ...t.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...t.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
    ...t.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]!);
}

const FORBIDDEN_MODULES = [
  /^@nestjs\//,
  /^pg(\/|$)/,
  /^(node:)?fs(\/|$)/,
  /^(node:)?net$/,
  /^(node:)?tls$/,
  /^(node:)?http2?$/,
  /^(node:)?https$/,
  /^(node:)?child_process$/,
  /^(node:)?dgram$/,
];

/** Imports interdits d'un fichier ; `root` borne les chemins relatifs. */
function offences(file: string, root: string): string[] {
  const text = readFileSync(file, 'utf8');
  return specifiers(text).filter((s) => {
    if (FORBIDDEN_MODULES.some((re) => re.test(s))) return true;
    if (/(^|\/)apps\//.test(s)) return true;
    if (s.startsWith('.')) {
      const target = resolve(dirname(file), s);
      return target !== root && !target.startsWith(root + sep);
    }
    return false;
  });
}

function scan(root: string): string[] {
  return sources(root).flatMap((f) =>
    offences(f, root).map((s) => `${relative(root, f).split(sep).join('/')} -> ${s}`),
  );
}

describe('architecture du paquet @cashless/shared-rules', () => {
  it('le paquet contient des sources (le test n’est pas vide)', () => {
    expect(sources(SRC).length).toBeGreaterThanOrEqual(10);
  });

  it('aucun import interdit dans src/', () => {
    expect(scan(SRC)).toEqual([]);
  });

  describe('contrôle positif : la détection échoue sur une version fautive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shared-rules-arch-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it.each([
      ["import { Pool } from 'pg';", 'pg'],
      ["import type { Client } from 'pg';", 'pg'],
      ["import { Injectable } from '@nestjs/common';", '@nestjs/common'],
      ["import { readFileSync } from 'node:fs';", 'node:fs'],
      ["import { readFile } from 'fs/promises';", 'fs/promises'],
      ["import { createServer } from 'node:net';", 'node:net'],
      ["import http from 'node:http';", 'node:http'],
      ["import https from 'node:https';", 'node:https'],
      ["const x = require('node:fs');", 'node:fs'],
      ["const x = await import('pg');", 'pg'],
      [
        "import { x } from '../../../apps/api/src/config/config';",
        '../../../apps/api/src/config/config',
      ],
      ["import { x } from '../outside';", '../outside'],
    ])('%s', (line, specifier) => {
      const root = join(dir, 'src');
      mkdirSync(root, { recursive: true });
      const file = join(root, 'fautif.ts');
      writeFileSync(file, `${line}\n`);
      expect(offences(file, root)).toEqual([specifier]);
    });

    it('un import permis n’est pas signalé', () => {
      const root = join(dir, 'ok');
      mkdirSync(root, { recursive: true });
      const file = join(root, 'bon.ts');
      writeFileSync(
        file,
        "import { createHash } from 'node:crypto';\nimport canonicalize from 'canonicalize';\n" +
          "import type { components } from '@cashless/contracts';\nimport { a } from './a';\n" +
          "// import { Pool } from 'pg';\n",
      );
      expect(offences(file, root)).toEqual([]);
    });
  });
});
