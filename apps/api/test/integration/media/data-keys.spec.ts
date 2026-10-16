// Intégration : clés de données des bracelets (FR-008, FR-009, NFR-003, NFR-008 ; décisions du porteur n° 5 et 7).
// Deux processus réels, chacun sous son rôle de base et avec ses seuls droits sur le service de clés :
//   - personnalisation : clé de données de session, rotation, retrait d'une clé dédiée ; ne déchiffre jamais ;
//   - clés de bracelet : rechiffrement par tranches après une rotation, reprise après un échec.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { openPwdPack, pwdPackAad, sealPwdPack } from '@cashless/tag-format';
import { APP_CONFIG, type AppConfig } from '../../../src/config/config';
import { TenantTx } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { DataKeyRepository } from '../../../src/media/keys/data-key.repository';
import { DekWorker } from '../../../src/media/keys/dek.worker';
import { REENCRYPT_BATCH, ReencryptWorker } from '../../../src/media/keys/reencrypt.worker';
import { SessionDataKeyProvider } from '../../../src/media/keys/session-data-key';
import { createKeyProcess, type KeyProcessApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

const ZERO = Buffer.alloc(32);

interface Seeded {
  id: string;
  uid: Buffer;
  pwdPack: Buffer;
}

describe('clés de données des bracelets', () => {
  let perso: KeyProcessApp;
  let tagKeys: KeyProcessApp;
  let ops: Operators;
  let requester: TestPerson;
  let approver: TestPerson;
  let config: AppConfig;
  let sessions: SessionDataKeyProvider;
  const ids = { organizer: randomUUID(), organizerB: randomUUID(), profile: randomUUID(), event: randomUUID() };
  let nextIndex = 100;

  const rows = <T>(sql: string, params: unknown[] = []) => withOwner(async (db) => (await db.query(sql, params)).rows as T[]);

  // La file des travaux est commune à tous les prestataires, donc à toutes les suites qui tournent sur la même base :
  // chaque passage est limité aux prestataires de cette suite.
  const runPerso = () => perso.app.get(DekWorker, { strict: false }).runOnce([ops.a, ops.b]);
  const runTagKeys = () => tagKeys.app.get(ReencryptWorker, { strict: false }).runOnce([ops.a, ops.b]);

  /** Clé de dérivation active (partagée, ou dédiée à l'événement) ; rend son index. */
  const createKey = async (operatorId: string = ops.a, dedicated = false): Promise<number> => {
    const index = (nextIndex += 1);
    await rows(`INSERT INTO tag_key (operator_id, key_index, kms_key_ref, scope, dedicated_event_id) VALUES ($1, $2, $3, $4, $5)`, [
      operatorId, index, `fake-kms:hmac:${randomUUID()}`, dedicated ? 'DEDICATED' : 'SHARED', dedicated ? ids.event : null,
    ]);
    return index;
  };

  /** Version de clé de données posée directement : rend son identifiant et son clair (pour sceller les jeux d'essai). */
  const createVersion = async (operatorId: string, index: number, version: number, status: string) => {
    const { plaintext, encrypted } = await perso.kms.generateDataKey(config.tagWrappingKeyRef);
    const [row] = await rows<{ id: string }>(
      `INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [operatorId, index, version, config.tagWrappingKeyRef, encrypted, status],
    );
    return { id: row!.id, dek: plaintext };
  };

  const createBatch = async (operatorId: string, organizerId: string, index: number, quantity: number, options: { dedicated?: boolean; status?: string } = {}) => {
    const [row] = await rows<{ id: string }>(
      `INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index, key_mode, status) VALUES ($1, $2, $3, 'PUBLIC', $4, $5, $6, $7) RETURNING id`,
      [operatorId, organizerId, options.dedicated ? ids.event : null, quantity, index, options.dedicated ? 'DEDICATED' : 'SHARED', options.status ?? 'PERSONALIZED'],
    );
    return row!.id;
  };

  /** Bracelets personnalisés, scellés tour à tour sous chacune des clés données. */
  const seedMedia = async (operatorId: string, batchId: string, index: number, count: number, keys: { id: string; dek: Buffer }[]): Promise<Seeded[]> => {
    const seeded: Seeded[] = [];
    const blobs: Buffer[] = [];
    const deks: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const media = { id: randomUUID(), uid: Buffer.concat([Buffer.from([0x04]), randomBytes(6)]), pwdPack: randomBytes(6) };
      const key = keys[i % keys.length]!;
      blobs.push(sealPwdPack({ dek: key.dek, nonce: randomBytes(12), pwdPack: media.pwdPack, aad: pwdPackAad({ mediaId: media.id, operatorId, keyIndex: index, uid: media.uid }) }));
      deks.push(key.id);
      seeded.push(media);
    }
    await rows(
      `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, batch_id, status, personalized_at, signature_ok, pwd_pack_enc, pwd_pack_dek_id)
       SELECT m.id, $1, 'NFC_TAG', m.token_hash, m.uid, $2, $3, 'PERSONALIZED', clock_timestamp(), true, m.blob, m.dek
         FROM unnest($4::uuid[], $5::bytea[], $6::bytea[], $7::bytea[], $8::uuid[]) AS m(id, token_hash, uid, blob, dek)`,
      [operatorId, index, batchId, seeded.map((m) => m.id), seeded.map((m) => createHash('sha256').update(m.id).digest()), seeded.map((m) => m.uid), blobs, deks],
    );
    return seeded;
  };

  const job = (index: number, kind: string, operatorId: string = ops.a) =>
    rows<{ id: string }>(`INSERT INTO tag_key_job (operator_id, key_index, kind, payload) VALUES ($1, $2, $3, $4) RETURNING id`, [
      operatorId, index, kind, JSON.stringify({ requested_by: requester.userId, approved_by: approver.userId }),
    ]).then((r) => r[0]!.id);

  const jobRow = (id: string) =>
    rows<{ status: string; progress: Record<string, unknown>; last_error: string | null; attempts: number }>('SELECT status, progress, last_error, attempts FROM tag_key_job WHERE id = $1', [id]).then((r) => r[0]!);

  const versions = (index: number, operatorId: string = ops.a) =>
    rows<{ id: string; version: number; status: string }>('SELECT id, version, status FROM tag_data_key WHERE operator_id = $1 AND key_index = $2 ORDER BY version', [operatorId, index]);

  /** Vérifie que chaque bracelet se rouvre, sous la clé `dekId`, en son mot de passe d'origine. */
  const expectAllUnder = async (operatorId: string, index: number, seeded: Seeded[], dekId: string) => {
    const [stored] = await rows<{ encrypted_dek: Buffer }>('SELECT encrypted_dek FROM tag_data_key WHERE id = $1', [dekId]);
    const dek = await tagKeys.kms.decrypt(config.tagWrappingKeyRef, stored!.encrypted_dek);
    const media = await rows<{ id: string; pwd_pack_enc: Buffer; pwd_pack_dek_id: string }>('SELECT id, pwd_pack_enc, pwd_pack_dek_id FROM media WHERE operator_id = $1 AND key_index = $2', [operatorId, index]);
    const byId = new Map(media.map((m) => [m.id, m]));
    expect(media).toHaveLength(seeded.length);
    for (const expected of seeded) {
      const row = byId.get(expected.id)!;
      expect(row.pwd_pack_dek_id).toBe(dekId);
      const opened = openPwdPack({ dek, blob: row.pwd_pack_enc, aad: pwdPackAad({ mediaId: expected.id, operatorId, keyIndex: index, uid: expected.uid }) });
      expect(opened.equals(expected.pwdPack)).toBe(true);
    }
  };

  beforeAll(async () => {
    const idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(`INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Organisateur A'), ($3, 'ORGANIZER', $4, 'Organisateur B')`, [
        ids.organizer, ops.a, ids.organizerB, ops.b,
      ]);
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [ids.profile],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES ($1, $2, $3, 'Événement A', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [ids.event, ops.a, ids.organizer, ids.profile],
      );
      requester = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }] });
      approver = await idp.createPerson(db, { operatorId: ops.a, roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }] });
    });
    perso = await createKeyProcess('personalization', { identity: idp });
    tagKeys = await createKeyProcess('tag-keys');
    config = perso.app.get<AppConfig>(APP_CONFIG, { strict: false });
    sessions = perso.app.get(SessionDataKeyProvider, { strict: false });
  });

  afterAll(async () => {
    await tagKeys.app.close();
    await perso.app.close();
  });

  /** Un second fournisseur de session, comme une autre instance du processus de personnalisation. */
  const otherProvider = (seconds: number) =>
    new SessionDataKeyProvider(
      { tagDekCacheSeconds: seconds, tagWrappingKeyRef: config.tagWrappingKeyRef },
      perso.app.get(TenantTx, { strict: false }),
      perso.app.get(DataKeyRepository, { strict: false }),
      perso.kms,
    );

  describe('clé de données de session (personnalisation)', () => {
    it('une série de bracelets partage une seule clé : un appel au service de clés, une version active', async () => {
      const index = await createKey();
      perso.kms.resetCalls();
      const first = await sessions.withKey(ops.a, index, async (key) => ({ dekId: key.dekId, version: key.version, length: key.dek.length }));
      const others = await Promise.all(Array.from({ length: 10 }, () => sessions.withKey(ops.a, index, async (key) => key.dekId)));
      expect(first).toMatchObject({ version: 1, length: 32 });
      expect(new Set(others)).toEqual(new Set([first.dekId]));
      expect(perso.kms.calls).toMatchObject({ generateDataKey: 1, decrypt: 0 });
      expect(await versions(index)).toEqual([{ id: first.dekId, version: 1, status: 'ACTIVE' }]);
    });

    it('des premières demandes simultanées n’ouvrent qu’une clé', async () => {
      const index = await createKey();
      perso.kms.resetCalls();
      const seen = await Promise.all(Array.from({ length: 12 }, () => sessions.withKey(ops.a, index, async (key) => key.dekId)));
      expect(new Set(seen).size).toBe(1);
      expect(perso.kms.calls.generateDataKey).toBe(1);
      expect(await versions(index)).toHaveLength(1);
    });

    it('le clair scelle un mot de passe que le processus des clés de bracelet sait rouvrir', async () => {
      const index = await createKey();
      const mediaId = randomUUID();
      const uid = Buffer.concat([Buffer.from([0x04]), randomBytes(6)]);
      const pwdPack = randomBytes(6);
      const aad = pwdPackAad({ mediaId, operatorId: ops.a, keyIndex: index, uid });
      const sealed = await sessions.withKey(ops.a, index, async (key) => ({ dekId: key.dekId, blob: sealPwdPack({ dek: key.dek, nonce: randomBytes(12), pwdPack, aad }) }));
      const [stored] = await rows<{ encrypted_dek: Buffer }>('SELECT encrypted_dek FROM tag_data_key WHERE id = $1', [sealed.dekId]);
      const dek = await tagKeys.kms.decrypt(config.tagWrappingKeyRef, stored!.encrypted_dek);
      expect(openPwdPack({ dek, blob: sealed.blob, aad }).equals(pwdPack)).toBe(true);
    });

    it('une version qui n’est plus active en base est abandonnée : tampon à zéro, nouvelle version', async () => {
      const index = await createKey();
      let buffer!: Buffer;
      const first = await sessions.withKey(ops.a, index, async (key) => {
        buffer = key.dek;
        return key.dekId;
      });
      expect(buffer.equals(ZERO)).toBe(false);
      await rows(`UPDATE tag_data_key SET status = 'DECRYPT_ONLY' WHERE id = $1`, [first]);
      const second = await sessions.withKey(ops.a, index, async (key) => key);
      expect(second.dekId).not.toBe(first);
      expect(second.version).toBe(2);
      expect(buffer.equals(ZERO)).toBe(true);
      expect((await versions(index)).map((v) => v.status)).toEqual(['DECRYPT_ONLY', 'ACTIVE']);
    });

    it('deux instances sur le même index : la dernière ouverture l’emporte, l’autre s’en aperçoit et rouvre', async () => {
      const index = await createKey();
      const other = otherProvider(300);
      const mine = await sessions.withKey(ops.a, index, async (key) => key.dekId);
      const theirs = await other.withKey(ops.a, index, async (key) => key.dekId);
      const mineAgain = await sessions.withKey(ops.a, index, async (key) => key.dekId);
      expect(new Set([mine, theirs, mineAgain]).size).toBe(3);
      // Jamais deux versions actives à la fois ; tout ce qui a été scellé reste déchiffrable (DECRYPT_ONLY).
      expect((await versions(index)).map((v) => v.status)).toEqual(['DECRYPT_ONLY', 'DECRYPT_ONLY', 'ACTIVE']);
      other.onModuleDestroy();
    });

    it('durée nulle : une clé par demande, rien en mémoire après', async () => {
      const index = await createKey();
      const provider = otherProvider(0);
      const buffers: Buffer[] = [];
      for (let i = 0; i < 2; i += 1) await provider.withKey(ops.a, index, async (key) => void buffers.push(key.dek));
      expect(provider.size()).toBe(0);
      expect(buffers.every((b) => b.equals(ZERO))).toBe(true);
      expect(await versions(index)).toHaveLength(2);
    });

    it('après la durée sans utilisation, la clé est effacée', async () => {
      const index = await createKey();
      const provider = otherProvider(1);
      let buffer!: Buffer;
      await provider.withKey(ops.a, index, async (key) => void (buffer = key.dek));
      expect(provider.size()).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(provider.size()).toBe(0);
      expect(buffer.equals(ZERO)).toBe(true);
    });

    it('l’arrêt du processus efface les clés en mémoire', async () => {
      const index = await createKey();
      const provider = otherProvider(300);
      let buffer!: Buffer;
      await provider.withKey(ops.a, index, async (key) => void (buffer = key.dek));
      provider.onModuleDestroy();
      expect(buffer.equals(ZERO)).toBe(true);
      expect(provider.size()).toBe(0);
    });

    it('index inconnu, clé d’un autre prestataire ou clé non active : aucune clé de données ouverte', async () => {
      const index = await createKey();
      const foreign = await createKey(ops.b);
      const retired = await createKey();
      await rows(`UPDATE tag_key SET status = 'DECRYPT_ONLY' WHERE operator_id = $1 AND key_index = $2`, [ops.a, retired]);
      perso.kms.resetCalls();
      const attempt = (i: number) => sessions.withKey(ops.a, i, async () => undefined).then(() => null, (e: unknown) => (e instanceof ProblemException ? e.status : e));
      expect(await attempt(index + 5000)).toBe(404);
      expect(await attempt(foreign)).toBe(404);
      expect(await attempt(retired)).toBe(409);
      expect(perso.kms.calls.generateDataKey).toBe(0);
      expect(await versions(index)).toEqual([]);
    });

    it('la personnalisation ne peut pas relire une clé de données chiffrée, ni un mot de passe chiffré', async () => {
      const tx = perso.app.get(TenantTx, { strict: false });
      await expect(tx.run(ops.a, (client) => client.query('SELECT encrypted_dek FROM tag_data_key LIMIT 1'))).rejects.toMatchObject({ code: '42501' });
      await expect(tx.run(ops.a, (client) => client.query('SELECT pwd_pack_enc FROM media LIMIT 1'))).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('rotation et rechiffrement', () => {
    it('1 200 bracelets sous deux versions de session : tous ramenés sous la nouvelle, en trois tranches', async () => {
      const index = await createKey();
      const v1 = await createVersion(ops.a, index, 1, 'DECRYPT_ONLY');
      const v2 = await createVersion(ops.a, index, 2, 'ACTIVE');
      const batch = await createBatch(ops.a, ids.organizer, index, 1200);
      const seeded = await seedMedia(ops.a, batch, index, 1200, [v1, v2]);
      // Même index chez un autre prestataire : il ne doit pas bouger.
      const indexB = index;
      await rows(`INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, $2, 'fake-kms:hmac:b')`, [ops.b, indexB]);
      const b1 = await createVersion(ops.b, indexB, 1, 'ACTIVE');
      const seededB = await seedMedia(ops.b, await createBatch(ops.b, ids.organizerB, indexB, 3), indexB, 3, [b1]);

      const rotation = await job(index, 'ROTATE_DEK');
      perso.kms.resetCalls();
      expect(await runPerso()).toBe(1);
      expect(perso.kms.calls).toMatchObject({ generateDataKey: 1, decrypt: 0 });
      expect(await jobRow(rotation)).toMatchObject({ status: 'DONE', progress: { version: 3 } });
      const afterRotation = await versions(index);
      expect(afterRotation.map((v) => v.status)).toEqual(['DECRYPT_ONLY', 'DECRYPT_ONLY', 'ACTIVE']);
      const target = afterRotation[2]!.id;
      const [child] = await rows<{ id: string; status: string; payload: Record<string, unknown>; parent_job_id: string }>(
        `SELECT id, status, payload, parent_job_id FROM tag_key_job WHERE operator_id = $1 AND key_index = $2 AND kind = 'REENCRYPT'`,
        [ops.a, index],
      );
      expect(child).toMatchObject({ status: 'PENDING', parent_job_id: rotation, payload: { target_dek_id: target, target_version: 3, requested_by: requester.userId, approved_by: approver.userId } });
      // La personnalisation ne prend pas le rechiffrement : elle ne peut pas déchiffrer.
      expect(await runPerso()).toBe(0);

      tagKeys.kms.resetCalls();
      expect(await runTagKeys()).toBe(1);
      expect(await jobRow(child!.id)).toMatchObject({ status: 'DONE', progress: { reencrypted: 1200, retired_versions: 2 } });
      // Trois tranches de 500 au plus, et par tranche un déchiffrement par clé rencontrée (deux anciennes, la cible).
      expect(Math.ceil(1200 / REENCRYPT_BATCH)).toBe(3);
      expect(tagKeys.kms.calls.decrypt).toBe(9);
      expect(tagKeys.kms.calls).toMatchObject({ generateMac: 0, generateDataKey: 0 });
      expect((await versions(index)).map((v) => v.status)).toEqual(['RETIRED', 'RETIRED', 'ACTIVE']);
      await expectAllUnder(ops.a, index, seeded, target);
      await expectAllUnder(ops.b, indexB, seededB, b1.id);
      expect(await versions(indexB, ops.b)).toEqual([{ id: b1.id, version: 1, status: 'ACTIVE' }]);
      expect(
        await rows(`SELECT action, actor_id, approver_id, origin FROM audit_log WHERE operator_id = $1 AND object_id = $2 ORDER BY id`, [ops.a, `${ops.a}:${index}`]),
      ).toEqual([
        { action: 'TAG_DEK_ROTATED', actor_id: requester.userId, approver_id: approver.userId, origin: 'personalization' },
        { action: 'TAG_DEK_REENCRYPTED', actor_id: requester.userId, approver_id: approver.userId, origin: 'tag-keys' },
      ]);
      expect(await runTagKeys()).toBe(0);
    }, 60_000);

    it('la session ouverte avant la rotation n’est plus utilisée après', async () => {
      const index = await createKey();
      const v1 = await createVersion(ops.a, index, 1, 'DECRYPT_ONLY');
      const seeded = await seedMedia(ops.a, await createBatch(ops.a, ids.organizer, index, 3), index, 3, [v1]);
      const before = await sessions.withKey(ops.a, index, async (key) => key.dekId);
      await job(index, 'ROTATE_DEK');
      await runPerso();
      const after = await sessions.withKey(ops.a, index, async (key) => key);
      expect(after.dekId).not.toBe(before);
      // La version de la rotation (3) est ACTIVE ; la personnalisation, qui ne peut pas la déchiffrer, en ouvre une (4).
      expect(after.version).toBe(4);
      while ((await runTagKeys()) > 0);
      // Tout converge sous la version active du moment ; les autres, sans bracelet, sont retirées.
      await expectAllUnder(ops.a, index, seeded, after.dekId);
      expect((await versions(index)).map((v) => v.status)).toEqual(['RETIRED', 'RETIRED', 'RETIRED', 'ACTIVE']);
    });

    it('un mot de passe illisible arrête le travail sans demi-écriture ; il reprend où il s’était arrêté', async () => {
      const index = await createKey();
      const v1 = await createVersion(ops.a, index, 1, 'ACTIVE');
      const batch = await createBatch(ops.a, ids.organizer, index, 1200);
      const seeded = await seedMedia(ops.a, batch, index, 1200, [v1]);
      // Le 700e bracelet dans l'ordre de traitement : il tombe dans la deuxième tranche.
      const ordered = await rows<{ id: string; pwd_pack_enc: Buffer }>('SELECT id, pwd_pack_enc FROM media WHERE operator_id = $1 AND key_index = $2 ORDER BY id', [ops.a, index]);
      const broken = ordered[699]!;
      const damaged = Buffer.from(broken.pwd_pack_enc);
      damaged[20] = damaged[20]! ^ 0xff;
      await rows('UPDATE media SET pwd_pack_enc = $2 WHERE id = $1', [broken.id, damaged]);

      await job(index, 'ROTATE_DEK');
      await runPerso();
      const target = (await versions(index))[1]!.id;
      const [child] = await rows<{ id: string }>(`SELECT id FROM tag_key_job WHERE operator_id = $1 AND key_index = $2 AND kind = 'REENCRYPT'`, [ops.a, index]);
      expect(await runTagKeys()).toBe(1);
      const failed = await jobRow(child!.id);
      expect(failed).toMatchObject({ status: 'FAILED', progress: { reencrypted: 500 }, attempts: 1 });
      expect(failed.last_error).toBeTruthy();
      // La première tranche est acquise, la deuxième n'a rien écrit.
      const count = () => rows<{ dek: string; n: string }>('SELECT pwd_pack_dek_id AS dek, count(*) AS n FROM media WHERE operator_id = $1 AND key_index = $2 GROUP BY 1', [ops.a, index]);
      expect(new Map((await count()).map((r) => [r.dek, Number(r.n)]))).toEqual(new Map([[target, 500], [v1.id, 700]]));
      expect((await versions(index)).map((v) => v.status)).toEqual(['DECRYPT_ONLY', 'ACTIVE']);
      // Un travail en échec n'est pas repris tout seul.
      expect(await runTagKeys()).toBe(0);

      await rows('UPDATE media SET pwd_pack_enc = $2 WHERE id = $1', [broken.id, broken.pwd_pack_enc]);
      await rows('SELECT retry_tag_key_job($1)', [child!.id]);
      expect(await runTagKeys()).toBe(1);
      expect(await jobRow(child!.id)).toMatchObject({ status: 'DONE', progress: { reencrypted: 1200, retired_versions: 1 }, attempts: 2 });
      await expectAllUnder(ops.a, index, seeded, target);
      expect((await versions(index)).map((v) => v.status)).toEqual(['RETIRED', 'ACTIVE']);
    }, 60_000);

    it('un travail abandonné en cours (processus tué) est repris après son verrou, sans double effet', async () => {
      const index = await createKey();
      const v1 = await createVersion(ops.a, index, 1, 'ACTIVE');
      const seeded = await seedMedia(ops.a, await createBatch(ops.a, ids.organizer, index, 40), index, 40, [v1]);
      await job(index, 'ROTATE_DEK');
      await runPerso();
      const target = (await versions(index))[1]!.id;
      const [child] = await rows<{ id: string }>(`SELECT id FROM tag_key_job WHERE operator_id = $1 AND key_index = $2 AND kind = 'REENCRYPT'`, [ops.a, index]);
      await rows(
        `UPDATE tag_key_job SET status = 'RUNNING', attempts = 1, started_at = clock_timestamp(), locked_until = clock_timestamp() - interval '1 second' WHERE id = $1`,
        [child!.id],
      );
      expect(await runTagKeys()).toBe(1);
      expect(await jobRow(child!.id)).toMatchObject({ status: 'DONE', progress: { reencrypted: 40 }, attempts: 2 });
      await expectAllUnder(ops.a, index, seeded, target);
    });

    it('service de clés en panne : la rotation échoue sans ouvrir de version ; le rechiffrement échoue sans rien écrire', async () => {
      const index = await createKey();
      const v1 = await createVersion(ops.a, index, 1, 'ACTIVE');
      const seeded = await seedMedia(ops.a, await createBatch(ops.a, ids.organizer, index, 5), index, 5, [v1]);
      const rotation = await job(index, 'ROTATE_DEK');
      perso.kms.failNext('generateDataKey');
      await runPerso();
      expect(await jobRow(rotation)).toMatchObject({ status: 'FAILED' });
      expect(await versions(index)).toHaveLength(1);
      await rows('SELECT retry_tag_key_job($1)', [rotation]);
      await runPerso();
      expect(await jobRow(rotation)).toMatchObject({ status: 'DONE' });

      const [child] = await rows<{ id: string }>(`SELECT id FROM tag_key_job WHERE operator_id = $1 AND key_index = $2 AND kind = 'REENCRYPT'`, [ops.a, index]);
      tagKeys.kms.failNext('decrypt');
      await runTagKeys();
      expect(await jobRow(child!.id)).toMatchObject({ status: 'FAILED', progress: { reencrypted: 0 } });
      await expectAllUnder(ops.a, index, seeded, v1.id);
      await rows('SELECT retry_tag_key_job($1)', [child!.id]);
      await runTagKeys();
      await expectAllUnder(ops.a, index, seeded, (await versions(index))[1]!.id);
    });

    it('rotation d’une clé qui n’est plus active : refusée, aucune version ouverte', async () => {
      const index = await createKey();
      await rows(`UPDATE tag_key SET status = 'DECRYPT_ONLY' WHERE operator_id = $1 AND key_index = $2`, [ops.a, index]);
      const rotation = await job(index, 'ROTATE_DEK');
      await runPerso();
      expect(await jobRow(rotation)).toMatchObject({ status: 'FAILED' });
      expect(await versions(index)).toEqual([]);
      expect(await rows(`SELECT 1 FROM tag_key_job WHERE operator_id = $1 AND key_index = $2 AND kind = 'REENCRYPT'`, [ops.a, index])).toEqual([]);
    });
  });

  describe('retrait d’une clé dédiée', () => {
    it('clé et clés de données retirées, mots de passe effacés, bracelets en fin de vie, désactivation inscrite', async () => {
      const index = await createKey(ops.a, true);
      const v1 = await createVersion(ops.a, index, 1, 'ACTIVE');
      const batch = await createBatch(ops.a, ids.organizer, index, 4, { dedicated: true });
      await seedMedia(ops.a, batch, index, 4, [v1]);
      await rows(`UPDATE media_batch SET status = 'CLOSED' WHERE id = $1`, [batch]);
      await sessions.withKey(ops.a, index, async () => undefined);
      const before = sessions.size();

      const retirement = await job(index, 'RETIRE_KEY');
      perso.kms.resetCalls();
      expect(await runPerso()).toBe(1);
      expect(await jobRow(retirement)).toMatchObject({ status: 'DONE', progress: { retired_media: 4 } });
      expect(perso.kms.calls).toMatchObject({ generateDataKey: 0, decrypt: 0, generateMac: 0 });
      expect(sessions.size()).toBe(before - 1);
      expect(await rows('SELECT status, kms_disabled_at FROM tag_key WHERE operator_id = $1 AND key_index = $2', [ops.a, index])).toEqual([{ status: 'RETIRED', kms_disabled_at: null }]);
      expect(new Set((await versions(index)).map((v) => v.status))).toEqual(new Set(['RETIRED']));
      expect(await rows('SELECT DISTINCT status, pwd_pack_enc, pwd_pack_dek_id FROM media WHERE operator_id = $1 AND key_index = $2', [ops.a, index])).toEqual([
        { status: 'RETIRED', pwd_pack_enc: null, pwd_pack_dek_id: null },
      ]);
      expect(await rows(`SELECT kind, status, parent_job_id, payload FROM tag_key_job WHERE operator_id = $1 AND key_index = $2 AND kind = 'DISABLE_KMS_KEY'`, [ops.a, index])).toEqual([
        { kind: 'DISABLE_KMS_KEY', status: 'PENDING', parent_job_id: retirement, payload: { requested_by: requester.userId, approved_by: approver.userId } },
      ]);
      expect(await rows(`SELECT action, actor_id, approver_id FROM audit_log WHERE operator_id = $1 AND object_id = $2`, [ops.a, `${ops.a}:${index}`])).toEqual([
        { action: 'TAG_KEY_RETIRED', actor_id: requester.userId, approver_id: approver.userId },
      ]);
      // La désactivation dans le service de clés n'est pas à la portée de ce processus.
      expect(await runPerso()).toBe(0);
      await expect(sessions.withKey(ops.a, index, async () => undefined)).rejects.toMatchObject({ status: 409 });
    });

    it('un lot encore ouvert, ou une clé partagée : rien n’est retiré', async () => {
      const dedicated = await createKey(ops.a, true);
      const v1 = await createVersion(ops.a, dedicated, 1, 'ACTIVE');
      const seeded = await seedMedia(ops.a, await createBatch(ops.a, ids.organizer, dedicated, 2, { dedicated: true }), dedicated, 2, [v1]);
      const shared = await createKey();
      const open = await job(dedicated, 'RETIRE_KEY');
      await runPerso();
      const wrong = await job(shared, 'RETIRE_KEY');
      await runPerso();
      expect(await jobRow(open)).toMatchObject({ status: 'FAILED' });
      expect(await jobRow(wrong)).toMatchObject({ status: 'FAILED' });
      expect(await rows('SELECT status FROM tag_key WHERE operator_id = $1 AND key_index = ANY($2::int[])', [ops.a, [dedicated, shared]])).toEqual([{ status: 'ACTIVE' }, { status: 'ACTIVE' }]);
      await expectAllUnder(ops.a, dedicated, seeded, v1.id);
      expect(await rows(`SELECT 1 FROM tag_key_job WHERE operator_id = $1 AND kind = 'DISABLE_KMS_KEY' AND key_index = ANY($2::int[])`, [ops.a, [dedicated, shared]])).toEqual([]);
    });
  });
});
