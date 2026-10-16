// Intégration : poste de personnalisation (FR-016, FR-017, NFR-002, NFR-003, SC-002 ; décisions du porteur n° 4 et 7).
// Le processus de personnalisation réel, sous son rôle de base, avec ses seuls droits sur le service de clés (calcul
// d'un mot de passe, ouverture d'une clé de données — jamais de déchiffrement). Le mot de passe d'un bracelet ne sort
// que sous enveloppe pour la clé du poste, et n'est écrit en clair nulle part.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { derivationMessage, openPwdPack, pwdPackAad, splitPwdPack } from '@cashless/tag-format';
import vectors from '@cashless/tag-format/vectors/vectors.json';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { FakeKms, KIT_VECTOR_HMAC_KEY_REF, TEST_WRAPPING_KEY_REF } from '../../../src/kms/fake-kms';
import { SessionDataKeyProvider } from '../../../src/media/keys/session-data-key';
import { createKeyProcess, type KeyProcessApp } from '../../support/app';
import type { TestPerson } from '../../support/fake-idp';
import { commitWhileWaiting, withOwner } from '../../support/db';
import {
  createBatch, createChip, createMediaWorld, createStation, expectedPwdPack, MEDIA_KEY_INDEX, ownerRows as rows, personalizationBody, type MediaWorld,
} from '../../support/media-fixtures';

/** Clé de test du kit (`vecteurs_test_bracelet.py`) : 00 01 … 1f. */
const KIT_KEY = Buffer.from(vectors.kdf.test_key, 'hex');

interface MediaRow {
  id: string;
  status: string;
  key_index: number;
  token_hash: Buffer;
  signature_ok: boolean;
  originality_sig_sha256: Buffer;
  personalized_at: Date | null;
  pwd_pack_enc: Buffer;
  pwd_pack_dek_id: string;
  claim_code_hash: Buffer | null;
}

/** Cherche une valeur secrète (octets) dans toute la base : colonnes binaires, et texte ou JSON en hexadécimal ou base64. */
async function findSecretAtRest(secret: Buffer): Promise<string[]> {
  const texts = [secret.toString('hex'), secret.toString('base64').replace(/=+$/, ''), secret.toString('base64url')].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const columns = await rows<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
    `SELECT c.table_schema, c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE t.table_type = 'BASE TABLE' AND c.table_schema IN ('public', 'ops')
        AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb', 'bytea', 'ARRAY')`,
  );
  const byTable = new Map<string, string[]>();
  for (const column of columns) {
    const table = `"${column.table_schema}"."${column.table_name}"`;
    const expression = column.data_type === 'bytea' ? `position($2::bytea in "${column.column_name}") > 0` : `"${column.column_name}"::text ~* $1`;
    byTable.set(table, [...(byTable.get(table) ?? []), expression]);
  }
  const hits: string[] = [];
  for (const [table, expressions] of byTable) {
    const found = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ($1::text IS NOT NULL AND $2::bytea IS NOT NULL) AND (${expressions.join(' OR ')})`, [texts, secret]);
    if (found[0]!.n > 0) hits.push(table);
  }
  return hits;
}

describe('poste de personnalisation', () => {
  let w: MediaWorld;
  let perso: KeyProcessApp;
  let batchA: string;
  let batchB: string;
  const pathA = () => `/v1/operators/${w.ops.a}/media-personalizations`;
  const pathB = () => `/v1/operators/${w.ops.b}/media-personalizations`;
  const post = (who: TestPerson | null, path: string, body: object, key: string | null = randomUUID()) => {
    let req = request(perso.app.getHttpServer()).post(path);
    if (who) req = req.set('Authorization', `Bearer ${who.token}`);
    if (key !== null) req = req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const batch = (options: Partial<Parameters<typeof createBatch>[1]> = {}) =>
    withOwner((db) => createBatch(db, { operatorId: w.ops.a, organizerId: w.ids.organizerA, ...options }));
  const mediaOf = (uid: string, operatorId: string = w.ops.a) =>
    rows<MediaRow>(
      `SELECT id, status, key_index, token_hash, signature_ok, originality_sig_sha256, personalized_at, pwd_pack_enc, pwd_pack_dek_id, claim_code_hash
         FROM media WHERE operator_id = $1 AND nfc_uid = $2`,
      [operatorId, Buffer.from(uid, 'hex')],
    );
  /** Rouvre le mot de passe stocké d'un bracelet, comme le ferait le processus des clés de bracelet. */
  const openStored = async (media: MediaRow, uid: string, operatorId: string = w.ops.a) => {
    const [key] = await rows<{ encrypted_dek: Buffer; status: string }>('SELECT encrypted_dek, status FROM tag_data_key WHERE id = $1', [media.pwd_pack_dek_id]);
    const dek = await new FakeKms().decrypt(TEST_WRAPPING_KEY_REF, key!.encrypted_dek);
    return openPwdPack({ dek, blob: media.pwd_pack_enc, aad: pwdPackAad({ mediaId: media.id, operatorId, keyIndex: media.key_index, uid: Buffer.from(uid, 'hex') }) });
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    perso = await createKeyProcess('personalization', { identity: w.idp });
    batchA = await batch({ quantity: 500 });
    batchB = await withOwner((db) => createBatch(db, { operatorId: w.ops.b, organizerId: w.ids.organizerB }));
  });

  afterAll(async () => {
    await perso.app.close();
  });

  it('le faux service de clés et le message de dérivation reproduisent le vecteur du kit', async () => {
    const { kdf } = vectors;
    const message = derivationMessage({ operatorId: kdf.operator_id, keyIndex: kdf.key_index, uid: Buffer.from(kdf.uid, 'hex') });
    expect(message.toString('hex')).toBe(kdf.message);
    const mac = await perso.kms.generateMac(KIT_VECTOR_HMAC_KEY_REF, message);
    expect(splitPwdPack(mac).pwdPack.toString('hex')).toBe(kdf.okm);
    expect((await expectedPwdPack(KIT_VECTOR_HMAC_KEY_REF, kdf.operator_id, kdf.key_index, kdf.uid)).toString('hex')).toBe(`${kdf.pwd}${kdf.pack}`);
  });

  describe('enregistrement', () => {
    const chip = createChip();
    const station = createStation();
    const key = randomUUID();
    let mediaId: string;
    let pwdPack: Buffer;
    let logged = '';

    beforeAll(async () => {
      perso.kms.resetCalls();
      const spies = [jest.spyOn(process.stdout, 'write'), jest.spyOn(process.stderr, 'write')];
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchA, chip, station), key);
      logged = spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0]))).join('');
      spies.forEach((spy) => spy.mockRestore());
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Object.keys(res.body).sort()).toEqual(['key_index', 'media_id', 'pwd_pack']);
      expect(res.body.key_index).toBe(MEDIA_KEY_INDEX);
      expect(res.body.pwd_pack).toEqual({ alg: 'ECDH-ES+HKDF-SHA256+A256GCM', epk: expect.any(String), nonce: expect.any(String), ciphertext: expect.any(String), tag: expect.any(String) });
      mediaId = res.body.media_id;
      pwdPack = station.open(res.body.pwd_pack, mediaId, chip.uid);
    });

    it('le mot de passe ouvert par le poste est celui que donne la clé de test du kit pour cette puce', () => {
      // Calcul indépendant : HMAC-SHA256 de la clé du kit sur le message SP 800-108, 6 premiers octets.
      const message = derivationMessage({ operatorId: w.ops.a, keyIndex: MEDIA_KEY_INDEX, uid: Buffer.from(chip.uid, 'hex') });
      expect(pwdPack.toString('hex')).toBe(createHmac('sha256', KIT_KEY).update(message).digest().subarray(0, 6).toString('hex'));
      expect(pwdPack).toHaveLength(6);
    });

    it('un seul calcul de mot de passe, une clé de données ouverte pour la série, aucun déchiffrement', () => {
      expect(perso.kms.calls).toMatchObject({ generateMac: 1, generateDataKey: 1, decrypt: 0, createKey: 0, disableKey: 0 });
    });

    it('le bracelet est enregistré en stock, avec l’index de clé du lot et l’empreinte de la signature', async () => {
      const [media] = await mediaOf(chip.uid);
      expect(media).toMatchObject({ id: mediaId, status: 'PERSONALIZED', key_index: MEDIA_KEY_INDEX, signature_ok: true, claim_code_hash: null });
      expect(media!.token_hash.toString('hex')).toBe(chip.tokenHash);
      // Seule l'empreinte de la signature d'originalité est gardée (ADR-59).
      expect(media!.originality_sig_sha256.equals(createHash('sha256').update(chip.signature).digest())).toBe(true);
      expect(media!.personalized_at).toBeInstanceOf(Date);
      expect(media!.pwd_pack_enc).toHaveLength(34);
      expect(await rows('SELECT status FROM tag_data_key WHERE id = $1', [media!.pwd_pack_dek_id])).toEqual([{ status: 'ACTIVE' }]);
      expect(await rows(`SELECT to_status, actor_id, reason FROM media_status_history WHERE media_id = $1`, [mediaId])).toEqual([
        { to_status: 'PERSONALIZED', actor_id: w.personalizerA.userId, reason: 'PERSONALIZATION' },
      ]);
    });

    it('le chiffré stocké se rouvre, par le processus qui peut déchiffrer, en la même valeur', async () => {
      const [media] = await mediaOf(chip.uid);
      expect((await openStored(media!, chip.uid)).equals(pwdPack)).toBe(true);
    });

    it('audit : qui, quel lot, quelle clé — jamais le mot de passe', async () => {
      expect(await rows(`SELECT action, actor_id, actor_role, after FROM audit_log WHERE operator_id = $1 AND object_id = $2`, [w.ops.a, mediaId])).toEqual([
        { action: 'MEDIA_PERSONALIZED', actor_id: w.personalizerA.userId, actor_role: 'PERSONALIZER', after: { batch_id: batchA, key_index: MEDIA_KEY_INDEX, data_key_version: 1 } },
      ]);
    });

    it('le mot de passe n’est en clair ni en base, ni dans le registre d’idempotence, ni dans les journaux', async () => {
      expect(await findSecretAtRest(pwdPack)).toEqual([]);
      for (const form of [pwdPack.toString('hex'), pwdPack.toString('base64'), pwdPack.toString('base64url')]) expect(logged.toLowerCase()).not.toContain(form.toLowerCase());
      expect(await rows(`SELECT response_status, response_body FROM api_idempotency WHERE operator_id = $1 AND scope = 'perso:' AND idempotency_key = $2`, [w.ops.a, key])).toEqual([
        { response_status: 201, response_body: { media_id: mediaId } },
      ]);
    });

    it('la recherche au repos trouve bien une valeur quand elle y est (contrôle du contrôle)', async () => {
      const planted = randomBytes(6);
      const id = randomUUID();
      await rows(`INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, $3)`, [id, w.ops.a, `fuite ${planted.toString('hex').toUpperCase()}`]);
      try {
        expect(await findSecretAtRest(planted)).toEqual(['"public"."party"']);
      } finally {
        await rows('DELETE FROM party WHERE id = $1', [id]);
      }
      // Et en binaire : le chiffré d'un bracelet contient son propre nonce.
      const [media] = await mediaOf(chip.uid);
      expect(await findSecretAtRest(media!.pwd_pack_enc.subarray(0, 12))).toEqual(['"public"."media"']);
    });

    it('le bracelet suivant de la série réutilise la clé de données de session', async () => {
      perso.kms.resetCalls();
      const next = createChip();
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchA, next, station));
      expect(res.status).toBe(201);
      expect(perso.kms.calls).toMatchObject({ generateMac: 1, generateDataKey: 0, decrypt: 0 });
      const [first] = await mediaOf(chip.uid);
      const [second] = await mediaOf(next.uid);
      expect(second!.pwd_pack_dek_id).toBe(first!.pwd_pack_dek_id);
      expect(station.open(res.body.pwd_pack, res.body.media_id, next.uid).equals(await expectedPwdPack(w.keyRef.a, w.ops.a, MEDIA_KEY_INDEX, next.uid))).toBe(true);
      // L'enveloppe est liée à CE bracelet : celle d'un autre ne s'ouvre pas à sa place.
      expect(() => station.open(res.body.pwd_pack, mediaId, next.uid)).toThrow();
    });

    it('rejeu de la même clé : même bracelet, enveloppe recalculée pour la clé présentée, rien de plus en base', async () => {
      perso.kms.resetCalls();
      const other = createStation();
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchA, chip, other), key);
      expect(res.status).toBe(201);
      expect(res.body.media_id).toBe(mediaId);
      expect(other.open(res.body.pwd_pack, mediaId, chip.uid).equals(pwdPack)).toBe(true);
      expect(() => station.open(res.body.pwd_pack, mediaId, chip.uid)).toThrow();
      expect(perso.kms.calls).toMatchObject({ generateMac: 1, generateDataKey: 0, decrypt: 0 });
      expect(await mediaOf(chip.uid)).toHaveLength(1);
      expect(await rows(`SELECT count(*)::int AS n FROM audit_log WHERE operator_id = $1 AND object_id = $2`, [w.ops.a, mediaId])).toEqual([{ n: 1 }]);
    });

    it('la même clé pour une autre puce est refusée ; une puce déjà connue aussi', async () => {
      const reused = await post(w.personalizerA, pathA(), personalizationBody(batchA, createChip(), station), key);
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const sameUid = await post(w.personalizerA, pathA(), personalizationBody(batchA, { ...createChip(), uid: chip.uid }, station));
      expect(sameUid.status).toBe(409);
      const sameIdentity = await post(w.personalizerA, pathA(), personalizationBody(batchA, { ...createChip(), tokenHash: chip.tokenHash }, station));
      expect(sameIdentity.status).toBe(409);
      expect(await mediaOf(chip.uid)).toHaveLength(1);
    });
  });

  it('trois envois simultanés de la même demande : un seul bracelet', async () => {
    const chip = createChip();
    const station = createStation();
    const key = randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => post(w.personalizerA, pathA(), personalizationBody(batchA, chip, station), key)));
    expect(results.map((res) => res.status)).toEqual([201, 201, 201]);
    expect(new Set(results.map((res) => res.body.media_id)).size).toBe(1);
    expect(await mediaOf(chip.uid)).toHaveLength(1);
    const expected = await expectedPwdPack(w.keyRef.a, w.ops.a, MEDIA_KEY_INDEX, chip.uid);
    for (const res of results) expect(station.open(res.body.pwd_pack, res.body.media_id, chip.uid).equals(expected)).toBe(true);
  });

  describe('refus', () => {
    const count = () => rows<{ n: number }>('SELECT count(*)::int AS n FROM media WHERE operator_id = ANY($1::uuid[])', [[w.ops.a, w.ops.b]]).then((r) => r[0]!.n);

    it('signature d’originalité invalide : 422, aucun calcul de mot de passe, rien d’enregistré', async () => {
      const before = await count();
      perso.kms.resetCalls();
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchA, createChip(), createStation(), { signature_ok: false }));
      expect(res.status).toBe(422);
      expect(perso.kms.calls.generateMac).toBe(0);
      expect(await count()).toBe(before);
    });

    it.each([
      ['identité qui n’est pas une empreinte', { token_hash: 'abcd' }],
      ['UID en majuscules', { nfc_uid: '04A1B2C3D4E5F6' }],
      ['UID trop court', { nfc_uid: '04a1b2' }],
      ['signature vide', { originality_signature: '' }],
      ['signature qui n’est pas du base64', { originality_signature: '***' }],
      ['signature_ok absent', { signature_ok: undefined }],
      ['lot mal formé', { batch_id: 'abc' }],
      ['clé du poste trop courte', { station_public_key: randomBytes(32).toString('base64url') }],
      ['clé du poste compressée', { station_public_key: Buffer.concat([Buffer.from([0x02]), randomBytes(64)]).toString('base64url') }],
      ['clé du poste hors de la courbe', { station_public_key: Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 1)]).toString('base64url') }],
      ['clé du poste absente', { station_public_key: undefined }],
    ])('demande mal formée : %s (400, aucun calcul de mot de passe)', async (_name, overrides) => {
      perso.kms.resetCalls();
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchA, createChip(), createStation(), overrides));
      expect(res.status).toBe(400);
      expect(perso.kms.calls.generateMac).toBe(0);
    });

    it('sans clé d’idempotence : 400', async () => {
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchA, createChip(), createStation()), null);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('lot inconnu ou d’un autre prestataire : 404', async () => {
      const before = await count();
      for (const id of [randomUUID(), batchB]) expect((await post(w.personalizerA, pathA(), personalizationBody(id, createChip(), createStation()))).status).toBe(404);
      expect(await count()).toBe(before);
    });

    it('quantité du lot atteinte : 409', async () => {
      const small = await batch({ quantity: 1 });
      expect((await post(w.personalizerA, pathA(), personalizationBody(small, createChip(), createStation()))).status).toBe(201);
      const res = await post(w.personalizerA, pathA(), personalizationBody(small, createChip(), createStation()));
      expect(res.status).toBe(409);
      expect(await rows('SELECT count(*)::int AS n FROM media WHERE batch_id = $1', [small])).toEqual([{ n: 1 }]);
    });

    it('lot qui n’est plus en préparation : 409', async () => {
      const delivered = await batch({ status: 'DELIVERED' });
      expect((await post(w.personalizerA, pathA(), personalizationBody(delivered, createChip(), createStation()))).status).toBe(409);
      expect(await rows('SELECT 1 FROM media WHERE batch_id = $1', [delivered])).toEqual([]);
    });

    it('clé du lot qui n’est plus active : 409, aucun calcul de mot de passe', async () => {
      const index = 77;
      await rows(`INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, $2, $3)`, [w.ops.a, index, `fake-kms:hmac:${randomUUID()}`]);
      const onKey = await batch({ keyIndex: index });
      await rows(`UPDATE tag_key SET status = 'DECRYPT_ONLY' WHERE operator_id = $1 AND key_index = $2`, [w.ops.a, index]);
      perso.kms.resetCalls();
      expect((await post(w.personalizerA, pathA(), personalizationBody(onKey, createChip(), createStation()))).status).toBe(409);
      expect(perso.kms.calls.generateMac).toBe(0);
      expect(await rows('SELECT 1 FROM media WHERE batch_id = $1', [onKey])).toEqual([]);
    });

    it('service de clés en panne : 503, rien d’enregistré ; la même demande réussit ensuite', async () => {
      const chip = createChip();
      const station = createStation();
      const key = randomUUID();
      perso.kms.failNext('generateMac');
      const down = await post(w.personalizerA, pathA(), personalizationBody(batchA, chip, station), key);
      expect(down.status).toBe(503);
      expect(down.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(await mediaOf(chip.uid)).toEqual([]);
      expect(await rows(`SELECT 1 FROM api_idempotency WHERE operator_id = $1 AND idempotency_key = $2`, [w.ops.a, key])).toEqual([]);
      const up = await post(w.personalizerA, pathA(), personalizationBody(batchA, chip, station), key);
      expect(up.status).toBe(201);
      expect(await mediaOf(chip.uid)).toHaveLength(1);
    });

    it('panne à l’ouverture de la clé de données : 503, rien d’enregistré', async () => {
      const index = 78;
      await rows(`INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, $2, $3)`, [w.ops.a, index, `fake-kms:hmac:${randomUUID()}`]);
      const onKey = await batch({ keyIndex: index });
      const chip = createChip();
      perso.kms.failNext('generateDataKey');
      expect((await post(w.personalizerA, pathA(), personalizationBody(onKey, chip, createStation()))).status).toBe(503);
      expect(await mediaOf(chip.uid)).toEqual([]);
      expect(await rows('SELECT 1 FROM tag_data_key WHERE operator_id = $1 AND key_index = $2', [w.ops.a, index])).toEqual([]);
      expect((await post(w.personalizerA, pathA(), personalizationBody(onKey, chip, createStation()))).status).toBe(201);
    });
  });

  describe('clé de données de session qui cesse d’être active en cours de route', () => {
    const makeStale = (times: number) => {
      const sessions = perso.app.get(SessionDataKeyProvider, { strict: false });
      const real = sessions.withKey.bind(sessions);
      const spy = jest.spyOn(sessions, 'withKey');
      for (let i = 0; i < times; i += 1) {
        spy.mockImplementationOnce((operatorId, keyIndex, fn) =>
          real(operatorId, keyIndex, async (key) => {
            // Une autre instance vient d'ouvrir sa propre version : celle-ci ne sert plus qu'à déchiffrer.
            await rows(`UPDATE tag_data_key SET status = 'DECRYPT_ONLY' WHERE id = $1`, [key.dekId]);
            return fn(key);
          }),
        );
      }
      return spy;
    };

    it('une nouvelle version est ouverte et l’enregistrement refait une fois', async () => {
      const chip = createChip();
      const station = createStation();
      const spy = makeStale(1);
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchA, chip, station));
      spy.mockRestore();
      expect(res.status).toBe(201);
      const [media] = await mediaOf(chip.uid);
      expect(await rows('SELECT status FROM tag_data_key WHERE id = $1', [media!.pwd_pack_dek_id])).toEqual([{ status: 'ACTIVE' }]);
      expect((await openStored(media!, chip.uid)).equals(station.open(res.body.pwd_pack, res.body.media_id, chip.uid))).toBe(true);
      expect(await rows(`SELECT count(*)::int AS n FROM tag_data_key WHERE operator_id = $1 AND key_index = $2 AND status = 'ACTIVE'`, [w.ops.a, MEDIA_KEY_INDEX])).toEqual([{ n: 1 }]);
    });

    it('deux fois de suite : 409, rien d’enregistré', async () => {
      const chip = createChip();
      const spy = makeStale(2);
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchA, chip, createStation()));
      spy.mockRestore();
      expect(res.status).toBe(409);
      expect(await mediaOf(chip.uid)).toEqual([]);
    });
  });

  describe('rôles et isolation', () => {
    it('seul le rôle PERSONALIZER du prestataire enregistre un bracelet', async () => {
      perso.kms.resetCalls();
      const body = () => personalizationBody(batchA, createChip(), createStation());
      expect((await post(null, pathA(), body())).status).toBe(401);
      for (const who of [w.operatorAdminA, w.organizerAdminA, w.platformAdmin]) expect((await post(who, pathA(), body())).status).toBe(403);
      expect((await post(w.personalizerB, pathA(), body())).status).toBe(404);
      expect((await post(w.personalizerB, pathB(), body())).status).toBe(404); // lot de A vu depuis B
      expect((await post(w.personalizerA, pathB(), personalizationBody(batchB, createChip(), createStation()))).status).toBe(404);
      expect(perso.kms.calls.generateMac).toBe(0);
    });

    it('chaque prestataire a sa clé : la même puce n’aurait pas le même mot de passe ailleurs', async () => {
      const chip = createChip();
      const station = createStation();
      const res = await post(w.personalizerB, pathB(), personalizationBody(batchB, chip, station));
      expect(res.status).toBe(201);
      const opened = station.open(res.body.pwd_pack, res.body.media_id, chip.uid);
      expect(opened.equals(await expectedPwdPack(w.keyRef.b, w.ops.b, MEDIA_KEY_INDEX, chip.uid))).toBe(true);
      expect(opened.equals(await expectedPwdPack(w.keyRef.a, w.ops.a, MEDIA_KEY_INDEX, chip.uid))).toBe(false);
      expect(await mediaOf(chip.uid, w.ops.a)).toEqual([]);
      expect(await mediaOf(chip.uid, w.ops.b)).toHaveLength(1);
      // Le même UID peut exister chez les deux prestataires.
      expect((await post(w.personalizerA, pathA(), personalizationBody(batchA, chip, station))).status).toBe(201);
    });

    it('le processus de personnalisation ne sert aucune autre route des bracelets', async () => {
      const http = request(perso.app.getHttpServer());
      const auth = { Authorization: `Bearer ${w.personalizerA.token}` };
      expect((await http.get(`/v1/operators/${w.ops.a}/media-batches`).set(auth)).status).toBe(404);
      expect((await http.post('/v1/media/auth-keys').set(auth).send({})).status).toBe(404);
      expect((await http.post(`/v1/operators/${w.ops.a}/tag-keys`).set(auth).set('Idempotency-Key', randomUUID()).send({})).status).toBe(404);
    });
  });

  describe('association du code imprimé', () => {
    let hasher: ClaimHasher;
    let publicBatch: string;
    let otherBatch: string;
    const codes = { good: 'K7QM4XH9RT', second: 'A2B3C4D5E6', other: 'Z9Y8X7W6V5', used: 'H2J3K4L5M6', invalidated: 'N7P8Q9R2S3' };
    let media: { id: string; uid: string }[];
    const path = (mediaId: string) => `${pathA()}/${mediaId}/claim-code`;
    const register = async (batchId: string) => {
      const chip = createChip();
      const res = await post(w.personalizerA, pathA(), personalizationBody(batchId, chip, createStation()));
      expect(res.status).toBe(201);
      return { id: res.body.media_id as string, uid: chip.uid };
    };

    beforeAll(async () => {
      hasher = perso.app.get(ClaimHasher, { strict: false });
      publicBatch = await batch({ quantity: 20 });
      otherBatch = await batch({ quantity: 20 });
      // Codes tirés au hasard à chaque exécution : l'empreinte d'un code est unique dans toute la base.
      const alphabet = vectors.claim_code.alphabet;
      for (const name of Object.keys(codes) as (keyof typeof codes)[]) codes[name] = Array.from(randomBytes(10), (b) => alphabet[b & 0x1f]).join('');
      media = [await register(publicBatch), await register(publicBatch), await register(publicBatch)];
      await withOwner(async (db) => {
        const insert = (batchId: string, code: string) => db.query('INSERT INTO claim_code (operator_id, batch_id, code_hash) VALUES ($1, $2, $3)', [w.ops.a, batchId, hasher.claimCodeHash(code)]);
        await insert(publicBatch, codes.good);
        await insert(publicBatch, codes.second);
        await insert(publicBatch, codes.used);
        await insert(publicBatch, codes.invalidated);
        await insert(otherBatch, codes.other);
        await db.query('UPDATE claim_code SET invalidated_at = clock_timestamp() WHERE code_hash = $1', [hasher.claimCodeHash(codes.invalidated)]);
      });
    });

    it('associe le code scanné, quelle que soit sa saisie ; l’audit ne porte pas le code', async () => {
      const typed = ` ${codes.good.slice(0, 4).toLowerCase()}-${codes.good.slice(4).toLowerCase()} `;
      const res = await post(w.personalizerA, path(media[0]!.id), { claim_code: typed });
      expect(res.status).toBe(204);
      expect(res.headers['idempotency-replayed']).toBeUndefined();
      const [row] = await mediaOf(media[0]!.uid);
      expect(row!.claim_code_hash!.equals(hasher.claimCodeHash(codes.good))).toBe(true);
      expect(await rows('SELECT media_id FROM claim_code WHERE code_hash = $1', [hasher.claimCodeHash(codes.good)])).toEqual([{ media_id: media[0]!.id }]);
      const audit = await rows<{ action: string; after: unknown }>(`SELECT action, after FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action LIKE 'CLAIM_CODE%'`, [w.ops.a, media[0]!.id]);
      expect(audit).toEqual([{ action: 'CLAIM_CODE_ASSOCIATED', after: { batch_id: publicBatch } }]);
    });

    it('le même code sur le même bracelet : rejeu, rien de plus ; un autre code : 409', async () => {
      const again = await post(w.personalizerA, path(media[0]!.id), { claim_code: codes.good });
      expect(again.status).toBe(204);
      expect(again.headers['idempotency-replayed']).toBe('true');
      expect((await post(w.personalizerA, path(media[0]!.id), { claim_code: codes.second })).status).toBe(409);
      expect(await rows(`SELECT count(*)::int AS n FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action LIKE 'CLAIM_CODE%'`, [w.ops.a, media[0]!.id])).toEqual([{ n: 1 }]);
    });

    it('code inconnu, mal formé, d’un autre lot, déjà associé ou invalidé : le même refus, le motif à l’audit', async () => {
      await rows('UPDATE claim_code SET media_id = $2, associated_at = clock_timestamp() WHERE code_hash = $1', [hasher.claimCodeHash(codes.used), media[2]!.id]);
      const attempts: [string, string][] = [
        ['ZZZZZZZZZ2', 'CLAIM_CODE_UNKNOWN'],
        ['pas-un-code', 'BAD_CLAIM_CODE'],
        [codes.other, 'CLAIM_CODE_OTHER_BATCH'],
        [codes.used, 'CLAIM_CODE_ALREADY_ASSOCIATED'],
        [codes.invalidated, 'CLAIM_CODE_INVALIDATED'],
      ];
      const bodies: string[] = [];
      for (const [code] of attempts) {
        const res = await post(w.personalizerA, path(media[1]!.id), { claim_code: code });
        expect(res.status).toBe(422);
        const { instance: _instance, request_id: _requestId, ...rest } = res.body as Record<string, unknown>;
        bodies.push(JSON.stringify(rest));
        expect(JSON.stringify(res.body)).not.toContain(code);
      }
      expect(new Set(bodies).size).toBe(1);
      const audit = await rows<{ after: { reason: string } }>(
        `SELECT after FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'CLAIM_CODE_ASSOCIATION_REFUSED' ORDER BY id`,
        [w.ops.a, media[1]!.id],
      );
      expect(audit.map((row) => row.after.reason)).toEqual(attempts.map(([, reason]) => reason));
      const all = await rows<{ text: string }>(`SELECT coalesce(before::text, '') || coalesce(after::text, '') AS text FROM audit_log WHERE operator_id = $1`, [w.ops.a]);
      for (const code of Object.values(codes)) expect(all.some((row) => row.text.toUpperCase().includes(code))).toBe(false);
      expect((await mediaOf(media[1]!.uid))[0]!.claim_code_hash).toBeNull();
      // Le bracelet reste associable à un code juste.
      expect((await post(w.personalizerA, path(media[1]!.id), { claim_code: codes.second })).status).toBe(204);
    });

    it('lot sans code (STAFF, VIP) : 409', async () => {
      for (const kind of ['STAFF', 'VIP'] as const) {
        const staff = await register(await batch({ kind }));
        expect((await post(w.personalizerA, path(staff.id), { claim_code: codes.second })).status).toBe(409);
      }
    });

    it('corps mal formé, bracelet inconnu, rôles, isolation', async () => {
      expect((await post(w.personalizerA, path(media[2]!.id), {})).status).toBe(400);
      expect((await post(w.personalizerA, path(media[2]!.id), { claim_code: 'x'.repeat(65) })).status).toBe(400);
      expect((await post(w.personalizerA, path(media[2]!.id), { claim_code: codes.second }, null)).status).toBe(400);
      expect((await post(w.personalizerA, path(randomUUID()), { claim_code: codes.second })).status).toBe(404);
      expect((await post(w.personalizerA, path('abc'), { claim_code: codes.second })).status).toBe(404);
      expect((await post(w.operatorAdminA, path(media[2]!.id), { claim_code: codes.second })).status).toBe(403);
      expect((await post(w.personalizerB, path(media[2]!.id), { claim_code: codes.second })).status).toBe(404);
      expect((await post(w.personalizerB, `${pathB()}/${media[2]!.id}/claim-code`, { claim_code: codes.second })).status).toBe(404);
      expect((await mediaOf(media[2]!.uid))[0]!.claim_code_hash).toBeNull();
    });

    it('code invalidé pendant l’association (contrôle préalable passé) : la base refuse, l’audit porte le bon motif', async () => {
      // Relecture du cycle 7, constat 1 : la lecture préalable, sans verrou, ne voit pas l'invalidation en cours ;
      // associate_claim_code l'attend puis refuse. Le motif inscrit doit être celui de la base, pas un motif fixe.
      const target = await register(publicBatch);
      const late = Array.from(randomBytes(10), (b) => vectors.claim_code.alphabet[b & 0x1f]).join('');
      await rows('INSERT INTO claim_code (operator_id, batch_id, code_hash) VALUES ($1, $2, $3)', [w.ops.a, publicBatch, hasher.claimCodeHash(late)]);
      const res = await commitWhileWaiting(
        { sql: 'UPDATE claim_code SET invalidated_at = clock_timestamp() WHERE code_hash = $1', params: [hasher.claimCodeHash(late)] },
        { role: 'cashless_perso', statement: 'associate_claim_code' },
        () => post(w.personalizerA, path(target.id), { claim_code: late }),
      );
      expect(res.status).toBe(422);
      const audit = await rows<{ action: string; after: unknown }>(
        `SELECT action, after FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action LIKE 'CLAIM_CODE%'`,
        [w.ops.a, target.id],
      );
      expect(audit).toEqual([{ action: 'CLAIM_CODE_ASSOCIATION_REFUSED', after: { reason: 'CLAIM_CODE_INVALIDATED' } }]);
      expect((await mediaOf(target.uid))[0]!.claim_code_hash).toBeNull();
      expect(await rows('SELECT media_id FROM claim_code WHERE code_hash = $1', [hasher.claimCodeHash(late)])).toEqual([{ media_id: null }]);
    });
  });
});
