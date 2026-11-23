// Intégration : codes de rattachement versionnés côté API (mission serveur-app-festivalier, WP07 ; FR-007,
// NFR-002, SC-003). Après une rotation, une empreinte d'une autre version du secret compte comme absente : même
// réponse qu'un code inconnu pour le rattachement, la confirmation au guichet et la consultation anonyme. Deux
// rotations sont simulées : un autre secret avec la version 2, et la version relevée sans changer de secret (seul le
// filtre de version protège alors). Les lignes de version 2 sont reposées à 1 après chaque essai : la base de test
// est partagée entre suites et l'API refuse de démarrer sous la version la plus haute qu'elle connaît.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { generateClaimCode } from '@cashless/tag-format';
import request from 'supertest';
import { loadConfig } from '../../../src/config/config';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  creditWallet,
  goLive,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

const SECRET_1 = loadConfig({ NODE_ENV: 'test' }).claimCodeHmacKey;
const SECRET_2_HEX = 'cd'.repeat(32);

/** Crée une application avec ces variables d'environnement, puis rétablit l'environnement. */
async function appWith(
  world: MediaWorld,
  env: { key?: string; version: string },
): Promise<INestApplication> {
  const saved = {
    key: process.env.CLAIM_CODE_HMAC_KEY,
    version: process.env.CLAIM_CODE_HMAC_KEY_VERSION,
  };
  try {
    if (env.key === undefined) delete process.env.CLAIM_CODE_HMAC_KEY;
    else process.env.CLAIM_CODE_HMAC_KEY = env.key;
    process.env.CLAIM_CODE_HMAC_KEY_VERSION = env.version;
    return await createTestApp({ identity: world.idp, trustProxyHops: 1 });
  } finally {
    if (saved.key === undefined) delete process.env.CLAIM_CODE_HMAC_KEY;
    else process.env.CLAIM_CODE_HMAC_KEY = saved.key;
    if (saved.version === undefined) delete process.env.CLAIM_CODE_HMAC_KEY_VERSION;
    else process.env.CLAIM_CODE_HMAC_KEY_VERSION = saved.version;
  }
}

describe('codes de rattachement : rotation du secret', () => {
  let w: MediaWorld;
  let apps: { v1: INestApplication; rotated: INestApplication; bumped: INestApplication };
  let hashers: { v1: ClaimHasher; v2: ClaimHasher; bumped: ClaimHasher };
  let device: TestDevice;
  let batch: string;
  let counter = 0;
  const next = () => (counter += 1);
  /** Tous les codes en clair manipulés : cherchés à la fin dans la base (NFR-002). */
  const plain: string[] = [];

  const customer = () => withOwner((db) => createTestCustomer(db, w.ops.a));
  const claim = (app: INestApplication, who: TestCustomer, code: string) =>
    request(app.getHttpServer())
      .post('/v1/me/media')
      .set(who.headers)
      .set('Idempotency-Key', randomUUID())
      .send({ claim_code: code });
  const confirm = (app: INestApplication, body: object) =>
    request(app.getHttpServer())
      .post('/v1/media/claims/confirmations')
      .set(device.headers)
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const lookup = (app: INestApplication, code: string, ip: string) =>
    request(app.getHttpServer())
      .post('/v1/public/balance-lookups')
      .set('X-Forwarded-For', ip)
      .send({ claim_code: code });
  const tap = async (m: SeededMedia) =>
    (
      await request(apps.v1.getHttpServer())
        .post('/v1/taps')
        .set(device.headers)
        .send(tapBody(m, next()))
    ).body.tap_id as number;
  const refusal = (res: request.Response) => {
    const { instance: _instance, ...body } = res.body as Record<string, unknown>;
    return { status: res.status, body };
  };
  const unknownCode = () => {
    const code = generateClaimCode(randomBytes);
    plain.push(code);
    return code;
  };
  const attempts = (who: TestCustomer) =>
    rows<{ outcome: string }>(
      'SELECT outcome FROM claim_attempt WHERE customer_id = $1 ORDER BY attempted_at',
      [who.customerId],
    );

  /** Bracelet du lot avec son code associé, au secret et à la version donnés ; actif et crédité si `balance`. */
  const bracelet = async (
    options: { hasher?: ClaimHasher; version?: number; balance?: number; batchId?: string } = {},
  ) =>
    withOwner(async (db) => {
      const hasher = options.hasher ?? hashers.v1;
      const version = options.version ?? 1;
      const batchId = options.batchId ?? batch;
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      });
      const code = unknownCode();
      const hash = hasher.claimCodeHash(code);
      await db.query(
        `INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version, media_id, associated_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [w.ops.a, batchId, hash, version, m!.id],
      );
      await db.query(
        'UPDATE media SET claim_code_hash = $2, claim_key_version = $3 WHERE id = $1',
        [m!.id, hash, version],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      const walletId = (
        await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [w.ids.eventA])
      ).rows[0]!.id;
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId,
        mediaIds: [m!.id],
      });
      if (options.balance)
        await creditWallet(db, {
          operatorId: w.ops.a,
          ledgerId: w.ids.ledgerA,
          walletId,
          amount: options.balance,
        });
      return { media: m!, code, walletId };
    });

  /** Remet à 1 les lignes de version 2 de ces essais (les autres suites partagent la base). */
  const restoreVersions = () =>
    withOwner(async (db) => {
      const ops = [w.ops.a, w.ops.b];
      for (const sql of [
        'UPDATE media SET claim_key_version = 1 WHERE operator_id = ANY($1) AND claim_key_version = 2',
        'UPDATE claim_code SET key_version = 1 WHERE operator_id = ANY($1) AND key_version = 2',
        'UPDATE media_claim SET key_version = 1 WHERE operator_id = ANY($1) AND key_version = 2',
      ])
        await db.query(sql, [ops]);
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
    });
    apps = {
      v1: await appWith(w, { version: '1' }),
      // Rotation complète : autre secret, version 2.
      rotated: await appWith(w, { key: SECRET_2_HEX, version: '2' }),
      // Version relevée, même secret : les empreintes de version 1 sont valides, seul le filtre les écarte.
      bumped: await appWith(w, { version: '2' }),
    };
    hashers = {
      v1: new ClaimHasher({ claimCodeHmacKey: SECRET_1, claimCodeKeyVersion: 1 }),
      bumped: new ClaimHasher({ claimCodeHmacKey: SECRET_1, claimCodeKeyVersion: 2 }),
      v2: new ClaimHasher({
        claimCodeHmacKey: Buffer.from(SECRET_2_HEX, 'hex'),
        claimCodeKeyVersion: 2,
      }),
    };
  });

  afterEach(restoreVersions);

  afterAll(async () => {
    await restoreVersions();
    await Promise.all(Object.values(apps).map((app) => app.close()));
  });

  describe.each([
    ['autre secret, version 2', 'rotated'],
    ['même secret, version 2', 'bumped'],
  ] as const)('code de la version 1 après rotation (%s)', (_label, which) => {
    it('rattachement : même statut, même corps, mêmes en-têtes et même essai compté qu’un code inconnu', async () => {
      const b = await bracelet(); // solde nul : serait rattaché tout de suite si l'empreinte était admise
      const old = await customer();
      const stranger = await customer();
      const a = await claim(apps[which], old, b.code);
      const u = await claim(apps[which], stranger, unknownCode());
      expect(a.status).toBe(422);
      expect(a.body.code).toBe('MEDIA_CLAIM_INVALID');
      expect(refusal(a)).toEqual(refusal(u));
      expect(Object.keys(a.headers).sort()).toEqual(Object.keys(u.headers).sort());
      expect(await attempts(old)).toEqual(await attempts(stranger));
      expect(await attempts(old)).toHaveLength(1);
      expect(
        await rows(`SELECT claim_code_used_at FROM media WHERE id = $1`, [b.media.id]),
      ).toEqual([{ claim_code_used_at: null }]);
    });

    it('consultation anonyme : 404 comme pour un code inconnu', async () => {
      const b = await bracelet({ balance: 1200 });
      const a = await lookup(apps[which], b.code, '203.0.113.21');
      const u = await lookup(apps[which], unknownCode(), '203.0.113.22');
      expect(a.status).toBe(404);
      expect(refusal(a)).toEqual(refusal(u));
      expect(Object.keys(a.headers).sort()).toEqual(Object.keys(u.headers).sort());
      // Le même code reste lisible par l'API de sa version.
      expect((await lookup(apps.v1, b.code, '203.0.113.23')).status).toBe(200);
    });

    it('confirmation au guichet d’une demande née en version 1 : refus d’un code inconnu, demande intacte', async () => {
      const b = await bracelet({ balance: 3000 });
      const me = await customer();
      const pending = await claim(apps.v1, me, b.code);
      expect(pending.status).toBe(202);
      const digits = pending.body.confirmation_code as string;
      const a = await confirm(apps[which], {
        tap_id: await tap(b.media),
        claim_code: b.code,
        confirmation_code: digits,
      });
      const u = await confirm(apps[which], {
        tap_id: await tap(b.media),
        claim_code: unknownCode(),
        confirmation_code: digits,
      });
      expect(a.status).toBe(422);
      expect(a.body.code).toBe('MEDIA_CLAIM_INVALID');
      expect(refusal(a)).toEqual(refusal(u));
      expect(
        await rows(`SELECT status, attempts FROM media_claim WHERE id = $1`, [
          pending.body.claim_id,
        ]),
      ).toEqual([{ status: 'PENDING', attempts: 0 }]);
    });
  });

  it('confirmation : un bracelet resté en version 1 ne confirme pas une demande de version 2', async () => {
    // Défense en profondeur : la lecture directe du bracelet filtre elle aussi sur la version (même secret).
    const b = await bracelet({ balance: 2000 });
    const me = await customer();
    const claimId = randomUUID();
    const digits = '123456';
    await withOwner((db) =>
      db.query(
        `INSERT INTO media_claim (id, operator_id, media_id, customer_id, confirmation_hash, expires_at, key_version)
         VALUES ($1, $2, $3, $4, $5, now() + interval '1 day', 2)`,
        [
          claimId,
          w.ops.a,
          b.media.id,
          me.customerId,
          hashers.bumped.confirmationHash(claimId, digits),
        ],
      ),
    );
    // Le secret de la version 2 de cette application est celui de la version 1 : même empreinte du code imprimé.
    const res = await confirm(apps.bumped, {
      tap_id: await tap(b.media),
      claim_code: b.code,
      confirmation_code: digits,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MEDIA_CLAIM_INVALID');
    expect(await rows(`SELECT status FROM media_claim WHERE id = $1`, [claimId])).toEqual([
      { status: 'PENDING' },
    ]);
  });

  it('un code posé en version 2 rattache normalement, et son solde se lit', async () => {
    const attach = await bracelet({ hasher: hashers.v2, version: 2 });
    const me = await customer();
    const res = await claim(apps.rotated, me, attach.code);
    expect(res.status).toBe(201);
    expect(res.body.media_id).toBe(attach.media.id);
    const funded = await bracelet({ hasher: hashers.v2, version: 2, balance: 1500 });
    const seen = await lookup(apps.rotated, funded.code, '203.0.113.31');
    expect(seen.status).toBe(200);
    expect(seen.body.spendable).toBe(1500);
    // L'API de la version 1 ne le connaît pas.
    expect((await lookup(apps.v1, funded.code, '203.0.113.32')).status).toBe(404);
  });

  it('numéro imprimé rendu par le rattachement', async () => {
    const b = await bracelet();
    await withOwner((db) =>
      db.query(`UPDATE media SET printed_number = 'FS26-000042' WHERE id = $1`, [b.media.id]),
    );
    const res = await claim(apps.v1, await customer(), b.code);
    expect(res.status).toBe(201);
    expect(res.body.printed_number).toBe('FS26-000042');
  });

  describe('import du fichier de l’imprimeur', () => {
    const importCsv = (app: INestApplication, batchId: string, text: string) =>
      request(app.getHttpServer())
        .post(`/v1/operators/${w.ops.a}/media-batches/${batchId}/claim-code-associations`)
        .set('Authorization', `Bearer ${w.organizerAdminA.token}`)
        .set('Idempotency-Key', randomUUID())
        .set('Content-Type', 'text/csv')
        .send(text);

    it('ancien code remplacé, code courant conservé, numéro imprimé facultatif et unique par prestataire', async () => {
      const importBatch = await withOwner((db) =>
        createBatch(db, {
          operatorId: w.ops.a,
          organizerId: w.ids.organizerA,
          eventId: w.ids.eventA,
          status: 'ACTIVE',
        }),
      );
      const media = await withOwner((db) =>
        seedPersonalizedMedia(db, {
          operatorId: w.ops.a,
          batchId: importBatch,
          kmsKeyRef: w.keyRef.a,
          count: 8,
        }),
      );
      const code = (): string => unknownCode();
      const [oldHeld, current, withNumber, withoutNumber, badNumber, taken, otherOp, four] = media;
      const codes = {
        replacement: code(),
        current: code(),
        withNumber: code(),
        withoutNumber: code(),
        badNumber: code(),
        taken: code(),
        otherOp: code(),
        four: code(),
        heldOld: code(),
        heldCurrent: code(),
      };
      const unassigned = [
        'replacement',
        'current',
        'withNumber',
        'withoutNumber',
        'badNumber',
        'taken',
        'otherOp',
        'four',
      ] as const;
      await withOwner(async (db) => {
        for (const name of unassigned)
          await db.query(
            `INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version) VALUES ($1, $2, $3, 2)`,
            [w.ops.a, importBatch, hashers.v2.claimCodeHash(codes[name])],
          );
        // Un bracelet au code de la version 1 (jamais utilisé), un autre au code de la version courante.
        for (const [m, name, version, hasher] of [
          [oldHeld!, 'heldOld', 1, hashers.v1],
          [current!, 'heldCurrent', 2, hashers.v2],
        ] as const) {
          const hash = hasher.claimCodeHash(codes[name]);
          await db.query(
            `INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version, media_id, associated_at)
             VALUES ($1, $2, $3, $4, $5, now())`,
            [w.ops.a, importBatch, hash, version, m.id],
          );
          await db.query(
            'UPDATE media SET claim_code_hash = $2, claim_key_version = $3 WHERE id = $1',
            [m.id, hash, version],
          );
        }
        // Même numéro chez un autre prestataire : sans effet sur celui-ci.
        await db.query(
          `INSERT INTO media (operator_id, kind, token_hash, nfc_uid, key_index, status, printed_number)
           SELECT $1, 'NFC_TAG', sha256($2::bytea), $2::bytea, 1, 'PERSONALIZED', 'FS26-777'`,
          [w.ops.b, randomBytes(7)],
        );
      });
      const file = [
        'code,uid,printed_number', // 1
        `${codes.replacement},${oldHeld!.uid}`, // 2 : remplace le code de la version 1
        `${codes.current},${current!.uid}`, // 3 : le bracelet porte déjà un code courant
        `${codes.withNumber},${withNumber!.uid},fs26-004812`, // 4 : numéro en minuscules
        `${codes.withoutNumber},${withoutNumber!.uid}`, // 5 : sans numéro
        `${codes.badNumber},${badNumber!.uid},bad number!`, // 6
        `${codes.badNumber},${badNumber!.uid},${'A'.repeat(33)}`, // 7 : trop long
        `${codes.taken},${taken!.uid},FS26-004812`, // 8 : numéro pris par la ligne 4
        `${codes.otherOp},${otherOp!.uid},FS26-777`, // 9 : même numéro chez un autre prestataire
        `${codes.four},${four!.uid},FS26-9,en-trop`, // 10
      ].join('\n');
      const res = await importCsv(apps.rotated, importBatch, file);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        accepted: 4,
        rejected: [
          { line: 3, reason: 'MEDIA_ALREADY_HAS_CODE' },
          { line: 6, reason: 'BAD_PRINTED_NUMBER' },
          { line: 7, reason: 'BAD_PRINTED_NUMBER' },
          { line: 8, reason: 'PRINTED_NUMBER_TAKEN' },
          { line: 10, reason: 'MALFORMED_LINE' },
        ],
      });
      for (const c of Object.values(codes)) expect(JSON.stringify(res.body)).not.toContain(c);
      expect(
        await rows(
          `SELECT id, claim_key_version AS v, printed_number AS n,
                  claim_code_hash = $2 AS replaced
             FROM media WHERE id = ANY($1::uuid[]) ORDER BY array_position($1::uuid[], id)`,
          [
            [oldHeld!.id, withNumber!.id, withoutNumber!.id, taken!.id, otherOp!.id],
            hashers.v2.claimCodeHash(codes.replacement),
          ],
        ),
      ).toEqual([
        { id: oldHeld!.id, v: 2, n: null, replaced: true },
        { id: withNumber!.id, v: 2, n: 'FS26-004812', replaced: false },
        { id: withoutNumber!.id, v: 2, n: null, replaced: false },
        { id: taken!.id, v: 1, n: null, replaced: null },
        { id: otherOp!.id, v: 2, n: 'FS26-777', replaced: false },
      ]);
      // Le bracelet au code courant n'a pas bougé ; le code refusé pour numéro pris reste libre.
      expect(
        await rows(`SELECT claim_key_version AS v FROM media WHERE id = $1`, [current!.id]),
      ).toEqual([{ v: 2 }]);
      expect(
        await rows(`SELECT media_id FROM claim_code WHERE code_hash = $1`, [
          hashers.v2.claimCodeHash(codes.taken),
        ]),
      ).toEqual([{ media_id: null }]);
    });
  });

  describe('démarrage', () => {
    it('version inférieure à celle de la base : démarrage refusé ; égale ou supérieure : démarre', async () => {
      await bracelet({ hasher: hashers.v2, version: 2 });
      await expect(appWith(w, { version: '1' })).rejects.toThrow(/inférieure à la version 2/);
      const same = await appWith(w, { version: '2' });
      await same.close();
      const higher = await appWith(w, { version: '3' });
      await higher.close();
    });
  });

  it('NFR-002 : aucun code en clair dans l’audit, l’idempotence ni les tables du prestataire', async () => {
    // Prépare du trafic : un rattachement, un refus, une consultation.
    const b = await bracelet();
    await claim(apps.v1, await customer(), b.code);
    await lookup(apps.v1, unknownCode(), '203.0.113.41');
    const pattern = plain.map((c) => `${c.slice(0, 4)}-?${c.slice(4)}`).join('|');
    const tables = await rows<{ table_name: string }>(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema = 'public' AND c.column_name = 'operator_id'
          AND t.table_type = 'BASE TABLE'`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(['audit_log', 'api_idempotency', 'media', 'claim_code']),
    );
    const hits: string[] = [];
    for (const { table_name: table } of tables) {
      const found = await rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${table}" t WHERE t.operator_id = $2 AND t::text ~* $1`,
        [pattern, w.ops.a],
      );
      if (found[0]!.n > 0) hits.push(table);
    }
    expect(plain.length).toBeGreaterThan(5);
    expect(hits).toEqual([]);
  });
});
