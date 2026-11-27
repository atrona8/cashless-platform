import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, loadConfig, type ExternalModes } from '../../../src/config/config';
import { ProblemException } from '../../../src/errors/problem';
import { assertNoFakeInProduction, FakeInProductionError } from '../../../src/kms/production-guard';
import { AwsSecretsManagerStore } from '../../../src/psp/aws/secrets-manager-store';
import { PayDunyaPspAdapter } from '../../../src/psp/paydunya/paydunya-adapter';
import { PspSecretError, type PspSecretStore } from '../../../src/psp/psp-secret-store.port';
import { StripePspAdapter } from '../../../src/psp/stripe/stripe-adapter';
import { WavePspAdapter } from '../../../src/psp/wave/wave-adapter';
import { startFakeServer } from '../../support/fake-servers/http-fake';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { FakePspAdapter } from '../../../src/psp/fake/fake-psp-adapter';
import { FakePspSecretStore } from '../../../src/psp/fake/fake-psp-secret-store';
import { PspAdapterRegistry } from '../../../src/psp/psp-adapter-registry';
import { PspModule } from '../../../src/psp/psp.module';
import { createPspAdapters, createPspSecretStore } from '../../../src/psp/psp.providers';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../../../src/psp/psp.tokens';
import { PSP_PROVIDERS } from '../../../src/psp/psp.types';
import { UnavailablePspSecretStore } from '../../../src/psp/unavailable/unavailable-psp';

const PRODUCTION = { production: true };
const LOCAL = { production: false };

const processWith = (production: boolean, providers: Map<symbol, object>) => ({
  get: (wanted: unknown) => {
    if (wanted === APP_CONFIG) return { production };
    const found = providers.get(wanted as symbol);
    if (found) return found;
    throw new Error('absent');
  },
});

describe('production : aucun faux PSP (borne OP-N81, ADR-131)', () => {
  it('OP-N81 : en production, aucun adaptateur n’est construit (mettre OP-N81 à jour si ce test change)', () => {
    const registry = createPspAdapters(PRODUCTION);
    expect(registry.available).toBe(false);
    expect(registry.isFake).toBeUndefined();
    for (const provider of PSP_PROVIDERS) {
      expect(() => registry.forProvider(provider)).toThrow(ProblemException);
      try {
        registry.forProvider(provider);
      } catch (error) {
        expect(error).toMatchObject({ code: 'PSP_UNAVAILABLE', status: 503 });
      }
    }
  });

  it('OP-N81 : le coffre de production est le coffre indisponible, non faux', () => {
    const store = createPspSecretStore(PRODUCTION);
    expect(store).toBeInstanceOf(UnavailablePspSecretStore);
    expect((store as { isFake?: boolean }).isFake).toBeUndefined();
  });

  it('aucun réglage d’environnement n’y change rien', () => {
    const saved = { ...process.env };
    Object.assign(process.env, { PSP_FAKE: '1', ALLOW_FAKES: '1', FAKE_PSP: 'true' });
    try {
      expect(createPspAdapters(PRODUCTION).available).toBe(false);
      expect(createPspSecretStore(PRODUCTION)).toBeInstanceOf(UnavailablePspSecretStore);
    } finally {
      process.env = saved;
    }
  });

  it('hors production : quatre faux, tous marqués', () => {
    const registry = createPspAdapters(LOCAL);
    expect(registry.available).toBe(true);
    expect(registry.isFake).toBe(true);
    for (const provider of PSP_PROVIDERS) {
      const adapter = registry.forProvider(provider);
      expect(adapter.isFake).toBe(true);
      expect(adapter.provider).toBe(provider);
    }
    expect(createPspSecretStore(LOCAL)).toBeInstanceOf(FakePspSecretStore);
    expect(createPspSecretStore(LOCAL).isFake).toBe(true);
  });
});

describe('garde de démarrage : cinq faux', () => {
  const fakes: [string, object][] = [
    ...PSP_PROVIDERS.map((p): [string, object] => [
      `registre avec le faux ${p}`,
      new PspAdapterRegistry([new FakePspAdapter(p)], true),
    ]),
    ['coffre', new FakePspSecretStore()],
  ];

  it.each(fakes)('assertNoFakeInProduction : %s', (_name, fake) => {
    expect(() => assertNoFakeInProduction(true, { x: fake })).toThrow(FakeInProductionError);
    expect(() => assertNoFakeInProduction(false, { x: fake })).not.toThrow();
  });

  it('assertProcessIsSafe : registre faux, y compris un faux glissé dans un registre sain', () => {
    const glissé = new PspAdapterRegistry([new FakePspAdapter('WAVE')], true);
    const proc = processWith(true, new Map<symbol, object>([[PSP_ADAPTERS, glissé]]));
    expect(() => assertProcessIsSafe(proc as never)).toThrow(/les adaptateurs PSP/);
    expect(() =>
      assertProcessIsSafe(processWith(false, new Map([[PSP_ADAPTERS, glissé]])) as never),
    ).not.toThrow();
  });

  it('assertProcessIsSafe : faux coffre refusé, registre et coffre indisponibles passent', () => {
    const faux = processWith(
      true,
      new Map<symbol, object>([[PSP_SECRET_STORE, new FakePspSecretStore()]]),
    );
    expect(() => assertProcessIsSafe(faux as never)).toThrow(/le coffre des secrets PSP/);
    const sain = processWith(
      true,
      new Map<symbol, object>([
        [PSP_ADAPTERS, createPspAdapters(PRODUCTION)],
        [PSP_SECRET_STORE, createPspSecretStore(PRODUCTION)],
      ]),
    );
    expect(() => assertProcessIsSafe(sain as never)).not.toThrow();
    // Processus qui n'importe pas PspModule : aucun refus.
    expect(() => assertProcessIsSafe(processWith(true, new Map()) as never)).not.toThrow();
  });
});

function configStub(production: boolean) {
  @Global()
  @Module({ providers: [{ provide: APP_CONFIG, useValue: { production } }], exports: [APP_CONFIG] })
  class ConfigStub {}
  return ConfigStub;
}

describe('module', () => {
  const compile = (production: boolean) =>
    Test.createTestingModule({
      imports: [configStub(production), PspModule],
    }).compile();

  it('production : compile sans lever et fournit un registre indisponible', async () => {
    const module = await compile(true);
    const registry = module.get<PspAdapterRegistry>(PSP_ADAPTERS);
    expect(registry.available).toBe(false);
    expect(module.get(PSP_SECRET_STORE)).toBeInstanceOf(UnavailablePspSecretStore);
    expect(() => assertProcessIsSafe(module as never)).not.toThrow();
    await module.close();
  });

  it('hors production : registre de faux', async () => {
    const module = await compile(false);
    expect(module.get<PspAdapterRegistry>(PSP_ADAPTERS).isFake).toBe(true);
    await module.close();
  });
});

describe('borne OP-N81 : les faux ne se répandent pas', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
    });
  }

  it('seul psp/psp.providers.ts référence psp/fake/, quelle que soit la forme', () => {
    const src = join(__dirname, '../../../src');
    // Toute chaîne de chemin contenant « fake/ » : import, import dynamique, require, import sans liaison.
    const reference = /['"`][^'"`\n]*\bfake\/[^'"`\n]*['"`]/;
    const offenders = sources(src)
      .map((file) => file.slice(src.length + 1))
      .filter((file) => !file.startsWith('psp/fake/') && file !== 'psp/psp.providers.ts')
      .filter((file) => reference.test(readFileSync(join(src, file), 'utf8')));
    expect(offenders).toEqual([]);
    expect(readFileSync(join(src, 'psp/psp.providers.ts'), 'utf8')).toMatch(reference);
  });
});

// ----- Mission 12b-1, WP10 : faux ou réel, listé ou non (décisions D3 et D6 du porteur, 26/11/2026) -----

const asConfig = (env: NodeJS.ProcessEnv) => loadConfig({ NODE_ENV: 'test', ...env });
const prod = (modes: Partial<ExternalModes>) => ({
  production: true,
  externalModes: {
    psp: 'real',
    pspSecrets: 'real',
    kms: 'real',
    sealCopy: 'real',
    ...modes,
  } as ExternalModes,
  ...pick(asConfig({}), ['pspBases', 'waveDefaultUrls', 'pspHttpTimeoutMs', 'aws']),
});

function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>;
}

const unavailable = (registry: PspAdapterRegistry, provider: (typeof PSP_PROVIDERS)[number]) => {
  try {
    registry.forProvider(provider);
  } catch (error) {
    return (error as { code?: string }).code === 'PSP_UNAVAILABLE';
  }
  return false;
};

describe('sélection des adaptateurs PSP : production × fake/real × listé/non listé', () => {
  it('production, fake posé : refus de construire, nommé', () => {
    expect(() => createPspAdapters(prod({ psp: 'fake' }))).toThrow(FakeInProductionError);
    expect(() => createPspAdapters(prod({ psp: 'fake' }))).toThrow(/les adaptateurs PSP/);
    expect(() => createPspAdapters(prod({ psp: 'fake' }), undefined, ['psp.wave'])).toThrow(
      FakeInProductionError,
    );
  });

  it('production, réel non listé (liste du code, vide) : registre vide et indisponible, aucun réel construit', () => {
    const registry = createPspAdapters(prod({}));
    expect(registry.available).toBe(false);
    for (const provider of PSP_PROVIDERS) expect(unavailable(registry, provider)).toBe(true);
    // Réglage absent en production = réel : même résultat.
    expect(createPspAdapters({ production: true }).available).toBe(false);
  });

  it('production, réel listé : seuls les fournisseurs listés entrent, jamais Orange Money', () => {
    const one = createPspAdapters(prod({}), undefined, ['psp.wave']);
    expect(one.available).toBe(true);
    expect(one.forProvider('WAVE')).toBeInstanceOf(WavePspAdapter);
    for (const other of ['PAYDUNYA', 'STRIPE', 'ORANGE_MONEY'] as const)
      expect(unavailable(one, other)).toBe(true);

    const all = createPspAdapters(prod({}), undefined, ['psp.wave', 'psp.paydunya', 'psp.stripe']);
    expect(all.forProvider('PAYDUNYA')).toBeInstanceOf(PayDunyaPspAdapter);
    expect(all.forProvider('STRIPE')).toBeInstanceOf(StripePspAdapter);
    expect(unavailable(all, 'ORANGE_MONEY')).toBe(true);
    expect(all.isFake).toBeUndefined();
    // Le service du coffre ou du service de clés ne suffit pas à ouvrir un PSP.
    expect(createPspAdapters(prod({}), undefined, ['psp.secrets', 'kms']).available).toBe(false);
  });

  it('hors production : fake par défaut, real permis (trois adaptateurs, pas d’Orange Money)', () => {
    expect(createPspAdapters(asConfig({})).isFake).toBe(true);
    const real = createPspAdapters(asConfig({ PSP_ADAPTERS: 'real' }));
    expect(real.available).toBe(true);
    expect(real.isFake).toBeUndefined();
    expect(real.forProvider('WAVE')).toBeInstanceOf(WavePspAdapter);
    expect(real.forProvider('PAYDUNYA')).toBeInstanceOf(PayDunyaPspAdapter);
    expect(real.forProvider('STRIPE')).toBeInstanceOf(StripePspAdapter);
    expect(unavailable(real, 'ORANGE_MONEY')).toBe(true);
    for (const provider of ['WAVE', 'PAYDUNYA', 'STRIPE'] as const)
      expect(real.forProvider(provider).isFake).not.toBe(true);
  });

  it('la liste ne vient jamais de l’environnement', () => {
    const saved = { ...process.env };
    Object.assign(process.env, { PRODUCTION_ENABLED_SERVICES: 'psp.wave,psp.stripe,kms' });
    try {
      expect(createPspAdapters(prod({})).available).toBe(false);
      expect(createPspSecretStore(prod({}))).toBeInstanceOf(UnavailablePspSecretStore);
    } finally {
      process.env = saved;
    }
  });
});

describe('sélection du coffre des secrets : production × fake/real × listé/non listé', () => {
  it('production, fake posé : refus, nommé', () => {
    expect(() => createPspSecretStore(prod({ pspSecrets: 'fake' }))).toThrow(FakeInProductionError);
    expect(() => createPspSecretStore(prod({ pspSecrets: 'fake' }))).toThrow(
      /le coffre des secrets PSP/,
    );
  });

  it('production, réel non listé : coffre indisponible (démarrage permis), pas le réel', async () => {
    const store = createPspSecretStore(prod({}));
    expect(store).toBeInstanceOf(UnavailablePspSecretStore);
    expect((store as { isFake?: boolean }).isFake).toBeUndefined();
    // Un autre service listé n'ouvre pas le coffre.
    expect(createPspSecretStore(prod({}), ['psp.wave', 'kms'])).toBeInstanceOf(
      UnavailablePspSecretStore,
    );
  });

  it('production, réel listé : le coffre AWS', () => {
    const store = createPspSecretStore(prod({}), ['psp.secrets']);
    expect(store).toBeInstanceOf(AwsSecretsManagerStore);
    expect(store.isFake).toBe(false);
  });

  it('hors production : fake par défaut, real permis', () => {
    expect(createPspSecretStore(asConfig({}))).toBeInstanceOf(FakePspSecretStore);
    expect(createPspSecretStore(asConfig({ PSP_SECRET_STORE: 'real' }))).toBeInstanceOf(
      AwsSecretsManagerStore,
    );
  });
});

describe('indisponibilité d’un service au démarrage : le module démarre, l’usage échoue sans secret', () => {
  let closedUrl: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    // Faux serveur local démarré puis ARRÊTÉ : le port est libre, toute connexion est refusée.
    const server = await startFakeServer(() => undefined);
    closedUrl = server.url;
    await server.close();
    Object.assign(process.env, {
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_MAX_ATTEMPTS: '1',
      AWS_EC2_METADATA_DISABLED: 'true',
    });
  });
  afterAll(() => {
    process.env = saved;
  });

  it('coffre réel : le module compile (aucun appel au démarrage) ; la lecture échoue sans exposer la référence', async () => {
    const config = asConfig({
      PSP_ADAPTERS: 'real',
      PSP_SECRET_STORE: 'real',
      AWS_ENDPOINT_URL: closedUrl,
    });
    @Global()
    @Module({ providers: [{ provide: APP_CONFIG, useValue: config }], exports: [APP_CONFIG] })
    class RealConfig {}
    const module = await Test.createTestingModule({ imports: [RealConfig, PspModule] }).compile();
    const store = module.get<PspSecretStore>(PSP_SECRET_STORE);
    expect(store).toBeInstanceOf(AwsSecretsManagerStore);
    const holder = '11111111-2222-4333-8444-555555555555';
    const secretRef = `psp/${holder}/ref-tres-secrete`;
    const error = await store
      .get({ configurationId: 'c', holderPartyId: holder, secretRef, provider: 'WAVE' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PspSecretError);
    expect(JSON.stringify(error) + String((error as Error).message)).not.toContain(
      'ref-tres-secrete',
    );
    await module.close();
  });
});
