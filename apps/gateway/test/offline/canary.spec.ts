// NFR-010 : un PWD-canari traverse le flux (réplication simulée, snapshots, getMediaAuthKey, lot) ; on le
// cherche sous toutes ses représentations dans la base de la passerelle (`pg_dump` complet), les journaux de
// PostgreSQL (`log_statement = all`, journal du conteneur) et la sortie des processus. Contrôle positif :
// une fuite volontaire (canari en base64 journalisé, stocké, écrit) FAIT échouer la recherche.
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { buildDeviceBatch, makeBench, readySnapshot, submit, type Bench } from './_support/bench';
import type { Loose } from '../support/loose';

const CANARY = Buffer.from('k"Z\'9q', 'utf8'); // 6 octets : PWD (4) + PACK (2), avec « " » et « ' »
const PG_CONTAINER = 'cashless-platform-pg17';

/** Toutes les représentations utiles (les trois alignements de base64 pour un canari inclus dans un tampon). */
export function representations(canary: Buffer): Array<[string, string]> {
  const text = canary.toString('utf8');
  const out: Array<[string, string]> = [
    ['utf8', text],
    ['hex', canary.toString('hex')],
    ['HEX', canary.toString('hex').toUpperCase()],
    ['json', JSON.stringify(text).slice(1, -1)],
    ['sql', text.replace(/'/g, "''")],
    ['bytea-escaped', `\\x${canary.toString('hex')}`],
  ];
  for (let pad = 0; pad < 3; pad += 1) {
    const whole = Buffer.concat([Buffer.alloc(pad, 0x41), canary]);
    const b64 = whole.toString('base64');
    const skip = Math.ceil((pad / 3) * 4);
    // Sans les caractères qui dépendent des octets voisins.
    const stable = b64.slice(skip + (pad === 0 ? 0 : 1), b64.length - 2);
    out.push([`base64@${pad}`, stable]);
    out.push([`base64url@${pad}`, stable.replace(/\+/g, '-').replace(/\//g, '_')]);
  }
  out.push(['base64', canary.toString('base64').replace(/=+$/, '')]);
  out.push(['base64url', canary.toString('base64url')]);
  return out;
}

export function findLeaks(haystack: string, canary: Buffer): string[] {
  return representations(canary)
    .filter(([, needle]) => needle.length >= 6 && haystack.includes(needle))
    .map(([name]) => name);
}

let b: Bench;
let started: Date;
let output = '';
let sqlLog = '';
let restore: () => void;
let restoreSql: () => void;

// Journal des requêtes côté client : tout ce que `log_statement = all` écrirait (texte et paramètres, `bytea`
// en `\x…`). Le journal du serveur est lu en plus quand le conteneur le restitue (voir `serverLog`).
const realQuery = Client.prototype.query;
function captureSql(): () => void {
  (Client.prototype as Loose).query = function (this: Client, ...args: Loose[]) {
    const first = args[0];
    const text = typeof first === 'string' ? first : (first?.text ?? '');
    const values = (typeof first === 'string' ? args[1] : first?.values) as unknown[] | undefined;
    const shown = Array.isArray(values)
      ? values.map((v) =>
          Buffer.isBuffer(v)
            ? `\\x${v.toString('hex')}`
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v),
        )
      : [];
    sqlLog += `statement: ${text} parameters: ${shown.join(' | ')}\n`;
    return (realQuery as Loose).apply(this, args);
  };
  return () => {
    Client.prototype.query = realQuery;
  };
}

function captureOutput(): void {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: Loose, ...rest: Loose[]) => {
    output += String(chunk);
    return out(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: Loose, ...rest: Loose[]) => {
    output += String(chunk);
    return err(chunk, ...rest);
  }) as typeof process.stderr.write;
  restore = () => {
    process.stdout.write = out;
    process.stderr.write = err;
  };
}

const dump = (): string => {
  const r = spawnSync(
    'pg_dump',
    [
      '-h',
      process.env.PGHOST ?? '127.0.0.1',
      '-p',
      process.env.PGPORT ?? '5433',
      '-U',
      'postgres',
      '--no-owner',
      b.db.name,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`pg_dump a échoué : ${r.stderr}`);
  return r.stdout;
};
const serverLog = (): string => {
  const r = spawnSync(
    'docker',
    ['logs', '--since', String(Math.floor(started.getTime() / 1000) - 10), PG_CONTAINER],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  return `${r.stdout}\n${r.stderr}`;
};

beforeEach(async () => {
  started = new Date();
  output = '';
  captureOutput();
  sqlLog = '';
  const unhook = captureSql();
  restoreSql = unhook;
  b = await makeBench({ media: { floorMs: 0, perMinute: 100 }, logAllStatements: true });
});
afterEach(async () => {
  restore();
  restoreSql();
  await b.close().catch(() => undefined);
});

/** Le flux complet avec le canari comme mot de passe de bracelet. */
async function runFlow(): Promise<void> {
  const dev = await b.newDevice();
  const media = await b.seedMedia({ balancePaid: 10000, pwdPack: CANARY });
  const version = await readySnapshot(b);
  const snap = await b.request(dev, { path: '/v1/offline-snapshots/current' });
  expect(snap.status).toBe(200);
  const key = await b.request(dev, {
    method: 'POST',
    path: '/v1/media/auth-keys',
    body: { nfc_uid: media.uid.toString('hex'), key_index: 0 },
  });
  expect(key.status).toBe(200);
  const lot = buildDeviceBatch(b, dev, [{ media, amount: 500 }], { snapshotVersion: version });
  expect((await submit(b, dev, lot)).status).toBe(200);
  // Réponses elles-mêmes : jamais de PWD en clair.
  expect(findLeaks(`${snap.text}\n${key.text}`, CANARY)).toEqual([]);
  // Cas d'erreur : le PWD n'est ni dans l'erreur ni dans la trace.
  await b.keystore.destroy('agreement');
  const err = await b.request(dev, {
    method: 'POST',
    path: '/v1/media/auth-keys',
    body: { nfc_uid: media.uid.toString('hex'), key_index: 0 },
  });
  expect(err.status).toBe(404);
  expect(findLeaks(err.text, CANARY)).toEqual([]);
}

describe('NFR-010 : le canari n’apparaît nulle part', () => {
  it('le détecteur trouve chaque représentation (contrôle du détecteur)', () => {
    for (const [name, needle] of representations(CANARY)) {
      expect(findLeaks(`xx${needle}yy`, CANARY)).toContain(name);
    }
    expect(findLeaks('rien à voir', CANARY)).toEqual([]);
  });

  it('absent de pg_dump, du journal PostgreSQL (log_statement = all) et de la sortie des processus', async () => {
    await runFlow();
    const sql = dump();
    expect(sql.length).toBeGreaterThan(10_000);
    expect(findLeaks(sql, CANARY)).toEqual([]);
    // Le journal contient bien nos requêtes (sinon la recherche ne prouverait rien).
    expect(sqlLog).toContain('edge_media');
    expect(sqlLog.length).toBeGreaterThan(5_000);
    expect(findLeaks(sqlLog, CANARY)).toEqual([]);
    expect(findLeaks(serverLog(), CANARY)).toEqual([]);
    expect(findLeaks(output, CANARY)).toEqual([]);
  });

  it('CONTRÔLE POSITIF : une variante fautive qui journalise ou stocke le canari en base64 fait échouer la recherche', async () => {
    await runFlow();
    const leaked = CANARY.toString('base64');
    // Fuite en base, dans le journal du serveur (requête journalisée) et dans la sortie du processus.
    await b.q('CREATE TABLE faulty_debug (line text)');
    await b.q('INSERT INTO faulty_debug VALUES ($1)', [`pwd=${leaked}`]);
    await b.q(`SELECT '${leaked}' AS faulty_log`);
    process.stdout.write(`faulty log line pwd=${leaked}\n`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(findLeaks(dump(), CANARY)).toContain('base64@0');
    expect(findLeaks(sqlLog, CANARY)).toContain('base64@0');
    expect(findLeaks(output, CANARY).length).toBeGreaterThan(0);
  });
});
