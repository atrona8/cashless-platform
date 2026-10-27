import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG } from '../../../src/config/config';
import { ProblemException } from '../../../src/errors/problem';
import { assertNoFakeInProduction, FakeInProductionError } from '../../../src/kms/production-guard';
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
