// Lecture de la clé de contenu des colis (`edge_pwd_pack_key`, ligne `current`, WP18) et ouverture en
// MÉMOIRE par le port matériel. Rien n'est persisté en clair. Une STANDBY non promue (ou une base
// purgée, A16/NFR-013) n'a pas de ligne : `null`. Une clé d'accord détruite rend l'ouverture
// impossible : `PackCryptoError('KEY_UNREADABLE')`, sans détail.
import { Inject, Injectable } from '@nestjs/common';
import type { WrappedKey } from '@cashless/tag-format';
import type { TxClient } from '../../db/gateway-tx';
import { HARDWARE_KEYSTORE, type HardwareKeystore } from '../../key-store/hardware-keystore.port';
import { PWD_PACK_KEY_ID } from '../../replication/pwd-pack-key';
import { openSealedContentKey, PackCryptoError, sealedKeyAad } from './pack-crypto';

@Injectable()
export class PackKeyReader {
  constructor(@Inject(HARDWARE_KEYSTORE) private readonly keystore: HardwareKeystore) {}

  /** `null` : aucune clé de contenu détenue. Le tampon rendu est à effacer par l'appelant. */
  async open(tx: TxClient): Promise<Buffer | null> {
    const { rows } = await tx.query<{ sealed_key: Buffer; ledger_id: string; gateway_id: string }>(
      `SELECT k.sealed_key, m.ledger_id, m.gateway_id
         FROM edge_pwd_pack_key k CROSS JOIN edge_meta m WHERE k.key_id = $1`,
      [PWD_PACK_KEY_ID],
    );
    const row = rows[0];
    if (!row) return null;
    let sealed: WrappedKey;
    try {
      sealed = JSON.parse(row.sealed_key.toString('utf8')) as WrappedKey;
    } catch {
      throw new PackCryptoError('KEY_UNREADABLE');
    }
    return openSealedContentKey(this.keystore, sealed, sealedKeyAad(row.ledger_id, row.gateway_id));
  }
}
