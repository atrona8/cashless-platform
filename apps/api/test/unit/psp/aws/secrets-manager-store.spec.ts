// AwsSecretsManagerStore contre un faux Secrets Manager local (aucun appel à AWS, identifiants factices).
import { Logger } from '@nestjs/common';
import { AwsSecretsManagerStore } from '../../../../src/psp/aws/secrets-manager-store';
import { PspSecretError, type PspSecretBinding } from '../../../../src/psp/psp-secret-store.port';
import {
  startFakeSecretsManager,
  type FakeSecretsManager,
} from '../../../support/fake-servers/secrets-manager';

const HOLDER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REF = `psp/${HOLDER}/prod`;

const WAVE = {
  provider: 'WAVE',
  credentials: { api_key: 'wave-api-key-SECRET', request_signing_secret: 'wave-sign-SECRET' },
  notification: 'wave-whs-CURRENT-SECRET',
  previous_valid_until: null as string | null,
};
const PAYDUNYA = {
  provider: 'PAYDUNYA',
  credentials: {
    master_key: 'pd-master-SECRET',
    private_key: 'pd-private-SECRET',
    token: 'pd-token-SECRET',
  },
  notification: 'pd-master-SECRET',
  previous_valid_until: null,
};
const STRIPE = {
  provider: 'STRIPE',
  credentials: { secret_key: 'sk_test_SECRET' },
  notification: 'whsec_SECRET',
  previous_valid_until: null,
};

const binding = (provider: string, ref = REF, holder = HOLDER): PspSecretBinding => ({
  configurationId: 'cfg-1',
  holderPartyId: holder,
  secretRef: ref,
  provider: provider as PspSecretBinding['provider'],
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PspSecretError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('AwsSecretsManagerStore', () => {
  let fake: FakeSecretsManager;
  let now: Date;
  let store: AwsSecretsManagerStore;
  const logs: string[] = [];

  beforeAll(async () => {
    fake = await startFakeSecretsManager();
  });
  afterAll(async () => {
    await fake.close();
  });
  beforeEach(() => {
    fake.server.requests.length = 0;
    fake.clearFailures();
    now = new Date('2026-11-26T12:00:00Z');
    store = new AwsSecretsManagerStore(fake.client, () => now);
    logs.length = 0;
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const)
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
  });
  afterEach(() => jest.restoreAllMocks());

  const put = (ref: string, current: unknown, previous?: unknown): void =>
    fake.put(ref, {
      current: typeof current === 'string' ? current : JSON.stringify(current),
      previous: previous === undefined ? undefined : JSON.stringify(previous),
    });

  it('lit un secret Wave', async () => {
    put(REF, WAVE);
    const s = await store.get(binding('WAVE'));
    expect(s.credentials.provider).toBe('WAVE');
    if (s.credentials.provider !== 'WAVE') throw new Error('type');
    expect(s.credentials.apiKey.reveal()).toBe('wave-api-key-SECRET');
    expect(s.credentials.requestSigningSecret?.reveal()).toBe('wave-sign-SECRET');
    expect(s.notification.current.reveal()).toBe('wave-whs-CURRENT-SECRET');
    expect(s.notification.previous).toBeNull();
    expect(s.notification.previousValidUntil).toBeNull();
    const req = fake.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.headers['x-amz-target']).toBe('secretsmanager.GetSecretValue');
    expect(JSON.parse(req.body.toString())).toEqual({ SecretId: REF });
  });

  it('Wave sans secret de signature de requête : null', async () => {
    put(REF, { ...WAVE, credentials: { api_key: 'k', request_signing_secret: null } });
    const s = await store.get(binding('WAVE'));
    if (s.credentials.provider !== 'WAVE') throw new Error('type');
    expect(s.credentials.requestSigningSecret).toBeNull();
  });

  it('lit un secret PayDunya et un secret Stripe', async () => {
    put(REF, PAYDUNYA);
    const pd = await store.get(binding('PAYDUNYA'));
    if (pd.credentials.provider !== 'PAYDUNYA') throw new Error('type');
    expect(pd.credentials.masterKey.reveal()).toBe('pd-master-SECRET');
    expect(pd.credentials.privateKey.reveal()).toBe('pd-private-SECRET');
    expect(pd.credentials.token.reveal()).toBe('pd-token-SECRET');
    expect(pd.notification.current.reveal()).toBe('pd-master-SECRET');
    expect(pd.notification.previous).toBeNull();

    const ref2 = `psp/${HOLDER}/card`;
    put(ref2, STRIPE);
    const st = await store.get(binding('STRIPE', ref2));
    if (st.credentials.provider !== 'STRIPE') throw new Error('type');
    expect(st.credentials.secretKey.reveal()).toBe('sk_test_SECRET');
    expect(st.notification.current.reveal()).toBe('whsec_SECRET');
  });

  describe('détenteur et forme de la référence', () => {
    it('détenteur différent : HOLDER_MISMATCH sans aucune requête', async () => {
      put(`psp/${OTHER}/prod`, WAVE);
      expect(await codeOf(store.get(binding('WAVE', `psp/${OTHER}/prod`)))).toBe('HOLDER_MISMATCH');
      expect(fake.requests).toHaveLength(0);
    });

    it('segment comparé exactement : un préfixe du détenteur est refusé', async () => {
      const ref = `psp/${HOLDER}x/prod`;
      put(ref, WAVE);
      expect(await codeOf(store.get(binding('WAVE', ref)))).toBe('HOLDER_MISMATCH');
      expect(fake.requests).toHaveLength(0);
    });

    it('refuse sans requête une référence mal formée', async () => {
      for (const ref of [
        'prod',
        `psp/${HOLDER}`,
        `psp/${HOLDER}/`,
        `psp/${HOLDER}/../${OTHER}/prod`,
        `psp/${HOLDER}/a b`,
        `psp/${HOLDER}/${'a'.repeat(512)}`,
        `other/${HOLDER}/prod`,
      ])
        expect(await codeOf(store.get(binding('WAVE', ref)))).toBe('REF_INVALID');
      expect(fake.requests).toHaveLength(0);
    });
  });

  describe('contenu invalide', () => {
    it.each([
      ['JSON invalide', '{pas du json'],
      ['tableau', '[]'],
      ['fournisseur inconnu', JSON.stringify({ ...WAVE, provider: 'ORANGE' })],
      ['FAKE refusé', JSON.stringify({ ...WAVE, provider: 'FAKE' })],
      ['champ manquant', JSON.stringify({ ...WAVE, credentials: {} })],
      ['champ vide', JSON.stringify({ ...WAVE, credentials: { api_key: '' } })],
      ['notification absente', JSON.stringify({ ...WAVE, notification: undefined })],
      ['échéance illisible', JSON.stringify({ ...WAVE, previous_valid_until: 'demain' })],
    ])('%s : REF_INVALID', async (_name, value) => {
      put(REF, value);
      expect(await codeOf(store.get(binding('WAVE')))).toBe('REF_INVALID');
    });

    it('fournisseur du secret différent de la configuration : REF_INVALID', async () => {
      put(REF, STRIPE);
      expect(await codeOf(store.get(binding('WAVE')))).toBe('REF_INVALID');
    });

    it('PayDunya dont notification diffère de master_key : REF_INVALID (L4)', async () => {
      put(REF, { ...PAYDUNYA, notification: 'autre-secret' });
      expect(await codeOf(store.get(binding('PAYDUNYA')))).toBe('REF_INVALID');
    });
  });

  describe('rotation', () => {
    const previousDoc = { ...WAVE, notification: 'wave-whs-PREVIOUS-SECRET' };

    it('échéance future : lit AWSPREVIOUS, seul notification est repris', async () => {
      const until = '2026-11-27T12:00:00Z';
      put(
        REF,
        { ...WAVE, previous_valid_until: until },
        {
          ...previousDoc,
          credentials: { api_key: 'AUTRE-CLE-PRECEDENTE' },
        },
      );
      const s = await store.get(binding('WAVE'));
      expect(s.notification.previous?.reveal()).toBe('wave-whs-PREVIOUS-SECRET');
      expect(s.notification.previousValidUntil?.toISOString()).toBe('2026-11-27T12:00:00.000Z');
      if (s.credentials.provider !== 'WAVE') throw new Error('type');
      expect(s.credentials.apiKey.reveal()).toBe('wave-api-key-SECRET');
      expect(fake.requests.map((r) => JSON.parse(r.body.toString()))).toEqual([
        { SecretId: REF },
        { SecretId: REF, VersionStage: 'AWSPREVIOUS' },
      ]);
    });

    it('échéance passée : pas de lecture de AWSPREVIOUS, previous = null', async () => {
      put(REF, { ...WAVE, previous_valid_until: '2026-11-26T11:59:59Z' }, previousDoc);
      const s = await store.get(binding('WAVE'));
      expect(s.notification.previous).toBeNull();
      expect(s.notification.previousValidUntil).toBeNull();
      expect(fake.requests).toHaveLength(1);
    });

    it('échéance absente : previous = null', async () => {
      put(REF, WAVE, previousDoc);
      const s = await store.get(binding('WAVE'));
      expect(s.notification.previous).toBeNull();
      expect(fake.requests).toHaveLength(1);
    });

    it('erreur sur AWSPREVIOUS : previous = null, journal sans référence ni valeur', async () => {
      put(REF, { ...WAVE, previous_valid_until: '2026-11-27T12:00:00Z' });
      fake.fail(REF, 'InternalServiceError', 500, 'AWSPREVIOUS');
      const s = await store.get(binding('WAVE'));
      expect(s.notification.previous).toBeNull();
      expect(s.notification.current.reveal()).toBe('wave-whs-CURRENT-SECRET');
      expect(logs.length).toBeGreaterThan(0);
      for (const line of logs) {
        expect(line).not.toContain(REF);
        expect(line).not.toContain(HOLDER);
        expect(line).not.toContain('SECRET');
      }
    });

    it('PayDunya : jamais de précédent, même avec une échéance future', async () => {
      put(REF, { ...PAYDUNYA, previous_valid_until: '2026-11-27T12:00:00Z' }, PAYDUNYA);
      const s = await store.get(binding('PAYDUNYA'));
      expect(s.notification.previous).toBeNull();
      expect(fake.requests).toHaveLength(1);
    });
  });

  describe('erreurs', () => {
    it('ResourceNotFoundException : NOT_FOUND', async () => {
      expect(await codeOf(store.get(binding('WAVE', `psp/${HOLDER}/absent`)))).toBe('NOT_FOUND');
    });

    it('AccessDeniedException : UNAVAILABLE', async () => {
      put(REF, WAVE);
      fake.fail(REF, 'AccessDeniedException', 400);
      expect(await codeOf(store.get(binding('WAVE')))).toBe('UNAVAILABLE');
    });

    it('erreur 5xx : UNAVAILABLE', async () => {
      put(REF, WAVE);
      fake.fail(REF, 'InternalServiceError', 500);
      expect(await codeOf(store.get(binding('WAVE')))).toBe('UNAVAILABLE');
    });

    it('serveur injoignable : UNAVAILABLE', async () => {
      const dead = await startFakeSecretsManager();
      const deadStore = new AwsSecretsManagerStore(dead.client, () => now);
      await dead.close();
      expect(await codeOf(deadStore.get(binding('WAVE')))).toBe('UNAVAILABLE');
    });

    it("une erreur n'est pas mise en cache", async () => {
      put(REF, WAVE);
      fake.fail(REF, 'InternalServiceError', 500);
      expect(await codeOf(store.get(binding('WAVE')))).toBe('UNAVAILABLE');
      fake.clearFailures();
      const s = await store.get(binding('WAVE'));
      expect(s.notification.current.reveal()).toBe('wave-whs-CURRENT-SECRET');
    });

    it('message sans valeur, référence ni détenteur', async () => {
      const refs = [`psp/${OTHER}/prod`, `psp/${HOLDER}/absent`, 'psp/x'];
      for (const ref of refs) {
        try {
          await store.get(binding('WAVE', ref));
        } catch (error) {
          const text = `${(error as Error).message} ${JSON.stringify(error)}`;
          expect(text).not.toContain(ref);
          expect(text).not.toContain(HOLDER);
          expect(text).not.toContain(OTHER);
        }
      }
      put(REF, '{"provider":"WAVE","credentials":{"api_key":"valeur-SECRET"}');
      try {
        await store.get(binding('WAVE'));
        throw new Error('attendu');
      } catch (error) {
        expect((error as Error).message).not.toContain('SECRET');
      }
    });
  });

  describe('cache de 60 s', () => {
    it('une seule requête en 60 s, une nouvelle après', async () => {
      put(REF, WAVE);
      await store.get(binding('WAVE'));
      now = new Date(now.getTime() + 59_999);
      await store.get(binding('WAVE'));
      expect(fake.requests).toHaveLength(1);
      put(REF, { ...WAVE, notification: 'wave-whs-ROTATED-SECRET' });
      now = new Date(now.getTime() + 1);
      const s = await store.get(binding('WAVE'));
      expect(fake.requests).toHaveLength(2);
      expect(s.notification.current.reveal()).toBe('wave-whs-ROTATED-SECRET');
    });

    it('le cache ne contourne pas le contrôle du détenteur ni du fournisseur', async () => {
      put(REF, WAVE);
      await store.get(binding('WAVE'));
      expect(await codeOf(store.get(binding('WAVE', REF, OTHER)))).toBe('HOLDER_MISMATCH');
      expect(await codeOf(store.get(binding('STRIPE')))).toBe('REF_INVALID');
    });

    it("un résultat modifié par l'appelant ne change pas le cache", async () => {
      put(REF, WAVE);
      const first = await store.get(binding('WAVE'));
      (first.notification as { previous: unknown }).previous = 'altéré';
      const second = await store.get(binding('WAVE'));
      expect(second.notification.previous).toBeNull();
    });
  });

  it('aucun secret dans les journaux, tous cas confondus', async () => {
    put(REF, { ...WAVE, previous_valid_until: '2026-11-27T12:00:00Z' }, WAVE);
    await store.get(binding('WAVE'));
    await codeOf(store.get(binding('WAVE', `psp/${HOLDER}/absent`)));
    for (const line of logs) expect(line).not.toContain('SECRET');
  });

  it('porte les marques des adaptateurs réels', () => {
    expect(store.isFake).toBe(false);
    expect(store.service).toBe('psp.secrets');
  });
});
