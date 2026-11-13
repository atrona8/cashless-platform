// Sondes SQL du banc (research R-28). Chacune prend une fonction de lecture (`centralQuery` ou
// `localQuery` du
// banc) : aucune ne lit l'horloge de PostgreSQL pour la comparer à celle de Node.
export type Query = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

/** Plus grand `posting.id` du central : le `W` de NFR-001 se relève à la bascule. */
export async function maxPostingId(central: Query): Promise<bigint> {
  const rows = await central<{ w: string }>('SELECT coalesce(max(id), 0)::text AS w FROM posting');
  return BigInt(rows[0]!.w);
}

export type Violation = {
  transaction_id: string;
  source: string;
  type: string;
  posting_id: string;
};

/**
 * NFR-001 (R-28) : débits de portefeuille (`WALLET_PAID` ou `WALLET_PROMO`, montant positif =
 * débit) écrits par
 * une source autre que `EDGE_SYNC` après `W`. Doit rendre 0 ligne après la bascule.
 */
export function exclusionViolations(
  central: Query,
  ledgerId: string,
  afterPostingId: bigint,
): Promise<Violation[]> {
  return central<Violation>(
    `SELECT t.id AS transaction_id, t.source, t.type, p.id::text AS posting_id
       FROM posting p
       JOIN journal_transaction t ON t.ledger_id = p.ledger_id AND t.id = p.transaction_id
       JOIN account a ON a.ledger_id = p.ledger_id AND a.id = p.account_id
      WHERE p.ledger_id = $1 AND p.id > $2 AND p.amount > 0
        AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO') AND t.source <> 'EDGE_SYNC'
      ORDER BY p.id`,
    [ledgerId, afterPostingId.toString()],
  );
}

/**
 * Même requête que `exclusionViolations`, bornée à la durée de l'autorité de la passerelle : `W`
 * est le
 * `watermark_posting_id` de la bascule `toEdgeId`, la borne haute la fin (`completed_at`) du rendu
 * `toCentralId` (le central débite de nouveau ensuite, légitimement). Comparaison faite par la base
 * seule (aucune horloge de Node).
 */
export function exclusionViolationsDuring(
  central: Query,
  ledgerId: string,
  toEdgeId: string,
  toCentralId: string,
): Promise<Violation[]> {
  return central<Violation>(
    `SELECT t.id AS transaction_id, t.source, t.type, p.id::text AS posting_id
       FROM debit_authority_handover e
       JOIN debit_authority_handover r ON r.id = $3 AND r.completed_at IS NOT NULL
       JOIN posting p ON p.ledger_id = e.ledger_id AND p.id > e.watermark_posting_id
       JOIN journal_transaction t ON t.ledger_id = p.ledger_id AND t.id = p.transaction_id
       JOIN account a ON a.ledger_id = p.ledger_id AND a.id = p.account_id
      WHERE e.id = $2 AND e.ledger_id = $1 AND p.amount > 0
        AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO') AND t.source <> 'EDGE_SYNC'
        AND t.recorded_at < r.completed_at
      ORDER BY p.id`,
    [ledgerId, toEdgeId, toCentralId],
  );
}

export interface Continuity {
  count: number;
  distinct: number;
  min: number;
  max: number;
  /** Numéros manquants entre 1 et `max` (vide si continu). */
  gaps: number[];
  duplicates: number;
  contiguousAtGateway: number;
}

/** `edge_seq` du registre du central pour une passerelle : 1..N continus, aucun doublon. */
export async function edgeSeqContinuity(central: Query, gatewayId: string): Promise<Continuity> {
  const rows = await central<{
    n: string;
    d: string;
    lo: string | null;
    hi: string | null;
    gaps: string[] | null;
    contiguous: string;
  }>(
    `WITH r AS (SELECT x.edge_seq FROM edge_sync_batch_result x
                  JOIN edge_sync_batch b ON b.batch_id = x.batch_id WHERE b.gateway_id = $1)
     SELECT (SELECT count(*) FROM r)::text AS n,
            (SELECT count(DISTINCT edge_seq) FROM r)::text AS d,
            (SELECT min(edge_seq) FROM r)::text AS lo, (SELECT max(edge_seq) FROM r)::text AS hi,
            (SELECT array_agg(g::text)
               FROM generate_series(1, coalesce((SELECT max(edge_seq) FROM r), 0)) g
              WHERE NOT EXISTS (SELECT 1 FROM r WHERE r.edge_seq = g)) AS gaps,
            (SELECT contiguous_edge_seq FROM edge_gateway WHERE id = $1)::text AS contiguous`,
    [gatewayId],
  );
  const row = rows[0]!;
  return {
    count: Number(row.n),
    distinct: Number(row.d),
    min: Number(row.lo ?? 0),
    max: Number(row.hi ?? 0),
    gaps: (row.gaps ?? []).map(Number),
    duplicates: Number(row.n) - Number(row.d),
    contiguousAtGateway: Number(row.contiguous),
  };
}

/** Chaîne du central et chaîne locale (tête) : égales après vidage complet. */
export async function chainsEqual(
  central: Query,
  local: Query,
  gatewayId: string,
): Promise<{ equal: boolean; centralHex: string | null; localHex: string | null; seq: string }> {
  const c = (
    await central<{ h: Buffer | null }>(
      'SELECT last_chain_hash AS h FROM edge_gateway WHERE id = $1',
      [gatewayId],
    )
  )[0];
  const l = (
    await local<{ h: Buffer; s: string }>(
      'SELECT last_chain_hash AS h, last_edge_seq::text AS s FROM edge_chain_head',
    )
  )[0]!;
  const centralHex = c?.h ? c.h.toString('hex') : null;
  const localHex = l.h.toString('hex');
  return { equal: centralHex === localHex, centralHex, localHex, seq: l.s };
}

export interface Balance {
  paid: bigint;
  promo: bigint;
}

/** Soldes du central (crédit moins débit) par portefeuille du grand livre. */
export async function centralBalances(
  central: Query,
  ledgerId: string,
): Promise<Map<string, Balance>> {
  const rows = await central<{ wallet_id: string; paid: string; promo: string }>(
    `SELECT a.wallet_id,
            coalesce(-sum(p.amount) FILTER (WHERE a.purpose = 'WALLET_PAID'), 0)::text AS paid,
            coalesce(-sum(p.amount) FILTER (WHERE a.purpose = 'WALLET_PROMO'), 0)::text AS promo
       FROM account a LEFT JOIN posting p ON p.ledger_id = a.ledger_id AND p.account_id = a.id
      WHERE a.ledger_id = $1 AND a.purpose IN ('WALLET_PAID', 'WALLET_PROMO')
      GROUP BY a.wallet_id`,
    [ledgerId],
  );
  return new Map(rows.map((r) => [r.wallet_id, { paid: BigInt(r.paid), promo: BigInt(r.promo) }]));
}

/** Soldes de la passerelle : central répliqué plus variations locales non encore appliquées. */
export async function localBalances(local: Query): Promise<Map<string, Balance>> {
  const rows = await local<{ wallet_id: string; paid: string; promo: string }>(
    `SELECT w.wallet_id,
            (w.central_paid + coalesce((SELECT sum(paid_delta) FROM edge_op_delta d
               WHERE d.wallet_id = w.wallet_id
                 AND d.edge_seq > w.applied_edge_seq), 0))::text AS paid,
            (w.central_promo + coalesce((SELECT sum(promo_delta) FROM edge_op_delta d
               WHERE d.wallet_id = w.wallet_id
                 AND d.edge_seq > w.applied_edge_seq), 0))::text AS promo
       FROM edge_wallet w`,
  );
  return new Map(rows.map((r) => [r.wallet_id, { paid: BigInt(r.paid), promo: BigInt(r.promo) }]));
}

/** Différences de solde entre deux relevés, sur les portefeuilles de `wallets` (vide = égaux). */
export function balanceDiff(
  a: Map<string, Balance>,
  b: Map<string, Balance>,
  wallets: Iterable<string>,
): string[] {
  const out: string[] = [];
  for (const id of wallets) {
    const x = a.get(id);
    const y = b.get(id);
    if (!x || !y || x.paid !== y.paid || x.promo !== y.promo)
      out.push(`${id}: ${JSON.stringify(x, bigintJson)} <> ${JSON.stringify(y, bigintJson)}`);
  }
  return out;
}

const bigintJson = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? String(v) : v);

/** Lignes d'anomalie du central (SC-001 : aucune inattendue). */
export function anomalies(central: Query): Promise<Array<{ kind: string; n: string }>> {
  return central<{ kind: string; n: string }>(
    'SELECT kind, count(*)::text AS n FROM anomaly GROUP BY kind ORDER BY kind',
  );
}
