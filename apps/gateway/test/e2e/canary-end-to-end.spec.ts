// T116 / NFR-010 : des canaris traversent le flux réel (réplication du central vers la passerelle,
// ventes, jeton de terminal, `getMediaAuthKey`), puis on les cherche sous TOUTES leurs
// représentations dans : le corps des réponses du flux central, la base de la passerelle
// (`pg_dump`), les journaux de PostgreSQL local (`log_statement = all` sur la base du banc), la
// sortie des processus enfants et l'image (`docker save`).
// Canaris : le PWD||PACK en clair de deux bracelets personnalisés, le jeton de rafraîchissement et
// le jeton d'accès d'un terminal (la passerelle n'en garde que l'empreinte, jamais la valeur).
// Contrôle positif OBLIGATOIRE, en deux temps : (1) chaque chercheur trouve une fuite volontaire
// sous chaque représentation ; (2) une fuite plantée dans chacun des lieux du banc (base, journal
// de requêtes, sortie de processus) est retrouvée. Hors Docker, la suite ÉCHOUE (elle ne saute
// pas) : l'image est construite et balayée.
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { edgeGet } from '../../../api/test/support/edge-fixtures';
import {
  assertNoLeak,
  assertSearchersDetectLeak,
  canaryOf,
  findIn,
  pgServerLog,
  searchPgDump,
  searchText,
  type Canary,
  type Hit,
} from '../support/canary';
import { cluster } from '../support/disposable-databases';
import { TwoProcessBench, until } from '../support/two-process-bench';
import { activateEdge } from '../support/load-support';
import { awaitLocalPacks, depositPacks, seedFreshMedia } from '../support/pack-delivery';

const IMAGE = 'cashless_m8_gateway_image';
const REPO = join(__dirname, '..', '..', '..', '..');

let bench: TwoProcessBench;
let started: Date;
let canaries: Array<{ name: string; canary: Canary }> = [];
let fluxText = '';
let mediaIds: string[] = [];

afterAll(async () => bench?.close());

const docker = (args: string[], maxBuffer = 64 * 1024 * 1024): Buffer =>
  execFileSync('docker', args, { maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });

async function admin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = cluster();
  const client = new Client({
    connectionString: `postgres://${c.user}@${c.host}:${c.port}/postgres`,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const childOutput = (): string => [...bench.childOutputs, bench.gateway?.output ?? ''].join('\n');

function hitsFor(canary: Canary, where: string, text: string | Buffer): Hit[] {
  const found = findIn(canary, text);
  return found.length ? [{ where, representations: found }] : [];
}

/**
 * Clé de signature des jetons de la passerelle (usage `token` du coffre factice du banc) : le
 * PKCS#8 complet et le scalaire privé seul. Lus dans le fichier de clés du BANC (le faux coffre,
 * jamais le code de production) ; aucune des deux valeurs ne doit sortir du processus.
 */
function tokenKeyCanaries(): Array<{ name: string; canary: Canary }> {
  const content = JSON.parse(readFileSync(join(bench.dir, 'dev-keys.json'), 'utf8')) as {
    keys: Record<string, string>;
  };
  const pkcs8 = content.keys['token'];
  expect(pkcs8).toBeTruthy(); // la clé existe : la recherche porte sur une valeur réelle
  const der = Buffer.from(pkcs8!, 'base64');
  const d = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }).export({
    format: 'jwk',
  }).d;
  return [
    { name: 'clé de jeton (PKCS#8)', canary: canaryOf(der) },
    {
      name: 'clé de jeton (scalaire privé)',
      canary: canaryOf(Buffer.from(String(d), 'base64url')),
    },
  ];
}

describe('NFR-010 : le canari ne sort pas du flux', () => {
  it('contrôle positif des chercheurs : une fuite volontaire est trouvée', () => {
    const control = canaryOf(Buffer.from('pwd-pack-de-controle-0123456789', 'utf8'));
    assertSearchersDetectLeak(control);
    expect(findIn(control, 'rien à voir')).toEqual([]);
  });

  it('flux : bracelets, bascule, ventes, jeton de terminal, clé d’authentification', async () => {
    started = new Date(Date.now() - 5_000);
    bench = await TwoProcessBench.start({ startGateway: false });
    // Journal de toutes les requêtes de la base LOCALE du banc (réglage de base seulement).
    await admin((c) => c.query(`ALTER DATABASE ${bench.edgeDb.name} SET log_statement = 'all'`));
    const w = bench.world;
    const till = await w.terminal();
    const fresh = await seedFreshMedia(bench, 2);
    mediaIds = fresh.map((m) => m.id);
    expect(await depositPacks(bench)).toBeGreaterThanOrEqual(1);
    await bench.startGateway();
    const paid = await w.media(1, 100_000);
    await activateEdge(bench, [paid[0]!.walletId]);
    await awaitLocalPacks(bench, mediaIds);
    const sealed = await bench.localQuery<{ n: string }>(
      'SELECT count(*)::text AS n FROM edge_media WHERE media_id = ANY($1::uuid[]) ' +
        'AND pwd_pack_enc IS NOT NULL',
      [mediaIds],
    );
    // Le PWD||PACK est bien arrivé SCELLÉ : la recherche porte sur une valeur réellement présente.
    expect(Number(sealed[0]!.n)).toBeGreaterThan(0);

    expect(
      (await bench.gwPay(till, w.catalogBody(till, { tap: w.tap(paid[0]!) }, [[0, 1]]))).status,
    ).toBe(201);
    const accessToken = await bench.gatewayToken(till);
    const auth = await bench.gwRequest(till, {
      method: 'POST',
      path: '/media/auth-keys',
      body: { nfc_uid: fresh[0]!.uid, key_index: 0 },
    });
    expect(auth.status).toBeLessThan(500);

    canaries = [
      ...fresh.map((m, i) => ({
        name: `PWD||PACK du bracelet ${i + 1}`,
        canary: canaryOf(m.pwdPack),
      })),
      { name: 'jeton de rafraîchissement', canary: canaryOf(Buffer.from(till.t.refreshToken)) },
      { name: 'jeton d’accès de la passerelle', canary: canaryOf(Buffer.from(accessToken)) },
      ...tokenKeyCanaries(),
    ];

    // Le flux du central : toutes les pages de réplication, avec le certificat de la passerelle.
    const client = {
      certPem: readFileSync(join(bench.dir, 'client.crt'), 'utf8'),
      keyPem: readFileSync(join(bench.dir, 'client.key'), 'utf8'),
      sha256: Buffer.alloc(0),
    };
    let after = 0;
    fluxText = JSON.stringify(auth.body) + (auth.text ?? '');
    for (let page = 0; page < 30; page += 1) {
      const res = await edgeGet(
        bench.edge.port,
        `/edge/replication-feed?after_posting_id=${after}&after_change_seq=0&limit=200`,
        { client },
      );
      expect(res.status).toBe(200);
      fluxText += res.body;
      if (res.json?.has_more !== true) break;
      after = Number(res.json?.to_posting_id);
    }
    // Les bracelets personnalisés sont bien dans le flux (la recherche n'est pas vide de sens).
    for (const id of mediaIds) expect(fluxText).toContain(id);
  }, 600_000);

  it('aucune représentation d’aucun canari : flux, base, journaux, processus', () => {
    const hits: Hit[] = [];
    const dump = Buffer.from(
      execFileSync(
        'docker',
        [
          'exec',
          process.env.M8_PG_CONTAINER ?? 'cashless-platform-pg17',
          'pg_dump',
          '-U',
          'postgres',
          bench.edgeDb.name,
        ],
        { maxBuffer: 1024 * 1024 * 1024 },
      ),
    );
    const log = pgServerLog(started.toISOString());
    const logsStatements = log.includes('statement:') || log.includes('execute');
    expect(logsStatements).toBe(true); // `log_statement = all` journalise bien la base du banc
    for (const { name, canary } of canaries) {
      hits.push(...hitsFor(canary, `flux central (${name})`, fluxText));
      hits.push(...hitsFor(canary, `pg_dump base locale (${name})`, dump));
      hits.push(...hitsFor(canary, `journal PostgreSQL (${name})`, log));
      hits.push(...searchText(canary, `sortie des processus (${name})`, childOutput()));
    }
    assertNoLeak(hits);
  }, 300_000);

  it('contrôle positif sur le banc : une fuite plantée est retrouvée partout', async () => {
    const planted = canaryOf(Buffer.from('FUITE-VOLONTAIRE-pwd', 'utf8'));
    const b64 = planted.bytes.toString('base64');
    // Base locale : une ligne qui porte le canari en base64, retrouvée par le même `pg_dump`.
    await bench.edgeDb.pool.query('CREATE TABLE canary_control (v text)');
    await bench.edgeDb.pool.query('INSERT INTO canary_control VALUES ($1)', [b64]);
    const dumped = searchPgDump(planted, bench.edgeDb.name);
    await bench.edgeDb.pool.query('DROP TABLE canary_control');
    expect(dumped.length).toBeGreaterThan(0);
    // Journal de PostgreSQL : la requête qui porte le canari est journalisée, donc trouvée.
    // Session NEUVE : `log_statement` ne vaut que pour les sessions ouvertes après le réglage.
    const session = new Client({ connectionString: bench.edgeDb.url });
    await session.connect();
    try {
      await session.query('SELECT $1::text', [planted.bytes.toString('hex')]);
    } finally {
      await session.end();
    }
    const log = await until(
      'requête plantée dans le journal du serveur',
      () => {
        const text = pgServerLog(started.toISOString());
        return findIn(planted, text).length > 0 ? text : null;
      },
      30_000,
      1_000,
    );
    expect(findIn(planted, log).length).toBeGreaterThan(0);
    // Flux central : une fuite de la clé de jeton plantée dans le flux est trouvée, sous chaque
    // canari de clé (le même chercheur que celui du test de flux).
    for (const { name, canary } of canaries.filter((c) => c.name.startsWith('clé de jeton'))) {
      const leaked = `${fluxText}\n${canary.bytes.toString('base64')}`;
      expect(hitsFor(canary, `flux central planté (${name})`, leaked).length).toBeGreaterThan(0);
      expect(hitsFor(canary, `flux central (${name})`, fluxText)).toEqual([]);
    }
    // Sortie d'un processus : un texte qui porte le canari en base64url est trouvé.
    expect(
      searchText(planted, 'sortie', `log applicatif ${planted.bytes.toString('base64url')}`).length,
    ).toBeGreaterThan(0);
  }, 300_000);
});

describe('NFR-010 : image de la passerelle (docker save)', () => {
  // Le banc n'a plus d'utilité (les canaris sont en mémoire) : on le ferme avant les appels
  // bloquants de `docker build` et `docker save`, qui figent la boucle d'événements plusieurs
  // minutes (une connexion ouverte pendant ce temps serait coupée par le serveur).
  beforeAll(async () => bench?.close());
  // L'image du banc ne reste pas sur le poste (390 Mo) : retirée même si un essai échoue.
  afterAll(() => {
    try {
      docker(['rmi', '-f', IMAGE]);
    } catch {
      // image absente (build jamais atteint) ou retrait refusé : sans effet sur le verdict
    }
  });

  it('Docker est présent (sinon la suite échoue, elle ne saute pas)', () => {
    try {
      docker(['version', '--format', '{{.Server.Version}}']);
    } catch (error) {
      throw new Error(
        `NFR-010 : Docker indisponible, l’image ne peut pas être balayée (${String(error)})`,
      );
    }
  });

  it('aucun canari dans l’image, aucun fichier de clé, de certificat ou d’environnement', () => {
    docker(
      ['build', '-q', '-f', join(REPO, 'apps/gateway/Dockerfile'), '-t', IMAGE, REPO],
      1 << 28,
    );
    const tar = docker(['save', IMAGE], 1 << 30);
    const hits: Hit[] = [];
    for (const { name, canary } of canaries) hits.push(...hitsFor(canary, `image (${name})`, tar));
    assertNoLeak(hits);
    const files = docker([
      'run',
      '--rm',
      '--entrypoint',
      'find',
      IMAGE,
      '/app',
      '-path',
      '/app/node_modules',
      '-prune',
      '-o',
      '-type',
      'f',
      '(',
      '-name',
      '*.key',
      '-o',
      '-name',
      '*.pem',
      '-o',
      '-name',
      '*.crt',
      '-o',
      '-name',
      '.env*',
      ')',
      '-print',
    ]).toString();
    expect(files.trim()).toBe('');
    // Contrôle positif de la recherche dans l'archive : une valeur présente dans l'image est vue.
    const present = canaryOf(Buffer.from('FROM node:22-bookworm-slim', 'utf8'));
    expect(findIn(present, readFileSync(join(REPO, 'apps/gateway/Dockerfile')))).not.toEqual([]);
    expect(findIn(canaryOf(Buffer.from('gateway', 'utf8')), tar).length).toBeGreaterThan(0);
  }, 1_200_000);
});
