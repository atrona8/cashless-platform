// Aucun faux en production (règle du porteur du 13/10/2026, NFR-010) : un processus qui porte un faux service de clés,
// un faux terminal, un faux festivalier, une fausse autorité des terminaux, un faux signataire de jetons ou un faux
// vérificateur d'attestation, ou une fausse copie externe des scellements (mission 9b, WP12) refuse de démarrer en
// configuration de production. Aucun réglage ne désactive cette garde. Chaque point d'entrée l'appelle avant d'écouter.

import { PRODUCTION_ENABLED_SERVICES } from '../external-services/production-enabled';
import type { ExternalService } from '../external-services/services';

/** Fournisseur du service de clés du processus, quel qu'il soit : lu par la garde de production. */
export const KMS_PROVIDER = Symbol('KMS_PROVIDER');

export interface MaybeFake {
  readonly isFake?: boolean;
  /** Service externe d'un adaptateur RÉEL (`isFake === false`) : il doit figurer dans la liste des services essayés. */
  readonly service?: string;
}

export class FakeInProductionError extends Error {
  constructor(readonly names: string[]) {
    super(
      `Démarrage refusé : ${names.join(', ')} ${names.length > 1 ? 'sont des faux' : 'est un faux'}, interdit en production`,
    );
    this.name = 'FakeInProductionError';
  }
}

/**
 * Un service réel qui n'a pas été essayé contre le vrai service (décisions D3 et D6 du porteur, 26/11/2026) : en
 * production, refus de démarrer, comme pour un faux. `service` est le nom de la liste `PRODUCTION_ENABLED_SERVICES`.
 */
export class UntriedInProductionError extends Error {
  constructor(readonly service: string) {
    super(
      `Démarrage refusé : ${service} n'a pas été essayé contre le vrai service ` +
        '(liste PRODUCTION_ENABLED_SERVICES)',
    );
    this.name = 'UntriedInProductionError';
  }
}

/**
 * `providers` : nom lisible → fournisseur réellement injecté dans le processus. Refuse un faux (`isFake === true`),
 * puis un adaptateur réel (`isFake === false`) dont le `service` n'est pas dans `enabled` (la liste du code ; le
 * paramètre ne sert qu'aux tests).
 */
export function assertNoFakeInProduction(
  production: boolean,
  providers: Record<string, object | null | undefined>,
  enabled: readonly ExternalService[] = PRODUCTION_ENABLED_SERVICES,
): void {
  if (!production) return;
  const entries = Object.entries(providers) as Array<[string, MaybeFake | null | undefined]>;
  const fakes = entries.filter(([, provider]) => provider?.isFake === true).map(([name]) => name);
  if (fakes.length > 0) throw new FakeInProductionError(fakes);
  for (const [, provider] of entries) {
    if (
      provider?.isFake === false &&
      typeof provider.service === 'string' &&
      !(enabled as readonly string[]).includes(provider.service)
    )
      throw new UntriedInProductionError(provider.service);
  }
}

/** Ce que le processus sert réellement : HTTPS (certificat configuré) ou clair, et ses répartiteurs de confiance. */
export interface ServedTransport {
  production: boolean;
  /** Le processus termine TLS lui-même (certificat et clé configurés). */
  tls: boolean;
  trustProxyHops: number;
}

export class UnsafeTransportError extends Error {
  constructor(reason: string) {
    super(`Démarrage refusé : ${reason}`);
    this.name = 'UnsafeTransportError';
  }
}

/**
 * Transport d'un processus HTTP en production (research R-03, OP-N53) : jamais d'écoute en clair ; et, puisque le
 * processus termine TLS (répartiteur en passage TCP), aucun répartiteur n'ajoute `X-Forwarded-For` : un
 * `TRUST_PROXY_HOPS` > 0 ferait croire à Express un en-tête forgé par le client. Aucun réglage ne désactive ce contrôle.
 */
export function assertSafeTransport(transport: ServedTransport): void {
  if (!transport.production) return;
  if (!transport.tls)
    throw new UnsafeTransportError(
      'écoute en clair interdite en production (TLS_CERT_FILE, TLS_KEY_FILE, research R-03)',
    );
  if (transport.trustProxyHops !== 0)
    throw new UnsafeTransportError(
      `TRUST_PROXY_HOPS = ${transport.trustProxyHops} alors que le processus sert TLS lui-même : 0 exigé ` +
        '(aucun répartiteur ne pose X-Forwarded-For en passage TCP ; OP-N53, research R-03)',
    );
}
