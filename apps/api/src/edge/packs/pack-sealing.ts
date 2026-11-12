// Scellement des colis de mots de passe pour une passerelle (WP15, T068 ; R-22, R-27, C-009).
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, secrets en mémoire).
//
// Format ALIGNÉ sur ce que la passerelle lit déjà (apps/gateway/src/operations/offline/pack-
// crypto.ts, WP23) :
//   - clé de contenu K (32 octets), UNE par passerelle ; scellée pour sa clé d'accord P-256 par
// ECDH-ES + HKDF-SHA256 (sel vide, info = AAD) + AES-256-GCM (`sealForRecipient`), forme
// `WrappedKey` ;
//     AAD = `CASHLESS/PWDPACK-KEY/EDGE/v1|<grand livre>|<passerelle>` (ASCII, UUID en minuscules) ;
// - colis d'un bracelet : `sealPwdPack` sous K (nonce 12 ‖ chiffré 6 ‖ étiquette 16 = 34 octets),
// AAD
//     `pwdPackAad` (bracelet, prestataire, index de clé, UID), la même que le stockage central.
// K est DERIVEE (HKDF-SHA256) de la plus ancienne clé de données du prestataire, de la clé d'accord
// et de la passerelle (ADR-184, décision 44) : le central la RECALCULE à volonté (il détient la clé
// de données, comme pour les mots de passe eux-mêmes) et ne la stocke pas ; la passerelle seule
// l'ouvre scellée avec sa clé d'accord privée. Aucune clé maître (MAC) n'intervient.

import { createHash, hkdfSync, randomBytes } from 'node:crypto';
import {
  pwdPackAad,
  sealForRecipient,
  sealPwdPack,
  toWrappedKey,
  type WrappedKey,
} from '@cashless/tag-format';

const CONTENT_INFO = 'CASHLESS/PWDPACK-CONTENT/v1|';

/** AAD du scellement de la clé de contenu (identique à `sealedKeyAad` de la passerelle). */
export function sealedKeyAad(ledgerId: string, gatewayId: string): Buffer {
  return Buffer.concat([
    Buffer.from('CASHLESS/PWDPACK-KEY/EDGE/v1|', 'ascii'),
    Buffer.from(ledgerId.toLowerCase(), 'ascii'),
    Buffer.from('|', 'ascii'),
    Buffer.from(gatewayId.toLowerCase(), 'ascii'),
  ]);
}

/** Empreinte de la clé d'accord : celle que la base compare à `sha256(agreement_public_key)`. */
export function agreementKeySha256(agreementPublicKey: Uint8Array): Buffer {
  return createHash('sha256').update(agreementPublicKey).digest();
}

/**
 * Dérivation sans état acceptée par le porteur (décision 44, ADR-184) ; sa source (la plus ancienne
 * clé de données du prestataire) est figée par `pack-derivation.spec.ts`.
 * Clé de contenu de la passerelle pour CETTE clé d'accord (autre clé d'accord, autre clé). */
export function deriveContentKey(input: {
  dek: Uint8Array;
  gatewayId: string;
  agreementPublicKey: Uint8Array;
}): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      input.dek,
      agreementKeySha256(input.agreementPublicKey),
      Buffer.from(CONTENT_INFO + input.gatewayId.toLowerCase(), 'ascii'),
      32,
    ),
  );
}

/** Enveloppe `WrappedKey` de K pour la clé d'accord de la passerelle (clé éphémère neuve). */
export function sealContentKey(input: {
  contentKey: Uint8Array;
  agreementPublicKey: Uint8Array;
  ledgerId: string;
  gatewayId: string;
}): WrappedKey {
  return toWrappedKey(
    sealForRecipient({
      recipientPublicKey: input.agreementPublicKey,
      plaintext: input.contentKey,
      aad: sealedKeyAad(input.ledgerId, input.gatewayId),
    }),
  );
}

/** Colis d'un bracelet : 34 octets chiffrés sous K, et leur empreinte SHA-256 (clair à effacer). */
export function sealMediaPack(input: {
  contentKey: Uint8Array;
  pwdPack: Uint8Array;
  mediaId: string;
  operatorId: string;
  keyIndex: number;
  uid: Uint8Array;
}): { pack: Buffer; sha256: Buffer } {
  const pack = sealPwdPack({
    dek: input.contentKey,
    nonce: randomBytes(12),
    pwdPack: input.pwdPack,
    aad: pwdPackAad({
      mediaId: input.mediaId,
      operatorId: input.operatorId,
      keyIndex: input.keyIndex,
      uid: input.uid,
    }),
  });
  return { pack, sha256: createHash('sha256').update(pack).digest() };
}
