// Traduction des refus d'autorité en problèmes du contrat (interfaces.md § 7,
// gateway-served-operations.md « Comportements communs »). Aucun débit n'est écrit, aucun numéro de
// file consommé : l'appelant a annulé sa transaction.
import { AuthorityRefusal } from '../../authority/authority.service';
import { ProblemException } from '../../device-proofs/problem';

export function refusalToProblem(refusal: AuthorityRefusal): ProblemException {
  switch (refusal.code) {
    case 'DEBIT_AUTHORITY_MOVING':
      return new ProblemException('DEBIT_AUTHORITY_MOVING', {
        extensions: { authority_epoch: refusal.authorityEpoch, retryable: true },
      });
    case 'STALE_AUTHORITY_EPOCH':
      return new ProblemException('STALE_AUTHORITY_EPOCH', {
        extensions: { authority_epoch: refusal.authorityEpoch },
      });
    case 'CONFLICT_STATE':
      return new ProblemException('CONFLICT_STATE', {
        detail: refusal.detail ?? 'GATEWAY_NOT_AUTHORITY',
        extensions: { authority_epoch: refusal.authorityEpoch, retryable: false },
      });
  }
}

/** Exécute `fn` en traduisant un refus d'autorité ; toute autre erreur passe telle quelle. */
export async function withAuthorityProblems<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AuthorityRefusal) throw refusalToProblem(error);
    throw error;
  }
}
