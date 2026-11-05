// WP13, T056 : aucun faux en production pour le processus `snapshot-signer` (règle 2), et bornes du processus :
// SignPort seul, aucune lecture de mot de passe, aucun accès à l'audit ou à la plateforme.
import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { APP_CONFIG, type AppConfig } from '../../../src/config/config';
import { FakeKms } from '../../../src/kms/fake-kms';
import { KMS_PROVIDER } from '../../../src/kms/kms.module';
import {
  DATA_KEY_PORT,
  DECRYPT_PORT,
  KEY_ADMIN_PORT,
  MAC_PORT,
  SIGN_PORT,
} from '../../../src/kms/kms.ports';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { SnapshotSignerProcessModule } from '../../../src/processes/snapshot-signer.module';
import { WorkerRegistry } from '../../../src/processes/worker';
import { SNAPSIGN_URL } from './support';

jest.setTimeout(120_000);

const SRC = join(__dirname, '../../../src');
const SIGNER_DIR = join(SRC, 'snapshots-signer');

describe('snapshot-signer : démarrage', () => {
  beforeAll(() => {
    process.env.DATABASE_URL_SNAPSIGN = SNAPSIGN_URL;
  });

  const compile = async (production: boolean, fake = true) => {
    const probe = await Test.createTestingModule({
      imports: [SnapshotSignerProcessModule],
    }).compile();
    const config = probe.get<AppConfig>(APP_CONFIG, { strict: false });
    await probe.close();
    const builder = Test.createTestingModule({ imports: [SnapshotSignerProcessModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...config, production });
    if (fake) builder.overrideProvider(KMS_PROVIDER).useValue(new FakeKms());
    const app = (await builder.compile()).createNestApplication({ logger: false });
    await app.init();
    return app;
  };

  it('production avec le faux SignPort : assertProcessIsSafe refuse de démarrer', async () => {
    const app = await compile(true);
    try {
      expect(() => assertProcessIsSafe(app)).toThrow(FakeInProductionError);
      expect(() => assertProcessIsSafe(app)).toThrow(/signataire de snapshots|service de clés/);
    } finally {
      await app.close();
    }
  });

  it('production sans surcharge : la fabrique du service de clés refuse déjà de construire le faux', async () => {
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        Test.createTestingModule({ imports: [SnapshotSignerProcessModule] }).compile(),
      ).rejects.toThrow();
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('hors production : démarrage accepté, deux travailleurs enregistrés', async () => {
    const app = await compile(false);
    try {
      expect(() => assertProcessIsSafe(app)).not.toThrow();
      expect(app.get(WorkerRegistry, { strict: false }).names().sort()).toEqual([
        'seq-gap-age',
        'snapshot-signer',
      ]);
    } finally {
      await app.close();
    }
  });

  it('SignPort seul : DECRYPT_PORT, DATA_KEY_PORT, MAC_PORT et KEY_ADMIN_PORT sont introuvables', async () => {
    const app = await compile(false);
    try {
      expect(app.get(SIGN_PORT, { strict: false })).toBeDefined();
      for (const token of [DECRYPT_PORT, DATA_KEY_PORT, MAC_PORT, KEY_ADMIN_PORT])
        expect(() => app.get(token, { strict: false })).toThrow();
    } finally {
      await app.close();
    }
  });
});

describe('snapshot-signer : bornes du code', () => {
  const files = readdirSync(SIGNER_DIR).map((name) => ({
    name,
    text: readFileSync(join(SIGNER_DIR, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));
  const all = [
    ...files,
    ...[
      'main.snapshot-signer.ts',
      'processes/snapshot-signer.module.ts',
      'db/snapshot-signer-db.module.ts',
    ].map((name) => ({
      name,
      text: readFileSync(join(SRC, name), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
    })),
  ];

  it('aucun fichier du processus ne touche aux mots de passe, à la clé de contenu, aux ports de clés autres que sign', () => {
    for (const { name, text } of all)
      expect({
        name,
        hit: /pwd_pack_enc|content_key_wrapped|DECRYPT_PORT|DATA_KEY_PORT|MAC_PORT|KEY_ADMIN_PORT|tag_data_key/.test(
          text,
        ),
      }).toEqual({ name, hit: false });
  });

  it('ni audit ni plateforme : AuditService, AuditModule, PlatformTx et DB_PLATFORM absents', () => {
    for (const { name, text } of all)
      expect({
        name,
        hit: /AuditService|AuditModule|PlatformTx|platformDatabaseUrl|databaseUrl\b/.test(text),
      }).toEqual({ name, hit: false });
  });

  it('seul le repository écrit du SQL, et seulement les neuf fonctions accordées au rôle', () => {
    const sql = [
      ...files
        .find((f) => f.name === 'snapshot-signer.repository.ts')!
        .text.matchAll(/\b([a-z_]+)\(\s*(?:\$|\))/g),
    ]
      .map((m) => m[1]!)
      .filter((name) => /offline|snapshot|seq_gap|mark_|discard|publish/.test(name));
    expect(new Set(sql)).toEqual(
      new Set([
        'offline_snapshot_drafts_ready',
        'offline_snapshot_draft_content',
        'publish_offline_snapshot',
        'discard_offline_snapshot_draft',
        'offline_seq_gaps_to_alert',
        'mark_seq_gap_alerted',
        'offline_retries_to_alert',
        'mark_offline_retry_alerted',
        'snapshot_public_keys',
      ]),
    );
    for (const { name, text } of files)
      if (name !== 'snapshot-signer.repository.ts') expect(text).not.toMatch(/\bquery\(/);
  });

  it('header-signer n’accepte qu’un VerifiedDraft, produit seulement par verifyDraft', () => {
    const signer = files.find((f) => f.name === 'header-signer.ts')!.text;
    expect(signer).toMatch(/verified: VerifiedDraft/);
    expect(signer).not.toMatch(/header: |SnapshotHeader/);
    const producers = all.filter((f) =>
      /as unknown as VerifiedDraft|\[VERIFIED\]\s*:/.test(f.text),
    );
    expect(producers.map((f) => f.name)).toEqual(['draft-verifier.ts']);
  });
});
