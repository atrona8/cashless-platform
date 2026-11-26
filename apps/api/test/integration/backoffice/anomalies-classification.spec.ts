// Classement des anomalies `POST /anomalies/{anomaly_id}/classification` (mission routes-backoffice 11b, WP07 ;
// FR-009, FR-010, C-002, SC-004). Aucune écriture au grand livre ; la base décide du type classable ; l'auteur est
// toujours la personne de la session. Les anomalies sont posées par le rôle propriétaire du test (INSERT direct,
// jeu d'essai : le chemin applicatif qui les crée est testé par les missions qui les produisent).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { APP_URL, connect, withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';

jest.setTimeout(300_000);

/** Les 10 types classables de D1. */
const CLASSIFIABLE = [
  'CASH_DIFF',
  'CLOCK_SKEW',
  'CARD_VELOCITY',
  'IDEMPOTENCY_CONFLICT',
  'CHAIN_BROKEN',
  'COUNTER_DUPLICATE',
  'COUNTER_TIME_INVERSION',
  'UID_MISMATCH',
  'RETIRED_IDENTITY',
  'SIGNATURE_MISMATCH',
];

describe('POST /anomalies/{anomaly_id}/classification', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let organizerA2: string;
  let eventA2: string;
  let ledgerA2: string;
  let organizerAdminA2: TestPerson;
  let operatorAdminB: TestPerson;
  let mediaA: string;

  const classify = (
    person: TestPerson,
    anomaly: string,
    body: unknown = { reason: 'Vérifié sur place' },
    key: string = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post(`/v1/anomalies/${anomaly}/classification`)
      .set('Authorization', `Bearer ${person.token}`)
      .set('Idempotency-Key', key)
      .send(body as object);

  const owner = <T>(sql: string, params: unknown[] = []) =>
    withOwner(async (db) => (await db.query(sql, params)).rows as T[]);

  const make = async (
    kind: string,
    options: { operator?: string; ledger?: string | null; media?: string | null } = {},
  ): Promise<string> => {
    const id = randomUUID();
    const ledger = options.ledger === undefined ? w.ids.ledgerA : options.ledger;
    await owner(
      `INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, media_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        options.operator ?? w.ops.a,
        ledger,
        kind,
        ledger === null ? 0 : 1500,
        options.media ?? null,
      ],
    );
    return id;
  };

  /** Ce qui ne doit jamais bouger au classement : écritures du grand livre de A. */
  const ledgerState = async (ledger: string) =>
    (
      await owner<{ tx: string; postings: string; resolved_tx: string }>(
        `SELECT (SELECT count(*) FROM journal_transaction WHERE ledger_id = $1)::text AS tx,
                (SELECT count(*) FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
                  WHERE t.ledger_id = $1)::text AS postings,
                (SELECT count(*) FROM anomaly WHERE ledger_id = $1 AND resolution_tx_id IS NOT NULL)::text
                  AS resolved_tx`,
        [ledger],
      )
    )[0]!;

  const row = async (id: string) =>
    (
      await owner<{
        status: string;
        classified_by: string | null;
        classification_reason: string | null;
        resolution_tx_id: string | null;
      }>(
        'SELECT status, classified_by, classification_reason, resolution_tx_id FROM anomaly WHERE id = $1',
        [id],
      )
    )[0]!;

  const audits = (anomaly: string) =>
    owner<{ actor_id: string; actor_role: string; operator_id: string; after: { kind: string } }>(
      `SELECT actor_id, actor_role, operator_id, after FROM audit_log
        WHERE action = 'ANOMALY_CLASSIFIED' AND object_id = $1`,
      [anomaly],
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    organizerA2 = randomUUID();
    eventA2 = randomUUID();
    mediaA = randomUUID();
    await withOwner(async (db: Client) => {
      const profile = (
        await db.query<{ id: string }>('SELECT id FROM jurisdiction_profile LIMIT 1')
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
         VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
        [organizerA2, w.ops.a],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         VALUES ($1, $2, $3, 'Événement A2', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [eventA2, w.ops.a, organizerA2, profile],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      ledgerA2 = (
        await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventA2])
      ).rows[0]!.ledger;
      await db.query(
        `INSERT INTO media (id, operator_id, kind, token_hash) VALUES ($1, $2, 'CARD', $3)`,
        [mediaA, w.ops.a, Buffer.from(randomUUID().replace(/-/g, '').padEnd(64, '0'), 'hex')],
      );
      organizerAdminA2 = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: organizerA2 }],
      });
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(CLASSIFIABLE)(
    'type classable %s : 200, traitée, classement rempli, grand livre intact',
    async (kind) => {
      const id = await make(kind);
      const before = await ledgerState(w.ids.ledgerA);
      const res = await classify(w.operatorAdminA, id, { reason: `  Contrôlé : ${kind}  ` });
      expect(res.status).toBe(200);
      expect(contractViolations('Anomaly', res.body)).toEqual([]);
      expect(res.body).toMatchObject({
        anomaly_id: id,
        kind,
        status: 'RESOLVED',
        classifiable: true,
        classification: { reason: `Contrôlé : ${kind}`, classified_by: w.operatorAdminA.userId },
      });
      const stored = await row(id);
      expect(stored).toMatchObject({
        status: 'RESOLVED',
        classified_by: w.operatorAdminA.userId,
        resolution_tx_id: null,
      });
      // C-002, SC-004 : aucune écriture du grand livre (ni transaction, ni posting, ni résolution).
      expect(await ledgerState(w.ids.ledgerA)).toEqual(before);
      const log = await audits(id);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        actor_id: w.operatorAdminA.userId,
        actor_role: 'OPERATOR_ADMIN',
        operator_id: w.ops.a,
      });
      expect(log[0]!.after.kind).toBe(kind);
    },
  );

  it.each(['OFFLINE_SHORTFALL', 'PSP_TOPUP_NOT_CREDITED', 'CASH_TOPUP_OVER_LIMIT'])(
    'type non classable %s : 422 avec le motif prévu, anomalie inchangée, rien d’audité',
    async (kind) => {
      const id = await make(kind, kind === 'CASH_TOPUP_OVER_LIMIT' ? { media: mediaA } : {});
      const before = await ledgerState(w.ids.ledgerA);
      const res = await classify(w.operatorAdminA, id);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.reason).toBe('ANOMALY_KIND_NOT_CLASSIFIABLE');
      expect(await row(id)).toMatchObject({ status: 'OPEN', classified_by: null });
      expect(await audits(id)).toHaveLength(0);
      expect(await ledgerState(w.ids.ledgerA)).toEqual(before);
    },
  );

  it('deuxième classement : 409 CONFLICT_STATE, premier motif conservé', async () => {
    const id = await make('CASH_DIFF');
    expect((await classify(w.operatorAdminA, id, { reason: 'Premier' })).status).toBe(200);
    const second = await classify(w.operatorAdminA, id, { reason: 'Second' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('CONFLICT_STATE');
    expect((await row(id)).classification_reason).toBe('Premier');
    expect(await audits(id)).toHaveLength(1);
  });

  it('une anomalie déjà close (RESOLVED sans classement) : 409', async () => {
    const id = await make('CLOCK_SKEW');
    await owner(`UPDATE anomaly SET status = 'RESOLVED' WHERE id = $1`, [id]);
    expect((await classify(w.operatorAdminA, id)).status).toBe(409);
  });

  it('rejeu de la même clé : même réponse, un seul classement, une seule ligne d’audit', async () => {
    const id = await make('CARD_VELOCITY');
    const key = randomUUID();
    const first = await classify(w.operatorAdminA, id, { reason: 'Une fois' }, key);
    const replay = await classify(w.operatorAdminA, id, { reason: 'Une fois' }, key);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await audits(id)).toHaveLength(1);
    const reused = await classify(w.operatorAdminA, id, { reason: 'Autre motif' }, key);
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('sans Idempotency-Key : refusé, anomalie inchangée', async () => {
    const id = await make('CASH_DIFF');
    const res = await request(app.getHttpServer())
      .post(`/v1/anomalies/${id}/classification`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`)
      .send({ reason: 'x' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await row(id)).status).toBe('OPEN');
  });

  it('motif vide, blanc, de 501 caractères, absent, mal typé, champ en trop : 422, anomalie inchangée', async () => {
    const id = await make('CASH_DIFF');
    for (const body of [
      { reason: '' },
      { reason: '   ' },
      { reason: 'x'.repeat(501) },
      {},
      { reason: 12 },
      { reason: 'ok', classified_by: w.cashierA.userId },
      { reason: 'ok', status: 'RESOLVED' },
    ]) {
      const res = await classify(w.operatorAdminA, id, body);
      expect({ body, status: res.status }).toEqual({ body, status: 422 });
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect((await classify(w.operatorAdminA, id, { reason: 'x'.repeat(500) })).status).toBe(200);
    expect(await row(id)).toMatchObject({ status: 'RESOLVED' });
  });

  it('l’auteur est toujours la personne de la session (OPERATOR_ADMIN, puis ORGANIZER_ADMIN)', async () => {
    const byOperator = await make('UID_MISMATCH');
    const byOrganizer = await make('RETIRED_IDENTITY');
    expect((await classify(w.operatorAdminA, byOperator)).status).toBe(200);
    expect((await classify(w.organizerAdminA, byOrganizer)).status).toBe(200);
    expect((await row(byOperator)).classified_by).toBe(w.operatorAdminA.userId);
    expect((await row(byOrganizer)).classified_by).toBe(w.organizerAdminA.userId);
    expect((await audits(byOrganizer))[0]).toMatchObject({
      actor_id: w.organizerAdminA.userId,
      actor_role: 'ORGANIZER_ADMIN',
    });
    // Aucun moyen de désigner un autre auteur : le corps, l'en-tête ou la chaîne de requête n'y changent rien.
    const forged = await make('SIGNATURE_MISMATCH');
    const res = await request(app.getHttpServer())
      .post(`/v1/anomalies/${forged}/classification?classified_by=${w.cashierA.userId}`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`)
      .set('Idempotency-Key', randomUUID())
      .set('X-Actor-Id', w.cashierA.userId)
      .send({ reason: 'ok' });
    expect(res.status).toBe(200);
    expect((await row(forged)).classified_by).toBe(w.operatorAdminA.userId);
  });

  it('portée : autre prestataire et autre organisateur : 404 identique, rien de modifié', async () => {
    const own = await make('CASH_DIFF');
    const ofB = await make('CASH_DIFF', { operator: w.ops.b, ledger: null });
    const missing = randomUUID();
    const foreign = await classify(operatorAdminB, own);
    const absent = await classify(operatorAdminB, missing);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({
      ...absent.body,
      instance: foreign.body.instance,
      request_id: foreign.body.request_id,
    });
    expect((await classify(w.operatorAdminA, ofB)).status).toBe(404);
    expect((await classify(organizerAdminA2, own)).status).toBe(404);
    expect((await classify(w.operatorAdminA, 'pas-un-uuid')).status).toBe(404);
    for (const id of [own, ofB]) expect((await row(id)).status).toBe('OPEN');
    // Son propre organisateur : possible.
    const mine = await make('CASH_DIFF', { ledger: ledgerA2 });
    expect((await classify(organizerAdminA2, mine)).status).toBe(200);
  });

  it('anomalie sans grand livre (F3) : OPERATOR_ADMIN la classe ; ORGANIZER_ADMIN reçoit 404', async () => {
    const id = await make('UID_MISMATCH', { ledger: null });
    for (const organizer of [w.organizerAdminA, organizerAdminA2]) {
      expect((await classify(organizer, id)).status).toBe(404);
    }
    expect((await row(id)).status).toBe('OPEN');
    const res = await classify(w.operatorAdminA, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      event_id: null,
      amount: null,
      currency: null,
      status: 'RESOLVED',
    });
    expect(contractViolations('Anomaly', res.body)).toEqual([]);
  });

  it('rôles : CASHIER, SUPERVISOR, PLATFORM_ADMIN : 403 ; sans jeton : 401', async () => {
    const id = await make('CASH_DIFF');
    for (const person of [w.cashierA, w.supervisorA, w.platformAdmin])
      expect((await classify(person, id)).status).toBe(403);
    const anonymous = await request(app.getHttpServer())
      .post(`/v1/anomalies/${id}/classification`)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'x' });
    expect(anonymous.status).toBe(401);
    expect((await row(id)).status).toBe('OPEN');
  });

  describe('D4 : plus de clôture directe par l’application', () => {
    const asApp = async <T>(fn: (db: Client) => Promise<T>): Promise<T> => {
      const db = await connect(APP_URL);
      try {
        await db.query('BEGIN');
        await db.query(`SELECT set_config('app.operator_id', $1, true)`, [w.ops.a]);
        return await fn(db);
      } finally {
        await db.query('ROLLBACK').catch(() => undefined);
        await db.end();
      }
    };

    it('cashless_app ne peut plus faire UPDATE anomaly SET status / resolution_tx_id', async () => {
      const id = await make('CASH_DIFF');
      await expect(
        asApp((db) => db.query(`UPDATE anomaly SET status = 'RESOLVED' WHERE id = $1`, [id])),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asApp((db) => db.query(`UPDATE anomaly SET resolution_tx_id = NULL WHERE id = $1`, [id])),
      ).rejects.toMatchObject({ code: '42501' });
      expect((await row(id)).status).toBe('OPEN');
    });

    it('cashless_app ne classe pas non plus une anomalie d’argent, et classify_anomaly refuse un autre prestataire', async () => {
      const money = await make('OFFLINE_SHORTFALL');
      await expect(
        asApp((db) =>
          db.query('SELECT classify_anomaly($1::uuid, $2, $3::uuid)', [
            money,
            'x',
            w.operatorAdminA.userId,
          ]),
        ),
      ).rejects.toMatchObject({ code: 'CL067' });
      const other = await make('CASH_DIFF', { operator: w.ops.b, ledger: null });
      await expect(
        asApp((db) =>
          db.query('SELECT classify_anomaly($1::uuid, $2, $3::uuid)', [
            other,
            'x',
            w.operatorAdminA.userId,
          ]),
        ),
      ).rejects.toMatchObject({ code: 'CL066' });
    });

    it('waive_seq_gap clôt toujours un SEQ_GAP (fonction habilitée)', async () => {
      const ids = await withOwner(async (db) => {
        const device = randomUUID();
        const op = w.ops.a;
        await db.query(
          `INSERT INTO device (id, operator_id, serial, status, kind, event_id, last_seq, contiguous_acked_seq)
           VALUES ($1, $2, $3, 'ACTIVE', 'POS', $4, 5, 0)`,
          [device, op, `serial-${randomUUID()}`, w.ids.eventA],
        );
        const gap = randomUUID();
        await db.query(
          `INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount, device_id, seq)
           VALUES ($1, $2, $3, 'SEQ_GAP', 0, $4, 3)`,
          [gap, op, w.ids.ledgerA, device],
        );
        return { device, gap };
      });
      await asApp(async (db) => {
        await db.query('SELECT waive_seq_gap($1::uuid, 3, $2::uuid, $3::uuid, $4)', [
          ids.device,
          w.operatorAdminA.userId,
          w.organizerAdminA.userId,
          'journal perdu',
        ]);
        const { rows } = await db.query<{ status: string }>(
          'SELECT status FROM anomaly WHERE id = $1',
          [ids.gap],
        );
        expect(rows[0]!.status).toBe('RESOLVED');
      });
    });
  });
});
