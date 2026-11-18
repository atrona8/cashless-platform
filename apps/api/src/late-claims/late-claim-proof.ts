// Preuve du droit d'une réclamation tardive (mission 9b, WP10 ; FR-016 ; openapi `postLateClaim`) :
// contrôlée par l'API SEULEMENT (aucune garde SQL), à la demande puis de nouveau à l'exécution. Un
// festivalier prouve son droit :
//  - `MEDIA_TAP` : `tap_id` désigne un passage du MÊME prestataire, lu par un terminal (`device_id`
//    non nul), d'un bracelet qui est, ou a été, rattaché à ce portefeuille (`media_assignment`, qui
//    garde l'historique) ;
//  - `CUSTOMER_ACCOUNT` : le portefeuille porte un client (`customer_id`).
// Toute preuve manquante, étrangère ou d'un autre portefeuille reçoit la MÊME réponse `422` : rien
// ne dit laquelle des conditions a manqué (pas d'oracle sur les passages d'autrui).
import type { TxClient } from '../db/tenant-tx';
import { unprocessable } from '../organization/platform/platform.dto';

export type LateClaimProof = { kind: 'MEDIA_TAP'; tap_id: number } | { kind: 'CUSTOMER_ACCOUNT' };

const REFUSED = 'Preuve du droit non recevable pour ce portefeuille.';

/** Lève `422` (message unique) si la preuve ne vaut pas pour ce portefeuille de ce prestataire. */
export async function verifyLateClaimProof(
  client: TxClient,
  input: { operatorId: string; walletId: string; proof: LateClaimProof },
): Promise<void> {
  const { operatorId, walletId, proof } = input;
  if (proof.kind === 'CUSTOMER_ACCOUNT') {
    const { rows } = await client.query(
      'SELECT 1 FROM wallet WHERE id = $1 AND operator_id = $2 AND customer_id IS NOT NULL',
      [walletId, operatorId],
    );
    if (rows.length !== 1) throw unprocessable(REFUSED);
    return;
  }
  const { rows } = await client.query(
    `SELECT 1
       FROM media_tap t
       JOIN media_assignment ma ON ma.media_id = t.media_id AND ma.wallet_id = $2
      WHERE t.id = $1::bigint AND t.operator_id = $3 AND t.device_id IS NOT NULL
      LIMIT 1`,
    [String(proof.tap_id), walletId, operatorId],
  );
  if (rows.length !== 1) throw unprocessable(REFUSED);
}
