// Marquage d'une route d'écriture idempotente et transaction métier mise à disposition du contrôleur.
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TxClient } from '../db/tenant-tx';

export const IDEMPOTENT = Symbol('IDEMPOTENT');

export interface IdempotentOptions {
  /** Portée de la clé : `app:`, `bo:`, `pos:<client_id>:` ou `device:<serial>` (calculée depuis la requête). */
  scope: string | ((req: Request) => string);
  /**
   * Route qui écrit (défaut : `true`) : elle doit passer par `IdempotentTx.run`. Si le contrôleur rend sa valeur sans
   * l'avoir appelé, la requête échoue en 500 et la clé est relâchée (RISK-2 de la mission 1). `false` : la réponse
   * est enregistrée seule, sans transaction métier.
   */
  writes?: boolean;
  /**
   * Niveau de la clé et de la transaction métier (contrat platform-access). `true` : route de plateforme — clé sans
   * prestataire, transaction du rôle de la plateforme, `PLATFORM_ADMIN` exigé. `'principal'` : route commune aux
   * deux niveaux — plateforme si la personne authentifiée n'a pas de prestataire, sinon son prestataire. Déclaré
   * par la route seulement : rien de ce que la requête transporte (en-tête, chemin, corps) n'en décide.
   */
  platform?: boolean | 'principal';
  /**
   * Réponse à ne jamais conserver (elle porte un secret remis une seule fois, comme le fichier de commande des codes
   * de rattachement). La clé protège toujours contre un double envoi, mais le registre ne garde que « déjà exécutée,
   * non rejouable » : un nouvel envoi de la même clé reçoit `409`, jamais la réponse d'origine.
   */
  transient?: boolean;
}

/** Route d'écriture : `Idempotency-Key` obligatoire, réponse enregistrée et rejouée (SPECIFICATION §10.2). */
export const Idempotent = (options: IdempotentOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(IDEMPOTENT, options);

/**
 * Transaction métier d'une requête idempotente : `run` ouvre la transaction cloisonnée du prestataire (ou celle de
 * la plateforme pour une route `platform`), exécute `fn`
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
