// Jeu d'essai des réclamations tardives (mission 9b, lot WP10, T046). S'appuie sur le monde des
// recharges PSP (importé, jamais copié) : événement A, prestataire A, personnes. Amorçage par le
// propriétaire (écritures directes) : portefeuilles financés, casse prise (organisateur 60 %,
// prestataire 40 %), bracelets et passages, verrouillage du grand livre. Les routes et les
// approbations passent par HTTPS, comme en production.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { LedgerEngineService } from '../../../src/ledger/ledger-engine.service';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import { PspWorld } from '../topups/psp-fixtures';

export const FUNDS = 10_000;
/** Part de la casse de l'organisateur (le prestataire reçoit le reste). */
export const ORGANIZER_SHARE = 6_000;

export const IBAN = 'SN08SN0100152000048500003035';

export interface Broken {
  walletId: string;
  customerId: string;
}

export class LateWorld {
  pw!: PspWorld;
  engine!: LedgerEngineService;
  static async create(): Promise<LateWorld> {
    const lw = new LateWorld();
    lw.pw = await PspWorld.create();
    lw.engine = lw.pw.sw.api.app.get(LedgerEngineService, { strict: false });
    // Comptes d'argent des canaux (la fixture des recharges n'ouvre pas ceux de WAVE et d'Orange
    // Money).
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [lw.operatorId]);
      await db.query('SELECT open_psp_accounts($1)', [lw.ledgerId]);
    });
    return lw;
  }

  close(): Promise<void> {
    return this.pw.close();
  }
  get cw() {
    return this.pw.sw;
  }
  get w() {
    return this.pw.w;
  }
  get ledgerId() {
    return this.pw.ev.ledgerId;
  }
  get eventId() {
    return this.pw.ev.eventId;
  }
  get organizerId() {
    return this.w.ids.organizerA;
  }
  get operatorId() {
    return this.w.ops.a;
  }
  author(): TestPerson {
    return this.w.operatorAdminA;
  }
  validator(): TestPerson {
    return this.w.organizerAdminA;
  }

  // ----- amorçage

  /** Portefeuille financé de `funds`, dont toute la casse est prise (grand livre encore ouvert). */
  async brokenWallet(funds = FUNDS, share = ORGANIZER_SHARE): Promise<Broken> {
    const { walletId, customer } = await this.pw.wallet({ funds });
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [this.operatorId]);
      await db.query(
        `SELECT post_transaction($1, 'BREAKAGE', $2, clock_timestamp(), 'BATCH', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $3 AND purpose = 'WALLET_PAID'), 'amount', $4::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'ORG_CASSE'), 'amount', -$5::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'OPE_CASSE'), 'amount', -($4::bigint - $5::bigint))))`,
        [
          this.ledgerId,
          `test-breakage:${randomUUID()}`,
          walletId,
          funds,
          Math.round((funds * share) / FUNDS),
        ],
      );
    });
    return { walletId, customerId: customer.customerId };
  }

  /** Événement `CLOSED`, grand livre `LOCKED` : réclamations tardives jusqu'à `lateUntilSql`. */
  async lock(lateUntilSql = "clock_timestamp() + interval '1 year'"): Promise<void> {
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.event_status_change', 'on', false)`);
      await db.query(`UPDATE event SET status = 'CLOSED' WHERE id = $1`, [this.eventId]);
      await db.query(`SELECT set_config('app.event_status_change', 'off', false)`);
      await db.query(
        `UPDATE ledger SET status = 'LOCKED', locked_until = clock_timestamp() - interval '1 hour',
                late_claims_until = ${lateUntilSql} WHERE id = $1`,
        [this.ledgerId],
      );
    });
  }

  /** Remet l'événement en service et le grand livre ouvert (entre deux essais). */
  async reset(): Promise<void> {
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.event_status_change', 'on', false)`);
      await db.query(`UPDATE event SET status = 'LIVE' WHERE id = $1`, [this.eventId]);
      await db.query(`SELECT set_config('app.event_status_change', 'off', false)`);
      await db.query(
        `UPDATE ledger SET status = 'OPEN', locked_until = NULL, late_claims_until = NULL,
                debit_authority = 'CENTRAL', edge_gateway_id = NULL WHERE id = $1`,
        [this.ledgerId],
      );
    });
  }

  /**
   * Bracelet rattaché (ou ayant été rattaché) au portefeuille, et passage lu par un terminal (ou
   * non).
   */
  async tap(
    walletId: string,
    over: { device?: boolean; operatorId?: string; released?: boolean; assign?: boolean } = {},
  ): Promise<number> {
    const operatorId = over.operatorId ?? this.operatorId;
    return withOwner(async (db) => {
      const media = await db.query<{ id: string }>(
        `INSERT INTO media (operator_id, kind, token_hash, nfc_uid, status)
         VALUES ($1, 'NFC_TAG', sha256($2::bytea), $3, 'PERSONALIZED') RETURNING id`,
        [
          operatorId,
          Buffer.from(randomUUID()),
          Buffer.from(randomUUID().replace(/-/g, '').slice(0, 14), 'hex'),
        ],
      );
      const mediaId = media.rows[0]!.id;
      if (over.assign !== false)
        await db.query(
          `INSERT INTO media_assignment (operator_id, media_id, wallet_id, currency, token_hash, released_at)
           SELECT $1, $2, $3, 'XOF', token_hash, ${over.released ? 'now()' : 'NULL'} FROM media WHERE id = $2`,
          [operatorId, mediaId, walletId],
        );
      let deviceId: string | null = null;
      if (over.device !== false) {
        const device = await db.query<{ id: string }>(
          `INSERT INTO device (operator_id, kind, app_mode, serial) VALUES ($1, 'TOPUP', 'TOPUP_DESK', $2)
           RETURNING id`,
          [operatorId, `late-tap-${randomUUID()}`],
        );
        deviceId = device.rows[0]!.id;
      }
      const tap = await db.query<{ id: string }>(
        `INSERT INTO media_tap (operator_id, media_id, counter, nfc_uid, occurred_at, device_id, mode)
         SELECT $1, $2, 1, coalesce(nfc_uid, '\\x00000000000000'::bytea), now(), $3, 'ONLINE' FROM media WHERE id = $2
         RETURNING id::text`,
        [operatorId, mediaId, deviceId],
      );
      return Number(tap.rows[0]!.id);
    });
  }

  // ----- appels HTTP

  claimBody(walletId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      wallet_id: walletId,
      amount: FUNDS,
      currency: 'XOF',
      proof: { kind: 'CUSTOMER_ACCOUNT' },
      destination: { method: 'WAVE', msisdn: '+221770000002' },
      reason: 'Festivalier absent pendant la fenêtre de remboursement.',
      ...over,
    };
  }

  claim(body: unknown, who: TestPerson = this.author(), key: string = randomUUID()) {
    return this.cw.bo('POST', `/ledgers/${this.ledgerId}/late-claims`, who, body, key);
  }

  adjust(body: unknown, who: TestPerson = this.author(), key: string = randomUUID()) {
    return this.cw.bo('POST', `/ledgers/${this.ledgerId}/late-adjustments`, who, body, key);
  }

  approve(id: unknown, who: TestPerson = this.validator()) {
    return this.cw.bo('POST', `/approval-requests/${String(id)}/approve`, who, {});
  }

  // ----- lectures en base

  transactions(types: string[], keyLike: string) {
    return ownerRows<{
      id: string;
      type: string;
      source: string;
      idempotency_key: string;
      created_by: string | null;
      approved_by: string | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, type, source, idempotency_key, created_by, approved_by, metadata
         FROM journal_transaction WHERE ledger_id = $1 AND type = ANY($2::text[])
          AND idempotency_key LIKE $3 ORDER BY recorded_at`,
      [this.ledgerId, types, keyLike],
    );
  }

  /**
   * Nombre d'écritures de réclamation tardive du grand livre (annulations, remboursements et
   * apports tardifs).
   */
  async lateWrites(): Promise<number> {
    const [row] = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_transaction
        WHERE ledger_id = $1 AND source = 'BACKOFFICE'
          AND type IN ('BREAKAGE_REVERSAL', 'WALLET_REFUND', 'ADJUSTMENT')
          AND idempotency_key LIKE 'bo:%'`,
      [this.ledgerId],
    );
    return row!.n;
  }

  async requests(action: string, targetId?: string) {
    return ownerRows<{
      id: string;
      status: string;
      failure_reason: string | null;
      payload: unknown;
    }>(
      `SELECT id, status, failure_reason, payload FROM approval_request
        WHERE action = $1 AND ($2::uuid IS NULL OR target_id = $2) ORDER BY requested_at`,
      [action, targetId ?? null],
    );
  }

  async walletPaid(walletId: string): Promise<bigint> {
    const [row] = await ownerRows<{ b: string }>(
      `SELECT coalesce(-sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id
        WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PAID'`,
      [walletId],
    );
    return BigInt(row!.b);
  }

  /** Lignes d'une transaction par code de compte (compte de portefeuille : `WALLET_PAID`). */
  async lines(txId: string): Promise<Record<string, number>> {
    const rows = await ownerRows<{ code: string; purpose: string; amount: string }>(
      `SELECT a.code, a.purpose, sum(p.amount)::text AS amount FROM posting p
         JOIN account a ON a.id = p.account_id WHERE p.transaction_id = $1 GROUP BY 1, 2`,
      [txId],
    );
    const out: Record<string, number> = {};
    for (const r of rows)
      out[r.purpose === 'WALLET_PAID' ? 'WALLET_PAID' : r.code] = Number(r.amount);
    return out;
  }

  /** Solde (crédit positif) d'un compte de casse. */
  async casse(purpose: 'ORG_CASSE' | 'OPE_CASSE'): Promise<bigint> {
    const [row] = await ownerRows<{ b: string }>(
      `SELECT coalesce(-sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id
        WHERE a.ledger_id = $1 AND a.purpose = $2`,
      [this.ledgerId, purpose],
    );
    return BigInt(row!.b);
  }

  /**
   * Marge d'apport d'un compte de casse : annulé depuis le verrouillage, moins les apports déjà
   * faits (comme la base).
   */
  async room(purpose: 'ORG_CASSE' | 'OPE_CASSE'): Promise<bigint> {
    const [row] = await ownerRows<{ room: string }>(
      `SELECT (coalesce(sum(p.amount) FILTER (WHERE t.type = 'BREAKAGE_REVERSAL'), 0)
               + coalesce(sum(p.amount) FILTER (WHERE t.type = 'ADJUSTMENT' AND t.recorded_at > l.locked_until), 0))::text
              AS room
         FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
         JOIN account a ON a.id = p.account_id JOIN ledger l ON l.id = a.ledger_id
        WHERE a.ledger_id = $1 AND a.purpose = $2`,
      [this.ledgerId, purpose],
    );
    return BigInt(row!.room);
  }
}
