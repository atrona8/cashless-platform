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

const files = sources(SRC).map((path) => ({
  path: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));
const imports = (text: string): string[] =>
  [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);

describe('architecture', () => {
  it('aucun fichier hors db/ n’importe pg (valeurs) ni le jeton du pool', () => {
    const offenders = files
      .filter((file) => !file.path.startsWith('db/'))
      .filter(
        (file) =>
          imports(file.text).some((source) => source.endsWith('pool.token')) ||
          // `import type` de pg est permis (types seulement, aucune connexion possible).
          /^import\s+(?!type\b)[^;]*from\s+'pg'/m.test(file.text),
      )
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('aucun SET app. dans src/ (set_config(…, true) seulement)', () => {
    expect(
      files.filter((file) => /SET\s+(LOCAL\s+)?app\./i.test(file.text)).map((f) => f.path),
    ).toEqual([]);
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
    expect(
      files
        .filter((file) => !file.path.startsWith('db/') && file.text.includes('PG_PLATFORM_POOL'))
        .map((f) => f.path),
    ).toEqual([]);
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

  const BASE_ROOTS = {
    public: 'processes/public.module.ts',
    'tag-keys': 'processes/tag-keys.module.ts',
    personalization: 'processes/personalization.module.ts',
    'tag-check': 'processes/tag-check.module.ts',
    'key-admin': 'processes/key-admin.module.ts',
    maintenance: 'processes/maintenance.module.ts',
    'snapshot-content': 'processes/snapshot-content.module.ts',
    'snapshot-signer': 'processes/snapshot-signer.module.ts',
    // Mission passerelle-locale, WP10 : processus `edge`, aucun droit de clé.
    edge: 'processes/edge.module.ts',
    // Mission 11a, WP06 (OP-N76) : processus `vendor-pin`, aucun droit de clé.
    'vendor-pin': 'processes/vendor-pin.module.ts',
  } as const;
  // Processus des lots WP11 (snapshot-content) et WP13 (snapshot-signer) : leurs lots ajoutent leur
  // racine ici ; tant que le fichier n'existe pas, la liste ne les attend pas.
  const LATER_ROOTS = {
    'snapshot-content': 'processes/snapshot-content.module.ts',
    'snapshot-signer': 'processes/snapshot-signer.module.ts',
  } as const;
  type ProcessName = keyof typeof BASE_ROOTS | keyof typeof LATER_ROOTS;
  const ROOTS = {
    ...BASE_ROOTS,
    ...Object.fromEntries(
      Object.entries(LATER_ROOTS).filter(([, path]) => files.some((file) => file.path === path)),
    ),
  } as Record<ProcessName, string>;
  const PROCESS_NAMES = Object.keys(ROOTS) as ProcessName[];
  /**
   * Droits de chaque processus sur le service de clés (tableau de §3.2 ; décision du porteur n° 6 pour la commande ;
   * décision du 30/10 : `sign` au seul snapshot-signer, `key-admin` ne reçoit jamais `sign`).
   */
  const CAPABILITIES: Record<ProcessName, string[]> = {
    public: [],
    'tag-keys': ['decrypt'],
    personalization: ['mac', 'dataKey'],
    'tag-check': ['mac', 'decrypt'],
    'key-admin': ['keyAdmin'],
    maintenance: [],
    'snapshot-content': ['dataKey', 'decrypt'],
    'snapshot-signer': ['sign'],
    edge: [],
    'vendor-pin': [],
  };
  const PORT_TOKEN: Record<string, string> = {
    mac: 'MAC_PORT',
    dataKey: 'DATA_KEY_PORT',
    decrypt: 'DECRYPT_PORT',
    keyAdmin: 'KEY_ADMIN_PORT',
    sign: 'SIGN_PORT',
  };
  const code = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('l’API publique n’atteint aucun fichier du service de clés qui donne un port', () => {
    const seen = reachable(ROOTS.public);
    expect(seen.has('app.module.ts')).toBe(true);
    // claim-hash (empreinte des codes), production-guard et zeroize ne donnent aucun droit de clé.
    const forbidden = ['kms/kms.ports.ts', 'kms/fake-kms.ts', 'kms/kms.module.ts'];
    expect(forbidden.filter((path) => seen.has(path))).toEqual([]);
    expect(
      [...seen].filter((path) =>
        /KmsModule|MAC_PORT|DATA_KEY_PORT|DECRYPT_PORT|KEY_ADMIN_PORT|SIGN_PORT/.test(
          code(files.find((f) => f.path === path)!.text),
        ),
      ),
    ).toEqual([]);
  });

  it.each(PROCESS_NAMES)('processus %s : demande exactement ses droits de clé', (name) => {
    const text = code(files.find((file) => file.path === ROOTS[name])!.text);
    const requested = /KmsModule\.forCapabilities\(\[([^\]]*)\]\)/.exec(text)?.[1];
    const list =
      requested === undefined ? [] : [...requested.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(list.sort()).toEqual([...CAPABILITIES[name]].sort());
  });

  it.each(PROCESS_NAMES)(
    'processus %s : aucun fichier atteignable n’injecte un port de clé hors de ses droits',
    (name) => {
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
    },
  );

  it('le droit de créer ou de désactiver une clé n’est atteignable que depuis la commande d’administration', () => {
    const users = files
      .filter((file) => !file.path.startsWith('kms/') && /\bKEY_ADMIN_PORT\b/.test(code(file.text)))
      .map((file) => file.path);
    for (const name of PROCESS_NAMES.filter((n) => n !== 'key-admin')) {
      const seen = reachable(ROOTS[name]);
      expect(users.filter((path) => seen.has(path))).toEqual([]);
    }
  });

  it('le droit de signer n’est atteignable que depuis snapshot-signer, jamais depuis key-admin', () => {
    const users = files
      .filter((file) => !file.path.startsWith('kms/') && /\bSIGN_PORT\b/.test(code(file.text)))
      .map((file) => file.path);
    for (const name of PROCESS_NAMES.filter((n) => n !== 'snapshot-signer')) {
      const seen = reachable(ROOTS[name]);
      expect(users.filter((path) => seen.has(path))).toEqual([]);
    }
    expect(CAPABILITIES['key-admin']).not.toContain('sign');
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
    expect(processDb).not.toMatch(
      /PG_PLATFORM_POOL|platform-tx|platformDatabaseUrl|config\.databaseUrl/,
    );
  });

  // Mission hors-ligne-snapshots-lots, WP10 (OP-N75) : les purges des terminaux sortent de l'API publique.
  it('processus maintenance : le pool de son rôle seul, jamais DbModule ni platform-tx', () => {
    const text = code(files.find((file) => file.path === ROOTS.maintenance)!.text);
    expect(text).toContain('MaintenanceDbModule');
    expect(text).not.toMatch(/\bDbModule\b(?!\.)/);
    expect(text).not.toMatch(/\b(AuditModule|KmsModule)\b/);
    const seen = reachable(ROOTS.maintenance);
    expect([...seen].filter((path) => path.endsWith('/platform-tx.ts'))).toEqual([]);
    expect(seen.has('db/db.module.ts')).toBe(false);
    expect(seen.has('device-identity/device-maintenance.ts')).toBe(true);
  });

  it('les purges des terminaux (device-maintenance.ts) ne sont pas atteignables depuis l’API publique', () => {
    expect(reachable(ROOTS.public).has('device-identity/device-maintenance.ts')).toBe(false);
  });

  it('maintenance-db.module.ts ne nomme ni le pool de la plateforme ni la chaîne de l’API', () => {
    const module = code(files.find((file) => file.path === 'db/maintenance-db.module.ts')!.text);
    expect(module).toContain('PG_POOL');
    expect(module).toContain('maintenanceDatabaseUrl');
    expect(module).not.toMatch(
      /PG_PLATFORM_POOL|platform-tx|platformDatabaseUrl|config\.databaseUrl/,
    );
  });

  // Exemption étroite (décision du porteur, 04/11/2026 ; ADR-150, OP-N97) : le service des snapshots met en forme
  // l'enveloppe `pwd_pack_enc` (chiffrée sous K_v) que le contrat sert au terminal. Ce nom, et lui seul, est permis
  // dans ce fichier, et nulle part ailleurs. Liste figée : l'agrandir exige une décision du porteur et un ADR.
  const SECRET_NAME_EXEMPTIONS: ReadonlyArray<{ file: string; name: string }> = [
    { file: 'offline/snapshots/offline-snapshots.service.ts', name: 'pwd_pack_enc' },
  ];
  const secretNames = (path: string, text: string): boolean => {
    const allowed = SECRET_NAME_EXEMPTIONS.filter((e) => e.file === path).map((e) => e.name);
    const stripped = allowed.reduce((t, name) => t.split(name).join(''), text);
    return (
      /pwd_pack_enc|pwd_pack_dek_id|encrypted_dek|offline_snapshot_rows/.test(stripped) ||
      /SELECT\s+(m\.)?\*\s+FROM\s+media\b/i.test(stripped)
    );
  };

  it('l’API publique ne fait jamais SELECT * sur media ni ne nomme une colonne secrète', () => {
    const seen = reachable(ROOTS.public);
    const offenders = [...seen].filter((path) =>
      secretNames(path, code(files.find((file) => file.path === path)!.text)),
    );
    expect(offenders).toEqual([]);
  });

  it('exemption des noms secrets : liste figée, un seul nom dans un seul fichier', () => {
    expect(SECRET_NAME_EXEMPTIONS).toEqual([
      { file: 'offline/snapshots/offline-snapshots.service.ts', name: 'pwd_pack_enc' },
    ]);
    expect(files.some((f) => f.path === SECRET_NAME_EXEMPTIONS[0]!.file)).toBe(true);
  });

  it('exemption des noms secrets (contrôle) : le même nom ailleurs, ou un autre nom, est attrapé', () => {
    const exempt = SECRET_NAME_EXEMPTIONS[0]!.file;
    expect(secretNames(exempt, 'const a = e.pwd_pack_enc;')).toBe(false);
    expect(secretNames('offline/other.service.ts', 'const a = e.pwd_pack_enc;')).toBe(true);
    for (const name of ['pwd_pack_dek_id', 'encrypted_dek', 'offline_snapshot_rows'])
      expect(secretNames(exempt, `x.${name}`)).toBe(true);
    expect(secretNames(exempt, 'SELECT * FROM media')).toBe(true);
  });

  // Mission 11a, WP06 (OP-N76, ADR-121) : le secret des empreintes de PIN n'existe que dans le processus
  // `vendor-pin`. L'exemption de `config/config.ts` (transition WP04) est levée par WP07 : `AppConfig`
  // ne porte plus le champ ; seule la fonction `vendorPinSettings` du processus le lit (voir plus bas).
  const PIN_SECRET_NAME = /\bvendorPinSecret\b|\bVENDOR_PIN_SECRET\b/;
  const PIN_SECRET_SETTINGS_FILE = 'config/config.ts';

  it('le secret des PIN (VENDOR_PIN_SECRET) n’est lu que par le processus vendor-pin', () => {
    const readers = files
      .filter((file) => PIN_SECRET_NAME.test(code(file.text)))
      .map((file) => file.path)
      .filter((path) => path !== PIN_SECRET_SETTINGS_FILE);
    expect(readers.length).toBeGreaterThan(0);
    const inPinProcess = reachable(ROOTS['vendor-pin']);
    expect(readers.filter((path) => !inPinProcess.has(path))).toEqual([]);
    const inPublic = reachable(ROOTS.public);
    expect(readers.filter((path) => inPublic.has(path))).toEqual([]);
    // Le seul lecteur du champ de configuration du processus est son module serveur.
    expect(readers).toContain('vendor-pin/vendor-pin-server.module.ts');
  });

  it('WP07 : hors vendor-pin/, seul config/config.ts nomme le secret (vendorPinSettings), jamais AppConfig', () => {
    const outside = files
      .filter((file) => PIN_SECRET_NAME.test(code(file.text)))
      .map((file) => file.path)
      .filter((path) => !path.startsWith('vendor-pin/'));
    expect(outside).toEqual([PIN_SECRET_SETTINGS_FILE]);
    // Exemption nommée : le champ n'est plus dans `AppConfig`, ni lu par `loadConfig`.
    const config = code(files.find((file) => file.path === PIN_SECRET_SETTINGS_FILE)!.text);
    const appConfig = config.slice(
      config.indexOf('export interface AppConfig'),
      config.indexOf('\n}\n', config.indexOf('export interface AppConfig')),
    );
    expect(appConfig.length).toBeGreaterThan(100);
    expect(appConfig).not.toMatch(PIN_SECRET_NAME);
    const loader = config.slice(config.indexOf('export function loadConfig'));
    expect(loader.slice(0, loader.indexOf('\nexport '))).not.toMatch(PIN_SECRET_NAME);
  });

  it('processus vendor-pin : le pool de son rôle seul, ni PlatformTx, ni pool de l’API, ni KmsModule', () => {
    const text = code(files.find((file) => file.path === ROOTS['vendor-pin'])!.text);
    expect(text).toContain("ProcessDbModule.forProcess('vendor-pin')");
    expect(text).not.toMatch(/\bDbModule\b(?!\.)/);
    expect(text).not.toMatch(/\b(KmsModule|DeviceIdentityModule)\b/);
    const seen = reachable(ROOTS['vendor-pin']);
    expect([...seen].filter((path) => path.endsWith('/platform-tx.ts'))).toEqual([]);
    expect(seen.has('db/db.module.ts')).toBe(false);
    expect(seen.has('kms/kms.module.ts')).toBe(false);
    expect(seen.has('device-identity/device-identity.module.ts')).toBe(false);
    const poolTokens = [...seen].filter((path) =>
      imports(files.find((file) => file.path === path)!.text).some((s) =>
        /pool\.token$|platform-tx$/.test(s),
      ),
    );
    expect(poolTokens.every((path) => path.startsWith('db/'))).toBe(true);
  });

  // ----- Mission 11a : OP-N151 (PIN en transit) et OP-N159 (c) (argon2 hors de l'API) -----

  /** Appels qui écrivent ou journalisent : le champ `pin` n'y figure jamais hors de `vendor-pin/`. */
  const SINKS =
    /(?:\.query|\.record|\.log\w*|\.warn|\.error|\.info|\.debug|\.verbose|\.write|console\.\w+|logger\.\w+|Logger\.\w+)\s*\(/g;
  /** Texte de l'appel qui commence à `start` (parenthèses équilibrées). */
  function callText(text: string, start: number): string {
    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      if (text[i] === ')' && --depth === 0) return text.slice(start, i + 1);
    }
    return text.slice(start);
  }
  /** Appels d'écriture ou de journal dont les arguments nomment le PIN (`pin`, `.pin`, `pin:`). */
  function pinSinks(text: string): string[] {
    const source = code(text);
    return [...source.matchAll(SINKS)]
      .map((m) => callText(source, m.index! + m[0].length - 1))
      .filter((call) => /(?<![A-Za-z0-9_])pin(?![A-Za-z0-9_])/.test(call));
  }

  it('OP-N151 : hors de vendor-pin/, aucun fichier ne persiste ni ne journalise le champ pin', () => {
    const offenders = files
      .filter((file) => !file.path.startsWith('vendor-pin/'))
      .filter((file) => pinSinks(file.text).length > 0)
      .map((file) => file.path);
    expect(offenders).toEqual([]);
    // Les fichiers qui manipulent le champ sont connus (liste figée) : un nouveau est à relire.
    const handlers = files
      .filter((file) => !file.path.startsWith('vendor-pin/'))
      .filter((file) =>
        /(?<![A-Za-z0-9_'.-])(?:input|body|call)\.pin\b|\{ pin \}/.test(code(file.text)),
      )
      .map((file) => file.path)
      .sort();
    expect(handlers).toEqual([
      'vendors/vendor-pin.client.ts',
      'vendors/vendor-sessions.service.ts',
      'vendors/vendors.controller.ts',
      'vendors/vendors.dto.ts',
    ]);
  });

  it('OP-N151 (contrôle) : un appel de journal ou d’écriture qui nomme le pin est attrapé', () => {
    expect(
      pinSinks("this.audit.record(client, { action: 'X', after: { pin: input.pin } });"),
    ).toHaveLength(1);
    expect(pinSinks("client.query('INSERT INTO t VALUES ($1)', [pin]);")).toHaveLength(1);
    expect(pinSinks('logger.warn(`essai ${input.pin}`);')).toHaveLength(1);
    expect(pinSinks("client.query('SELECT 1', [pinHash]);")).toHaveLength(0);
    expect(pinSinks("// logger.warn(pin)\n const x = 'pin';")).toHaveLength(0);
  });

  it('OP-N159 (c) : aucun import de vendor-pin.hasher, vendor-pin.digester ni argon2 hors de vendor-pin/', () => {
    const importers = (pattern: RegExp): string[] =>
      files
        .filter((file) => !file.path.startsWith('vendor-pin/'))
        .filter((file) => imports(file.text).some((source) => pattern.test(source)))
        .map((file) => file.path)
        .sort();
    expect(importers(/(^|\/)vendor-pin\.digester$/)).toEqual([]);
    expect(importers(/^argon2$/)).toEqual([]);
    // Seule exemption nommée : le dérivé d'idempotence du PIN (ADR-126) résout `VendorPinHasher`.
    expect(importers(/(^|\/)vendor-pin\.hasher$/)).toEqual([
      'idempotency/idempotency.interceptor.ts',
    ]);
    // `vendors/` n'atteint ni le hacheur ni argon2 : le motif du PIN vient d'un module neutre.
    const reached = reachable('vendors/vendors.dto.ts');
    expect([...reached].filter((path) => /vendor-pin\.(hasher|digester)\.ts$/.test(path))).toEqual(
      [],
    );
    expect(code(files.find((file) => file.path === 'common/pin-pattern.ts')!.text)).not.toMatch(
      /\bimport\b/,
    );
  });

  it('chaque point d’entrée passe par le démarrage commun, qui applique la garde de production', () => {
    const mains = files.filter((file) => /^main(\.[a-z-]+)?\.ts$/.test(file.path));
    expect(mains.map((file) => file.path).sort()).toEqual([
      'main.edge.ts',
      'main.key-admin.ts',
      'main.maintenance.ts',
      'main.personalization.ts',
      'main.psp-poller.ts',
      'main.snapshot-content.ts',
      'main.snapshot-signer.ts',
      'main.tag-check.ts',
      'main.tag-keys.ts',
      'main.ts',
      'main.vendor-pin.ts',
    ]);
    for (const main of mains) expect(code(main.text)).toMatch(/\b(serve|runWorkers)\(/);
    const bootstrap = code(files.find((file) => file.path === 'processes/bootstrap.ts')!.text);
    expect(bootstrap.match(/assertProcessIsSafe\(app\)/g)).toHaveLength(2);
    expect(bootstrap).toMatch(/assertNoFakeInProduction\(config\.production/);
  });

  // Mission 11b, D4 : `cashless_app` n'a plus UPDATE sur `anomaly`. Un verrou de ligne (`FOR UPDATE`, `FOR SHARE`, ...)
  // ou une écriture directe côté API échoue en 42501 en production (régression de `cash-due.service.ts`, cycle 3).
  // Les clôtures passent par des fonctions SECURITY DEFINER de la base.
  it('aucun verrou ni UPDATE/DELETE direct sur la table anomaly dans src/', () => {
    const offenders = files
      .filter((f) => /\b(?:FROM|UPDATE|DELETE\s+FROM)\s+(?:public\.)?anomaly\b/i.test(f.text))
      .filter((f) => {
        const text = f.text.replace(/\/\/.*$/gm, '');
        const writes = /\b(?:UPDATE|DELETE\s+FROM)\s+(?:public\.)?anomaly\b/i.test(text);
        const locks = [...text.matchAll(/`[^`]*\banomaly\b[^`]*`/gis)].some((m) =>
          /\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b/i.test(m[0]),
        );
        return writes || locks;
      })
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
