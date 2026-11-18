// Monde de test des relevés et de l'export (WP13) : le festival de référence construit PAR LES ROUTES (fixture de la
// mission configuration), rejoué EN ENTIER par le moteur (T1 à T48, comme `api-config-replay.spec.ts`), plus les
// personnes dont les tests ont besoin (commerçants, superviseur, caissier, autre organisateur, autre prestataire).
// Même mécanique que `closing-world.ts` (WP07), reprise ici parce que le faux serveur d'identité n'y est pas exposé.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import request from 'supertest';
import type { Role, ScopeType } from '../../../src/identity/principal';
import { TenantTx } from '../../../src/db/tenant-tx';
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import type { EventStatus } from '../../../src/ledger/status-matrix';
import { createApiConfigFixture, type ApiConfigFixture } from '../../scenario/api-config-fixture';
import { STEPS, type ScenarioStep } from '../../scenario/commands';
import { MERCHANTS, type MerchantKey } from '../../scenario/fixture';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { scenario } from '../../unit/builders/support/scenario-lines';

interface Expected {
  after_festival: { after_tx: number; balances: Record<string, number> };
  after_closing: { after_tx: number; balances: Record<string, number> };
}
export const expected = (scenario as unknown as { expected: Expected }).expected;

export interface StatementsWorld {
  app: INestApplication;
  idp: FakeIdp;
  fx: ApiConfigFixture;
  owner<T extends QueryResultRow>(sql: string, values?: unknown[]): Promise<T[]>;
  people: {
    merchantFood: TestPerson;
    merchantTee: TestPerson;
    supervisor: TestPerson;
    cashier: TestPerson;
    foreignOrganizer: TestPerson;
    foreignOperator: TestPerson;
    foreignOperatorEventId: string;
    foreignOperatorId: string;
  };
  /** `/v1/operators/<prestataire>/events/<événement>` + chemin. */
  eventPath(path: string, operatorId?: string): string;
  get(path: string, token?: string): request.Test;
  post(path: string, token?: string): request.Test;
  /** Menée par le moteur jusqu'à la transaction `to` (T1 à T48), avec les passages de statut. */
  replayTo(to: number): Promise<void>;
  /** Soldes du grand livre par code du scénario (comptes des commerçants par leur clé). */
  balances(): Promise<Record<string, bigint>>;
  counts(): Promise<{ transactions: number; postings: number }>;
  close(): Promise<void>;
}

export async function createStatementsWorld(): Promise<StatementsWorld> {
  const idp = await FakeIdp.create();
  const app = await createTestApp({ identity: idp });
  const fx = await createApiConfigFixture(app, idp);
  const engine = app.get(LedgerEngineService);
  const tx = app.get(TenantTx);
  const owner = <T extends QueryResultRow>(sql: string, values: unknown[] = []) =>
    withOwner(async (db) => (await db.query<T>(sql, values)).rows);
  const http = () => request(app.getHttpServer());
  const op = fx.parties.OPE;

  // Six bracelets activés (« Nombre de bracelets activés » du scénario), comme `closing-world.ts`.
  await withOwner(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM media_batch WHERE event_id = $1 LIMIT 1',
      [fx.eventId],
    );
    for (const key of ['W01', 'W02', 'W03', 'W06'] as const)
      await db.query(
        `INSERT INTO media (operator_id, kind, token_hash, batch_id, wallet_id, status)
         VALUES ($1, 'NFC_TAG', $2, $3, $4, 'ACTIVE')`,
        [op, randomBytes(32), rows[0]!.id, fx.wallets[key]],
      );
  });

  const setStatus = async (status: EventStatus) => {
    try {
      await tx.run(op, (client) =>
        client.query('SELECT set_event_status($1, $2, $3)', [fx.eventId, status, fx.users.author]),
      );
    } catch (error) {
      const e = error as { code?: string; message?: string };
      throw new Error(`passage ${status} refusé (${e.code}) : ${e.message}`);
    }
  };
  const execute = async (s: ScenarioStep) => {
    const command = await s.command(fx, async (key) => {
      const [row] = await owner<{ id: string }>(
        'SELECT id FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2',
        [fx.ledgerId, key],
      );
      return row!.id;
    });
    if (command.type === 'TOPUP') {
      const channel = (command.payload as { channel: keyof typeof fx.pspConfigurations }).channel;
      command.metadata = {
        ...command.metadata,
        psp_configuration_id: fx.pspConfigurations[channel],
      };
    }
    try {
      return await tx.run(op, (client) => engine.execute(client, command));
    } catch (error) {
      const e = error as { code?: string; detail?: string; message?: string };
      throw new Error(`T${s.no} refusée : ${e.code ?? ''} ${e.detail ?? e.message ?? ''}`);
    }
  };
  const closeCashSessions = () =>
    withOwner(async (db) => {
      await db.query('ALTER TABLE cash_session DISABLE TRIGGER USER');
      try {
        await db.query(
          `UPDATE cash_session SET status = 'CLOSED', closed_at = now(), counted_amount = 0,
                  expected_amount = 0, closed_by = opened_by,
                  close_tx_id = (SELECT id FROM journal_transaction WHERE ledger_id = $1 AND type = 'CASH_CLOSE' LIMIT 1)
            WHERE event_id = $2`,
          [fx.ledgerId, fx.eventId],
        );
      } finally {
        await db.query('ALTER TABLE cash_session ENABLE TRIGGER USER');
      }
    });
  const reconcilePsp = () =>
    owner(
      `INSERT INTO statement_import (operator_id, ledger_id, account_id, source, file_sha256, statement_date,
                                    closing_balance, currency, imported_by, lines_created, lines_existing, lines_matched)
       SELECT $1, $2, a.id, 'test', md5(a.id::text) || md5(a.code), current_date + 1,
              (SELECT coalesce(sum(p.amount), 0) FROM posting p WHERE p.account_id = a.id), 'XOF', $3, 0, 0, 0
         FROM account a WHERE a.ledger_id = $2 AND a.code LIKE 'A-PSP-%'
           AND EXISTS (SELECT 1 FROM posting p WHERE p.account_id = a.id)`,
      [op, fx.ledgerId, fx.users.author],
    );
  /** Étapes de clôture faites par les routes (T30 à T32, puis T43 à T45) : elles alimentent `closing_step`. */
  const closingSteps: Record<number, string[]> = {
    30: ['PITCH_FEES', 'OPERATOR_FEE', 'PLATFORM_FEE'],
    43: ['OPERATOR_FEE_REGULARIZATION', 'BREAKAGE', 'DEPOSIT_FORFEIT', 'PROMO_EXPIRY'],
  };
  const byRoutes = (no: number) => no === 31 || no === 32 || no === 44 || no === 45;
  let done = 0;
  const replayTo = async (to: number) => {
    for (const s of STEPS.filter((x) => x.no > done && x.no <= to)) {
      if (s.no === 30) {
        await reconcilePsp();
        await setStatus('SETTLING');
      }
      if (byRoutes(s.no)) {
        done = s.no;
        continue;
      }
      if (s.no === 41) {
        await setStatus('REFUND_WINDOW');
        await owner(
          `UPDATE event SET refund_deadline = clock_timestamp() - interval '1 minute' WHERE id = $1`,
          [fx.eventId],
        );
      }
      for (const status of s.statusBefore ?? []) {
        if (status === 'SETTLING' || status === 'REFUND_WINDOW') continue;
        if (status === 'RECONCILING') await closeCashSessions();
        await setStatus(status);
      }
      const steps = closingSteps[s.no];
      if (steps) {
        for (const step of steps) {
          const res = await http()
            .post(`/v1/operators/${op}/events/${fx.eventId}/closing-steps/${step}`)
            .set('Authorization', `Bearer ${fx.people.operatorAdmin.token}`)
            .set('Idempotency-Key', randomUUID());
          if (res.status !== 200) throw new Error(`étape ${step} : ${res.status} ${res.text}`);
        }
      } else await execute(s);
      done = s.no;
    }
  };

  const person = (
    operatorId: string | null,
    roles: { role: Role; scopeType: ScopeType; scopeId?: string | null }[],
  ) => withOwner((db) => idp.createPerson(db, { operatorId, roles }));
  const merchantFood = await person(op, [
    { role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: fx.parties.FOOD },
  ]);
  const merchantTee = await person(op, [
    { role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: fx.parties.TEE },
  ]);
  const supervisor = await person(op, [
    { role: 'SUPERVISOR', scopeType: 'ORGANIZER', scopeId: fx.parties.ORG },
  ]);
  const cashier = await person(op, [{ role: 'CASHIER', scopeType: 'EVENT', scopeId: fx.eventId }]);
  const foreignOrganizer = await withOwner(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO party (kind, operator_id, legal_name, country_code)
       VALUES ('ORGANIZER', $1, $2, 'AA') RETURNING id`,
      [op, `Autre organisateur ${randomUUID()}`],
    );
    return idp.createPerson(db, {
      operatorId: op,
      roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: rows[0]!.id }],
    });
  });
  // Autre prestataire : son administrateur, et un événement à lui (grand livre ouvert).
  let foreignOperatorEventId = '';
  let foreignOperatorId = '';
  const foreignOperator = await withOwner(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO party (kind, legal_name) VALUES ('OPERATOR', $1) RETURNING id`,
      [`Autre prestataire ${randomUUID()}`],
    );
    const other = rows[0]!.id;
    foreignOperatorId = other;
    const org = await db.query<{ id: string }>(
      `INSERT INTO party (kind, operator_id, legal_name, country_code)
       VALUES ('ORGANIZER', $1, $2, 'AA') RETURNING id`,
      [other, `Organisateur étranger ${randomUUID()}`],
    );
    const ev = await db.query<{ id: string }>(
      `INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
       SELECT $1, $2, 'Événement étranger', 'XOF', 'Africa/Dakar', $3, 'ORGANIZER'
       RETURNING id`,
      [other, org.rows[0]!.id, fx.jurisdictionId],
    );
    foreignOperatorEventId = ev.rows[0]!.id;
    return idp.createPerson(db, {
      operatorId: other,
      roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: other }],
    });
  });

  const balances = async (): Promise<Record<string, bigint>> => {
    const byParticipation = new Map<string, MerchantKey>(
      MERCHANTS.map((key) => [`L-MCH-${fx.participations[key]}`, key]),
    );
    const rows = await owner<{ code: string; b: string }>(
      'SELECT code, signed_balance::text AS b FROM trial_balance WHERE ledger_id = $1',
      [fx.ledgerId],
    );
    return Object.fromEntries(
      rows.map((row) => {
        const key = byParticipation.get(row.code);
        return [key ? `L-MCH-${key}` : row.code, BigInt(row.b)];
      }),
    );
  };

  return {
    app,
    idp,
    fx,
    owner,
    people: {
      merchantFood,
      merchantTee,
      supervisor,
      cashier,
      foreignOrganizer,
      foreignOperator,
      foreignOperatorEventId,
      foreignOperatorId,
    },
    eventPath: (path, operatorId = op) => `/v1/operators/${operatorId}/events/${fx.eventId}${path}`,
    get: (path, token = fx.people.operatorAdmin.token) =>
      http()
        .get(path.startsWith('/v1') ? path : `/v1${path}`)
        .set('Authorization', `Bearer ${token}`),
    post: (path, token = fx.people.operatorAdmin.token) =>
      http()
        .post(path.startsWith('/v1') ? path : `/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID()),
    replayTo,
    balances,
    async counts() {
      const [row] = await owner<{ transactions: number; postings: number }>(
        `SELECT (SELECT count(*)::int FROM journal_transaction WHERE ledger_id = $1) AS transactions,
                (SELECT count(*)::int FROM posting WHERE ledger_id = $1) AS postings`,
        [fx.ledgerId],
      );
      return row!;
    },
    async close() {
      await app.close();
    },
  };
}
