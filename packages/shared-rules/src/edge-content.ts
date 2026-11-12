// Contenu haché d'une opération de passerelle et charge utile de signature d'un lot (research R-12, R-13).
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { chainedContent } from './chained-content';

/** Opération de passerelle, forme minimale (le contrat complet est `EdgeSyncOperation` de `@cashless/contracts`). */
export interface EdgeSyncOperationLike {
  edge_seq: bigint | number;
  device_serial: string;
  authorized_mode: string;
  device_batch_id?: string;
  edge_guichet?: object;
  edge_decision?: object;
  [field: string]: unknown;
}

/** Lot de passerelle, forme minimale ; tout champ inconnu est conservé tel quel dans la charge utile. */
export interface EdgeSyncBatchLike {
  signature?: unknown;
  [field: string]: unknown;
}

/** `edge_seq` en nombre JSON : entier sûr positif ou nul (au-delà de 2^53 - 1, JCS ne le représente pas exactement). */
function edgeSeqToJson(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('edgeContent : edge_seq hors des entiers sûrs');
    return Number(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error('edgeContent : edge_seq doit être un entier sûr (bigint ou nombre)');
}

/**
 * Objet dont on prend l'empreinte : les onze champs chaînés (`chainedContent`), puis `edge_seq`, `device_serial`,
 * `authorized_mode`, puis `device_batch_id`, `edge_guichet` et `edge_decision` quand ils sont présents. La décision
 * est INCLUSE : sans elle, un maillon altéré changerait le résultat sans rompre la chaîne.
 */
export function edgeContent(op: EdgeSyncOperationLike): object {
  if (typeof op.device_serial !== 'string' || typeof op.authorized_mode !== 'string')
    throw new Error('edgeContent : device_serial et authorized_mode sont obligatoires');
  const out: Record<string, unknown> = {
    ...chainedContent(op),
    edge_seq: edgeSeqToJson(op.edge_seq),
    device_serial: op.device_serial,
    authorized_mode: op.authorized_mode,
  };
  if (op.device_batch_id !== undefined) out.device_batch_id = op.device_batch_id;
  if (op.edge_guichet !== undefined) out.edge_guichet = op.edge_guichet;
  if (op.edge_decision !== undefined) out.edge_decision = op.edge_decision;
  return out;
}

function jcs(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new Error('forme canonique impossible');
  return canonical;
}

/** SHA-256 de `JCS(edgeContent(op))`. */
export function edgeContentSha256(op: EdgeSyncOperationLike): Buffer {
  return createHash('sha256')
    .update(jcs(edgeContent(op)), 'utf8')
    .digest();
}

/** Octets de `JCS(lot sans le champ signature)` : la signature couvre tout le reste, `staff_token_audit` compris. */
export function batchSigningPayload(batch: EdgeSyncBatchLike): Buffer {
  const { signature: _signature, ...rest } = batch;
  return Buffer.from(jcs(rest), 'utf8');
}
