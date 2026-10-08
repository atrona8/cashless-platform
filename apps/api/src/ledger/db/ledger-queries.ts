// Requêtes du moteur d'écritures. Toutes s'exécutent avec le client de la transaction ouverte par l'appelant.
// Montants : lus en texte (`::text`) puis convertis en bigint, écrits en JSON construit sans passer par `number`.
import type { Queryable } from '../ports/account-resolver';
import type { EventStatus, LedgerStatus } from '../status-matrix';
import type { Line } from '../types';

export interface LedgerContextRow {
  ledgerStatus: LedgerStatus;
  currency: string;
  eventId: string | null;
  eventStatus: EventStatus | null;
  depositMode: 'FROM_BALANCE' | 'SEPARATE' | null;
}

/** Grand livre, événement et (si un support est donné) mode de caution de son lot, en une requête. */
export async function readLedgerContext(
  client: Queryable,
  ledgerId: string,
  eventId: string | undefined,
  mediaId: string | undefined,
): Promise<LedgerContextRow | undefined> {
  const { rows } = await client.query<{
    ledger_status: LedgerStatus;
    currency: string;
    event_id: string | null;
    event_status: EventStatus | null;
    deposit_mode: 'FROM_BALANCE' | 'SEPARATE' | null;
  }>(
    `SELECT l.status AS ledger_status, l.currency, e.id AS event_id, e.status::text AS event_status,
            b.deposit_mode
       FROM ledger l
       LEFT JOIN event e ON e.id = coalesce($2::uuid, CASE WHEN l.scope_type = 'EVENT' THEN l.scope_id END)
       LEFT JOIN media m ON m.id = $3::uuid
       LEFT JOIN media_batch b ON b.id = m.batch_id
      WHERE l.id = $1`,
    [ledgerId, eventId ?? null, mediaId ?? null],
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    ledgerStatus: row.ledger_status,
    currency: row.currency,
    eventId: row.event_id,
    eventStatus: row.event_status,
    depositMode: row.deposit_mode,
  };
}

/**
 * Soldes signés (débit +, crédit −) de comptes désignés par fonction et titulaire. Les comptes chauds n'ont pas de
 * solde en cache : leur solde vient de la vue `trial_balance` du schéma ; les autres, du cache `account_balance`.
 */
export async function readSignedBalances(
  client: Queryable,
  ledgerId: string,
  where: { purpose: string; walletId?: string; participationId?: string }[],
): Promise<bigint[]> {
  // Une requête après l'autre : un client `pg` n'exécute qu'une requête à la fois (pg@9 refusera le chevauchement).
  const balances: bigint[] = [];
  for (const { purpose, walletId, participationId } of where) {
    const { rows } = await client.query<{ balance: string | null }>(
      `SELECT CASE WHEN a.hot
                   THEN (SELECT tb.signed_balance FROM trial_balance tb WHERE tb.ledger_id = a.ledger_id AND tb.code = a.code)
                   ELSE coalesce(ab.balance, 0) END::text AS balance
         FROM account a LEFT JOIN account_balance ab ON ab.account_id = a.id
        WHERE a.ledger_id = $1 AND a.purpose = $2
          AND ($3::uuid IS NULL OR a.wallet_id = $3::uuid)
          AND ($4::uuid IS NULL OR a.participation_id = $4::uuid)`,
      [ledgerId, purpose, walletId ?? null, participationId ?? null],
    );
    // Compte absent : aucun solde (le constructeur refusera s'il en a besoin pour écrire).
    balances.push(rows[0]?.balance ? BigInt(rows[0].balance) : 0n);
  }
  return balances;
}

/** Marge sous le plafond du portefeuille (verrouille son solde jusqu'à la fin de la transaction) ; null = sans plafond. */
export async function readTopupHeadroom(client: Queryable, walletId: string, occurredAt: Date): Promise<bigint | undefined> {
  const { rows } = await client.query<{ headroom: string | null }>(
    'SELECT wallet_topup_headroom($1, $2)::text AS headroom',
    [walletId, occurredAt.toISOString()],
  );
  const value = rows[0]?.headroom;
  return value === null || value === undefined ? undefined : BigInt(value);
}

/** Lignes de la transaction contre-passée, dans leur ordre d'écriture, comptes désignés par leur code. */
export async function readOriginalLines(client: Queryable, ledgerId: string, transactionId: string): Promise<Line[]> {
  const { rows } = await client.query<{ code: string; amount: string; memo: string | null }>(
    `SELECT a.code, p.amount::text AS amount, p.memo
       FROM posting p JOIN account a ON a.id = p.account_id
      WHERE p.transaction_id = $1 AND p.ledger_id = $2
      ORDER BY p.line_no`,
    [transactionId, ledgerId],
  );
  return rows.map((row) => ({
    account: { code: row.code },
    amount: BigInt(row.amount),
    ...(row.memo === null ? {} : { memo: row.memo }),
  }));
}

/**
 * Sérialise les lignes pour `post_transaction` : montants écrits comme nombres JSON à partir de leur forme décimale
 * exacte (`bigint.toString()`), jamais convertis en `number` (même texte JSON que les appels SQL du schéma).
 */
export function linesJson(lines: readonly { accountId: string; amount: bigint; memo?: string }[]): string {
  return `[${lines
    .map(
      (line) =>
        `{"account_id":${JSON.stringify(line.accountId)},"amount":${line.amount.toString()}` +
        `${line.memo === undefined ? '' : `,"memo":${JSON.stringify(line.memo)}`}}`,
    )
    .join(',')}]`;
}

/** Sérialise un objet JSON dont des valeurs peuvent être des bigint (écrits comme nombres exacts). */
export function jsonWithBigint(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? `\u0000${v.toString()}\u0000` : v)).replace(
    /"\\u0000(-?\d+)\\u0000"/g,
    '$1',
  );
}

/**
 * Verrou de transaction sur (grand livre, clé) : deux commandes de même clé s'exécutent l'une après l'autre, ce qui
 * rend exacte la lecture « la transaction existait-elle déjà ? » faite juste après (voir LedgerEngineService).
 */
export async function lockIdempotencyKey(client: Queryable, ledgerId: string, key: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('engine-key:' || $1 || ':' || $2, 0))`, [ledgerId, key]);
}

export async function findTransactionId(client: Queryable, ledgerId: string, key: string): Promise<string | undefined> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2',
    [ledgerId, key],
  );
  return rows[0]?.id;
}

export interface PostTransactionArgs {
  ledgerId: string;
  type: string;
  key: string;
  occurredAt: Date;
  source: string;
  linesJson: string;
  eventId?: string;
  reversesId?: string;
  createdBy?: string;
  approvedBy?: string;
  configVersionId?: string;
  deviceId?: string;
  mediaId?: string;
  metadataJson: string;
}

/** L'unique appel d'écriture d'une commande à lignes (SPECIFICATION §5.4, signature de post_transaction). */
export async function postTransaction(client: Queryable, args: PostTransactionArgs): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT post_transaction($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb) AS id`,
    [
      args.ledgerId,
      args.type,
      args.key,
      args.occurredAt.toISOString(),
      args.source,
      args.linesJson,
      args.eventId ?? null,
      args.reversesId ?? null,
      args.createdBy ?? null,
      args.approvedBy ?? null,
      args.configVersionId ?? null,
      args.deviceId ?? null,
      args.mediaId ?? null,
      args.metadataJson,
    ],
  );
  return rows[0]!.id;
}

// ------------------------------------------------------------------ fonctions déléguées (types construits par la base)

export interface MediaDepositState {
  depositStatus: string;
  assignments: number;
}

/** État de caution du support et rang de son détenteur (les clés internes des fonctions en dépendent). */
export async function readMediaDepositState(client: Queryable, mediaId: string): Promise<MediaDepositState | undefined> {
  const { rows } = await client.query<{ deposit_status: string; assignments: number }>(
    `SELECT m.deposit_status, (SELECT count(*)::int FROM media_assignment a WHERE a.media_id = m.id) AS assignments
       FROM media m WHERE m.id = $1`,
    [mediaId],
  );
  const row = rows[0];
  return row ? { depositStatus: row.deposit_status, assignments: row.assignments } : undefined;
}

export async function takeDeposit(client: Queryable, mediaId: string, moneyAccountId: string | null): Promise<string> {
  const { rows } = await client.query<{ outcome: string }>('SELECT take_deposit($1, $2) AS outcome', [mediaId, moneyAccountId]);
  return rows[0]!.outcome;
}

export async function refundDeposit(client: Queryable, mediaId: string, moneyAccountId: string | null): Promise<void> {
  await client.query('SELECT refund_deposit($1, $2)', [mediaId, moneyAccountId]);
}

export async function forfeitDeposit(client: Queryable, mediaId: string): Promise<void> {
  await client.query('SELECT forfeit_deposit($1)', [mediaId]);
}

export async function preloadMedia(client: Queryable, mediaId: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string | null }>('SELECT preload_media($1) AS id', [mediaId]);
  return rows[0]?.id ?? null;
}

export async function refundCashDue(
  client: Queryable,
  args: { mediaId: string; cashAccountId: string; key: string; actor: string; approver?: string; deviceId?: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>('SELECT refund_cash_due($1, $2, $3, $4, $5, $6) AS id', [
    args.mediaId,
    args.cashAccountId,
    args.key,
    args.actor,
    args.approver ?? null,
    args.deviceId ?? null,
  ]);
  return rows[0]!.id;
}
