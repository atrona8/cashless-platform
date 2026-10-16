// Intégration : liste noire d'un bracelet et sortie à deux (FR-029, FR-035, SC-007 ;
// SPECIFICATION §7.8 ; contrat `blacklistMedia`, `requestMediaReinstatement`). Aucune sortie de
// liste noire avec une seule personne.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ApprovalActionRegistry } from '../../../src/approval/action-registry';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('liste noire et sortie à deux', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let batch: string;
  let supervisor: TestPerson; // SUPERVISOR de l'organisateur A
  let supervisor2: TestPerson; // second SUPERVISOR, de l'événement A
  let cashier: TestPerson; // CASHIER de l'événement A
  let outsider: TestPerson; // SUPERVISOR d'un autre organisateur du prestataire A
  let supervisorB: TestPerson; // SUPERVISOR du prestataire B
  let counter = 0;
  const next = () => (counter += 1);

  const post = (person: TestPerson, path: string, body: object = {}, key: string = randomUUID()) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${person.token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const base = (m: SeededMedia, operatorId = w.ops.a) =>
    `/v1/operators/${operatorId}/media/${m.id}`;
  const blacklist = (
    person: TestPerson,
    m: SeededMedia,
    reason = 'Fraude suspectée',
    key?: string,
  ) => post(person, `${base(m)}/blacklist`, { reason }, key);
  const askReinstate = (
    person: TestPerson,
    m: SeededMedia,
    reason = 'Enquête close, bracelet sain',
  ) => post(person, `${base(m)}/reinstatement`, { reason });
  const approve = (person: TestPerson, id: string) =>
    post(person, `/v1/approval-requests/${id}/approve`, {});
  /** Dernière ligne de l'historique vers BLACKLISTED : l'épisode de liste noire en cours. */
  const lastBlacklisting = (m: SeededMedia) =>
    rows<{ id: string }>(
      `SELECT id::text AS id FROM media_status_history
        WHERE media_id = $1 AND to_status = 'BLACKLISTED' ORDER BY id DESC LIMIT 1`,
      [m.id],
    ).then((r) => r[0]!.id);
  const status = (m: SeededMedia) =>
    rows<{ status: string }>('SELECT status FROM media WHERE id = $1', [m.id]).then(
      (r) => r[0]!.status,
    );
  const tap = async (m: SeededMedia) =>
    (
      await request(app.getHttpServer())
        .post('/v1/taps')
        .set(device.headers)
        .send(tapBody(m, next()))
    ).body.result as string;
  const active = () =>
    withOwner(async (db) => {
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      });
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: w.ids.walletA,
        mediaIds: [m!.id],
      });
      return m!;
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      const organizerA2 = randomUUID();
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
         VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
        [organizerA2, w.ops.a],
      );
      const person = (
        operatorId: string,
        role: 'SUPERVISOR' | 'CASHIER',
        scopeType: 'ORGANIZER' | 'EVENT',
        scopeId: string,
      ) => w.idp.createPerson(db, { operatorId, roles: [{ role, scopeType, scopeId }] });
      supervisor = await person(w.ops.a, 'SUPERVISOR', 'ORGANIZER', w.ids.organizerA);
      supervisor2 = await person(w.ops.a, 'SUPERVISOR', 'EVENT', w.ids.eventA);
      cashier = await person(w.ops.a, 'CASHIER', 'EVENT', w.ids.eventA);
      outsider = await person(w.ops.a, 'SUPERVISOR', 'ORGANIZER', organizerA2);
      supervisorB = await person(w.ops.b, 'SUPERVISOR', 'ORGANIZER', w.ids.organizerB);
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('mise en liste noire : bloqué à la lecture, motif et auteur tracés, rejeu identique', async () => {
    const m = await active();
    expect(await tap(m)).toBe('OK');
    const key = randomUUID();
    const res = await blacklist(supervisor, m, 'Fraude suspectée', key);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ media_id: m.id, status: 'BLACKLISTED' });
    expect(res.body.status_history.at(-1)).toMatchObject({
      from_status: 'ACTIVE',
      to_status: 'BLACKLISTED',
      reason: 'Fraude suspectée',
      actor_id: supervisor.userId,
    });
    expect((await blacklist(supervisor, m, 'Fraude suspectée', key)).body).toEqual(res.body);
    // Nouvelle mise en liste noire par une seconde personne : rien ne change en base, mais son
    // acte et son motif sont tracés ; le rejeu de la première n'ajoute rien.
    expect((await blacklist(supervisor2, m, 'Second signalement')).body).toMatchObject({
      status: 'BLACKLISTED',
    });
    expect(
      await rows(
        `SELECT actor_id, before, after FROM audit_log
          WHERE object_id = $1 AND action = 'MEDIA_BLACKLISTED' ORDER BY seq`,
        [m.id],
      ),
    ).toEqual([
      {
        actor_id: supervisor.userId,
        before: { status: 'ACTIVE' },
        after: { status: 'BLACKLISTED', reason: 'Fraude suspectée' },
      },
      {
        actor_id: supervisor2.userId,
        before: { status: 'BLACKLISTED' },
        after: { status: 'BLACKLISTED', reason: 'Second signalement' },
      },
    ]);
    expect(await tap(m)).toBe('BLOCKED');
  });

  it('sortie : la demande seule ne change rien ; l’auteur ne peut pas l’approuver ; une autre personne la fait aboutir', async () => {
    const m = await active();
    expect((await blacklist(supervisor, m)).status).toBe(200);
    const asked = await askReinstate(supervisor, m);
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({
      action: 'REINSTATE_MEDIA',
      status: 'PENDING',
      target_id: m.id,
    });
    expect(asked.headers.location).toBe(`/v1/approval-requests/${asked.body.approval_request_id}`);
    // La demande est liée à l'épisode de liste noire qu'elle lève.
    expect(asked.body.payload).toMatchObject({ blacklist_history_id: await lastBlacklisting(m) });
    expect(await status(m)).toBe('BLACKLISTED');
    // Une seule demande de sortie en attente par bracelet, quel que soit l'auteur.
    for (const person of [supervisor, supervisor2]) {
      const again = await askReinstate(person, m);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('CONFLICT_STATE');
    }

    // L'auteur ne valide pas sa propre demande : refus de la base (mission 2), 409
    // APPROVAL_INVALID.
    const self = await approve(supervisor, asked.body.approval_request_id);
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('APPROVAL_INVALID');
    expect(await status(m)).toBe('BLACKLISTED');
    // Un CASHIER n'est pas habilité à valider.
    expect((await approve(cashier, asked.body.approval_request_id)).status).toBe(403);

    const done = await approve(supervisor2, asked.body.approval_request_id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      status: 'EXECUTED',
      result: { media_id: m.id, status: 'ACTIVE' },
    });
    expect(await status(m)).toBe('ACTIVE');
    expect(
      await rows(
        `SELECT actor_id, approved_by, reason FROM media_status_history
          WHERE media_id = $1 AND from_status = 'BLACKLISTED' AND to_status = 'ACTIVE'`,
        [m.id],
      ),
    ).toEqual([
      {
        actor_id: supervisor.userId,
        approved_by: supervisor2.userId,
        reason: 'Enquête close, bracelet sain',
      },
    ]);
    expect(await tap(m)).toBe('OK');
  });

  it('bracelet qui n’est plus en liste noire à l’approbation (retiré entre-temps) : la demande passe FAILED avec le motif', async () => {
    const m = await active();
    expect((await blacklist(supervisor, m)).status).toBe(200);
    const asked = await askReinstate(supervisor, m);
    await rows(`UPDATE media SET status = 'RETIRED' WHERE id = $1`, [m.id]);
    const res = await approve(supervisor2, asked.body.approval_request_id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'FAILED', failure_code: 'MEDIA_STATE_INVALID' });
    expect(res.body.failure_reason).toMatch(/plus en liste noire \(RETIRED\)/);
    expect(await status(m)).toBe('RETIRED');
  });

  it('demande de sortie d’un bracelet qui n’est pas en liste noire : 409, aucune demande créée', async () => {
    const m = await active();
    const res = await askReinstate(supervisor, m);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MEDIA_STATE_INVALID');
    expect(
      await rows(
        `SELECT count(*)::int AS n FROM approval_request
          WHERE action = 'REINSTATE_MEDIA' AND target_id = $1`,
        [m.id],
      ),
    ).toEqual([{ n: 0 }]);
    // Droit vérifié avant l'état : une personne non habilitée n'apprend rien de l'état.
    expect((await askReinstate(outsider, m)).status).toBe(403);
  });

  it('bracelet remis en service puis de nouveau en liste noire depuis la demande : la demande passe FAILED, il reste en liste noire', async () => {
    const m = await active();
    expect((await blacklist(supervisor, m)).status).toBe(200);
    const asked = await askReinstate(supervisor, m);
    expect(asked.status).toBe(202);
    // Sortie hors de cette demande (simulée en base, avec les deux personnes qu'exige la base),
    // puis nouvel épisode de liste noire.
    await withOwner(async (db) => {
      await db.query('BEGIN');
      await db.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.approved_by', $2, true)`,
        [supervisor.userId, supervisor2.userId],
      );
      await db.query(`UPDATE media SET status = 'ACTIVE' WHERE id = $1`, [m.id]);
      await db.query('COMMIT');
    });
    expect((await blacklist(supervisor2, m, 'Nouvelle fraude')).status).toBe(200);
    expect(await lastBlacklisting(m)).not.toBe(asked.body.payload.blacklist_history_id);

    const res = await approve(supervisor2, asked.body.approval_request_id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'FAILED', failure_code: 'CONFLICT_STATE' });
    expect(res.body.failure_reason).toMatch(/remis en liste noire depuis la demande/);
    expect(await status(m)).toBe('BLACKLISTED');
    // La demande échouée ne bloque plus : une nouvelle demande, liée au nouvel épisode, est admise.
    const renewed = await askReinstate(supervisor, m);
    expect(renewed.status).toBe(202);
    expect(renewed.body.payload.blacklist_history_id).toBe(await lastBlacklisting(m));
  });

  it('exécution : auteur, valideur et motif posés par reinstate_media sont remis à vide dans la transaction', async () => {
    const m = await active();
    expect((await blacklist(supervisor, m)).status).toBe(200);
    const definition = app.get(ApprovalActionRegistry, { strict: false }).get('REINSTATE_MEDIA')!;
    // Demande réelle (la base exige depuis la migration 0017 une demande approuvée concordante).
    const asked = await askReinstate(supervisor, m, 'Enquête close');
    expect(asked.status).toBe(202);
    const payload = asked.body.payload;
    const seen = await withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query('SET LOCAL ROLE cashless_app');
        await db.query(`SELECT set_config('app.operator_id', $1, true)`, [w.ops.a]);
        await db.query('SELECT 1 FROM decide_approval_request($1, $2, true)', [
          asked.body.approval_request_id,
          supervisor2.userId,
        ]);
        await definition.execute(db, {
          request: { operator_id: w.ops.a } as never,
          payload,
          requestedBy: supervisor.userId,
          approvedBy: supervisor2.userId,
        });
        const { rows: after } = await db.query(
          `SELECT current_setting('app.user_id', true) AS user_id,
                  current_setting('app.approved_by', true) AS approved_by,
                  current_setting('app.reason', true) AS reason,
                  (SELECT status FROM media WHERE id = $1) AS status`,
          [m.id],
        );
        // Conséquence concrète : dans la même transaction, une nouvelle mise en liste noire ne
        // peut pas être levée sans seconde personne (la base ne voit plus de valideur).
        await db.query(`UPDATE media SET status = 'BLACKLISTED' WHERE id = $1`, [m.id]);
        await db.query('SAVEPOINT second_exit');
        const secondExit = await db
          .query(`UPDATE media SET status = 'ACTIVE' WHERE id = $1`, [m.id])
          .then(
            () => null,
            (error: { code?: string }) => error.code,
          );
        await db.query('ROLLBACK TO SAVEPOINT second_exit');
        return { ...after[0], second_exit: secondExit };
      } finally {
        await db.query('ROLLBACK');
      }
    });
    expect(seen).toEqual({
      user_id: '',
      approved_by: '',
      reason: '',
      status: 'ACTIVE',
      second_exit: 'CL020',
    });
    expect(await status(m)).toBe('BLACKLISTED'); // transaction de test annulée
  });

  it('la base refuse auteur = valideur, même appelée directement', async () => {
    const m = await active();
    expect((await blacklist(supervisor, m)).status).toBe(200);
    const refused = withOwner(async (db) => {
      await db.query('SET ROLE cashless_app');
      try {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        await db.query('SELECT reinstate_media($1, $2, $2, $3)', [m.id, supervisor.userId, 'seul']);
      } finally {
        await db.query('RESET ROLE');
      }
    });
    await expect(refused).rejects.toMatchObject({ code: 'CL020' });
    expect(await status(m)).toBe('BLACKLISTED');
  });

  it('OP-N52, chemin nominal par l’API : la base trouve la demande approuvée concordante et remet en service', async () => {
    const m = await active();
    expect((await blacklist(supervisor, m)).status).toBe(200);
    const asked = await askReinstate(supervisor, m);
    expect(asked.status).toBe(202);
    const done = await approve(supervisor2, asked.body.approval_request_id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'EXECUTED', result: { status: 'ACTIVE' } });
    expect(
      await rows(
        `SELECT r.requested_by, r.decided_by, h.actor_id, h.approved_by
           FROM approval_request r
           JOIN media_status_history h ON h.media_id = r.target_id
          WHERE r.id = $1 AND h.from_status = 'BLACKLISTED' AND h.to_status = 'ACTIVE'`,
        [asked.body.approval_request_id],
      ),
    ).toEqual([
      {
        requested_by: supervisor.userId,
        decided_by: supervisor2.userId,
        actor_id: supervisor.userId,
        approved_by: supervisor2.userId,
      },
    ]);
  });

  it('OP-N52 : depuis la connexion de l’API, ni valideur inventé, ni demande non approuvée, ni UPDATE direct', async () => {
    const m = await active();
    expect((await blacklist(supervisor, m)).status).toBe(200);
    const asked = await askReinstate(supervisor, m);
    expect(asked.status).toBe(202);
    const asApp = (sql: string, params: unknown[], decide = false, withPeople = false) =>
      withOwner(async (db) => {
        await db.query('BEGIN');
        try {
          await db.query('SET LOCAL ROLE cashless_app');
          await db.query(`SELECT set_config('app.operator_id', $1, true)`, [w.ops.a]);
          if (decide) {
            await db.query('SELECT 1 FROM decide_approval_request($1, $2, true)', [
              asked.body.approval_request_id,
              supervisor2.userId,
            ]);
          }
          if (withPeople) {
            await db.query(
              `SELECT set_config('app.user_id', $1, true), set_config('app.approved_by', $2, true)`,
              [supervisor.userId, supervisor2.userId],
            );
          }
          await db.query(sql, params);
          return null;
        } catch (error) {
          return (error as { code?: string }).code;
        } finally {
          await db.query('ROLLBACK');
        }
      });
    const reinstate = 'SELECT reinstate_media($1, $2, $3, $4)';
    // Demande encore en attente : refus.
    expect(await asApp(reinstate, [m.id, supervisor.userId, supervisor2.userId, 'x'])).toBe('CL020');
    // Demande approuvée, mais valideur inventé à l'appel : refus.
    expect(await asApp(reinstate, [m.id, supervisor.userId, randomUUID(), 'x'], true)).toBe('CL020');
    // Demande approuvée par un valideur inventé : refus (personne inconnue du prestataire).
    const invented = withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query('SET LOCAL ROLE cashless_app');
        await db.query(`SELECT set_config('app.operator_id', $1, true)`, [w.ops.a]);
        const fake = randomUUID();
        await db.query('SELECT 1 FROM decide_approval_request($1, $2, true)', [
          asked.body.approval_request_id,
          fake,
        ]);
        await db.query(reinstate, [m.id, supervisor.userId, fake, 'x']);
      } finally {
        await db.query('ROLLBACK');
      }
    });
    await expect(invented).rejects.toMatchObject({ code: 'CL020' });
    // UPDATE direct, même avec la demande approuvée et les réglages posés : refus.
    expect(
      await asApp(`UPDATE media SET status = 'ACTIVE' WHERE id = $1`, [m.id], true, true),
    ).toBe('CL020');
    // Contrôle : dans les mêmes conditions, reinstate_media passe (le refus ci-dessus vient du chemin).
    expect(
      await asApp(reinstate, [m.id, supervisor.userId, supervisor2.userId, 'x'], true),
    ).toBeNull();
    // Demande inscrite déjà approuvée : refus à l'insertion.
    const forged = withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query('SET LOCAL ROLE cashless_app');
        await db.query(`SELECT set_config('app.operator_id', $1, true)`, [w.ops.a]);
        await db.query(
          `INSERT INTO approval_request (operator_id, action, target_id, payload, requested_by,
                                         status, decided_by, decided_at)
           VALUES ($1, 'REINSTATE_MEDIA', $2, '{}'::jsonb, $3, 'APPROVED', $4, now())`,
          [w.ops.a, m.id, supervisor.userId, supervisor2.userId],
        );
      } finally {
        await db.query('ROLLBACK');
      }
    });
    await expect(forged).rejects.toMatchObject({ code: 'CL023' });
    expect(await status(m)).toBe('BLACKLISTED');
  });

  it('passage non permis (bracelet remplacé) : 409 ; motif absent : 400 ; aucune route ne remet en service', async () => {
    const m = await active();
    await rows(`UPDATE media SET status = 'REPLACED', wallet_id = NULL WHERE id = $1`, [m.id]);
    const res = await blacklist(supervisor, m);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MEDIA_STATE_INVALID');
    const other = await active();
    expect((await post(supervisor, `${base(other)}/blacklist`, {})).status).toBe(400);
    expect(
      (await post(supervisor, `${base(other)}/blacklist`, { reason: 'x', extra: 1 })).status,
    ).toBe(400);
    // Les routes de la liste noire ne mènent qu'à BLACKLISTED ou à une demande
    // d'approbation.
    expect((await post(supervisor, `${base(other)}/reinstate`, { reason: 'x' })).status).toBe(404);
  });

  it('rôles et isolation à deux prestataires', async () => {
    const m = await active();
    for (const person of [cashier, w.operatorAdminA, w.organizerAdminA, w.personalizerA]) {
      expect((await blacklist(person, m)).status).toBe(403);
    }
    expect((await blacklist(outsider, m)).status).toBe(403);
    expect((await blacklist(supervisorB, m)).status).toBe(404);
    expect((await post(supervisorB, `${base(m, w.ops.b)}/blacklist`, { reason: 'x' })).status).toBe(
      404,
    );
    expect(await status(m)).toBe('ACTIVE');

    expect((await blacklist(supervisor, m)).status).toBe(200);
    expect((await askReinstate(outsider, m)).status).toBe(403);
    expect((await askReinstate(cashier, m)).status).toBe(403);
    const asked = await askReinstate(supervisor2, m);
    expect(asked.status).toBe(202);
    // Valideur d'un autre prestataire ou d'un autre organisateur : refusé, rien ne change.
    expect((await approve(supervisorB, asked.body.approval_request_id)).status).toBe(404);
    expect((await approve(outsider, asked.body.approval_request_id)).status).toBe(403);
    expect(await status(m)).toBe('BLACKLISTED');
  });
});
