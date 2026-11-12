// Autorité des passerelles locales (mission passerelle-locale, WP10, interfaces.md § 4, research R-04) : seconde
// autorité, distincte de celle des terminaux. Aujourd'hui seul un faux existe (refusé en production par
// `assertProcessIsSafe`, test de démarrage réel) ; l'adaptateur réel arrive avec la mission 12b (dette consignée au
// plan : « autorité des passerelles simulée jusqu'à 12b »).

export { EDGE_CA } from '../security/port-tokens';

export interface EdgeCaPort {
  readonly isFake?: boolean;
  /** Certificat de l'autorité (PEM) : `EDGE_CA_CERT_FILE`, seule autorité cliente de l'écouteur `edge`. */
  caCertPem(): string;
  /**
   * Émet le certificat client (PEM) d'une passerelle à partir d'un CSR PKCS#10 (PEM) et du numéro de série de la
   * passerelle. Le sujet vient du serveur (`serial`), jamais du CSR.
   */
  issue(csrPem: string, serial: string): Promise<string>;
}
