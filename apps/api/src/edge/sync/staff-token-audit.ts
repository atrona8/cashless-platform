// `staff_token_audit` (WP13, T062 ; décision 18) : chaque ligne désigne une opération du lot
// (intervalle
// `edge_seq_from..edge_seq_to`) ; la signature du lot les couvre déjà (elles sont dans le JCS
// signé). Une ligne hors
// intervalle ou hors d'une opération du lot : `400`, lot non traité, rien d'écrit. Le versement
// est fait par
// `edge_record_staff_token_audit` (audit `EDGE_STAFF_TOKEN_TOLERATED`), après le traitement des
// opérations.
import { ProblemException } from '../../errors/problem';
import type { ParsedEdgeBatch } from './edge-sync-body';

const refuse = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });

/** Lignes à verser (tableau vide si le lot n'en porte pas). Lève avant toute écriture. */
export function staffTokenRows(batch: ParsedEdgeBatch): Array<Record<string, unknown>> {
  const rows = (batch.raw.staff_token_audit as Array<Record<string, unknown>> | undefined) ?? [];
  const seen = new Set<string>();
  for (const row of rows) {
    const seq = row?.edge_seq;
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq))
      throw refuse('staff_token_audit : edge_seq invalide.');
    const n = BigInt(seq);
    if (n < batch.from || n > batch.to)
      throw refuse('staff_token_audit : une ligne est hors de l’intervalle du lot.');
    if (seen.has(String(seq))) throw refuse('staff_token_audit : deux lignes pour un même numéro.');
    seen.add(String(seq));
  }
  return rows;
}
