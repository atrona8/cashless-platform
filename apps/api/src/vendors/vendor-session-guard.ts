// Garde de session de vendeur (mission 5b, lot WP09, T042 ; FR-005, FR-006 ; contracts/vendors.md,
// « Garde de session »), fournie aux routes de vente, d'annulation et de demande QR (WP11 à WP13).
//
// CONTRAT D'USAGE (à tenir par chaque appelant) :
// 1. appelée DANS la transaction de l'écriture (le `client` de `IdempotentTx.run`), jamais dans une
//    transaction à part : une fermeture validée entre la garde et l'écriture serait sinon ignorée ;
// 2. APRÈS la prise du terminal (`record_device_seq` FOR UPDATE, ou `assert_device_active`) et
//    AVANT toute lecture du bracelet, de la demande QR ou du portefeuille : ordre global des
//    verrous terminal → vendeur → session → demande QR → bracelet → portefeuille (A7) ;
// 3. le vendeur d'une vente est TOUJOURS celui que rend cette garde : aucune route n'accepte un
//    `vendor_id` envoyé par le terminal pour attribuer une vente (FR-006).
//
// `assert_vendor_session` (SECURITY DEFINER) exige une session ouverte de CE terminal, égale à
// l'identifiant reçu, non expirée, d'un vendeur ACTIVE et non bloqué ; sinon CL032 →
// `409 VENDOR_SESSION_INVALID` (traduction du lot WP08). Identifiant non UUID : `422
// VALIDATION_FAILED` avant toute requête.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../db/tenant-tx';
import type { DeviceContext } from '../device-identity/device-identity.port';
import { isUuid, unprocessable } from '../organization/platform/platform.dto';

@Injectable()
export class VendorSessionGuard {
  /** Vendeur de la session ouverte `vendorSessionId` du terminal ; sinon `409` / `422`. */
  async assert(client: TxClient, device: DeviceContext, vendorSessionId: string): Promise<string> {
    if (!isUuid(vendorSessionId)) throw unprocessable('vendor_session_id : identifiant attendu.');
    const { rows } = await client.query<{ vendor_id: string }>(
      'SELECT assert_vendor_session($1, $2) AS vendor_id',
      [device.deviceId, vendorSessionId],
    );
    return rows[0]!.vendor_id;
  }
}
