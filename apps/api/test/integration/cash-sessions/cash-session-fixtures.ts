// Jeu d'essai des sessions de caisse (mission 6, lot WP08, T042) : HTTPS réel (trois preuves du terminal,
// personnes par jetons du faux fournisseur d'identité), vraie base `cashless_wp08`. Deux événements EN SERVICE du
// même prestataire (A : payeur d'écart ORGANIZER ; B : payeur OPERATOR), un prestataire B pour les croisements.
// Le théorique est posé par une écriture RÉELLE `TOPUP_CASH` du moteur sous la session (`seedCash`), donc par la
// garde de caisse de la base : jamais par un UPDATE de solde. Écritures directes en base : amorçage et lectures.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { TenantTx } from '../../../src/db/tenant-tx';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, goLive, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import {
  send,
  TestTerminal,
  type TerminalMode,
  type TerminalResponse,
} from '../../support/test-terminal';

export interface WorldEvent {
  eventId: string;
  ledgerId: string;
  walletId: string;
}

export type Res = Pick<TerminalResponse, 'status' | 'body' | 'headers' | 'text'>;

export class CashWorld {
  w!: MediaWorld;
  api!: HttpsTestApp;
  ca!: FakeDeviceCa;
  tokens!: DeviceTokenService;
  engine!: LedgerEngineService;
  tx!: TenantTx;
  /** Événement A (jeu d'essai de base, payeur d'écart ORGANIZER) et B (même prestataire, payeur OPERATOR). */
  a!: WorldEvent;
  b!: WorldEvent;
  /** Personnes de l'événement A (portée EVENT). */
  supervisor!: TestPerson;
  supervisor2!: TestPerson;
  supervisor3!: TestPerson;
  cashier2!: TestPerson;
  operatorAdmin2!: TestPerson;
  /** Personnes de l'événement B (portée EVENT) : sans aucun rôle sur A. */
  cashierOfB!: TestPerson;
  supervisorOfB!: TestPerson;
  /** Prestataire B. */
  supervisorOp2!: TestPerson;
  organizerAdminOp2!: TestPerson;
  operatorAdminOp2!: TestPerson;

  static async create(): Promise<CashWorld> {
    const cw = new CashWorld();
    cw.w = await createMediaWorld();
    const { w } = cw;
    cw.api = await startHttpsApp(undefined, { identity: w.idp });
    cw.ca = await FakeDeviceCa.fromFiles({
      certFile: cw.api.tls.deviceCaCertFile,
      keyFile: cw.api.tls.deviceCaFakeKeyFile,
    });
    cw.tokens = cw.api.app.get(DeviceTokenService, { strict: false });
    cw.engine = cw.api.app.get(LedgerEngineService, { strict: false });
    cw.tx = cw.api.app.get(TenantTx, { strict: false });
    await withOwner(async (db) => {
      // Contrat de l'événement A : écarts de caisse à la charge de l'ORGANISATEUR.
      const contract = async (bearer: 'ORGANIZER' | 'OPERATOR', eventId: string) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer,
                                 cash_diff_bearer, breakage_organizer_bps)
           VALUES ($1, 'OPERATOR_ORGANIZER', $2, '2026-01-01', 'ORGANIZER', $3, 10000) RETURNING id`,
          [w.ops.a, w.ids.organizerA, bearer],
        );
        await db.query('UPDATE event SET contract_id = $2 WHERE id = $1', [eventId, rows[0]!.id]);
      };
      await contract('ORGANIZER', w.ids.eventA);
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      cw.a = { eventId: w.ids.eventA, ledgerId: w.ids.ledgerA, walletId: w.ids.walletA };
      cw.b = await cw.insertEvent(db, 'OPERATOR', true);
      await contract('OPERATOR', cw.b.eventId);
      const person = (
        operatorId: string,
        role: Parameters<typeof w.idp.createPerson>[1]['roles'] extends infer R
          ? R extends Array<infer X>
            ? X
            : never
          : never,
      ) => w.idp.createPerson(db, { operatorId, roles: [role] });
      const onA = (role: 'SUPERVISOR' | 'CASHIER') =>
        person(w.ops.a, { role, scopeType: 'EVENT', scopeId: w.ids.eventA });
      cw.supervisor = await onA('SUPERVISOR');
      cw.supervisor2 = await onA('SUPERVISOR');
      cw.supervisor3 = await onA('SUPERVISOR');
      cw.cashier2 = await onA('CASHIER');
      cw.operatorAdmin2 = await person(w.ops.a, {
        role: 'OPERATOR_ADMIN',
        scopeType: 'OPERATOR',
        scopeId: w.ops.a,
      });
      cw.cashierOfB = await person(w.ops.a, {
        role: 'CASHIER',
        scopeType: 'EVENT',
        scopeId: cw.b.eventId,
      });
      cw.supervisorOfB = await person(w.ops.a, {
        role: 'SUPERVISOR',
        scopeType: 'EVENT',
        scopeId: cw.b.eventId,
      });
      cw.supervisorOp2 = await person(w.ops.b, {
        role: 'SUPERVISOR',
        scopeType: 'ORGANIZER',
        scopeId: w.ids.organizerB,
      });
      cw.organizerAdminOp2 = await person(w.ops.b, {
        role: 'ORGANIZER_ADMIN',
        scopeType: 'ORGANIZER',
        scopeId: w.ids.organizerB,
      });
      cw.operatorAdminOp2 = await person(w.ops.b, {
        role: 'OPERATOR_ADMIN',
        scopeType: 'OPERATOR',
        scopeId: w.ops.b,
      });
    });
    return cw;
  }

  close(): Promise<void> {
    return this.api.close();
  }

  /** Nouvel événement du prestataire A et de l'organisateur A (grand livre ouvert, portefeuille), en service ou non. */
  async insertEvent(
    db: Parameters<Parameters<typeof withOwner>[0]>[0],
    _bearer: 'ORGANIZER' | 'OPERATOR',
    live: boolean,
  ): Promise<WorldEvent> {
    const { w } = this;
    const eventId = randomUUID();
    const walletId = randomUUID();
    await db.query(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                          funds_holder)
       SELECT $2, operator_id, organizer_id, 'Événement ' || $2::text, currency, timezone,
              jurisdiction_id, funds_holder FROM event WHERE id = $1`,
      [w.ids.eventA, eventId],
    );
    await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
    const ledgerId = (
      await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventId])
    ).rows[0]!.ledger;
    await db.query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
      walletId,
      w.ops.a,
      ledgerId,
    ]);
    if (live) await goLive(db, w.ops.a, eventId, w.operatorAdminA.userId);
    return { eventId, ledgerId, walletId };
  }

  /** Événement du prestataire A, hors service (brouillon) : une caisse n'y peut pas être ouverte. */
  draftEvent(): Promise<WorldEvent> {
    return withOwner((db) => this.insertEvent(db, 'ORGANIZER', false));
  }

  /** Terminal enrôlé, jeton émis, de l'événement `ev` (défaut A), mode `TOPUP_DESK` (défaut). */
  async terminal(
    ev: WorldEvent = this.a,
    mode: TerminalMode = 'TOPUP_DESK',
  ): Promise<TestTerminal> {
    const t = await withOwner((db) =>
      new TestTerminal('ANDROID').enroll(db, {
        operatorId: this.w.ops.a,
        eventId: ev.eventId,
        mode,
        ca: this.ca,
      }),
    );
    await t.issueToken(this.tokens);
    return t;
  }

  // ----- requêtes

  /** Requête du terminal (trois preuves) avec la personne `staff` dans `X-Staff-Authorization`. */
  term(
    t: TestTerminal,
    method: 'GET' | 'POST',
    path: string,
    staff: TestPerson | null,
    body?: unknown,
    key?: string,
  ): Promise<TerminalResponse> {
    return t.request(
      this.api.baseUrl,
      this.api.tls.serverCaPem,
      {
        method,
        path,
        ...(method === 'POST' ? { body: body ?? {}, idempotencyKey: key ?? t.seqKey() } : {}),
      },
      { headers: staff ? { 'x-staff-authorization': `Bearer ${staff.token}` } : {} },
    );
  }

  /** Requête d'une personne seule (jeton d'accès dans `Authorization`), sans marqueur de terminal. */
  bo(
    method: 'GET' | 'POST',
    path: string,
    who: TestPerson,
    body?: unknown,
    key: string | null = method === 'POST' ? randomUUID() : null,
    extra: Record<string, string> = {},
  ): Promise<TerminalResponse> {
    const payload = method === 'POST' ? JSON.stringify(body ?? {}) : '';
    return send(
      {
        url: new URL(`${this.api.baseUrl}${path}`),
        method,
        headers: {
          authorization: `Bearer ${who.token}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...(key !== null ? { 'idempotency-key': key } : {}),
          ...extra,
        },
        body: payload,
        cert: null,
        key: null,
      },
      this.api.tls.serverCaPem,
    );
  }

  // ----- gestes

  async open(t: TestTerminal, who: TestPerson, body: unknown = {}): Promise<string> {
    const res = await this.term(t, 'POST', '/cash-sessions', who, body);
    if (res.status !== 201) throw new Error(`ouverture refusée : ${res.status} ${res.text}`);
    return String(res.body.cash_session_id);
  }

  count(t: TestTerminal, sessionId: string, who: TestPerson, amount: number, extra: object = {}) {
    return this.term(t, 'POST', `/cash-sessions/${sessionId}/counts`, who, {
      counted_amount: amount,
      counted_at: new Date().toISOString(),
      ...extra,
    });
  }

  /** Théorique posé par une écriture réelle `TOPUP_CASH` du moteur (garde de caisse de la base comprise). */
  async seedCash(
    t: TestTerminal,
    amount: number,
    ev: WorldEvent = this.a,
    key: string = `seed:${randomUUID()}`,
  ): Promise<string> {
    const result = await this.tx.run(this.w.ops.a, (client) =>
      this.engine.execute(client, {
        type: 'TOPUP_CASH',
        source: 'ONLINE',
        idempotencyKey: key,
        occurredAt: new Date(),
        ledgerId: ev.ledgerId,
        eventId: ev.eventId,
        currency: 'XOF',
        deviceId: t.deviceId,
        payload: { walletId: ev.walletId, cashDesk: t.serial, amount: BigInt(amount) },
      }),
    );
    return result.transactionId!;
  }

  /** Session ouverte par `cashier`, `expected` espèces en caisse, comptée `counted` (si non nul) par `counter`. */
  async ready(options: {
    expected: number;
    counted: number | null;
    ev?: WorldEvent;
    opener?: TestPerson;
    counter?: TestPerson;
    terminal?: TestTerminal;
  }): Promise<{ t: TestTerminal; id: string; ev: WorldEvent }> {
    const ev = options.ev ?? this.a;
    const t = options.terminal ?? (await this.terminal(ev));
    const id = await this.open(t, options.opener ?? this.w.cashierA);
    if (options.expected > 0) await this.seedCash(t, options.expected, ev);
    if (options.counted !== null) {
      const res = await this.count(t, id, options.counter ?? this.w.cashierA, options.counted);
      if (res.status !== 200) throw new Error(`comptage refusé : ${res.status} ${res.text}`);
    }
    return { t, id, ev };
  }

  // ----- lectures en base

  session(id: string) {
    return ownerRows<{
      status: string;
      closed_by: string | null;
      counted_amount: string | null;
      expected_amount: string | null;
      close_tx_id: string | null;
      cash_diff_anomaly_id: string | null;
    }>(
      `SELECT status, closed_by, counted_amount::text, expected_amount::text, close_tx_id,
              cash_diff_anomaly_id FROM cash_session WHERE cash_session_id = $1`,
      [id],
    ).then((r) => r[0]!);
  }

  /** Solde d'un compte par code (somme des lignes) dans un grand livre. */
  balance(ledgerId: string, code: string): Promise<number> {
    return ownerRows<{ b: string }>(
      `SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id
        WHERE a.ledger_id = $1 AND a.code = $2`,
      [ledgerId, code],
    ).then((r) => Number(r[0]!.b));
  }

  transactionsOf(ledgerId: string, type: string) {
    return ownerRows<{
      id: string;
      source: string;
      idempotency_key: string;
      created_by: string | null;
      approved_by: string | null;
    }>(
      `SELECT id, source, idempotency_key, created_by, approved_by FROM journal_transaction
        WHERE ledger_id = $1 AND type = $2`,
      [ledgerId, type],
    );
  }

  counts(id: string) {
    return ownerRows<{ count_no: number; counted_by: string; counted_amount: string }>(
      `SELECT count_no, counted_by, counted_amount::text FROM cash_session_count
        WHERE cash_session_id = $1 ORDER BY count_no`,
      [id],
    );
  }

  /** Lignes d'une transaction : code du compte → montant. */
  lines(txId: string) {
    return ownerRows<{ code: string; amount: string }>(
      `SELECT a.code, p.amount::text FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.transaction_id = $1 ORDER BY a.code`,
      [txId],
    );
  }

  journalCount(ledgerId: string): Promise<number> {
    return ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1',
      [ledgerId],
    ).then((r) => r[0]!.n);
  }
}

/** Les clés qui ne doivent jamais apparaître chez un caissier, plus le canari du théorique. */
export function leaks(value: unknown, forbidden: string[]): string[] {
  const text = JSON.stringify(value);
  return forbidden.filter((needle) => text.includes(needle));
}
