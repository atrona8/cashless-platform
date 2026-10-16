// Intégration : clés de bracelet (FR-007, FR-009, FR-035, SC-007 ; US8 de la spec) — demandes à deux dans l'API
// publique, travaux exécutés par la commande d'administration (seule à pouvoir créer ou désactiver une clé),
// reprise sans doublon après une panne, isolation à deux prestataires.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DekWorker } from '../../../src/media/keys/dek.worker';
import { ALARM_JOB_REFUSED } from '../../../src/media/keys/job-gate';
import { KeyAdminWorker } from '../../../src/media/keys/key-admin.worker';
import { createKeyProcess, createTestApp, type KeyProcessApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

describe('clés de bracelet', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let admin: KeyProcessApp;
  let perso: KeyProcessApp;
  let ops: Operators;
  let adminA: TestPerson;
  let adminA2: TestPerson;
  let adminB: TestPerson;
  let organizerAdmin: TestPerson;
  const ids = {
    organizer: randomUUID(),
    profile: randomUUID(),
    event: randomUUID(),
    eventB: randomUUID(),
    organizerB: randomUUID(),
  };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    ops = await createOperators();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Organisateur A'), ($3, 'ORGANIZER', $4, 'Organisateur B')`,
        [ids.organizer, ops.a, ids.organizerB, ops.b],
      );
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [ids.profile],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
           ($1, $2, $3, 'Événement A', 'XOF', 'Africa/Dakar', $7, 'ORGANIZER'), ($4, $5, $6, 'Événement B', 'XOF', 'Africa/Dakar', $7, 'ORGANIZER')`,
        [ids.event, ops.a, ids.organizer, ids.eventB, ops.b, ids.organizerB, ids.profile],
      );
      const person = (operatorId: string, roles: Parameters<FakeIdp['createPerson']>[1]['roles']) =>
        idp.createPerson(db, { operatorId, roles });
      adminA = await person(ops.a, [
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a },
      ]);
      adminA2 = await person(ops.a, [
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a },
      ]);
      adminB = await person(ops.b, [
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b },
      ]);
      organizerAdmin = await person(ops.a, [
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.organizer },
      ]);
    });
    app = await createTestApp({ identity: idp });
    admin = await createKeyProcess('key-admin');
    perso = await createKeyProcess('personalization', { identity: idp });
  });

  afterAll(async () => {
    await perso.app.close();
    await admin.app.close();
    await app.close();
  });

  // La file des travaux est commune à toutes les suites qui tournent sur la même base : passage limité aux
  // prestataires de celle-ci.
  const runAdmin = () => admin.app.get(KeyAdminWorker, { strict: false }).runOnce([ops.a, ops.b]);
  /**
   * Personnalisation : exécute rotations et retraits en attente (retrait : désactivation inscrite
   * ensuite).
   */
  const drainPerso = async () => {
    while ((await perso.app.get(DekWorker, { strict: false }).runOnce([ops.a, ops.b])) > 0);
  };
  const http = () => request(app.getHttpServer());
  const post = (who: TestPerson, path: string, body: object = {}, key: string = randomUUID()) =>
    http()
      .post(path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const get = (who: TestPerson, path: string) =>
    http().get(path).set('Authorization', `Bearer ${who.token}`);
  const rows = <T>(sql: string, params: unknown[] = []) =>
    withOwner(async (db) => (await db.query(sql, params)).rows as T[]);
  const A = () => `/v1/operators/${ops.a}`;
  const approve = (who: TestPerson, id: string) => post(who, `/v1/approval-requests/${id}/approve`);
  /** Demande par `adminA`, approbation par `adminA2` ; rend la demande exécutée. */
  const approved = async (path: string, body: object = {}) => {
    const requested = await post(adminA, path, body);
    expect(requested.status).toBe(202);
    const decided = await approve(adminA2, requested.body.approval_request_id);
    expect(decided.status).toBe(200);
    return decided.body as {
      status: string;
      result: { job_id: string; key_index: number; kind: string; awaiting: string | null };
    };
  };

  describe('création d’une clé', () => {
    let keyIndex: number;
    let jobId: string;

    it('une seule personne ne suffit pas : la demande ne crée ni clé ni travail', async () => {
      const res = await post(adminA, `${A()}/tag-keys`, {});
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ action: 'TAG_KEY_CREATE', status: 'PENDING' });
      expect(res.headers.location).toBe(`/v1/approval-requests/${res.body.approval_request_id}`);
      expect(await rows('SELECT 1 FROM tag_key WHERE operator_id = $1', [ops.a])).toEqual([]);
      expect(await rows('SELECT 1 FROM tag_key_job WHERE operator_id = $1', [ops.a])).toEqual([]);
      // L'auteur ne valide pas sa propre demande.
      expect([403, 409]).toContain((await approve(adminA, res.body.approval_request_id)).status);
      expect(await rows('SELECT 1 FROM tag_key_job WHERE operator_id = $1', [ops.a])).toEqual([]);
      await post(adminA2, `/v1/approval-requests/${res.body.approval_request_id}/reject`, {
        note: 'essai',
      });
    });

    it('approuvée par une autre personne : un travail attend la commande d’administration, toujours aucune clé', async () => {
      const decided = await approved(`${A()}/tag-keys`, { scope: 'SHARED' });
      expect(decided.status).toBe('EXECUTED');
      expect(decided.result).toMatchObject({ kind: 'CREATE_KEY', awaiting: 'KEY_ADMIN_COMMAND' });
      keyIndex = decided.result.key_index;
      jobId = decided.result.job_id;
      expect(keyIndex).toBe(1);
      expect(await rows('SELECT 1 FROM tag_key WHERE operator_id = $1', [ops.a])).toEqual([]);
      const jobs = await get(adminA, `${A()}/tag-key-jobs`);
      expect(jobs.body.data[0]).toMatchObject({
        job_id: jobId,
        status: 'PENDING',
        awaiting: 'KEY_ADMIN_COMMAND',
        progress: {},
      });
      expect(admin.kms.calls.createKey).toBe(0);
      expect(await admin.workers.describe()).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`CREATE_KEY  prestataire ${ops.a}  index 1  PENDING`),
        ]),
      );
    });

    it('commande d’administration : la clé est créée, active, auditée avec l’auteur et le valideur', async () => {
      expect(await runAdmin()).toBe(1);
      expect(admin.kms.calls.createKey).toBe(1);
      const [key] = await rows<{ status: string; scope: string; kms_key_ref: string }>(
        'SELECT status, scope, kms_key_ref FROM tag_key WHERE operator_id = $1 AND key_index = $2',
        [ops.a, keyIndex],
      );
      expect(key).toMatchObject({ status: 'ACTIVE', scope: 'SHARED' });
      expect(key!.kms_key_ref).toMatch(/^fake-kms:hmac:/);
      expect(
        await rows(
          'SELECT status, (finished_at IS NOT NULL) AS finished FROM tag_key_job WHERE id = $1',
          [jobId],
        ),
      ).toEqual([{ status: 'DONE', finished: true }]);
      expect(
        await rows(
          `SELECT actor_id, approver_id, origin FROM audit_log WHERE operator_id = $1 AND action = 'TAG_KEY_CREATED'`,
          [ops.a],
        ),
      ).toEqual([{ actor_id: adminA.userId, approver_id: adminA2.userId, origin: 'key-admin' }]);
      expect(await runAdmin()).toBe(0);

      const detail = await get(adminA, `${A()}/tag-keys/${keyIndex}`);
      expect(detail.body).toMatchObject({
        key_index: keyIndex,
        status: 'ACTIVE',
        scope: 'SHARED',
        data_key_versions: [],
        jobs: [],
      });
      expect(detail.body.kms_key_ref_suffix).toBe(key!.kms_key_ref.slice(-6));
      // La référence complète de la clé ne sort jamais de l'API.
      expect(JSON.stringify(detail.body)).not.toContain(key!.kms_key_ref);
      expect(JSON.stringify((await get(adminA, `${A()}/tag-keys`)).body)).not.toContain(
        key!.kms_key_ref,
      );
      expect(JSON.stringify((await get(adminA, `${A()}/tag-key-jobs`)).body)).not.toContain(
        key!.kms_key_ref,
      );
    });

    it('nouvelle série : index suivant, la clé partagée précédente ne sert plus qu’à déchiffrer', async () => {
      const decided = await approved(`${A()}/tag-keys`);
      expect(decided.result.key_index).toBe(2);
      await runAdmin();
      expect(
        await rows(
          'SELECT key_index, status FROM tag_key WHERE operator_id = $1 ORDER BY key_index',
          [ops.a],
        ),
      ).toEqual([
        { key_index: 1, status: 'DECRYPT_ONLY' },
        { key_index: 2, status: 'ACTIVE' },
      ]);
    });

    it('panne du service de clés : travail en échec, visible, relancé par l’administrateur', async () => {
      const decided = await approved(`${A()}/tag-keys`);
      admin.kms.failNext('createKey');
      expect(await runAdmin()).toBe(1);
      const failed = (await get(adminA, `${A()}/tag-key-jobs`)).body.data.find(
        (job: { job_id: string }) => job.job_id === decided.result.job_id,
      );
      expect(failed).toMatchObject({ status: 'FAILED', awaiting: 'KEY_ADMIN_COMMAND' });
      expect(failed.last_error).toContain('indisponible');
      expect(
        await rows('SELECT 1 FROM tag_key WHERE operator_id = $1 AND key_index = 3', [ops.a]),
      ).toEqual([]);
      expect(await runAdmin()).toBe(0);

      expect(
        (await post(organizerAdmin, `${A()}/tag-key-jobs/${decided.result.job_id}/retry`)).status,
      ).toBe(403);
      const retried = await post(adminA, `${A()}/tag-key-jobs/${decided.result.job_id}/retry`);
      expect([retried.status, retried.body.status]).toEqual([200, 'PENDING']);
      expect(
        (await post(adminA, `${A()}/tag-key-jobs/${decided.result.job_id}/retry`)).status,
      ).toBe(409);
      expect(await runAdmin()).toBe(1);
      expect(
        await rows('SELECT status FROM tag_key WHERE operator_id = $1 AND key_index = 3', [ops.a]),
      ).toEqual([{ status: 'ACTIVE' }]);
    });

    it('panne entre la création dans le service de clés et l’écriture en base : la reprise ne crée pas une seconde clé', async () => {
      const decided = await approved(`${A()}/tag-keys`);
      const before = admin.kms.calls.createKey;
      // La clé est créée et notée dans l'avancement, puis le processus « meurt » avant d'écrire tag_key : verrou échu.
      const created = await admin.kms.createKey('HMAC_256');
      await withOwner(async (db) => {
        await db.query(
          `UPDATE tag_key_job SET status = 'RUNNING', attempts = 1, started_at = clock_timestamp(), locked_until = clock_timestamp() - interval '1 second',
                  progress = jsonb_build_object('kms_key_ref', $2::text) WHERE id = $1`,
          [decided.result.job_id, created],
        );
      });
      expect(await runAdmin()).toBe(1);
      expect(admin.kms.calls.createKey).toBe(before + 1);
      expect(
        await rows('SELECT kms_key_ref FROM tag_key WHERE operator_id = $1 AND key_index = $2', [
          ops.a,
          decided.result.key_index,
        ]),
      ).toEqual([{ kms_key_ref: created }]);
    });

    it('clé dédiée : réservée à un événement du prestataire', async () => {
      expect((await post(adminA, `${A()}/tag-keys`, { scope: 'DEDICATED' })).status).toBe(422);
      expect(
        (await post(adminA, `${A()}/tag-keys`, { scope: 'SHARED', dedicated_event_id: ids.event }))
          .status,
      ).toBe(422);
      expect(
        (
          await post(adminA, `${A()}/tag-keys`, {
            scope: 'DEDICATED',
            dedicated_event_id: ids.eventB,
          })
        ).status,
      ).toBe(422);
      expect((await post(adminA, `${A()}/tag-keys`, { scope: 'AUTRE' })).status).toBe(400);
      const decided = await approved(`${A()}/tag-keys`, {
        scope: 'DEDICATED',
        dedicated_event_id: ids.event,
      });
      await runAdmin();
      const [key] = await rows<{ scope: string; dedicated_event_id: string; status: string }>(
        'SELECT scope, dedicated_event_id, status FROM tag_key WHERE operator_id = $1 AND key_index = $2',
        [ops.a, decided.result.key_index],
      );
      expect(key).toEqual({ scope: 'DEDICATED', dedicated_event_id: ids.event, status: 'ACTIVE' });
      // Une clé dédiée ne déclasse pas la clé partagée active.
      expect(
        await rows(
          `SELECT count(*)::int AS n FROM tag_key WHERE operator_id = $1 AND scope = 'SHARED' AND status = 'ACTIVE'`,
          [ops.a],
        ),
      ).toEqual([{ n: 1 }]);
    });
  });

  describe('rotation et retrait : recevabilité et inscription du travail', () => {
    const dedicatedIndex = async () =>
      (
        await rows<{ key_index: number }>(
          `SELECT key_index FROM tag_key WHERE operator_id = $1 AND scope = 'DEDICATED'`,
          [ops.a],
        )
      )[0]!.key_index;

    it('rotation : clé active seulement, une à la fois', async () => {
      expect((await post(adminA, `${A()}/tag-keys/1/dek-rotations`)).status).toBe(409); // DECRYPT_ONLY
      const active = (
        await rows<{ key_index: number }>(
          `SELECT key_index FROM tag_key WHERE operator_id = $1 AND scope = 'SHARED' AND status = 'ACTIVE'`,
          [ops.a],
        )
      )[0]!.key_index;
      expect((await post(adminA, `${A()}/tag-keys/999/dek-rotations`)).status).toBe(404);
      expect((await post(adminA, `${A()}/tag-keys/abc/dek-rotations`)).status).toBe(422);
      const decided = await approved(`${A()}/tag-keys/${active}/dek-rotations`);
      expect(decided.result).toMatchObject({
        kind: 'ROTATE_DEK',
        key_index: active,
        awaiting: null,
      });
      expect((await post(adminA, `${A()}/tag-keys/${active}/dek-rotations`)).status).toBe(409);
      // La commande d'administration ne prend pas un travail de rotation.
      expect(await runAdmin()).toBe(0);
      expect(
        await rows('SELECT status FROM tag_key_job WHERE id = $1', [decided.result.job_id]),
      ).toEqual([{ status: 'PENDING' }]);
    });

    it('retrait : clé dédiée dont tous les lots sont clos', async () => {
      const index = await dedicatedIndex();
      expect((await post(adminA, `${A()}/tag-keys/2/retirement`)).status).toBe(409); // clé partagée
      await withOwner((db) =>
        db.query(
          `INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index, key_mode) VALUES ($1, $2, $3, 'PUBLIC', 10, $4, 'DEDICATED')`,
          [ops.a, ids.organizer, ids.event, index],
        ),
      );
      const open = await post(adminA, `${A()}/tag-keys/${index}/retirement`);
      expect(open.status).toBe(409);
      expect(JSON.parse(open.text).detail).toContain('clos');
      await withOwner((db) =>
        db.query(
          `UPDATE media_batch SET status = 'CLOSED' WHERE operator_id = $1 AND key_index = $2`,
          [ops.a, index],
        ),
      );
      const decided = await approved(`${A()}/tag-keys/${index}/retirement`);
      expect(decided.result).toMatchObject({ kind: 'RETIRE_KEY', key_index: index });
      expect((await post(adminA, `${A()}/tag-keys/${index}/retirement`)).status).toBe(409);
    });

    it('lot rouvert entre la demande et l’approbation : la demande échoue, aucun travail', async () => {
      const decided = await approved(`${A()}/tag-keys`, {
        scope: 'DEDICATED',
        dedicated_event_id: ids.event,
      });
      await runAdmin();
      const index = decided.result.key_index;
      const requested = await post(adminA, `${A()}/tag-keys/${index}/retirement`);
      expect(requested.status).toBe(202);
      await withOwner((db) =>
        db.query(
          `INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index, key_mode) VALUES ($1, $2, $3, 'STAFF', 5, $4, 'DEDICATED')`,
          [ops.a, ids.organizer, ids.event, index],
        ),
      );
      const failed = await approve(adminA2, requested.body.approval_request_id);
      expect(failed.body.status).toBe('FAILED');
      expect(
        await rows(
          `SELECT 1 FROM tag_key_job WHERE operator_id = $1 AND key_index = $2 AND kind = 'RETIRE_KEY'`,
          [ops.a, index],
        ),
      ).toEqual([]);
    });

    it('désactivation dans le service de clés : faite par la commande d’administration, date enregistrée', async () => {
      const index = await dedicatedIndex();
      const ref = (
        await rows<{ kms_key_ref: string }>(
          'SELECT kms_key_ref FROM tag_key WHERE operator_id = $1 AND key_index = $2',
          [ops.a, index],
        )
      )[0]!.kms_key_ref;
      // Le retrait approuvé au test précédent est exécuté par la personnalisation, qui inscrit la
      // désactivation.
      await drainPerso();
      expect(
        await rows('SELECT status FROM tag_key WHERE operator_id = $1 AND key_index = $2', [
          ops.a,
          index,
        ]),
      ).toEqual([{ status: 'RETIRED' }]);
      admin.kms.failNext('disableKey');
      await runAdmin();
      expect(
        await rows(
          'SELECT kms_disabled_at FROM tag_key WHERE operator_id = $1 AND key_index = $2',
          [ops.a, index],
        ),
      ).toEqual([{ kms_disabled_at: null }]);
      const [job] = await rows<{ id: string; status: string }>(
        `SELECT id, status FROM tag_key_job WHERE operator_id = $1 AND key_index = $2 AND kind = 'DISABLE_KMS_KEY'`,
        [ops.a, index],
      );
      expect(job!.status).toBe('FAILED');
      await post(adminA, `${A()}/tag-key-jobs/${job!.id}/retry`);
      await runAdmin();
      expect(admin.kms.isDisabled(ref)).toBe(true);
      const [after] = await rows<{ kms_disabled_at: Date | null }>(
        'SELECT kms_disabled_at FROM tag_key WHERE operator_id = $1 AND key_index = $2',
        [ops.a, index],
      );
      expect(after!.kms_disabled_at).toBeInstanceOf(Date);
      expect(
        await rows(
          `SELECT approver_id FROM audit_log WHERE operator_id = $1 AND action = 'TAG_KEY_KMS_DISABLED'`,
          [ops.a],
        ),
      ).toEqual([{ approver_id: adminA2.userId }]);
      expect((await get(adminA, `${A()}/tag-keys/${index}`)).body.kms_disabled_at).not.toBeNull();
    });
  });

  // Revue post-fusion, constat SEC-1 : la base qui aurait accepté ces travaux est simulée par le
  // propriétaire. Avant le correctif, une session de l'API inscrivait ces travaux elle-même et la
  // commande d'administration les exécutait.
  describe('travail planté sans demande approuvée concordante', () => {
    const plant = (keyIndex: number, kind: string, approvalRequestId: string | null = null) =>
      rows<{ id: string }>(
        `INSERT INTO tag_key_job (operator_id, key_index, kind, payload, approval_request_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          ops.a,
          keyIndex,
          kind,
          JSON.stringify({
            scope: 'SHARED',
            requested_by: adminA.userId,
            approved_by: adminA2.userId,
          }),
          approvalRequestId,
        ],
      ).then((r) => r[0]!.id);
    const activeShared = async () =>
      (
        await rows<{ key_index: number; kms_key_ref: string }>(
          `SELECT key_index, kms_key_ref FROM tag_key
            WHERE operator_id = $1 AND scope = 'SHARED' AND status = 'ACTIVE'`,
          [ops.a],
        )
      )[0]!;

    it('désactivation de la clé partagée ACTIVE : refusée, aucun appel au KMS', async () => {
      const key = await activeShared();
      const id = await plant(key.key_index, 'DISABLE_KMS_KEY');
      admin.kms.resetCalls();
      expect(await runAdmin()).toBe(1);
      expect(admin.kms.calls.disableKey).toBe(0);
      expect(admin.kms.isDisabled(key.kms_key_ref)).toBe(false);
      const [job] = await rows<{ status: string; last_error: string }>(
        'SELECT status, last_error FROM tag_key_job WHERE id = $1',
        [id],
      );
      expect(job!.status).toBe('FAILED');
      expect(job!.last_error).toContain('Travail refusé : aucune demande');
      expect(
        await rows(
          'SELECT status, kms_disabled_at FROM tag_key WHERE operator_id = $1 AND key_index = $2',
          [ops.a, key.key_index],
        ),
      ).toEqual([{ status: 'ACTIVE', kms_disabled_at: null }]);
      expect(
        await rows(
          `SELECT origin, after->>'reason' AS reason FROM audit_log
            WHERE operator_id = $1 AND action = 'TAG_KEY_JOB_REFUSED' AND object_id = $2`,
          [ops.a, id],
        ),
      ).toEqual([{ origin: 'key-admin', reason: "aucune demande d'approbation" }]);
      expect(admin.workers.alarm()).toBe(ALARM_JOB_REFUSED);
      // Visible et relançable par l'administrateur, mais toujours refusé.
      expect((await post(adminA, `${A()}/tag-key-jobs/${id}/retry`)).status).toBe(200);
      expect(await runAdmin()).toBe(1);
      expect(admin.kms.calls.disableKey).toBe(0);
    });

    it('désactivation approuvée d’une clé redevenue ACTIVE : refusée, sans KMS', async () => {
      const created = await approved(`${A()}/tag-keys`, {
        scope: 'DEDICATED',
        dedicated_event_id: ids.event,
      });
      expect(await runAdmin()).toBe(1);
      const index = created.result.key_index;
      await approved(`${A()}/tag-keys/${index}/retirement`);
      await drainPerso();
      // La clé est remise en service après le retrait (base qui l'aurait permis) : la désactivation
      // approuvée ne doit plus toucher une clé en service.
      await rows(`UPDATE tag_key SET status = 'ACTIVE' WHERE operator_id = $1 AND key_index = $2`, [
        ops.a,
        index,
      ]);
      admin.kms.resetCalls();
      expect(await runAdmin()).toBe(1);
      expect(admin.kms.calls.disableKey).toBe(0);
      const [job] = await rows<{ status: string; last_error: string }>(
        `SELECT status, last_error FROM tag_key_job
          WHERE operator_id = $1 AND key_index = $2 AND kind = 'DISABLE_KMS_KEY'`,
        [ops.a, index],
      );
      expect(job!.status).toBe('FAILED');
      expect(job!.last_error).toContain('pas retirée');
    });

    it('création plantée, sans demande ou sur une demande non exécutée : refusée', async () => {
      const approvedOnly = await withOwner(async (db) => {
        await db.query('BEGIN');
        await db.query("SELECT set_config('app.operator_id', $1, true)", [ops.a]);
        const { rows: requested } = await db.query<{ id: string }>(
          `INSERT INTO approval_request (operator_id, action, payload, requested_by)
           VALUES ($1, 'TAG_KEY_CREATE', $2, $3) RETURNING id`,
          [
            ops.a,
            JSON.stringify({ operator_id: ops.a, scope: 'SHARED', dedicated_event_id: null }),
            adminA.userId,
          ],
        );
        await db.query('SELECT decide_approval_request($1, $2, true, NULL)', [
          requested[0]!.id,
          adminA2.userId,
        ]);
        await db.query('COMMIT');
        return requested[0]!.id;
      });
      const notExecuted = await plant(9000, 'CREATE_KEY', approvedOnly);
      const bare = await plant(9001, 'CREATE_KEY');
      admin.kms.resetCalls();
      expect(await runAdmin()).toBe(1);
      expect(await runAdmin()).toBe(1);
      expect(admin.kms.calls.createKey).toBe(0);
      expect(
        await rows(
          'SELECT key_index FROM tag_key WHERE operator_id = $1 AND key_index = ANY($2::int[])',
          [ops.a, [9000, 9001]],
        ),
      ).toEqual([]);
      const failed = await rows<{ id: string; status: string; last_error: string }>(
        `SELECT id, status, last_error FROM tag_key_job
          WHERE id = ANY($1::uuid[]) ORDER BY key_index`,
        [[notExecuted, bare]],
      );
      expect(failed.map((j) => [j.id, j.status])).toEqual([
        [notExecuted, 'FAILED'],
        [bare, 'FAILED'],
      ]);
      expect(failed[0]!.last_error).toContain('APPROVED, non exécutée');
      expect(failed[1]!.last_error).toContain('aucune demande');
    });
  });

  describe('droits et isolation', () => {
    it('réservé à l’OPERATOR_ADMIN du prestataire', async () => {
      for (const path of ['tag-keys', 'tag-keys/2', 'tag-key-jobs', 'tag-key-check-runs']) {
        expect([path, (await get(organizerAdmin, `${A()}/${path}`)).status]).toEqual([path, 403]);
        expect([path, (await http().get(`${A()}/${path}`)).status]).toEqual([path, 401]);
      }
      expect((await post(organizerAdmin, `${A()}/tag-keys`)).status).toBe(403);
      expect((await post(organizerAdmin, `${A()}/tag-keys/2/dek-rotations`)).status).toBe(403);
    });

    it('le prestataire B ne voit ni ne touche les clés et les travaux de A', async () => {
      for (const path of ['tag-keys', 'tag-keys/2', 'tag-key-jobs', 'tag-key-check-runs']) {
        expect([path, (await get(adminB, `${A()}/${path}`)).status]).toEqual([path, 404]);
      }
      expect((await post(adminB, `${A()}/tag-keys`)).status).toBe(404);
      expect((await get(adminB, `/v1/operators/${ops.b}/tag-keys`)).body).toMatchObject({
        data: [],
        has_more: false,
      });
      expect((await get(adminB, `/v1/operators/${ops.b}/tag-key-jobs`)).body.data).toEqual([]);
      const [job] = await rows<{ id: string }>(
        'SELECT id FROM tag_key_job WHERE operator_id = $1 LIMIT 1',
        [ops.a],
      );
      expect(
        (await post(adminB, `/v1/operators/${ops.b}/tag-key-jobs/${job!.id}/retry`)).status,
      ).toBe(404);
      expect((await get(adminB, `/v1/operators/${ops.b}/tag-keys/2`)).status).toBe(404);
    });

    it('comptes rendus du contrôle quotidien : lus, paginés', async () => {
      await withOwner((db) =>
        db.query(
          `INSERT INTO tag_key_check_run (operator_id, sampled, mismatches, status) VALUES ($1, 100, 0, 'OK'), ($1, 100, 1, 'MISMATCH')`,
          [ops.a],
        ),
      );
      const first = await get(adminA, `${A()}/tag-key-check-runs?limit=1`);
      expect(first.body).toMatchObject({ has_more: true });
      expect(first.body.data).toHaveLength(1);
      const second = await get(
        adminA,
        `${A()}/tag-key-check-runs?limit=1&cursor=${first.body.next_cursor}`,
      );
      expect(second.body.has_more).toBe(false);
      expect([first.body.data[0].status, second.body.data[0].status].sort()).toEqual([
        'MISMATCH',
        'OK',
      ]);
    });
  });
});
