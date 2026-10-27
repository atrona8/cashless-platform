// Jeu d'essai des annulations (mission 5b, lot WP12) : le monde des paiements (WP11), des ventes faites par la
// route, des SUPERVISOR aux jetons d'approbation réels (FakeIdp), et l'annulation par la route. Écritures directes
// en base : amorçage et recul de `recorded_at` seulement (la fenêtre se teste en reculant, jamais en attendant).
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { actHash } from '../../../src/approval/onsite/act-hash';
import { withOwner } from '../../support/db';
import { goLive, ownerRows } from '../../support/media-fixtures';
import { TestTerminal } from '../../support/test-terminal';
import type { TestPerson } from '../../support/fake-idp';
import type { TerminalResponse } from '../../support/test-terminal';
import { asOperator, seedPos, seedVendor } from '../vendors/vendor-fixtures';
import { PIN, PaymentWorld, type PayMedia, type PayTerminal } from '../payments/payments-fixtures';

export interface Sale {
  id: string;
  media: PayMedia;
  terminal: PayTerminal;
  /** Montant de la vente. */
  amount: number;
}

export interface ReverseOptions {
  /** Clé complète ; défaut : `<serial>:<seq>` suivant du terminal. */
  key?: string;
  /** Session de vendeur du corps ; défaut : celle du terminal. */
  session?: string | null;
  /** Champs ajoutés ou remplacés dans le corps. */
  body?: Record<string, unknown>;
  /** Jeton d'approbation (`X-Approval-Token`). */
  token?: string;
  epoch?: string | null;
}

export class ReversalWorld {
  constructor(readonly pw: PaymentWorld) {}

  static async create(): Promise<ReversalWorld> {
    return new ReversalWorld(await PaymentWorld.create());
  }

  close(): Promise<void> {
    return this.pw.close();
  }

  /** Une vente au TPE simplifié (montant saisi) par la route ; rend son identifiant. */
  async sell(terminal: PayTerminal, amount = 4000): Promise<Sale> {
    const [media] = (await this.pw.media(1)) as [PayMedia];
    const res = await this.pw.pay(
      terminal,
      this.pw.keypadBody(terminal, { tap: this.pw.tap(media) }, amount),
    );
    if (res.status !== 201) throw new Error(`vente refusée : ${res.status} ${res.text}`);
    return { id: String(res.body.transaction_id), media, terminal, amount };
  }

  reversalBody(terminal: PayTerminal, options: ReverseOptions = {}): Record<string, unknown> {
    const session = options.session === undefined ? terminal.sessionId : options.session;
    return {
      reason: 'INPUT_ERROR',
      comment: 'Erreur de saisie',
      occurred_at: new Date().toISOString(),
      ...(session !== null ? { vendor_session_id: session } : {}),
      ...options.body,
    };
  }

  /** `POST /payments/{id}/reversal` par le terminal (trois preuves). */
  reverse(
    terminal: PayTerminal,
    transactionId: string,
    options: ReverseOptions = {},
  ): Promise<TerminalResponse> {
    const headers: Record<string, string | null> = {
      'x-authority-epoch': options.epoch === undefined ? '0' : options.epoch,
    };
    if (options.token) headers['x-approval-token'] = options.token;
    return terminal.t.request(
      this.pw.api.baseUrl,
      this.pw.api.tls.serverCaPem,
      {
        method: 'POST',
        path: `/payments/${transactionId}/reversal`,
        body: this.reversalBody(terminal, options),
        idempotencyKey: options.key ?? terminal.t.seqKey(),
      },
      { headers },
    );
  }

  /** Jeton du `SUPERVISOR` pour la requête EXACTE (`body` compris) ; `act` et `jti` remplaçables. */
  async token(
    who: TestPerson,
    transactionId: string,
    body: unknown,
    overrides: { act?: string; jti?: string; hashedBody?: unknown; ttlSeconds?: number } = {},
  ): Promise<string> {
    return this.pw.w.idp.approvalToken({
      subject: who.subject,
      act: overrides.act ?? 'reversePayment',
      actHash: actHash(
        'POST',
        `/v1/payments/${transactionId}/reversal`,
        overrides.hashedBody ?? body,
      ),
      jti: overrides.jti ?? randomUUID(),
      ttlSeconds: overrides.ttlSeconds,
    });
  }

  /**
   * Annulation par un SUPERVISOR : le corps est construit d'abord (il fait partie de l'empreinte), puis le jeton.
   * Rend la réponse et le corps envoyé.
   */
  async reverseWithToken(
    terminal: PayTerminal,
    transactionId: string,
    who: TestPerson,
    options: ReverseOptions & {
      jti?: string;
      act?: string;
      hashedBody?: unknown;
      ttlSeconds?: number;
    } = {},
  ): Promise<{ res: TerminalResponse; body: Record<string, unknown> }> {
    const body = this.reversalBody(terminal, options);
    const token = await this.token(who, transactionId, body, options);
    const res = await terminal.t.request(
      this.pw.api.baseUrl,
      this.pw.api.tls.serverCaPem,
      {
        method: 'POST',
        path: `/payments/${transactionId}/reversal`,
        body,
        idempotencyKey: options.key ?? terminal.t.seqKey(),
      },
      {
        headers: {
          'x-authority-epoch': options.epoch === undefined ? '0' : options.epoch,
          'x-approval-token': token,
        },
      },
    );
    return { res, body };
  }

  /** SUPERVISOR de l'événement du jeu d'essai (ou d'un autre : `eventId`), actif ou non. */
  supervisor(
    options: { operatorId?: string; scope?: { type: 'EVENT' | 'ORGANIZER'; id: string } } = {},
  ): Promise<TestPerson> {
    return this.person('SUPERVISOR', options);
  }

  person(
    role: 'SUPERVISOR' | 'ORGANIZER_ADMIN' | 'CASHIER',
    options: {
      operatorId?: string;
      scope?: { type: 'EVENT' | 'ORGANIZER'; id: string };
      status?: 'ACTIVE' | 'DISABLED';
    } = {},
  ): Promise<TestPerson> {
    const { w } = this.pw;
    return withOwner((db) =>
      w.idp.createPerson(db, {
        operatorId: options.operatorId ?? w.ops.a,
        status: options.status,
        roles: [
          {
            role,
            scopeType: options.scope?.type ?? 'EVENT',
            scopeId: options.scope?.id ?? w.ids.eventA,
          },
        ],
      }),
    );
  }

  /** Autre événement EN SERVICE du même prestataire et du même organisateur, avec son terminal et sa session. */
  async otherEvent(): Promise<{ eventId: string; terminal: PayTerminal }> {
    const { pw } = this;
    const { w } = pw;
    const eventId = await withOwner(async (db) => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                            funds_holder, contract_id)
         SELECT $2, operator_id, organizer_id, 'Événement B', currency, timezone, jurisdiction_id,
                funds_holder, contract_id FROM event WHERE id = $1`,
        [w.ids.eventA, id],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query('SELECT open_event_ledger($1)', [id]);
      await goLive(db, w.ops.a, id, w.operatorAdminA.userId);
      return id;
    });
    const seeded = await withOwner(async (db) => {
      const pos = await seedPos(db, {
        operatorId: w.ops.a,
        eventId,
        name: 'Bar de l’autre événement',
      });
      await asOperator(db, w.ops.a, () =>
        db.query('SELECT open_participation_account($1)', [pos.participationId]),
      );
      const vendorId = await seedVendor(db, {
        operatorId: w.ops.a,
        merchantId: pos.merchantId,
        actorId: w.operatorAdminA.userId,
        displayName: 'Vendeur de l’autre événement',
        pinHash: await pw.hasher.hash(PIN),
      });
      const t = await new TestTerminal('ANDROID').enroll(db, {
        operatorId: w.ops.a,
        eventId,
        posId: pos.posId,
        mode: 'KEYPAD_TPE',
        ca: pw.ca,
      });
      return { t, vendorId };
    });
    await seeded.t.issueToken(pw.tokens);
    const terminal: PayTerminal = { t: seeded.t, sessionId: null };
    await pw.openSession(terminal, seeded.vendorId);
    return { eventId, terminal };
  }

  /** Second vendeur du MÊME commerçant (même point de vente) : un autre vendeur pour le même terminal. */
  async otherVendor(): Promise<string> {
    const { pw } = this;
    return withOwner(async (db) =>
      seedVendor(db, {
        operatorId: pw.w.ops.a,
        merchantId: pw.pos.merchantId,
        actorId: pw.w.operatorAdminA.userId,
        displayName: 'Second vendeur du bar',
        pinHash: await pw.hasher.hash(PIN),
      }),
    );
  }

  /** Requête d'une PERSONNE (jeton d'accès) sur l'API HTTPS, sans marqueur de terminal. */
  person_request(
    who: TestPerson,
    path: string,
    body: unknown,
    key: string | null = randomUUID(),
  ): Promise<{ status: number; headers: Record<string, unknown>; body: Record<string, unknown> }> {
    const payload = JSON.stringify(body);
    const url = new URL(`${this.pw.api.baseUrl}${path}`);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: 'POST',
          ca: this.pw.api.tls.serverCaPem,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            authorization: `Bearer ${who.token}`,
            ...(key !== null ? { 'idempotency-key': key } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
            });
          });
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  /** Recule `recorded_at` d'une vente (propriétaire) : la fenêtre se mesure sur l'heure de la base. */
  async ageSale(transactionId: string, minutes: number): Promise<void> {
    await withOwner(async (db) => {
      await db.query('ALTER TABLE journal_transaction DISABLE TRIGGER USER');
      try {
        await db.query(
          `UPDATE journal_transaction SET recorded_at = recorded_at - make_interval(mins => $2)
            WHERE id = $1`,
          [transactionId, minutes],
        );
      } finally {
        await db.query('ALTER TABLE journal_transaction ENABLE TRIGGER USER');
      }
    });
  }

  reversalsOf(transactionId: string) {
    return ownerRows<{ id: string; source: string; type: string; approved_by: string | null }>(
      `SELECT id, source, type, approved_by FROM journal_transaction WHERE reverses_id = $1`,
      [transactionId],
    );
  }

  tokenUses(jti?: string) {
    return ownerRows<{ jti: string; caller_device_id: string | null; target_id: string | null }>(
      `SELECT jti, caller_device_id, target_id FROM approval_token_use
        WHERE $1::text IS NULL OR jti = $1`,
      [jti ?? null],
    );
  }
}
