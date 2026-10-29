// Gardes de production de la mission 6 (lot WP14, T072 ; SC-008, C-007 ; règle « aucun faux en production »).
//   (a) Balayage de `apps/api/src` : toute classe qui porte `isFake` doit être couverte par
//       `test/unit/production-guard.spec.ts` (nommée, ou son jeton de port nommé) ; un faux ajouté plus tard sans preuve
//       de refus fait échouer ce test.
//   (b) Démarrage en configuration de production par le point d'entrée `processes/bootstrap.ts`
//       (`assertProcessIsSafe`) : chaque faux PSP (par fournisseur), le faux coffre, l'identité festivalier fausse
//       sont refusés sur de vrais modules de processus compilés en production ; les fournisseurs « indisponibles »
//       (production réelle) démarrent.
//   (c) Processus public avec des fournisseurs indisponibles : routes d'espèces servies, `initiatePspTopup` ->
//       `503 PSP_UNAVAILABLE`, notification -> `404` neutre.
// Réutilise les fabriques de WP07 (`psp.providers.ts`), ne les copie pas.
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, type AppConfig } from '../../../src/config/config';
import { FakeCustomerIdentity } from '../../../src/customer-identity/fake-customer-identity';
import { CUSTOMER_IDENTITY } from '../../../src/customer-identity/customer-identity.port';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { PublicProcessModule } from '../../../src/processes/public.module';
import { PspPollerProcessModule } from '../../../src/processes/psp-poller.module';
import { FakePspAdapter } from '../../../src/psp/fake/fake-psp-adapter';
import { FakePspSecretStore } from '../../../src/psp/fake/fake-psp-secret-store';
import { PspAdapterRegistry } from '../../../src/psp/psp-adapter-registry';
import { createPspAdapters, createPspSecretStore } from '../../../src/psp/psp.providers';
import { PSP_ADAPTERS, PSP_SECRET_STORE } from '../../../src/psp/psp.tokens';
import { PSP_PROVIDERS } from '../../../src/psp/psp.types';
import { APP_URL, PLATFORM_URL } from '../../support/db';
import { WebhookWorld } from '../webhooks/webhook-fixtures';

jest.setTimeout(300_000);

const SRC = join(__dirname, '../../../src');
const GUARD_SPEC = join(__dirname, '../../unit/production-guard.spec.ts');
/** Faux dont la preuve de refus est faite par JETON de port dans production-guard.spec.ts (cas `isFake` générique). */
const COVERED_BY_TOKEN: Record<string, string> = {
  FakeDeviceCa: 'DEVICE_CA',
  FakeTokenSigner: 'TOKEN_SIGNER',
  FakeAttestation: 'ATTESTATION_VERIFIER',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Classes qui déclarent `isFake = true` (champ) : les faux. Les accesseurs `get isFake` agrègent, ils ne sont pas des faux. */
export function fakeClasses(files: Array<{ path: string; text: string }>): string[] {
  const found: string[] = [];
  for (const { text } of files) {
    const re = /export class (\w+)[^{]*\{[\s\S]*?readonly isFake\s*=\s*true/g;
    for (const match of text.matchAll(re)) found.push(match[1]!);
  }
  return found.sort();
}

export function uncovered(classes: string[], guardSpec: string): string[] {
  return classes.filter((name) => {
    if (guardSpec.includes(name)) return false;
    const token = COVERED_BY_TOKEN[name];
    return token === undefined || !guardSpec.includes(token);
  });
}

const PRODUCTION = (config: AppConfig): AppConfig => ({ ...config, production: true });

describe('SC-008, C-007 : gardes de production de la mission 6', () => {
  it('(a) toute classe `isFake` de src/ est couverte par production-guard.spec.ts', () => {
    const files = sources(SRC).map((path) => ({
      path: relative(SRC, path).split(sep).join('/'),
      text: readFileSync(path, 'utf8'),
    }));
    const classes = fakeClasses(files);
    // Contrôle du balayage : les faux connus sont bien trouvés (le test échoue s'il ne cherche rien).
    expect(classes).toEqual(
      expect.arrayContaining([
        'FakeAttestation',
        'FakeCustomerIdentity',
        'FakeDeviceCa',
        'FakeDeviceIdentity',
        'FakeKms',
        'FakePspAdapter',
        'FakePspSecretStore',
        'FakeTokenSigner',
      ]),
    );
    expect(uncovered(classes, readFileSync(GUARD_SPEC, 'utf8'))).toEqual([]);
  });

  it('(a) un faux ajouté sans preuve de refus est vu', () => {
    const added = [
      {
        path: 'psp/fake/fake-nouveau.ts',
        text: 'export class FakeNouveauPsp implements X {\n  readonly isFake = true;\n}',
      },
    ];
    const classes = fakeClasses(added);
    expect(classes).toEqual(['FakeNouveauPsp']);
    expect(uncovered(classes, readFileSync(GUARD_SPEC, 'utf8'))).toEqual(['FakeNouveauPsp']);
  });

  describe('(b) démarrage en production par processes/bootstrap.ts', () => {
    const compile = async (
      overrides: Array<[unknown, unknown]>,
      module: Type<unknown> = PspPollerProcessModule,
    ) => {
      process.env.DATABASE_URL_APP = APP_URL;
      process.env.DATABASE_URL_PLATFORM = PLATFORM_URL;
      const probe = await Test.createTestingModule({ imports: [module] }).compile();
      const config = probe.get<AppConfig>(APP_CONFIG, { strict: false });
      await probe.close();
      const builder = Test.createTestingModule({ imports: [module] })
        .overrideProvider(APP_CONFIG)
        .useValue(PRODUCTION(config));
      for (const [token, value] of overrides)
        builder.overrideProvider(token as never).useValue(value);
      const moduleRef = await builder.compile();
      const app = moduleRef.createNestApplication({ logger: false });
      await app.init();
      return app;
    };

    it.each(PSP_PROVIDERS.map((provider) => [provider]))(
      'faux adaptateur %s : démarrage refusé en production',
      async (provider) => {
        const app = await compile([
          [PSP_ADAPTERS, new PspAdapterRegistry([new FakePspAdapter(provider)], true)],
        ]);
        try {
          expect(() => assertProcessIsSafe(app)).toThrow(FakeInProductionError);
          expect(() => assertProcessIsSafe(app)).toThrow(/adaptateurs PSP/);
        } finally {
          await app.close();
        }
      },
    );

    it('faux coffre des secrets : démarrage refusé en production', async () => {
      const app = await compile([[PSP_SECRET_STORE, new FakePspSecretStore()]]);
      try {
        expect(() => assertProcessIsSafe(app)).toThrow(/coffre des secrets PSP/);
      } finally {
        await app.close();
      }
    });

    it('identité festivalier fausse : démarrage du processus public refusé en production', async () => {
      // Le processus public construit son identité festivalier : en production, la fabrique refuse le faux (ou la
      // garde de `bootstrap.ts` le refuse ensuite) ; dans les deux cas le processus ne démarre pas.
      await expect(
        compile([[CUSTOMER_IDENTITY, new FakeCustomerIdentity()]], PublicProcessModule).then(
          (app) => {
            try {
              assertProcessIsSafe(app);
            } finally {
              void app.close();
            }
          },
        ),
      ).rejects.toThrow(FakeInProductionError);
    });

    it('fournisseurs indisponibles (production réelle) : le processus passe la garde', async () => {
      const production = { production: true };
      const app = await compile([
        [PSP_ADAPTERS, createPspAdapters(production)],
        [PSP_SECRET_STORE, createPspSecretStore(production)],
      ]);
      try {
        expect(() => assertProcessIsSafe(app)).not.toThrow();
      } finally {
        await app.close();
      }
    });
  });

  describe('(c) processus public, fournisseurs indisponibles', () => {
    let w: WebhookWorld;
    let unavailable = false;
    beforeAll(async () => {
      // Registre vide et indisponible (comme en production) ; le coffre est celui du jeu d'essai le temps de
      // l'amorçage des configurations, puis indisponible (`UNAVAILABLE`), comme `UnavailablePspSecretStore`.
      const seeded = new FakePspSecretStore();
      const store = {
        put: seeded.put.bind(seeded),
        get: (binding: Parameters<FakePspSecretStore['get']>[0]) =>
          unavailable
            ? createPspSecretStore({ production: true }).get(binding)
            : seeded.get(binding),
      };
      w = await WebhookWorld.create([
        { provide: PSP_ADAPTERS, useValue: createPspAdapters({ production: true }) },
        { provide: PSP_SECRET_STORE, useValue: store },
      ]);
      unavailable = true;
    }, 300_000);
    afterAll(async () => {
      await w?.close();
    });

    it('routes d’espèces servies, initiatePspTopup -> 503 PSP_UNAVAILABLE, notification -> 404', async () => {
      const cw = w.p.sw;
      const t = await cw.terminal();
      const sessionId = await cw.open(t, cw.w.cashierA);
      expect((await cw.term(t, 'GET', `/cash-sessions/${sessionId}`, cw.w.cashierA)).status).toBe(
        200,
      );
      const wallet = await w.p.wallet();
      const initiate = await cw.term(
        t,
        'POST',
        '/topups/psp',
        cw.w.cashierA,
        w.p.body(wallet.walletId),
      );
      expect(initiate.status).toBe(503);
      expect(initiate.body.code).toBe('PSP_UNAVAILABLE');
      const topup = await w.p.topup();
      const notified = await w.raw(JSON.stringify(w.event(topup.row)), {}, { method: 'WAVE' });
      expect(notified.status).toBe(404);
      expect(await w.p.read(topup.row.topupId)).toMatchObject({ status: 'PENDING' });
    });
  });
});
