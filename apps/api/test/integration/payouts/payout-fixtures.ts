// Jeu d'essai des versements (mission 9b, lot WP08) : deux prestataires, l'événement A et son grand
// livre, des
// personnes de chaque rôle, des commerçants neufs à chaque appel (droit net amorcé par le
// propriétaire : amorçage
// seulement). Toute demande, approbation, lecture, export et résultat passe par la ROUTE.
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { send, type TerminalResponse } from '../../support/test-terminal';

export const IBAN = 'SN08SN0100152000048500003035';
export const MSISDN = '+221770000001';

export interface Merchant {
  partyId: string;
  participationId: string;
  name: string;
}

export class PayoutWorld {
  w!: MediaWorld;
  api!: HttpsTestApp;
  /** Seconds : même rôle que `w.operatorAdminA` / `w.organizerAdminA`, autre personne. */
  operatorAdmin2!: TestPerson;
  organizerAdmin2!: TestPerson;
  operatorAdminB!: TestPerson;
  organizerAdminB!: TestPerson;
  platformPartyId = '';
  private fundSeq = 0;

  static async create(): Promise<PayoutWorld> {
    const world = new PayoutWorld();
    world.w = await createMediaWorld();
    world.api = await startHttpsApp(undefined, { identity: world.w.idp });
    const { w } = world;
    await withOwner(async (db) => {
      const person = (
        operatorId: string,
        role: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN',
        scopeId: string,
      ) =>
        w.idp.createPerson(db, {
          operatorId,
          roles: [
            { role, scopeType: role === 'OPERATOR_ADMIN' ? 'OPERATOR' : 'ORGANIZER', scopeId },
          ],
        });
      world.operatorAdmin2 = await person(w.ops.a, 'OPERATOR_ADMIN', w.ops.a);
      world.organizerAdmin2 = await person(w.ops.a, 'ORGANIZER_ADMIN', w.ids.organizerA);
      world.operatorAdminB = await person(w.ops.b, 'OPERATOR_ADMIN', w.ops.b);
      world.organizerAdminB = await person(w.ops.b, 'ORGANIZER_ADMIN', w.ids.organizerB);
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      // Comptes d'argent de sortie (créés par les missions de paiement ; ici à la main) et argent
      // en banque.
      await db.query(
        `INSERT INTO account (operator_id, ledger_id, code, family, purpose, normal_side, allow_negative)
         SELECT $1, $2, c, 'ASSET', 'PSP', 'D', true FROM unnest(ARRAY['A-PSP-WAVE', 'A-PSP-OM', 'A-BANQUE']) c
          WHERE NOT EXISTS (SELECT 1 FROM account WHERE ledger_id = $2 AND code = c)`,
        [w.ops.a, w.ids.ledgerA],
      );
    });
    world.platformPartyId = (
      await ownerRows<{ id: string }>(`SELECT id FROM party WHERE kind = 'PLATFORM' LIMIT 1`)
    )[0]!.id;
    return world;
  }

  close(): Promise<void> {
    return this.api.close();
  }

  get ledger(): string {
    return this.w.ids.ledgerA;
  }

  /**
   * Crédite un compte de droits par l'attente (écriture réelle du propriétaire, deux personnes
   * distinctes). */
  async fund(code: string, amount: number, ledger = this.ledger): Promise<void> {
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [this.w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'ADJUSTMENT', $2, clock_timestamp(), 'BACKOFFICE', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'S-ATTENTE'), 'amount', $4::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = $3), 'amount', -$4::bigint)),
           NULL, NULL, $5, $6)`,
        [
          ledger,
          `test-fund:${this.fundSeq++}:${randomUUID()}`,
          code,
          amount,
          this.w.operatorAdminA.userId,
          this.w.organizerAdminA.userId,
        ],
      );
    });
  }

  /** Commerçant neuf, participant à l'événement A, avec `claim` de droit net. */
  async merchant(claim: number, name = `Stand ${randomUUID().slice(0, 8)}`): Promise<Merchant> {
    const partyId = randomUUID();
    const participationId = randomUUID();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'MERCHANT', $2, $3)`,
        [partyId, this.w.ops.a, name],
      );
      await db.query(
        `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
         VALUES ($1, $2, $3, $4, 'EXTERNAL', $4)`,
        [participationId, this.w.ops.a, this.w.ids.eventA, partyId],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [this.w.ops.a]);
      await db.query('SELECT open_participation_account($1)', [participationId]);
    });
    if (claim > 0) await this.fund(`L-MCH-${participationId}`, claim);
    return { partyId, participationId, name };
  }

  /** Droit net courant d'une partie (vue `party_position`). */
  async net(partyId: string, ledger = this.ledger): Promise<number> {
    const rows = await ownerRows<{ n: string }>(
      `SELECT coalesce((SELECT net_claim FROM party_position WHERE ledger_id = $1 AND owner_party_id = $2), 0)::text AS n`,
      [ledger, partyId],
    );
    return Number(rows[0]!.n);
  }

  bo(
    method: 'GET' | 'POST',
    path: string,
    who: TestPerson,
    body?: unknown,
    key: string | null = method === 'POST' ? randomUUID() : null,
  ): Promise<TerminalResponse> {
    return send(
      {
        url: new URL(`${this.api.baseUrl}${path}`),
        method,
        headers: {
          authorization: `Bearer ${who.token}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...(key !== null ? { 'idempotency-key': key } : {}),
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : '',
        cert: null,
        key: null,
      },
      this.api.tls.serverCaPem,
    );
  }

  line(m: Merchant, amount: number, over: Record<string, unknown> = {}) {
    return {
      beneficiary_party_id: m.partyId,
      amount,
      currency: 'XOF',
      method: 'WAVE',
      msisdn: MSISDN,
      ...over,
    };
  }

  request(
    lines: unknown[],
    who = this.w.organizerAdminA,
    key = randomUUID(),
    ledger = this.ledger,
  ) {
    return this.bo(
      'POST',
      `/ledgers/${ledger}/payout-batches/approval-requests`,
      who,
      { lines },
      key,
    );
  }

  approve(id: unknown, who = this.organizerAdmin2) {
    return this.bo('POST', `/approval-requests/${String(id)}/approve`, who, {});
  }

  /**
   * Demande puis approbation par une autre personne ; rend la réponse de l'approbation et
   * l'identifiant du lot. */
  async batch(lines: unknown[], author = this.w.organizerAdminA, approver = this.organizerAdmin2) {
    const asked = await this.request(lines, author);
    if (asked.status !== 202) throw new Error(`demande refusée : ${asked.status} ${asked.text}`);
    const id = String(asked.body.approval_request_id);
    const approved = await this.approve(id, approver);
    return { id, asked, approved };
  }

  /**
   * Nombre de requêtes SQL émises par l'API (même processus) pendant `fn` : preuve d'absence de
   * N+1. */
  async countQueries(fn: () => Promise<void>): Promise<number> {
    const proto = Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
    const original = proto.query;
    let n = 0;
    proto.query = function (this: unknown, ...args: unknown[]) {
      n++;
      return original.apply(this, args);
    };
    try {
      await fn();
    } finally {
      proto.query = original;
    }
    return n;
  }

  /** Personne qui tient les deux rôles (organisateur A et prestataire A). */
  holdingBoth(): Promise<TestPerson> {
    return withOwner((db) =>
      this.w.idp.createPerson(db, {
        operatorId: this.w.ops.a,
        roles: [
          { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: this.w.ids.organizerA },
          { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: this.w.ops.a },
        ],
      }),
    );
  }

  payoutsOf(batchId: string) {
    return ownerRows<{
      id: string;
      status: string;
      amount: string;
      iban: string | null;
      msisdn: string | null;
    }>(
      `SELECT id, status, amount::text, iban, msisdn FROM payout WHERE approval_request_id = $1 ORDER BY id`,
      [batchId],
    );
  }

  txCount(type: string, ledger = this.ledger): Promise<number> {
    return ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND type = $2`,
      [ledger, type],
    ).then((r) => r[0]!.n);
  }

  /** Somme nulle par transaction du grand livre. */
  async unbalanced(): Promise<number> {
    const rows = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT transaction_id FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
        WHERE t.ledger_id = $1 GROUP BY transaction_id HAVING sum(amount) <> 0) x`,
      [this.ledger],
    );
    return rows[0]!.n;
  }
}
