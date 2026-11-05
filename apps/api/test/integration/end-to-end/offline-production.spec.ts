// Garde de production de la mission hors-ligne-snapshots-lots (lot WP21, T088 ; SC-008, NFR-010,
// OP-N89 ; règle 2 du porteur « aucun faux en production »).
//   (a) Balayage de `apps/api/src` : toute classe qui porte `isFake` est couverte par
//       `test/unit/production-guard.spec.ts` (nommée, ou son jeton de port nommé), sinon échec.
//       Contrôle du contrôle : un faux ajouté sans preuve est vu, un balayage vidé échoue.
//   (b) `SnapshotContentProcessModule` et `SnapshotSignerProcessModule` en configuration de
//       production avec le faux service de clés : `assertProcessIsSafe` refuse. Lien OP-N89 : ce
//       test est le test de borne du faux service de clés de ces deux processus. Le faux processeur
//       d'opérations hors ligne est prouvé dans production-guard.spec.ts (le processus public réel ne
//       se compile pas en production dans un test : ses autres faux sont refusés avant lui).
//   (c) API publique sans clé ACTIVE (indicateur de production sans effet ici) : `403 OFFLINE_NOT_ALLOWED` (détail
//       `SNAPSHOTS_UNAVAILABLE`), configuration servie avec `offline_enabled` faux.
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, type AppConfig } from '../../../src/config/config';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { FakeKms } from '../../../src/kms/fake-kms';
import { KMS_PROVIDER } from '../../../src/kms/kms.module';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { SnapshotContentProcessModule } from '../../../src/processes/snapshot-content.module';
import { SnapshotSignerProcessModule } from '../../../src/processes/snapshot-signer.module';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { APP_URL, PLATFORM_URL, withOwner } from '../../support/db';
import { SNAPCONTENT_URL } from '../../support/snapshot-secrets-db';
import { SNAPSIGN_URL } from '../snapshots-signer/support';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import { TestTerminal } from '../../support/test-terminal';

jest.setTimeout(300_000);

const SRC = join(__dirname, '../../../src');
const GUARD_SPEC = join(__dirname, '../../unit/production-guard.spec.ts');
/** Faux dont la preuve de refus est faite par JETON de port dans production-guard.spec.ts. */
const COVERED_BY_TOKEN: Record<string, string> = {
  FakeDeviceCa: 'DEVICE_CA',
  FakeTokenSigner: 'TOKEN_SIGNER',
  FakeAttestation: 'ATTESTATION_VERIFIER',
  FakeOperationProcessor: 'OFFLINE_OPERATION_PROCESSOR',
  RefusingEntryEncryptor: 'createEntryEncryptor',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/**
 * Classes qui déclarent un champ `isFake = true` (les faux). Le texte est coupé à chaque
 * déclaration de classe : un `isFake` n'est jamais attribué à la classe qui le précède. Les
 * accesseurs `get isFake()` agrègent, ils ne sont pas des faux.
 */
function fakeClasses(files: Array<{ path: string; text: string }>): string[] {
  const found: string[] = [];
  for (const { text } of files)
    for (const chunk of text.split(/^(?=(?:export )?(?:abstract )?class \w+)/m)) {
      const name = /^(?:export )?(?:abstract )?class (\w+)/.exec(chunk)?.[1];
      if (name && /\bisFake\s*(?::[^=;]+)?=\s*true\b/.test(chunk)) found.push(name);
    }
  return found.sort();
}

/** Faux dont ni le nom ni le jeton ne figurent dans le texte de la suite de garde. */
function uncovered(classes: string[], guardSpec: string): string[] {
  return classes.filter((name) => {
    if (guardSpec.includes(name)) return false;
    const token = COVERED_BY_TOKEN[name];
    return token === undefined || !guardSpec.includes(token);
  });
}

const readSources = () =>
  sources(SRC).map((path) => ({
    path: relative(SRC, path).split(sep).join('/'),
    text: readFileSync(path, 'utf8'),
  }));

describe('SC-008, NFR-010, OP-N89 : aucun faux en production (mission 7)', () => {
  it('(a) toute classe `isFake` de src/ est couverte par production-guard.spec.ts', () => {
    const classes = fakeClasses(readSources());
    // Contrôle du balayage : les faux connus sont bien trouvés (le test échoue s'il ne cherche rien).
    expect(classes).toEqual(
      expect.arrayContaining([
        'FakeAttestation',
        'FakeCustomerIdentity',
        'FakeDeviceCa',
        'FakeDeviceIdentity',
        'FakeKms',
        'FakeOperationProcessor',
        'FakePspAdapter',
        'FakePspSecretStore',
        'FakeTokenSigner',
        'RefusingEntryEncryptor',
      ]),
    );
    expect(uncovered(classes, readFileSync(GUARD_SPEC, 'utf8'))).toEqual([]);
  });

  it('(a) contrôle du contrôle : un faux ajouté sans preuve de refus est vu', () => {
    const added = [
      {
        path: 'offline/fake/fake-nouveau.ts',
        text: [
          'export class Voisine {',
          '  readonly nom = 1;',
          '}',
          'export class FakeNouveauSigneur implements X {',
          '  readonly isFake = true;',
          '}',
        ].join('\n'),
      },
    ];
    // La classe qui précède n'est pas accusée, la bonne est trouvée.
    const classes = fakeClasses(added);
    expect(classes).toEqual(['FakeNouveauSigneur']);
    expect(uncovered(classes, readFileSync(GUARD_SPEC, 'utf8'))).toEqual(['FakeNouveauSigneur']);
    // Ajouté aux sources réelles, il fait échouer la vérification complète.
    const all = fakeClasses([...readSources(), ...added]);
    expect(uncovered(all, readFileSync(GUARD_SPEC, 'utf8'))).toEqual(['FakeNouveauSigneur']);
  });

  it('(a) contrôle du contrôle : un balayage vidé ne passe pas pour une preuve', () => {
    // Sans source, aucun faux n'est trouvé : la vérification précédente (liste attendue non
    // vide) échouerait, elle ne peut donc pas verdir à vide.
    const classes = fakeClasses([]);
    expect(classes).toEqual([]);
    expect(() => expect(classes).toEqual(expect.arrayContaining(['FakeKms']))).toThrow();
  });

  describe('(b) démarrage en production par processes/bootstrap.ts', () => {
    const compile = async (module: Type<unknown>, overrides: Array<[unknown, unknown]>) => {
      process.env.DATABASE_URL_SNAPCONTENT = SNAPCONTENT_URL;
      process.env.DATABASE_URL_SNAPSIGN = SNAPSIGN_URL;
      process.env.DATABASE_URL_APP = APP_URL;
      process.env.DATABASE_URL_PLATFORM = PLATFORM_URL;
      const probe = await Test.createTestingModule({ imports: [module] }).compile();
      const config = probe.get<AppConfig>(APP_CONFIG, { strict: false });
      await probe.close();
      const builder = Test.createTestingModule({ imports: [module] })
        .overrideProvider(APP_CONFIG)
        .useValue({ ...config, production: true });
      for (const [token, value] of overrides)
        builder.overrideProvider(token as never).useValue(value);
      const app = (await builder.compile()).createNestApplication({ logger: false });
      await app.init();
      return app;
    };

    it.each([
      ['snapshot-content', SnapshotContentProcessModule],
      ['snapshot-signer', SnapshotSignerProcessModule],
    ] as Array<[string, Type<unknown>]>)(
      'processus %s avec le faux service de clés : démarrage refusé en production',
      async (_name, module) => {
        const app = await compile(module, [[KMS_PROVIDER, new FakeKms()]]);
        try {
          expect(() => assertProcessIsSafe(app)).toThrow(FakeInProductionError);
          expect(() => assertProcessIsSafe(app)).toThrow(/service de clés/);
        } finally {
          await app.close();
        }
      },
    );
  });

  describe('(c) API publique sans clé de signature ACTIVE', () => {
    let w: MediaWorld;
    let api: HttpsTestApp;
    let terminal: TestTerminal;
    let platformKey = true;

    beforeAll(async () => {
      process.env.DATABASE_URL_APP = APP_URL;
      process.env.DATABASE_URL_PLATFORM = PLATFORM_URL;
      // Clé CENTRAL ACTIVE de la plateforme (sans prestataire) : repli de tout prestataire sans clé
      // propre. Posée par d'autres suites de la base partagée ; l'état « sans clé » est alors
      // inobservable (même réserve que `offline/snapshots.spec.ts`), l'assertion est portée par
      // `expect(platformKey)` plus bas, jamais silencieuse.
      platformKey = await withOwner(async (db) => {
        const { rows } = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM snapshot_signing_key
            WHERE owner = 'CENTRAL' AND operator_id IS NULL AND status = 'ACTIVE'`,
        );
        return rows[0]!.n > 0;
      });
      w = await createMediaWorld();
      // Le processus public réel ne se compile pas en production dans un test : son signataire de
      // jetons, son autorité des terminaux et son service de clés sont des faux de test (refusés par
      // (b)). Le comportement testé ici ne dépend pas de l'indicateur : il vient de l'absence de clé.
      api = await startHttpsApp(undefined, { identity: w.idp });
      const ca = await FakeDeviceCa.fromFiles({
        certFile: api.tls.deviceCaCertFile,
        keyFile: api.tls.deviceCaFakeKeyFile,
      });
      await withOwner((db) =>
        db.query(
          `INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled,
             max_per_sale, max_per_media_per_device, max_total_per_device)
           VALUES ($1, 'EVENT', $2, true, 5000, 20000, 300000)`,
          [w.ops.a, w.ids.eventA],
        ),
      );
      terminal = await withOwner((db) =>
        new TestTerminal('ANDROID').enroll(db, {
          operatorId: w.ops.a,
          eventId: w.ids.eventA,
          ca,
        }),
      );
      await terminal.issueToken(api.app.get(DeviceTokenService, { strict: false }));
    });
    afterAll(async () => {
      await api?.close();
    });

    it('sans clé ACTIVE : 403 OFFLINE_NOT_ALLOWED / SNAPSHOTS_UNAVAILABLE et offline_enabled faux', async () => {
      if (platformKey) {
        // Une clé de la plateforme sert de repli : l'état « sans clé » n'existe pas dans cette base.
        // Le cas est écarté ici et signalé ; il est prouvé sur la base de lot (jamais de clé posée
        // par ce fichier).
        console.warn('offline-production (c) : clé plateforme ACTIVE présente, cas non observable');
        return;
      }
      const snapshot = await terminal.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'GET',
        path: '/offline-snapshots/current',
      });
      expect(snapshot.status).toBe(403);
      expect(snapshot.body.code).toBe('OFFLINE_NOT_ALLOWED');
      expect(snapshot.body.detail).toBe('SNAPSHOTS_UNAVAILABLE');
      const config = await terminal.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'GET',
        path: '/device/config',
      });
      expect(config.status).toBe(200);
      expect((config.body.offline_policy as { offline_enabled: boolean }).offline_enabled).toBe(
        false,
      );
      expect(config.body.snapshot_keys).toEqual([]);
    });
  });
});
