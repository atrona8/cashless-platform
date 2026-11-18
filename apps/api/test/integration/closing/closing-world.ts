// Monde de test des étapes de clôture (WP07) : le festival de référence construit PAR LES ROUTES (fixture de la
// mission configuration), rejoué par le moteur jusqu'aux étapes de clôture, puis les routes 1 à 4 appelées en HTTP.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import request from 'supertest';
import { TenantTx } from '../../../src/db/tenant-tx';
import type { LedgerCommand } from '../../../src/ledger/types';
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import type { EventStatus } from '../../../src/ledger/status-matrix';
import { createApiConfigFixture, type ApiConfigFixture } from '../../scenario/api-config-fixture';
import { STEPS, type ScenarioStep } from '../../scenario/commands';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp } from '../../support/fake-idp';

export interface ClosingWorld {
  app: INestApplication;
  fx: ApiConfigFixture;
  owner<T extends QueryResultRow>(sql: string, values?: unknown[]): Promise<T[]>;
  /** Rejoue les transactions du scénario n° from à to par le moteur. */
  replay(from: number, to: number): Promise<void>;
  setStatus(status: EventStatus): Promise<void>;
  /** Mène l'événement à SETTLING (T1 à T29, session de caisse fermée, relevés PSP en accord). */
  toSettling(): Promise<void>;
  /** Relevés PSP en accord puis passage à SETTLING (T1 à T29 déjà rejouées). */
  settle(): Promise<void>;
  /** Personne ORGANIZER_ADMIN d'un autre organisateur du même prestataire (jeton). */
  stranger(): Promise<string>;
  /** Versements T33 à T40 (droits soldés) puis REFUND_WINDOW ; les étapes 1 à 3 doivent être faites. */
  enterRefundWindow(): Promise<void>;
  /** Échéance atteinte, remboursements T41 et T42 faits. */
  afterDeadline(): Promise<void>;
  /** Désactive les déclencheurs utilisateur de `table` le temps de `sql` (propriétaire, réglage de fixture). */
  tamper(table: string, sql: string, values?: unknown[]): Promise<void>;
  /** Verse et confirme les droits nets restants de l'organisateur et du prestataire (comme T46 à T48). */
  payOutRemaining(): Promise<void>;
  /** Jeton d'un OPERATOR_ADMIN d'un autre prestataire. */
  foreignOperator(): Promise<string>;
  /** enterRefundWindow puis afterDeadline. */
  toRefundWindow(): Promise<void>;
  /** Nombre de transactions écrites par les étapes (clés `closing:*`) et de transactions en tout. */
  counts(): Promise<{ closing: number; total: number }>;
  get(path: string, token?: string): request.Test;
  post(path: string, token?: string, key?: string): request.Test;
  base: string;
  close(): Promise<void>;
}

export async function createClosingWorld(): Promise<ClosingWorld> {
  const idp = await FakeIdp.create();
  const app = await createTestApp({ identity: idp });
  const fx = await createApiConfigFixture(app, idp);
  // Six bracelets activés (« Nombre de bracelets activés » du scénario) : W04 et W05 en ont déjà un (fixture),
  // les quatre autres portefeuilles reçoivent le leur, rattaché comme le fait l'activation.
  await withOwner(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM media_batch WHERE event_id = $1 LIMIT 1',
      [fx.eventId],
    );
    for (const key of ['W01', 'W02', 'W03', 'W06'] as const)
      await db.query(
        `INSERT INTO media (operator_id, kind, token_hash, batch_id, wallet_id, status)
         VALUES ($1, 'NFC_TAG', $2, $3, $4, 'ACTIVE')`,
        [fx.parties.OPE, randomBytes(32), rows[0]!.id, fx.wallets[key]],
      );
  });
  const engine = app.get(LedgerEngineService);
  const tx = app.get(TenantTx);
  const owner = <T extends QueryResultRow>(sql: string, values: unknown[] = []) =>
    withOwner(async (db) => (await db.query<T>(sql, values)).rows);
  const base = `/v1/operators/${fx.parties.OPE}/events/${fx.eventId}`;
  const http = () => request(app.getHttpServer());

  const setStatus = async (status: EventStatus) => {
    try {
      await tx.run(fx.parties.OPE, (client) =>
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
      return await tx.run(fx.parties.OPE, (client) => engine.execute(client, command));
    } catch (error) {
      const e = error as { code?: string; detail?: string; message?: string };
      throw new Error(`T${s.no} refusée : ${e.code ?? ''} ${e.detail ?? e.message ?? ''}`);
    }
  };
  const replay = async (from: number, to: number) => {
    for (const s of STEPS.filter((x) => x.no >= from && x.no <= to)) {
      // Les passages de statut propres aux étapes de clôture sont faits par les tests, pas par le scénario.
      for (const status of s.statusBefore ?? []) {
        if (status === 'SETTLING' || status === 'REFUND_WINDOW') continue;
        if (status === 'RECONCILING') await closeCashSessions();
        await setStatus(status);
      }
      await execute(s);
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
  const reconcilePsp = async () => {
    await owner(
      `INSERT INTO statement_import (operator_id, ledger_id, account_id, source, file_sha256, statement_date,
                                    closing_balance, currency, imported_by, lines_created, lines_existing, lines_matched)
       SELECT $1, $2, a.id, 'test', md5(a.id::text) || md5(a.code), current_date + 1,
              (SELECT coalesce(sum(p.amount), 0) FROM posting p WHERE p.account_id = a.id), 'XOF', $3, 0, 0, 0
         FROM account a WHERE a.ledger_id = $2 AND a.code LIKE 'A-PSP-%'
           AND EXISTS (SELECT 1 FROM posting p WHERE p.account_id = a.id)`,
      [fx.parties.OPE, fx.ledgerId, fx.users.author],
    );
  };

  const enterRefundWindow = async () => {
    await replay(33, 40);
    await setStatus('REFUND_WINDOW');
  };
  const afterDeadline = async () => {
    await owner(
      `UPDATE event SET refund_deadline = clock_timestamp() - interval '1 minute' WHERE id = $1`,
      [fx.eventId],
    );
    await replay(41, 42);
  };

  return {
    app,
    fx,
    base,
    owner,
    replay,
    setStatus,
    async settle() {
      await reconcilePsp();
      await setStatus('SETTLING');
    },
    async toSettling() {
      await replay(1, 29);
      await reconcilePsp();
      await setStatus('SETTLING');
    },
    async stranger() {
      const person = await withOwner(async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO party (kind, operator_id, legal_name, country_code)
           VALUES ('ORGANIZER', $1, $2, 'AA') RETURNING id`,
          [fx.parties.OPE, `Autre organisateur ${randomUUID()}`],
        );
        return idp.createPerson(db, {
          operatorId: fx.parties.OPE,
          roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: rows[0]!.id }],
        });
      });
      return person.token;
    },
    async tamper(table, sql, values = []) {
      await withOwner(async (db) => {
        await db.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
        try {
          await db.query(sql, values);
        } finally {
          await db.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
        }
      });
    },
    async payOutRemaining() {
      const claims = await owner<{ owner_party_id: string; net_claim: string }>(
        'SELECT owner_party_id, net_claim::text FROM party_position WHERE ledger_id = $1',
        [fx.ledgerId],
      );
      const due = (party: string) =>
        BigInt(claims.find((c) => c.owner_party_id === party)?.net_claim ?? '0');
      const payouts = [
        { beneficiary: 'ORGANIZER', amount: due(fx.parties.ORG) },
        { beneficiary: 'OPERATOR', amount: due(fx.parties.OPE) },
      ].filter((p) => p.amount > 0n);
      const base = { currency: 'XOF', ledgerId: fx.ledgerId, eventId: fx.eventId };
      const run = (command: LedgerCommand) =>
        tx.run(fx.parties.OPE, (client) => engine.execute(client, command));
      await run({
        ...base,
        type: 'PAYOUT_INITIATED',
        idempotencyKey: 'payout-batch:test',
        occurredAt: new Date(),
        source: 'BATCH',
        payload: { payouts },
      });
      for (const [i, p] of payouts.entries())
        await run({
          ...base,
          type: 'PAYOUT_CONFIRMED',
          idempotencyKey: `bank:TEST-${i}`,
          occurredAt: new Date(),
          source: 'PSP_WEBHOOK',
          payload: { amount: p.amount, moneyAccount: 'A-BANQUE' },
        });
    },
    enterRefundWindow,
    async toRefundWindow() {
      await enterRefundWindow();
      await afterDeadline();
    },
    afterDeadline,
    async foreignOperator() {
      const person = await withOwner(async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO party (kind, legal_name) VALUES ('OPERATOR', $1) RETURNING id`,
          [`Autre prestataire ${randomUUID()}`],
        );
        return idp.createPerson(db, {
          operatorId: rows[0]!.id,
          roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: rows[0]!.id }],
        });
      });
      return person.token;
    },
    async counts() {
      const [row] = await owner<{ closing: number; total: number }>(
        `SELECT count(*) FILTER (WHERE idempotency_key LIKE 'closing:%')::int AS closing, count(*)::int AS total
           FROM journal_transaction WHERE ledger_id = $1`,
        [fx.ledgerId],
      );
      return row!;
    },
    get: (path, token = fx.people.operatorAdmin.token) =>
      http().get(`${base}${path}`).set('Authorization', `Bearer ${token}`),
    post: (path, token = fx.people.operatorAdmin.token, key = randomUUID()) =>
      http()
        .post(`${base}${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key),
    async close() {
      await app.close();
    },
  };
}
