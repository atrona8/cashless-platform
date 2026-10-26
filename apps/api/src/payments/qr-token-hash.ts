// Empreinte d'un jeton de paiement QR (mission 5b, lot WP11, T050 ; NFR-008 ; contracts/qr-payments.md).
// SHA-256 des octets UTF-8 du jeton TEL QUE REÇU : aucune normalisation (casse, espaces) que le contrat
// n'écrit pas. Seule cette empreinte passe à la base : le jeton lui-même n'est ni journalisé, ni audité,
// ni mis en métadonnée, ni dans `content_sha256`. Réutilisée sans modification par WP13 (création du
// jeton du QR commerçant) : le même jeton donne la même empreinte des deux côtés.
import { createHash } from 'node:crypto';

export function qrTokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
