// Table UNIQUE des demandes que la passerelle refuse pendant `EDGE` (gateway-served-operations.md,
// « Opérations refusées pendant EDGE » ; interfaces.md § 7). Chaque refus : RIEN d'écrit, aucun
// numéro de file consommé, `409 DEBIT_AUTHORITY_EDGE`, `retryable: false`, SANS `edge_base_url` (la
// passerelle est déjà l'adresse indiquée : le terminal ne doit pas boucler sur elle), AVEC l'époque.
//
// WP22 (activation, caution, frais d'activation) s'appuie sur cette table pour `FROM_BALANCE` ;
// WP21 s'en sert pour le QR client et la restitution. Les états `ARMED`/`STANDBY`/`RELEASING`/
// `STALE`/`REVOKED` sont refusés par `AuthorityService.assertCanDebit` (`authorityProblem`).
// Fichier à faire relire par une personne : c'est lui qui borne ce que la passerelle refuse.
import {
  Inject,
  Injectable,
  RequestMethod,
  type MiddlewareConsumer,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { GatewayTx } from '../../db/gateway-tx';
import { PROBLEM_CONTENT_TYPE, ProblemException, problemBody } from '../../device-proofs/problem';

export const UNAVAILABLE_OPERATIONS = {
  /** Caution prélevée sur le solde (`activateMedia`, `takeDeposit`). */
  DEPOSIT_FROM_BALANCE: {
    where: ['activateMedia', 'takeDeposit'],
    detail: 'La caution prélevée sur le solde est indisponible pendant EDGE.',
  },
  /** Frais d'activation prélevés sur le solde (`activateMedia`). */
  ACTIVATION_FEE_FROM_BALANCE: {
    where: ['activateMedia'],
    detail: 'Les frais d’activation prélevés sur le solde sont indisponibles pendant EDGE.',
  },
  /** Paiement par QR de l'application cliente (`createPayment`, note 7). */
  CUSTOMER_QR_PAYMENT: {
    where: ['createPayment'],
    detail: 'Le paiement par QR client est indisponible pendant EDGE.',
  },
  /** Restitution d'un bracelet (`releaseMedia` : refus nommé, route non servie). */
  RELEASE_MEDIA: {
    where: ['releaseMedia'],
    detail: 'La restitution d’un bracelet est indisponible pendant EDGE.',
  },
} as const;
export type UnavailableOperation = keyof typeof UNAVAILABLE_OPERATIONS;

/** Le refus à lever (rien n'est écrit par celui qui le lève). */
export function unavailableDuringEdge(
  kind: UnavailableOperation,
  authorityEpoch: number,
): ProblemException {
  return new ProblemException('DEBIT_AUTHORITY_EDGE', {
    detail: UNAVAILABLE_OPERATIONS[kind].detail,
    extensions: { authority_epoch: authorityEpoch, retryable: false },
  });
}

/**
 * `POST /v1/media/{media_id}/release` : route NON servie (pas `x-edge-available`) mais refus nommé
 * du contrat (« Indisponible pendant EDGE »). Un middleware répond avant tout garde, sans rien
 * lire d'autre que l'époque détenue et sans rien écrire. Aucune autre route absente n'est
 * concernée : elles restent en `404` (`ServedOperationGuard`).
 */
@Injectable()
export class ReleaseMediaRefusal implements NestMiddleware {
  constructor(@Inject(GatewayTx) private readonly gatewayTx: GatewayTx) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const epoch = await this.gatewayTx.run(async (tx) => {
        const { rows } = await tx.query<{ epoch: string }>('SELECT epoch FROM edge_authority');
        return Number(rows[0]?.epoch ?? 0);
      });
      const problem = unavailableDuringEdge('RELEASE_MEDIA', epoch);
      res
        .status(problem.status)
        .type(PROBLEM_CONTENT_TYPE)
        .send(JSON.stringify(problemBody(problem, req)));
    } catch (error) {
      next(error);
    }
  }
}

export function routeUnavailableOperations(consumer: MiddlewareConsumer): void {
  consumer
    .apply(ReleaseMediaRefusal)
    .forRoutes({ path: 'v1/media/:media_id/release', method: RequestMethod.POST });
}
