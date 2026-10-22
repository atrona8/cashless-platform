// Aucun faux en production (règle du porteur du 13/10/2026, NFR-010) : un processus qui porte un faux service de clés,
// un faux terminal, un faux festivalier, une fausse autorité des terminaux, un faux signataire de jetons ou un faux
// vérificateur d'attestation refuse de démarrer en configuration de production. Aucun réglage ne désactive cette
// garde. Chaque point d'entrée l'appelle avant d'écouter.

export interface MaybeFake {
  readonly isFake?: boolean;
}

export class FakeInProductionError extends Error {
  constructor(readonly names: string[]) {
    super(
      `Démarrage refusé : ${names.join(', ')} ${names.length > 1 ? 'sont des faux' : 'est un faux'}, interdit en production`,
    );
    this.name = 'FakeInProductionError';
  }
}

/** `providers` : nom lisible → fournisseur réellement injecté dans le processus. */
export function assertNoFakeInProduction(
  production: boolean,
  providers: Record<string, object | null | undefined>,
): void {
  if (!production) return;
  const fakes = Object.entries(providers)
    .filter(([, provider]) => (provider as MaybeFake | null | undefined)?.isFake === true)
    .map(([name]) => name);
  if (fakes.length > 0) throw new FakeInProductionError(fakes);
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
