// Jeu d'essai commun aux suites des lots de bracelets : deux prestataires, deux organisateurs chez A, un événement
// avec son grand livre, des clés de bracelet posées directement (leur création à deux est prouvée ailleurs), et les
// personnes de chaque rôle.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators, type Operators } from '../transverse/fixtures';

export const KEY = { shared: 1, dedicated: 2, inactive: 3, dedicatedOther: 4 } as const;

export interface BatchWorld {
  app: INestApplication;
  ops: Operators;
  ids: {
    a1: string;
    a2: string;
    b1: string;
    eventA1: string;
    eventA1bis: string;
    eventA2: string;
    ledgerA1: string;
    walletA1: string;
  };
  operatorAdmin: TestPerson; // OPERATOR_ADMIN de A
  orgAdmin: TestPerson; // ORGANIZER_ADMIN de a1
  otherOrgAdmin: TestPerson; // ORGANIZER_ADMIN de a2
  supervisor: TestPerson; // SUPERVISOR de l'organisateur a1
  eventCashier: TestPerson; // CASHIER de l'événement eventA1
  otherCashier: TestPerson; // CASHIER de l'organisateur a2
  orgAdminB: TestPerson; // ORGANIZER_ADMIN de b1 (prestataire B)
}

export const rows = <T>(sql: string, params: unknown[] = []) =>
  withOwner(async (db) => (await db.query(sql, params)).rows as T[]);

export async function createBatchWorld(): Promise<BatchWorld> {
  const idp = await FakeIdp.create();
  const ops = await createOperators();
  const ids = {
    a1: randomUUID(),
    a2: randomUUID(),
    b1: randomUUID(),
    eventA1: randomUUID(),
    eventA1bis: randomUUID(),
    eventA2: randomUUID(),
    ledgerA1: '',
    walletA1: randomUUID(),
  };
  const profile = randomUUID();
  const people = {} as Pick<
    BatchWorld,
    | 'operatorAdmin'
    | 'orgAdmin'
    | 'otherOrgAdmin'
    | 'supervisor'
    | 'eventCashier'
    | 'otherCashier'
    | 'orgAdminB'
  >;
  await withOwner(async (db) => {
    await db.query(
      `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
    );
    await db.query(
      `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
         ($1, 'ORGANIZER', $4, 'Organisateur A1', 'SN'), ($2, 'ORGANIZER', $4, 'Organisateur A2', 'SN'), ($3, 'ORGANIZER', $5, 'Organisateur B1', 'SN')`,
      [ids.a1, ids.a2, ids.b1, ops.a, ops.b],
    );
    await db.query(
      `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
      [profile],
    );
    await db.query(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder) VALUES
         ($1, $4, $5, 'Événement A1', 'XOF', 'Africa/Dakar', $7, 'ORGANIZER'), ($2, $4, $5, 'Événement A1 bis', 'XOF', 'Africa/Dakar', $7, 'ORGANIZER'),
         ($3, $4, $6, 'Événement A2', 'XOF', 'Africa/Dakar', $7, 'ORGANIZER')`,
      [ids.eventA1, ids.eventA1bis, ids.eventA2, ops.a, ids.a1, ids.a2, profile],
    );
    await db.query(`SELECT set_config('app.operator_id', $1, false)`, [ops.a]);
    ids.ledgerA1 = (
      await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [ids.eventA1])
    ).rows[0]!.ledger;
    await db.query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
      ids.walletA1,
      ops.a,
      ids.ledgerA1,
    ]);
    await db.query(
      `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side, allow_negative) VALUES ($1, $2, 'L-WAL-TEST-PROMO', 'CLAIM', 'WALLET_PROMO', $3, 'C', false)`,
      [ops.a, ids.ledgerA1, ids.walletA1],
    );
    await db.query(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref, status, scope, dedicated_event_id) VALUES
         ($1, ${KEY.shared}, 'fake-kms:hmac:a-1', 'ACTIVE', 'SHARED', NULL), ($1, ${KEY.dedicated}, 'fake-kms:hmac:a-2', 'ACTIVE', 'DEDICATED', $3),
         ($1, ${KEY.inactive}, 'fake-kms:hmac:a-3', 'DECRYPT_ONLY', 'SHARED', NULL), ($1, ${KEY.dedicatedOther}, 'fake-kms:hmac:a-4', 'ACTIVE', 'DEDICATED', $4),
         ($2, ${KEY.shared}, 'fake-kms:hmac:b-1', 'ACTIVE', 'SHARED', NULL)`,
      [ops.a, ops.b, ids.eventA1, ids.eventA1bis],
    );
    const person = (operatorId: string, roles: Parameters<FakeIdp['createPerson']>[1]['roles']) =>
      idp.createPerson(db, { operatorId, roles });
    people.operatorAdmin = await person(ops.a, [
      { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a },
    ]);
    people.orgAdmin = await person(ops.a, [
      { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a1 },
    ]);
    people.otherOrgAdmin = await person(ops.a, [
      { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.a2 },
    ]);
    people.supervisor = await person(ops.a, [
      { role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: ids.a1 },
    ]);
    people.eventCashier = await person(ops.a, [
      { role: 'CASHIER', scopeType: 'EVENT', scopeId: ids.eventA1 },
    ]);
    people.otherCashier = await person(ops.a, [
      { role: 'CASHIER', scopeType: 'ORGANIZER', scopeId: ids.a2 },
    ]);
    people.orgAdminB = await person(ops.b, [
      { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.b1 },
    ]);
  });
  const app = await createTestApp({ identity: idp });
  return { app, ops, ids, ...people };
}

export function client(world: Pick<BatchWorld, 'app'>) {
  const http = () => request(world.app.getHttpServer());
  const send = (
    method: 'post' | 'patch',
    who: TestPerson,
    path: string,
    body: object | undefined,
    key: string,
    language?: string,
  ) => {
    let req = http()
      [method](path)
      .set('Authorization', `Bearer ${who.token}`)
      .set('Idempotency-Key', key);
    if (language) req = req.set('Accept-Language', language);
    return req.send(body);
  };
  return {
    get: (who: TestPerson, path: string) =>
      http().get(path).set('Authorization', `Bearer ${who.token}`),
    post: (
      who: TestPerson,
      path: string,
      body: object = {},
      key: string = randomUUID(),
      language?: string,
    ) => send('post', who, path, body, key, language),
    patch: (
      who: TestPerson,
      path: string,
      body: object = {},
      key: string = randomUUID(),
      language?: string,
    ) => send('patch', who, path, body, key, language),
    csv: (who: TestPerson, path: string, text: string, key: string = randomUUID()) =>
      http()
        .post(path)
        .set('Authorization', `Bearer ${who.token}`)
        .set('Idempotency-Key', key)
        .set('Content-Type', 'text/csv')
        .send(text),
  };
}

export interface SeedOptions {
  status?: 'PERSONALIZED' | 'ISSUED' | 'ACTIVE';
  walletId?: string;
  depositHeld?: number;
}

/** Bracelets posés directement dans un lot (leur personnalisation est prouvée ailleurs) ; rend leurs UID en hexadécimal. */
export async function seedMedia(
  db: Client,
  operatorId: string,
  batchId: string,
  keyIndex: number,
  count: number,
  options: SeedOptions = {},
): Promise<{ id: string; uid: string }[]> {
  const media = Array.from({ length: count }, () => ({
    id: randomUUID(),
    uid: Buffer.concat([Buffer.from([0x04]), randomBytes(6)]),
  }));
  await db.query(
    `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, key_index, batch_id, status, wallet_id, deposit_status, deposit_held)
     SELECT m.id, $1, 'NFC_TAG', m.token_hash, m.uid, $2, $3, $4, $5, $6, $7
       FROM unnest($8::uuid[], $9::bytea[], $10::bytea[]) AS m(id, token_hash, uid)`,
    [
      operatorId,
      keyIndex,
      batchId,
      options.status ?? 'PERSONALIZED',
      options.walletId ?? null,
      options.depositHeld ? 'HELD' : 'NONE',
      options.depositHeld ?? 0,
      media.map((m) => m.id),
      media.map((m) => createHash('sha256').update(m.id).digest()),
      media.map((m) => m.uid),
    ],
  );
  return media.map((m) => ({ id: m.id, uid: m.uid.toString('hex').toUpperCase() }));
}
