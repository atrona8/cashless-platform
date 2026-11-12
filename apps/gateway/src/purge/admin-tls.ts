// TLS du port d'administration local (décision 47 du porteur, plan WP17/WP24).
// Certificat et clé DÉDIÉS (`GATEWAY_ADMIN_TLS_CERT_FILE` / `GATEWAY_ADMIN_TLS_KEY_FILE`, montés
// depuis le dossier de site, jamais dans l'image), distincts de ceux des terminaux. Pas de
// certificat client demandé : l'ordre est authentifié par ses deux signatures, TLS protège le
// canal.
// En production : démarrage REFUSÉ sans cette paire (règle enregistrée dans la garde de démarrage,
// et seconde ceinture dans `AdminListener.start`). Hors production (`development`, `test`) : le
// clair
// reste permis, comme l'écoute des terminaux (`tlsServerOptions`).
import { readFileSync } from 'node:fs';
import type { SecureContextOptions } from 'node:tls';
import type { GatewayConfig } from '../config/config';
import { registerProductionRule } from '../processes/startup-guard';

export type AdminTlsOptions = Pick<SecureContextOptions, 'key' | 'cert' | 'minVersion'>;

export const ADMIN_TLS_VIOLATION =
  'GATEWAY_ADMIN_TLS_CERT_FILE / GATEWAY_ADMIN_TLS_KEY_FILE : port d’administration sans TLS ' +
  'interdit en production';

export function adminTlsOptions(
  config: Pick<GatewayConfig, 'adminTlsCertFile' | 'adminTlsKeyFile'>,
): AdminTlsOptions | undefined {
  if (config.adminTlsCertFile == null || config.adminTlsKeyFile == null) return undefined;
  const read = (name: string, file: string): Buffer => {
    try {
      return readFileSync(file);
    } catch {
      throw new Error(`${name} : fichier illisible`); // nomme la variable, jamais le contenu
    }
  };
  return {
    key: read('GATEWAY_ADMIN_TLS_KEY_FILE', config.adminTlsKeyFile),
    cert: read('GATEWAY_ADMIN_TLS_CERT_FILE', config.adminTlsCertFile),
    minVersion: 'TLSv1.3',
  };
}

registerProductionRule('GATEWAY_ADMIN_TLS', ({ config }) =>
  config.adminTlsCertFile === null || config.adminTlsKeyFile === null ? ADMIN_TLS_VIOLATION : null,
);
