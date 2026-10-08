// Marquage d'une route d'écriture idempotente et transaction métier mise à disposition du contrôleur.
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TxClient } from '../db/tenant-tx';

export const IDEMPOTENT = Symbol('IDEMPOTENT');

export interface IdempotentOptions {
  /** Portée de la clé : `app:`, `bo:`, `pos:<client_id>:` ou `device:<serial>` (calculée depuis la requête). */
  scope: string | ((req: Request) => string);
}

/** Route d'écriture : `Idempotency-Key` obligatoire, réponse enregistrée et rejouée (SPECIFICATION §10.2). */
export const Idempotent = (options: IdempotentOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(IDEMPOTENT, options);

/**
 * Transaction métier d'une requête idempotente : `run` ouvre la transaction cloisonnée du prestataire, exécute `fn`
 * puis enregistre la réponse (statut de la route, valeur rendue par `fn`) **dans la même transaction** avant le
 * COMMIT. La valeur rendue par `fn` est la réponse envoyée, à la première exécution comme au rejeu.
 */
export interface IdempotentTx {
  run<T>(fn: (client: TxClient) => Promise<T>): Promise<T>;
}

export interface IdempotentRequest extends Request {
  idempotentTx?: IdempotentTx;
}

/** Paramètre de contrôleur : `@IdempotentTransaction() tx: IdempotentTx` (route marquée `@Idempotent` seulement). */
export const IdempotentTransaction = createParamDecorator((_data: unknown, context: ExecutionContext): IdempotentTx => {
  const tx = context.switchToHttp().getRequest<IdempotentRequest>().idempotentTx;
  if (!tx) throw new Error('@IdempotentTransaction() utilisé sur une route non marquée @Idempotent');
  return tx;
});
