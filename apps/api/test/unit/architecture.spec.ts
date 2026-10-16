// Cloisonnement (research R-03) : seul src/db/ touche `pg` et les jetons des pools ; aucun `SET app.` dans src/.
// La transaction de plateforme (contrat platform-access) n'est importée que par les services de plateforme.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '../../src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
const imports = (text: string): string[] => [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);

describe('architecture', () => {
  it('aucun fichier hors db/ n’importe pg (valeurs) ni le jeton du pool', () => {
    const offenders = files
      .filter((file) => !file.path.startsWith('db/'))
      .filter((file) =>
        imports(file.text).some((source) => source.endsWith('pool.token')) ||
        // `import type` de pg est permis (types seulement, aucune connexion possible).
        /^import\s+(?!type\b)[^;]*from\s+'pg'/m.test(file.text),
      )
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('aucun SET app. dans src/ (set_config(…, true) seulement)', () => {
    expect(files.filter((file) => /SET\s+(LOCAL\s+)?app\./i.test(file.text)).map((f) => f.path)).toEqual([]);
  });

  it('les jetons des pools ne sont pas exportés par DbModule', () => {
    const module = files.find((file) => file.path === 'db/db.module.ts');
    expect(module?.text).toMatch(/exports:\s*\[TenantTx, PlatformTx, APP_CONFIG\]/);
  });

  it('PlatformTx n’est importée que par db/, idempotency/, approval/ et les fichiers de plateforme', () => {
    const allowed = [
      /^db\//,
      /^idempotency\//,
      /^approval\//,
      /^organization\/platform\//,
      /^configuration\/jurisdiction[^/]*$/,
      /^configuration\/platform-[^/]*$/,
    ];
    const offenders = files
      .filter((file) => imports(file.text).some((source) => source.endsWith('/platform-tx')))
      .filter((file) => !allowed.some((pattern) => pattern.test(file.path)))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('la transaction de plateforme ne pose jamais de prestataire', () => {
    const platformTx = files.find((file) => file.path === 'db/platform-tx.ts');
    expect(platformTx?.text).toMatch(/set_config\('app\.scope', 'platform', true\)/);
    expect(platformTx?.text.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/app\.operator_id/);
  });

  it('seul db/ nomme le pool de la plateforme', () => {
    expect(files.filter((file) => !file.path.startsWith('db/') && file.text.includes('PG_PLATFORM_POOL')).map((f) => f.path)).toEqual([]);
  });

  // ----- Mission bracelets-nfc : séparation des droits sur le service de clés (SPECIFICATION §3.2, NFR-005) -----

  /** Fichiers atteignables depuis `entry` en suivant les imports relatifs (analyse statique). */
  function reachable(entry: string): Set<string> {
    const byPath = new Map(files.map((file) => [file.path, file]));
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (seen.has(current)) continue;
      const file = byPath.get(current);
      if (!file) continue;
      seen.add(current);
      const dir = current.split('/').slice(0, -1);
      for (const source of imports(file.text)) {
        if (!source.startsWith('.')) continue;
        const parts = [...dir];
        for (const segment of source.split('/')) {
          if (segment === '.' || segment === '') continue;
          if (segment === '..') parts.pop();
          else parts.push(segment);
        }
        const base = parts.join('/');
        queue.push(byPath.has(`${base}.ts`) ? `${base}.ts` : `${base}/index.ts`);
      }
    }
    return seen;
  }

  const ROOTS = {
    public: 'processes/public.module.ts',
    'tag-keys': 'processes/tag-keys.module.ts',
    personalization: 'processes/personalization.module.ts',
    'tag-check': 'processes/tag-check.module.ts',
    'key-admin': 'processes/key-admin.module.ts',
  } as const;
  /** Droits de chaque processus sur le service de clés (tableau de §3.2 ; décision du porteur n° 6 pour la commande). */
  const CAPABILITIES: Record<keyof typeof ROOTS, string[]> = {
    public: [],
    'tag-keys': ['decrypt'],
    personalization: ['mac', 'dataKey'],
    'tag-check': ['mac', 'decrypt'],
    'key-admin': ['keyAdmin'],
  };
  const PORT_TOKEN: Record<string, string> = { mac: 'MAC_PORT', dataKey: 'DATA_KEY_PORT', decrypt: 'DECRYPT_PORT', keyAdmin: 'KEY_ADMIN_PORT' };
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('l’API publique n’atteint aucun fichier du service de clés qui donne un port', () => {
    const seen = reachable(ROOTS.public);
    expect(seen.has('app.module.ts')).toBe(true);
    // claim-hash (empreinte des codes), production-guard et zeroize ne donnent aucun droit de clé.
    const forbidden = ['kms/kms.ports.ts', 'kms/fake-kms.ts', 'kms/kms.module.ts'];
    expect(forbidden.filter((path) => seen.has(path))).toEqual([]);
    expect([...seen].filter((path) => /KmsModule|MAC_PORT|DATA_KEY_PORT|DECRYPT_PORT|KEY_ADMIN_PORT/.test(code(files.find((f) => f.path === path)!.text)))).toEqual([]);
  });

  it.each(Object.keys(ROOTS) as Array<keyof typeof ROOTS>)('processus %s : demande exactement ses droits de clé', (name) => {
    const text = code(files.find((file) => file.path === ROOTS[name])!.text);
    const requested = /KmsModule\.forCapabilities\(\[([^\]]*)\]\)/.exec(text)?.[1];
    const list = requested === undefined ? [] : [...requested.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(list.sort()).toEqual([...CAPABILITIES[name]].sort());
  });

  it.each(Object.keys(ROOTS) as Array<keyof typeof ROOTS>)('processus %s : aucun fichier atteignable n’injecte un port de clé hors de ses droits', (name) => {
    const allowed = CAPABILITIES[name].map((capability) => PORT_TOKEN[capability]!);
    const offenders = [...reachable(ROOTS[name])]
      .filter((path) => !path.startsWith('kms/'))
      .flatMap((path) => {
        const text = code(files.find((file) => file.path === path)!.text);
        return Object.values(PORT_TOKEN)
          .filter((token) => !allowed.includes(token) && new RegExp(`\\b${token}\\b`).test(text))
          .map((token) => `${path} : ${token}`);
      });
    expect(offenders).toEqual([]);
  });

  it('le droit de créer ou de désactiver une clé n’est atteignable que depuis la commande d’administration', () => {
    const users = files.filter((file) => !file.path.startsWith('kms/') && /\bKEY_ADMIN_PORT\b/.test(code(file.text))).map((file) => file.path);
    for (const name of ['public', 'tag-keys', 'personalization', 'tag-check'] as const) {
      const seen = reachable(ROOTS[name]);
      expect(users.filter((path) => seen.has(path))).toEqual([]);
    }
  });

  it('chaque processus des clés n’ouvre que le pool de son rôle, jamais celui de l’API ni de la plateforme', () => {
    for (const name of ['tag-keys', 'personalization', 'tag-check', 'key-admin'] as const) {
      const text = code(files.find((file) => file.path === ROOTS[name])!.text);
      expect(text).toContain(`ProcessDbModule.forProcess('${name}')`);
      expect(text).not.toMatch(/\bDbModule\b(?!\.)/);
      const seen = reachable(ROOTS[name]);
      expect([...seen].filter((path) => path.endsWith('/platform-tx.ts'))).toEqual([]);
    }
    const processDb = code(files.find((file) => file.path === 'db/process-db.module.ts')!.text);
    expect(processDb).toContain('PG_POOL');
    expect(processDb).not.toMatch(/PG_PLATFORM_POOL|platform-tx|platformDatabaseUrl|config\.databaseUrl/);
  });

  it('l’API publique ne fait jamais SELECT * sur media ni ne nomme une colonne secrète', () => {
    const seen = reachable(ROOTS.public);
    const offenders = [...seen].filter((path) => {
      const text = code(files.find((file) => file.path === path)!.text);
      return /pwd_pack_enc|pwd_pack_dek_id|encrypted_dek|offline_snapshot_rows/.test(text) || /SELECT\s+(m\.)?\*\s+FROM\s+media\b/i.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('chaque point d’entrée passe par le démarrage commun, qui applique la garde de production', () => {
    const mains = files.filter((file) => /^main(\.[a-z-]+)?\.ts$/.test(file.path));
    expect(mains.map((file) => file.path).sort()).toEqual(['main.key-admin.ts', 'main.personalization.ts', 'main.tag-check.ts', 'main.tag-keys.ts', 'main.ts']);
    for (const main of mains) expect(code(main.text)).toMatch(/\b(serve|runWorkers)\(/);
    const bootstrap = code(files.find((file) => file.path === 'processes/bootstrap.ts')!.text);
    expect(bootstrap.match(/assertProcessIsSafe\(app\)/g)).toHaveLength(2);
    expect(bootstrap).toMatch(/assertNoFakeInProduction\(config\.production/);
  });
});
