// Commandes d'essai par service (mission 12b-1, WP11 ; FR-014). Contre les faux serveurs locaux de WP05 à WP09 :
// aucun appel réseau réel (la garde de `test/support/no-external-network.ts` l'interdit aussi).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPspSecretStore } from '../../../../src/psp/psp.providers';
import { startFakeServer } from '../../../support/fake-servers/http-fake';
import { PRODUCTION_ENABLED_SERVICES } from '../../../../src/external-services/production-enabled';
import { EXTERNAL_SERVICES } from '../../../../src/external-services/services';
import { EXIT, main, parseArgs } from '../../../../src/external-services/trial/main';
import {
  looksSecret,
  reportViolations,
  SECRET_LOOKING,
  type TrialReport,
} from '../../../../src/external-services/trial/report';
import {
  PAYDUNYA_PRODUCTION_BASE,
  PAYDUNYA_SANDBOX_BASE,
  reportServiceName,
  resolvePspBases,
} from '../../../../src/external-services/trial/runner';
import {
  FAKE_AWS_CREDENTIALS,
  startFakeKms,
  type FakeKmsServer,
} from '../../../support/fake-servers/kms';
import { startFakePayDunya, type FakePayDunya } from '../../../support/fake-servers/paydunya';
import { startFakeS3, type FakeS3Server } from '../../../support/fake-servers/s3';
import {
  startFakeSecretsManager,
  type FakeSecretsManager,
} from '../../../support/fake-servers/secrets-manager';
import { startFakeStripe, type FakeStripe } from '../../../support/fake-servers/stripe';
import {
  startFakeWave,
  WAVE_TEST_API_KEY,
  type FakeWave,
} from '../../../support/fake-servers/wave';

jest.mock('../../../../src/psp/psp.providers', () => {
  const actual = jest.requireActual('../../../../src/psp/psp.providers');
  return { ...actual, createPspSecretStore: jest.fn(actual.createPspSecretStore) };
});

const BUCKET = 'cashless-seals-test';
const TRAP_STRIPE = 'sk_test_TRAPPED_stripe_secret_key_0001';
const TRAP_NOTIFICATION = 'whsec_TRAPPED_notification_secret_0002';
const TRAP_PAYDUNYA = {
  master: 'TRAPmasterKEY0003',
  priv: 'TRAPprivateKEY0004',
  token: 'TRAPtoken0005',
};
const SRC = join(__dirname, '../../../../src/external-services/trial');

let wave: FakeWave;
let paydunya: FakePayDunya;
let stripe: FakeStripe;
let secrets: FakeSecretsManager;
let kms: FakeKmsServer;
let s3: FakeS3Server;
let saved: Record<string, string | undefined>;

beforeAll(async () => {
  [wave, paydunya, stripe, secrets, kms, s3] = await Promise.all([
    startFakeWave(),
    startFakePayDunya(),
    startFakeStripe(),
    startFakeSecretsManager(),
    startFakeKms(),
    startFakeS3(BUCKET),
  ]);
  // Chaîne d'identifiants par défaut du SDK : des identifiants factices, vers des serveurs locaux.
  saved = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  };
  process.env.AWS_ACCESS_KEY_ID = FAKE_AWS_CREDENTIALS.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = FAKE_AWS_CREDENTIALS.secretAccessKey;
});

afterAll(async () => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  await Promise.all([
    wave.close(),
    paydunya.close(),
    stripe.close(),
    secrets.close(),
    kms.close(),
    s3.close(),
  ]);
});

const baseEnv = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  WAVE_API_BASE: wave.server.url,
  PAYDUNYA_API_BASE: paydunya.base,
  STRIPE_API_BASE: stripe.url,
  SEAL_COPY_BUCKET: BUCKET,
  ...over,
});

const awsEnv = (server: { url: string }, over: NodeJS.ProcessEnv = {}) =>
  baseEnv({ AWS_ENDPOINT_URL: server.url, ...over });

const files: Record<string, string> = {
  wave: JSON.stringify({
    provider: 'WAVE',
    credentials: { api_key: WAVE_TEST_API_KEY },
    notification: TRAP_NOTIFICATION,
  }),
  paydunya: JSON.stringify({
    provider: 'PAYDUNYA',
    credentials: {
      master_key: TRAP_PAYDUNYA.master,
      private_key: TRAP_PAYDUNYA.priv,
      token: TRAP_PAYDUNYA.token,
    },
    notification: TRAP_PAYDUNYA.master,
  }),
  stripe: JSON.stringify({
    provider: 'STRIPE',
    credentials: { secret_key: TRAP_STRIPE },
    notification: TRAP_NOTIFICATION,
  }),
};

interface Run {
  code: number;
  out: string;
  err: string;
  report: TrialReport | null;
}

async function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  fileContents: Record<string, string> = {},
  extra: Parameters<typeof main>[3] = {},
): Promise<Run> {
  let out = '';
  let err = '';
  const code = await main(
    argv,
    env,
    { out: (t) => (out += t), err: (t) => (err += t) },
    {
      ...extra,
      readFile: (path) => {
        const text = fileContents[path];
        if (text === undefined) throw new Error('absent');
        return text;
      },
    },
  );
  return { code, out, err, report: out === '' ? null : (JSON.parse(out) as TrialReport) };
}

const step = (r: Run, name: string) => r.report?.steps.find((s) => s.name === name);
const allTrapped = [
  TRAP_STRIPE,
  TRAP_NOTIFICATION,
  ...Object.values(TRAP_PAYDUNYA),
  WAVE_TEST_API_KEY,
];

function expectCleanSuccess(r: Run, service: string): void {
  expect(r.err).toBe('');
  expect(r.code).toBe(EXIT.OK);
  expect(r.report).not.toBeNull();
  expect(reportViolations(r.report!, service)).toEqual([]);
  for (const trapped of allTrapped) expect(r.out).not.toContain(trapped);
}

describe('essai : parcours de chaque service contre les faux serveurs', () => {
  it('psp.wave : session de 100 XOF, relecture PENDING, expiration, relevé du jour', async () => {
    const r = await run(
      ['psp.wave', '--credentials', 'w.json', '--return-url', 'https://example.com/retour'],
      baseEnv(),
      { 'w.json': files.wave! },
    );
    expectCleanSuccess(r, 'psp.wave');
    expect(r.report!.steps.map((s) => s.name)).toEqual([
      'construction',
      'lecture-identifiants',
      'creation-session',
      'relecture-statut',
      'expiration',
      'releve-du-jour',
    ]);
    expect(step(r, 'creation-session')?.httpStatus).toBe(200);
    expect(wave.creates().at(-1)?.body.toString()).toContain('"amount":"100"');
    expect([...wave.sessions.values()].at(-1)?.checkout_status).toBe('expired');
  });

  it('psp.wave par le coffre (--secret-ref) : mêmes étapes, la référence reste hors de la sortie', async () => {
    secrets.put('psp/holder-1/wave-essai', { current: files.wave! });
    const r = await run(
      [
        'psp.wave',
        '--secret-ref',
        'psp/holder-1/wave-essai',
        '--return-url',
        'https://example.com/r',
      ],
      awsEnv(secrets.server),
    );
    expectCleanSuccess(r, 'psp.wave');
    expect(r.out).not.toContain('holder-1');
    expect(r.out).not.toContain('wave-essai');
  });

  it('psp.paydunya : facture de 100 XOF puis confirmation en attente', async () => {
    const r = await run(['psp.paydunya', '--credentials', 'p.json'], baseEnv(), {
      'p.json': files.paydunya!,
    });
    expectCleanSuccess(r, 'psp.paydunya');
    expect(r.report!.steps.map((s) => s.name)).toEqual([
      'construction',
      'lecture-identifiants',
      'creation-facture',
      'confirmation',
    ]);
    const create = paydunya.requests.find((q) => q.path.endsWith('checkout-invoice/create'));
    expect(create?.body.toString()).toContain('"total_amount":100');
  });

  it('psp.stripe : session, relecture PENDING, expiration, relevé de la veille', async () => {
    const r = await run(
      ['psp.stripe', '--credentials', 's.json', '--return-url', 'https://example.com/retour'],
      baseEnv(),
      { 's.json': files.stripe! },
    );
    expectCleanSuccess(r, 'psp.stripe');
    expect(r.report!.steps.map((s) => s.name)).toContain('releve-de-la-veille');
    expect([...stripe.sessions.values()].at(-1)?.status).toBe('expired');
  });

  it('psp.secrets : lecture d’une référence de test et refus d’un autre détenteur', async () => {
    secrets.put('psp/holder-2/stripe-essai', { current: files.stripe! });
    const r = await run(
      ['psp.secrets', '--secret-ref', 'psp/holder-2/stripe-essai', '--provider', 'STRIPE'],
      awsEnv(secrets.server),
    );
    expectCleanSuccess(r, 'psp.secrets');
    expect(r.report!.steps.map((s) => s.name)).toEqual([
      'construction',
      'lecture-secret',
      'refus-autre-detenteur',
    ]);
    expect(r.out).not.toContain('holder-2');
  });

  it('kms : trois clés, MAC, clé de données, signature vérifiée, désactivation des trois clés', async () => {
    const r = await run(['kms'], awsEnv(kms));
    expectCleanSuccess(r, 'kms');
    expect(r.report!.steps.map((s) => s.name)).toEqual([
      'construction',
      'creation-cle-mac',
      'creation-cle-donnees',
      'creation-cle-signature',
      'mac',
      'cle-de-donnees',
      'signature',
      'desactivation-cles',
    ]);
    expect(kms.keys.size).toBeGreaterThanOrEqual(3);
    for (const key of kms.keys.values()) expect(key.enabled).toBe(false);
    expect(r.out).not.toContain('arn:aws');
  });

  it('seal-copy : écriture verrouillée, relecture, écrasement refusé ; compartiment absent de la sortie', async () => {
    const before = Date.now();
    const r = await run(['seal-copy', '--retention-days', '1'], awsEnv(s3));
    expectCleanSuccess(r, 'seal-copy');
    expect(r.out).not.toContain(BUCKET);
    const [key, object] = [...s3.objects.entries()].find(([k]) => k.startsWith('AUDIT/essai-'))!;
    expect(object.lockMode).toBe('COMPLIANCE');
    const until = Date.parse(object.retainUntil!);
    expect(until - before).toBeGreaterThan(86_400_000 - 5_000);
    expect(until - before).toBeLessThan(86_400_000 + 60_000);
    expect(r.out).not.toContain(key);
  });
});

describe('essai : refus et erreurs d’usage', () => {
  it('refus en production : code 3, rien sur la sortie, aucun appel', async () => {
    const before = wave.server.requests.length;
    const r = await run(
      ['psp.wave', '--credentials', 'w.json'],
      baseEnv({ NODE_ENV: 'production' }),
      {
        'w.json': files.wave!,
      },
    );
    expect(r.code).toBe(EXIT.PRODUCTION);
    expect(r.out).toBe('');
    expect(r.err).toContain('NODE_ENV=production');
    expect(wave.server.requests.length).toBe(before);
  });

  it('service inconnu ou hors périmètre : code 2 et message', async () => {
    for (const service of ['inconnu', 'psp.orange-money', 'bank', 'otp.sms']) {
      const r = await run([service], baseEnv());
      expect(r.code).toBe(EXIT.USAGE);
      expect(r.out).toBe('');
    }
    expect((await run([], baseEnv())).code).toBe(EXIT.USAGE);
  });

  it('arguments : un PSP exige une seule source d’identifiants ; les messages n’écrivent aucune valeur', () => {
    const both = parseArgs([
      'psp.wave',
      '--secret-ref',
      'psp/h/secret-ref-valeur',
      '--credentials',
      'f',
    ]);
    const none = parseArgs(['psp.wave']);
    expect('error' in both && 'error' in none).toBe(true);
    const unknown = parseArgs(['kms', '--secret-ref', 'psp/h/secret-ref-valeur', '--inconnu', 'v']);
    expect(JSON.stringify(unknown)).not.toContain('secret-ref-valeur');
    expect('error' in parseArgs(['kms', '--retention-days', '0'])).toBe(true);
    expect('error' in parseArgs(['kms', '--retention-days', '40000'])).toBe(true);
    expect('error' in parseArgs(['psp.secrets', '--secret-ref', 'psp/h/x'])).toBe(true);
  });

  it('aucun fichier d’identifiants lisible : l’étape échoue sans écrire de chemin', async () => {
    const r = await run(['psp.wave', '--credentials', 'secret-chemin.json'], baseEnv());
    expect(r.code).toBe(EXIT.FAILED);
    expect(step(r, 'lecture-identifiants')).toMatchObject({
      ok: false,
      reason: 'fichier-illisible',
    });
    expect(r.out).not.toContain('secret-chemin');
  });
});

describe('essai : étapes en échec', () => {
  it('une création refusée saute les étapes qui en dépendent et garde le statut HTTP', async () => {
    wave.behaviour.authOk = false;
    try {
      const r = await run(
        ['psp.wave', '--credentials', 'w.json', '--return-url', 'https://example.com/r'],
        baseEnv(),
        { 'w.json': files.wave! },
      );
      expect(r.code).toBe(EXIT.FAILED);
      expect(r.report!.ok).toBe(false);
      expect(step(r, 'creation-session')).toMatchObject({ ok: false, httpStatus: 401 });
      expect(step(r, 'relecture-statut')).toMatchObject({
        ok: false,
        reason: 'sautee',
        durationMs: 0,
      });
      expect(step(r, 'expiration')).toMatchObject({ ok: false, reason: 'sautee' });
      expect(r.out).not.toContain('Invalid API key');
    } finally {
      wave.behaviour.authOk = true;
    }
  });

  it('un état autre que PENDING ou une session non expirée fait échouer l’étape', async () => {
    paydunya.options.confirm = {
      response_code: '00',
      status: 'completed',
      invoice: { total_amount: 100 },
      custom_data: { psp_topup_id: 'x' },
    };
    const r = await run(['psp.paydunya', '--credentials', 'p.json'], baseEnv(), {
      'p.json': files.paydunya!,
    });
    delete paydunya.options.confirm;
    expect(step(r, 'confirmation')).toMatchObject({ ok: false, reason: 'etat-paid' });
    expect(r.code).toBe(EXIT.FAILED);

    wave.behaviour.expireStatus = 409;
    const w = await run(
      ['psp.wave', '--credentials', 'w.json', '--return-url', 'https://example.com/r'],
      baseEnv(),
      { 'w.json': files.wave! },
    );
    wave.behaviour.expireStatus = 200;
    expect(step(w, 'expiration')?.ok).toBe(false);
    expect(w.code).toBe(EXIT.FAILED);
  });

  it('kms : les clés de test sont désactivées même si la signature échoue', async () => {
    kms.forceNext('Sign', { status: 400, type: 'AccessDeniedException' });
    const r = await run(['kms'], awsEnv(kms));
    expect(r.code).toBe(EXIT.FAILED);
    expect(step(r, 'signature')).toMatchObject({
      ok: false,
      reason: 'kms.service.sign.AccessDeniedException',
    });
    expect(step(r, 'desactivation-cles')?.ok).toBe(true);
    const tail = [...kms.keys.values()].slice(-3);
    expect(tail).toHaveLength(3);
    for (const key of tail) expect(key.enabled).toBe(false);
    expect(r.out).not.toContain(tail[0]!.id);
  });

  it('kms : une signature qui ne se vérifie pas avec la clé publique fait échouer l’étape', async () => {
    kms.forceNext('Sign', {
      body: { Signature: Buffer.from('3006020101020101', 'hex').toString('base64') },
    });
    const r = await run(['kms'], awsEnv(kms));
    expect(step(r, 'signature')).toMatchObject({ ok: false, reason: 'signature-invalide' });
    expect(step(r, 'desactivation-cles')?.ok).toBe(true);
  });

  it('kms : une clé qui ne se désactive pas est signalée (cle-restee-active)', async () => {
    kms.forceNext('DisableKey', { status: 400, type: 'KMSInvalidStateException' });
    const r = await run(['kms'], awsEnv(kms));
    expect(step(r, 'desactivation-cles')).toMatchObject({ ok: false, reason: 'cle-restee-active' });
    expect(r.code).toBe(EXIT.FAILED);
  });

  it('seal-copy sans compartiment : étape de construction en échec, étapes suivantes sautées', async () => {
    const env = awsEnv(s3);
    delete env.SEAL_COPY_BUCKET;
    const r = await run(['seal-copy'], env);
    expect(r.code).toBe(EXIT.FAILED);
    expect(step(r, 'construction')).toMatchObject({ ok: false, reason: 'compartiment-absent' });
    expect(step(r, 'ecriture-verrouillee')?.reason).toBe('sautee');
  });
});

describe('essai : aucun secret dans la sortie', () => {
  it('une valeur secrète qui se retrouverait dans la sortie la fait refuser (rien sur la sortie standard)', async () => {
    // Piège : le secret de notification porte le nom d'une étape ; il figurerait dans le compte rendu.
    const trapped = JSON.stringify({
      provider: 'WAVE',
      credentials: { api_key: WAVE_TEST_API_KEY },
      notification: 'creation-session',
    });
    const r = await run(
      ['psp.wave', '--credentials', 'w.json', '--return-url', 'https://example.com/r'],
      baseEnv(),
      { 'w.json': trapped },
    );
    expect(r.code).toBe(EXIT.FAILED);
    expect(r.out).toBe('');
    expect(r.err).toContain('sortie refusée');
    expect(r.err).not.toContain('creation-session');
  });

  it('les motifs qui ressemblent à un secret sont ceux de la borne de WP10', () => {
    const spec = readFileSync(join(__dirname, '../production-enabled.spec.ts'), 'utf8');
    const block = /const SECRET_LOOKING = \[([\s\S]*?)\n\];/.exec(spec)![1]!;
    const theirs = [...block.matchAll(/^\s*(\/.*\/),/gm)].map((m) => m[1]);
    expect(theirs.length).toBeGreaterThanOrEqual(7);
    expect(SECRET_LOOKING.map((p) => p.toString())).toEqual(theirs);
    expect(looksSecret('a'.repeat(30))).toBe(true);
    expect(looksSecret('creation-session')).toBe(false);
    expect(looksSecret('sk_live_x')).toBe(true);
  });

  it('la forme du compte rendu est refusée si une étape est en échec, mal nommée ou longue comme un secret', () => {
    const base: TrialReport = {
      service: 'kms',
      startedAt: '2026-12-01T10:00:00Z',
      ok: true,
      steps: [{ name: 'a', ok: true, durationMs: 1 }],
    };
    expect(reportViolations(base, 'kms')).toEqual([]);
    expect(reportViolations({ ...base, service: 'kms.sandbox' }, 'kms')).toContain(
      'champ service différent',
    );
    expect(
      reportViolations({ ...base, steps: [{ name: 'a', ok: false, durationMs: 1 }] }, 'kms'),
    ).toContain('étape a non réussie');
    expect(
      reportViolations(
        { ...base, steps: [{ name: 'x'.repeat(31), ok: true, durationMs: 1 }] },
        'kms',
      ),
    ).toContain('le compte rendu ressemble à un secret');
    expect(reportViolations({ ...base, ok: false }, 'kms')).toContain("ok n'est pas true");
  });
});

describe('essai : bac à sable et garde de production', () => {
  it('--sandbox ne change que la base PayDunya par défaut ; une base explicite garde la main', () => {
    const bases = { wave: 'w', paydunya: PAYDUNYA_PRODUCTION_BASE, stripe: 's' };
    expect(resolvePspBases(bases, true)).toEqual({
      bases: { ...bases, paydunya: PAYDUNYA_SANDBOX_BASE },
      sandboxUsed: true,
    });
    expect(resolvePspBases(bases, false)).toEqual({ bases, sandboxUsed: false });
    const local = { ...bases, paydunya: 'http://127.0.0.1:1/api/v1' };
    expect(resolvePspBases(local, true)).toEqual({ bases: local, sandboxUsed: false });
  });

  it('un compte rendu de bac à sable porte un autre nom de service : la borne de production le refuse', () => {
    expect(reportServiceName('psp.paydunya', true)).toBe('psp.paydunya.sandbox');
    expect(reportServiceName('psp.paydunya', false)).toBe('psp.paydunya');
  });

  it('la liste des services autorisés en production reste vide après les essais', () => {
    expect(PRODUCTION_ENABLED_SERVICES).toEqual([]);
  });

  it('le code de la commande ne lit ni ne change la liste, ne touche pas à la base ni au grand livre', () => {
    for (const name of readdirSync(SRC)) {
      const source = readFileSync(join(SRC, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/PRODUCTION_ENABLED_SERVICES|isEnabledInProduction/);
      expect(source).not.toMatch(/production:\s*true/);
      expect(source).not.toMatch(/from '(pg|\.\.\/\.\.\/db\/|\.\.\/\.\.\/ledger)/);
      expect(source).not.toMatch(/DATABASE_URL|process\.env\.[A-Z_]*(SECRET|KEY|TOKEN)/);
    }
  });

  it('les adaptateurs sont construits par les fabriques de production, jamais directement', () => {
    for (const name of readdirSync(SRC)) {
      const source = readFileSync(join(SRC, name), 'utf8');
      expect(source).not.toMatch(
        /new (WavePspAdapter|PayDunyaPspAdapter|StripePspAdapter|AwsSecretsManagerStore|AwsKms|S3SealCopy|S3Client|KMSClient|SecretsManagerClient)\(/,
      );
      expect(source).not.toMatch(/from '@aws-sdk/);
    }
    const all = EXTERNAL_SERVICES.length;
    expect(all).toBe(6);
  });
});

describe('essai : contrôles propres à la commande', () => {
  it('un compte rendu dont la forme ressemble à un secret est refusé même sans valeur lue', async () => {
    const r = await run(
      ['kms'],
      awsEnv(kms),
      {},
      {
        now: () => ({ getTime: () => Date.now(), toISOString: () => 'a'.repeat(40) }) as Date,
      },
    );
    expect(r.code).toBe(EXIT.FAILED);
    expect(r.out).toBe('');
    expect(r.err).toContain('sortie refusée');
  });

  it('kms : un MAC instable ou une clé de données qui ne revient pas identique fait échouer l’étape', async () => {
    kms.forceNext('GenerateMac', { body: { Mac: Buffer.alloc(32, 7).toString('base64') } });
    const mac = await run(['kms'], awsEnv(kms));
    expect(step(mac, 'mac')).toMatchObject({ ok: false, reason: 'mac-instable' });
    kms.forceNext('Decrypt', { body: { Plaintext: Buffer.alloc(32, 9).toString('base64') } });
    const data = await run(['kms'], awsEnv(kms));
    expect(step(data, 'cle-de-donnees')).toMatchObject({
      ok: false,
      reason: 'aller-retour-different',
    });
    expect(step(data, 'desactivation-cles')?.ok).toBe(true);
  });

  it('psp.secrets : un coffre qui accepterait un autre détenteur fait échouer l’essai', async () => {
    secrets.put('psp/holder-3/wave-essai', { current: files.wave! });
    const actual = jest.requireActual('../../../../src/psp/psp.providers');
    const calls: string[] = [];
    (createPspSecretStore as jest.Mock).mockImplementationOnce((...args: unknown[]) => {
      const real = actual.createPspSecretStore(...args);
      return {
        isFake: false,
        get: async (binding: { holderPartyId: string; secretRef: string }) => {
          calls.push(binding.holderPartyId);
          // Détournement : le détenteur est toujours celui de la référence.
          return real.get({ ...binding, holderPartyId: binding.secretRef.split('/')[1] });
        },
      };
    });
    const r = await run(
      ['psp.secrets', '--secret-ref', 'psp/holder-3/wave-essai', '--provider', 'WAVE'],
      awsEnv(secrets.server),
    );
    expect(calls).toHaveLength(2);
    expect(step(r, 'refus-autre-detenteur')).toMatchObject({
      ok: false,
      reason: 'detenteur-accepte',
    });
    expect(r.code).toBe(EXIT.FAILED);
  });
});

describe('essai : S3, redirection locale qui trompe la copie', () => {
  /** Relais local vers le faux S3 : le second PUT est avalé (réponse 200) ou les lectures rendent autre chose. */
  async function relay(mode: 'swallow-second-put' | 'corrupt-get') {
    let puts = 0;
    return startFakeServer(async (req, res) => {
      if (req.method === 'PUT') puts += 1;
      if (mode === 'swallow-second-put' && req.method === 'PUT' && puts === 2) {
        res.statusCode = 200;
        res.end();
        return;
      }
      if (mode === 'corrupt-get' && req.method === 'GET') {
        res.statusCode = 200;
        res.end(Buffer.alloc(32, 1));
        return;
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers))
        if (
          typeof v === 'string' &&
          !['host', 'connection', 'content-length', 'transfer-encoding', 'expect'].includes(k)
        )
          headers[k] = v;
      const out = await fetch(`${s3.url}${req.path}`, {
        method: req.method,
        headers,
        ...(req.method === 'PUT' ? { body: req.body } : {}),
      });
      res.statusCode = out.status;
      out.headers.forEach((v, k) => {
        if (!['content-length', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
      });
      res.end(Buffer.from(await out.arrayBuffer()));
    });
  }

  it('un écrasement accepté à tort fait échouer l’étape (ecrasement-accepte)', async () => {
    const proxy = await relay('swallow-second-put');
    try {
      const r = await run(['seal-copy', '--retention-days', '1'], awsEnv(proxy));
      expect(step(r, 'ecriture-verrouillee')?.ok).toBe(true);
      expect(step(r, 'ecrasement-refuse')).toMatchObject({
        ok: false,
        reason: 'ecrasement-accepte',
      });
      expect(r.code).toBe(EXIT.FAILED);
    } finally {
      await proxy.close();
    }
  });

  it('une relecture qui ne rend pas l’empreinte écrite fait échouer l’étape (relecture-differente)', async () => {
    const proxy = await relay('corrupt-get');
    try {
      const r = await run(['seal-copy', '--retention-days', '1'], awsEnv(proxy));
      expect(step(r, 'relecture')).toMatchObject({ ok: false, reason: 'relecture-differente' });
      expect(r.code).toBe(EXIT.FAILED);
    } finally {
      await proxy.close();
    }
  });
});
