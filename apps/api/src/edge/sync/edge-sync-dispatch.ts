// Choix de l'enveloppe SQL par type d'opération (WP13, T059). Seules les enveloppes `edge_*`
// écrivent : jamais
// `post_transaction`, jamais `record_edge_seq` brute (interfaces.md § 2).
import type { ParsedEdgeOp } from './edge-sync-body';

export type Dispatch =
  | {
      kind: 'ENVELOPE';
      fn: 'edge_post_transaction' | 'edge_activate_media' | 'edge_take_deposit' | 'edge_topup_cash';
    }
  /**
   * Numéro consommé sans écriture : `VOID`, ou rejet décidé ici (l'enveloppe SQL n'a rien à
   * décider).
   */
  | { kind: 'RECORD'; outcome: 'VOID' | 'REJECTED'; reason: string; detail: string | null };

export function dispatch(op: ParsedEdgeOp): Dispatch {
  switch (op.type) {
    case 'ACTIVATION':
      return { kind: 'ENVELOPE', fn: 'edge_activate_media' };
    case 'DEPOSIT_CASH':
      return { kind: 'ENVELOPE', fn: 'edge_take_deposit' };
    case 'TOPUP_CASH':
      // Dans un lot de terminal relayé : toujours rejeté (C-006) ; dans la file de la passerelle :
      // rejoué.
      return op.mode === 'DEVICE_OFFLINE'
        ? {
            kind: 'RECORD',
            outcome: 'REJECTED',
            reason: 'OFFLINE_NOT_ALLOWED',
            detail: 'TOPUP_CASH_RELAYED',
          }
        : { kind: 'ENVELOPE', fn: 'edge_topup_cash' };
    case 'VOID':
      return {
        kind: 'RECORD',
        outcome: 'VOID',
        reason:
          typeof op.raw.void_reason === 'string' && op.raw.void_reason !== ''
            ? op.raw.void_reason
            : 'VOID',
        detail: null,
      };
    case 'ONLINE_REF':
      // Un terminal seul envoie ONLINE_REF : une passerelle n'en relaie pas.
      return {
        kind: 'RECORD',
        outcome: 'REJECTED',
        reason: 'MALFORMED_OPERATION',
        detail: 'ONLINE_REF_NOT_ALLOWED',
      };
    default:
      // PURCHASE, REVERSAL ; tout autre type est refusé par l'enveloppe (liste blanche SQL, A.4
      // bis 1).
      return { kind: 'ENVELOPE', fn: 'edge_post_transaction' };
  }
}
