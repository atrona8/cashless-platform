// Port : résolution des références de comptes (AccountRef) en identifiants, une seule requête par écriture.
// Le client `pg` est fourni par l'appelant (transaction ouverte par withTenantTx, WP10) : aucun accès au pool ici.
import { BuildError, type AccountRef } from '../types';

export interface AccountRow {
  id: string;
  code: string;
  purpose: string;
  owner_party_id: string | null;
  wallet_id: string | null;
  participation_id: string | null;
}

/** Ce dont le résolveur a besoin d'un client `pg` (PoolClient ou Client). */
export interface Queryable {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export interface AccountResolver {
  resolve(client: Queryable, ledgerId: string, refs: readonly AccountRef[]): Promise<Map<AccountRef, string>>;
}

export const ACCOUNT_RESOLVER = Symbol('ACCOUNT_RESOLVER');

const label = (ref: AccountRef): string => ('code' in ref ? ref.code : JSON.stringify(ref));

function matches(row: AccountRow, ref: AccountRef): boolean {
  if ('code' in ref) return row.code === ref.code;
  // Chaque critère présent dans la référence doit correspondre ; les critères absents ne filtrent pas.
  return (
    row.purpose === ref.purpose &&
    (ref.ownerPartyId === undefined || row.owner_party_id === ref.ownerPartyId) &&
    (ref.walletId === undefined || row.wallet_id === ref.walletId) &&
    (ref.participationId === undefined || row.participation_id === ref.participationId)
  );
}

/** Correspondance en mémoire ; référence introuvable ou ambiguë : VALIDATION_FAILED (« compte introuvable »). */
export function matchAccounts(rows: readonly AccountRow[], refs: readonly AccountRef[]): Map<AccountRef, string> {
  const resolved = new Map<AccountRef, string>();
  for (const ref of refs) {
    const found = rows.filter((row) => matches(row, ref));
    if (found.length === 0) throw new BuildError('VALIDATION_FAILED', `compte introuvable : ${label(ref)}`);
    if (found.length > 1) throw new BuildError('VALIDATION_FAILED', `compte ambigu : ${label(ref)}`);
    resolved.set(ref, found[0]!.id);
  }
  return resolved;
}

export const ACCOUNT_QUERY =
  'SELECT id, code, purpose, owner_party_id, wallet_id, participation_id FROM account ' +
  'WHERE ledger_id = $1 AND (code = ANY($2) OR purpose = ANY($3))';

export class SqlAccountResolver implements AccountResolver {
  async resolve(client: Queryable, ledgerId: string, refs: readonly AccountRef[]): Promise<Map<AccountRef, string>> {
    const codes = [...new Set(refs.flatMap((ref) => ('code' in ref ? [ref.code] : [])))];
    const purposes = [...new Set(refs.flatMap((ref) => ('purpose' in ref ? [ref.purpose] : [])))];
    const { rows } = await client.query<AccountRow>(ACCOUNT_QUERY, [ledgerId, codes, purposes]);
    return matchAccounts(rows, refs);
  }
}
