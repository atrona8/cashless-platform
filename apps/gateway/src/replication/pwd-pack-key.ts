// Clé de contenu des colis de mots de passe : stockée SCELLÉE telle que reçue (enveloppe JSON), le
// descellement se fait à l'usage, en mémoire, par HARDWARE_KEYSTORE.agree (WP23). Les colis
// `pwd_pack_enc` restent chiffrés (nonce, texte chiffré, tag). Aucun mot de passe en clair.
// Une STANDBY non promue ne stocke ni colis ni clé (A16).
import type { TxClient } from '../db/gateway-tx';
import type { EncryptedBlob, WrappedKey } from './page-schema';

export const PWD_PACK_KEY_ID = 'current';

export function encodeBlob(blob: EncryptedBlob | null): Buffer | null {
  return blob === null ? null : Buffer.from(JSON.stringify(blob), 'utf8');
}

/** La clé est par passerelle, la même à chaque page : une seule ligne, remplacée. */
export async function storeSealedKey(tx: TxClient, key: WrappedKey): Promise<void> {
  await tx.query(
    `INSERT INTO edge_pwd_pack_key (key_id, sealed_key) VALUES ($1, $2)
     ON CONFLICT (key_id) DO UPDATE SET sealed_key = EXCLUDED.sealed_key`,
    [PWD_PACK_KEY_ID, Buffer.from(JSON.stringify(key), 'utf8')],
  );
}

/**
 * Perte du rôle PRIMARY (A16) : dans la transaction du changement de rôle, efface la clé scellée,
 * les colis chiffrés et les empreintes de jetons de rafraîchissement. Réutilisable (WP24).
 */
export async function purgeKeyMaterial(tx: TxClient): Promise<void> {
  await tx.query('DELETE FROM edge_pwd_pack_key');
  await tx.query(
    `UPDATE edge_media SET pwd_pack_enc = NULL, pwd_pack_sha256 = NULL
      WHERE pwd_pack_enc IS NOT NULL OR pwd_pack_sha256 IS NOT NULL`,
  );
  await tx.query('DELETE FROM edge_device_token_family');
}
