// Corps des routes de demande de WP13 (`requestLateChargeback`, `requestWalletUnblock`) : objet JSON VIDE. Tout champ
// reçu est refusé (`422`) : ni l'événement ni le prestataire ne viennent du corps, ils sont lus en base.
import { objectBody, unprocessable } from '../organization/platform/platform.dto';

export function parseEmptyBody(raw: unknown): void {
  const body = objectBody(raw);
  const keys = Object.keys(body);
  if (keys.length > 0) throw unprocessable(`Champ hors de la demande : ${keys.join(', ')}.`);
}
