// Jeu de ventes de la mission routes-backoffice (WP06) : posé en SQL propriétaire, sans passer par le paiement
// (la création d'une vente est prouvée par ses propres suites). `session_replication_role = replica` écarte les
// clés étrangères et déclencheurs du grand livre le temps de l'insertion (lignes de vente, vendeurs, sessions) ;
// les CHECK de table restent actifs. Les ventes servent à la lecture seule.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { MediaWorld } from '../../support/media-fixtures';

export interface SalesFixture {
  operatorId: string;
  eventId: string;
  merchants: [string, string];
  /** `pos[i]` appartient à `merchants[i]`. */
  pos: [string, string];
  vendors: [string, string];
  devices: [string, string];
  /** Identifiants des ventes, de la plus ancienne (n = 1) à la plus récente. */
  sales: string[];
  /** Vente annulée et sa contre-passation. */
  reversedId: string;
  reversalId: string;
  /** Vente hors ligne (occurred_at d'origine, ancien) et vente avec lignes. */
  offlineId: string;
  withLinesId: string;
  /** Ventes par commerçant (indice). */
  byMerchant: [number, number];
}

export interface SeedOptions {
  /** Nombre de ventes. */
  count: number;
  /** Première vente à cet instant ; une vente toutes les `step` ventes partage la même seconde (égalités). */
  start?: string;
  /** Nombre de ventes par seconde (égalités d'`occurred_at`). */
  perSecond?: number;
  /** Poser des annulations et des lignes (jeu de la recette) ; sinon ventes simples. */
  rich?: boolean;
}

/** Parties, terminaux et comptes d'un événement, puis `count` ventes. */
export async function seedSales(
  db: Client,
  w: Pick<MediaWorld, 'ops' | 'ids'>,
  options: SeedOptions,
): Promise<SalesFixture> {
  const operatorId = w.ops.a;
  const eventId = w.ids.eventA;
  const ledgerId = w.ids.ledgerA;
  const tag = randomUUID().slice(0, 8);
  const ids = () => [randomUUID(), randomUUID()] as [string, string];
  const merchants = ids();
  const parts = ids();
  const pos = ids();
  const devices = ids();
  const vendors = ids();
  const sessions = ids();
  const accounts = ids();
  const walletAccount = randomUUID();
  const walletId = randomUUID();
  await db.query('BEGIN');
  await db.query('SET LOCAL session_replication_role = replica');
  for (let i = 0; i < 2; i++) {
    await db.query(
      `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'MERCHANT', $2, $3)`,
      [merchants[i], operatorId, `Commerçant ${tag}-${i}`],
    );
    await db.query(
      `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type, payout_to)
       VALUES ($1, $2, $3, $4, 'INTERNAL', $5)`,
      [parts[i], operatorId, eventId, merchants[i], w.ids.organizerA],
    );
    await db.query(
      `INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES ($1, $2, $3, $4)`,
      [pos[i], operatorId, parts[i], `PDV ${tag}-${i}`],
    );
    await db.query(
      `INSERT INTO device (id, operator_id, kind, app_mode, event_id, pos_id, serial, status)
       VALUES ($1, $2, 'POS', 'CATALOG_POS', $3, $4, $5, 'ACTIVE')`,
      [devices[i], operatorId, eventId, pos[i], `S-${tag}-${i}`],
    );
    await db.query(
      `INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, participation_id, normal_side)
       VALUES ($1, $2, $3, $4, 'CLAIM', 'MERCHANT', $5, 'C')`,
      [accounts[i], operatorId, ledgerId, `MER-${tag}-${i}`, parts[i]],
    );
  }
  await db.query(
    `INSERT INTO account (id, operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
     VALUES ($1, $2, $3, $4, 'CLAIM', 'WALLET_PAID', $5, 'C')`,
    [walletAccount, operatorId, ledgerId, `WAL-${tag}`, walletId],
  );
  // Vendeurs et sessions : factices (clés étrangères écartées), seulement lus par la vue.
  const gen = `generate_series(1, ${options.count}) n`;
  const perSecond = options.perSecond ?? 3;
  const start = options.start ?? '2026-06-01T10:00:00Z';
  await db.query(
    `INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
            request_hash, occurred_at, recorded_at, source, device_id)
     SELECT gen_random_uuid(), $1, $2, $3, 'PURCHASE', $4 || ':' || n, 'h',
            $5::timestamptz + (n / ${perSecond}) * interval '1 second'
              + (n % 2) * interval '100 microseconds'
              ${options.rich ? "- CASE WHEN n % 10 = 0 THEN interval '3 days' ELSE interval '0' END" : ''},
            now(),
            CASE WHEN ${options.rich ? 'n % 10 = 0' : 'false'} THEN 'OFFLINE_SYNC'
                 WHEN ${options.rich ? 'n % 15 = 1' : 'false'} THEN 'EDGE_SYNC' ELSE 'ONLINE' END,
            ($6::uuid[])[1 + n % 2]
       FROM ${gen}`,
    [operatorId, ledgerId, eventId, `sale:${tag}`, start, devices],
  );
  const sales = await db.query<{ id: string; n: number }>(
    `SELECT id, split_part(idempotency_key, ':', 3)::int AS n FROM journal_transaction
      WHERE idempotency_key LIKE $1 ORDER BY split_part(idempotency_key, ':', 3)::int`,
    [`sale:${tag}:%`],
  );
  await db.query(
    `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
     SELECT $1, $2, t.id, l, CASE WHEN l = 1 THEN $3::uuid ELSE ($4::uuid[])[1 + n % 2] END,
            CASE WHEN l = 1 THEN 500 + n ELSE -(500 + n) END
       FROM (SELECT id, split_part(idempotency_key, ':', 3)::int AS n FROM journal_transaction
              WHERE idempotency_key LIKE $5) t, generate_series(1, 2) l`,
    [operatorId, ledgerId, walletAccount, accounts, `sale:${tag}:%`],
  );
  await db.query(
    `INSERT INTO sale_attribution (transaction_id, operator_id, vendor_id, vendor_session_id, device_id, channel)
     SELECT t.id, $1, ($2::uuid[])[1 + (n / 2) % 2], ($3::uuid[])[1 + (n / 2) % 2],
            ($4::uuid[])[1 + n % 2], 'NFC'
       FROM (SELECT id, split_part(idempotency_key, ':', 3)::int AS n FROM journal_transaction
              WHERE idempotency_key LIKE $5) t`,
    [operatorId, vendors, sessions, devices, `sale:${tag}:%`],
  );
  const byN = new Map(sales.rows.map((r) => [r.n, r.id]));
  let reversedId = '';
  let reversalId = '';
  let offlineId = '';
  let withLinesId = '';
  if (options.rich) {
    reversedId = byN.get(7)!;
    offlineId = byN.get(10)!;
    withLinesId = byN.get(3)!;
    reversalId = randomUUID();
    await db.query(
      `INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
              request_hash, occurred_at, recorded_at, source, device_id, reverses_id)
       SELECT $1, operator_id, ledger_id, event_id, 'REVERSAL', 'rev:' || $2::text, 'h',
              occurred_at + interval '1 minute', now(), 'ONLINE', device_id, id
         FROM journal_transaction WHERE id = $3`,
      [reversalId, tag, reversedId],
    );
    await db.query(
      `INSERT INTO sale_line (operator_id, transaction_id, line_no, pos_id, item_id, catalog_version,
              label_fr, label_en, quantity, unit_price, vat_rate_bps, line_total)
       VALUES ($1, $2, 1, $3, $4, 1, 'Bière', 'Beer', 2, 250, 1800, 500),
              ($1, $2, 2, $3, $5, 1, 'Eau', 'Water', 1, 100, 0, 100)`,
      [operatorId, withLinesId, pos[1], randomUUID(), randomUUID()],
    );
  }
  await db.query('COMMIT');
  const byMerchant: [number, number] = [0, 0];
  for (const r of sales.rows) byMerchant[r.n % 2]!++;
  return {
    operatorId,
    eventId,
    merchants,
    pos,
    vendors,
    devices,
    sales: sales.rows.map((r) => r.id),
    reversedId,
    reversalId,
    offlineId,
    withLinesId,
    byMerchant,
  };
}
