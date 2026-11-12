// Passerelle STANDBY (T109 ; FR-030, A16, C-008).
//
// Une STANDBY réplique l'état de service (bloc `reference`) mais ne reçoit AUCUN mot de passe de
// bracelet ni clé de contenu (WP18 : `purgeKeyMaterial` à chaque page tant que le rôle n'est pas
// PRIMARY) et ne débite jamais (`AuthorityService.assertCanDebit` : `409 CONFLICT_STATE`, détail
// `GATEWAY_NOT_AUTHORITY`). Elle ne passe à `ARMED` que lorsque `reference.gateway.role` devient
// `PRIMARY` (`AuthorityService.onRoleChanged`), jamais par une écriture locale : le déclencheur de
// `edge_authority` refuse tout autre chemin, et `ACTIVE` n'arrive que par un handover complet.
//
// Promotion : la STANDBY n'a jamais reçu les colis ni les empreintes de jetons de rafraîchissement.
// Les entités de référence ne se rejouent que depuis le curseur de changement : sans remise à zéro,
// la nouvelle PRIMARY ne les recevrait JAMAIS. `requestFullCopy` remet ce curseur à zéro dans la
// transaction de la promotion ; le central ne rend les colis qu'après le délai de 30 minutes
// (WP15).
import type { TxClient } from '../db/gateway-tx';

/** Reprise d'une copie complète des entités de référence (curseur de changement à zéro). */
export async function requestFullCopy(tx: TxClient): Promise<void> {
  await tx.query('UPDATE edge_replication_cursor SET last_change_seq = 0');
  await tx.query(
    `INSERT INTO edge_audit (kind, actor, detail) VALUES ('STANDBY_PROMOTED', 'gateway', $1)`,
    [JSON.stringify({ full_copy: true })],
  );
}
