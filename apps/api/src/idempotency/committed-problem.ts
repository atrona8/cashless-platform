// Problème « validé » (mission identite-roles, WP07, research R-08) : levé À L'INTÉRIEUR de `IdempotentTx.run`, il
// n'annule pas la transaction métier. Le problème est enregistré comme réponse de la clé dans la même transaction,
// validé avec le travail fait, puis envoyé (et rejoué à l'identique).
//
// Réservé au cas où l'état écrit est exactement l'état voulu malgré le refus (ex. demande d'approbation passée à
// EXPIRED, réponse 409 APPROVAL_INVALID). Ne JAMAIS l'utiliser pour valider un travail partiel : toute autre erreur
// doit annuler la transaction.
import type { ProblemCode } from '@cashless/contracts';
import { ProblemException, type ProblemOptions } from '../errors/problem';

export class CommittedProblem extends ProblemException {
  constructor(code: ProblemCode, options: ProblemOptions = {}) {
    super(code, options);
    this.name = 'CommittedProblem';
  }
}
