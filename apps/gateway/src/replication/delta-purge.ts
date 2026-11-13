// Purge des deltas locaux par issue du central (A26, data-model.md B.2). Les deltas se suppriment,
// jamais l'opération. Aucun import de `queue/**` : WP20 appelle ce lot.
//  - ACCEPTED, ACCEPTED_WITH_SHORTFALL : gardés tant que le solde répliqué DU PORTEFEUILLE ne les
//    couvre pas (`edge_wallet.applied_edge_seq >= edge_seq`), ou jusqu'à une page FINALE de passe
//    dont `edge_seq_applied >= edge_seq` (tous les portefeuilles y sont à jour). Une page non
//    finale ne couvre que les portefeuilles qu'elle porte : le solde effectif n'est jamais
//    surestimé, même lien coupé en milieu de passe ;
//  - DUPLICATE : gardé (solde sous-estimé, sans danger) jusqu'à une passe de réplication COMMENCÉE
//    après la réception du résultat, puis annulé ;
//  - REJECTED, VOID : annulés dès le résultat.
import type { TxClient } from '../db/gateway-tx';

export type CentralOpStatus =
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_SHORTFALL'
  | 'DUPLICATE'
  | 'REJECTED'
  | 'VOID';

export class DeltaPurge {
  /** edge_seq d'un DUPLICATE -> nombre de passes déjà commencées à la réception du résultat. */
  private readonly duplicates = new Map<number, number>();
  /** Fourni par le service : nombre de passes commencées depuis le démarrage du processus. */
  passesStarted: () => number = () => 0;

  async onOpResult(tx: TxClient, edgeSeq: number, status: string): Promise<void> {
    switch (status) {
      case 'REJECTED':
      case 'VOID':
        await tx.query('DELETE FROM edge_op_delta WHERE edge_seq = $1', [edgeSeq]);
        return;
      case 'ACCEPTED':
      case 'ACCEPTED_WITH_SHORTFALL': {
        // Une page a pu passer avant le résultat : elle n'a rien purgé (issue inconnue). Seul le
        // solde répliqué du portefeuille du delta compte ; le reste attend la prochaine page finale.
        await tx.query(
          `DELETE FROM edge_op_delta d USING edge_wallet w
            WHERE d.edge_seq = $1 AND w.wallet_id = d.wallet_id
              AND w.applied_edge_seq >= d.edge_seq`,
          [edgeSeq],
        );
        return;
      }
      case 'DUPLICATE':
        if (!this.duplicates.has(edgeSeq)) this.duplicates.set(edgeSeq, this.passesStarted());
        return;
      default:
        return; // PENDING, SENT, inconnu : rien ne change
    }
  }

  /**
   * Dans la transaction de la page (portefeuilles de la page DÉJÀ écrits) : purge des ACCEPTED
   * couverts. Page non finale : par portefeuille seulement. Page finale : par `edge_seq_applied`.
   */
  async onPageApplied(tx: TxClient, edgeSeqApplied: number, finalPage: boolean): Promise<void> {
    if (finalPage) {
      await tx.query(
        `DELETE FROM edge_op_delta d USING edge_op o
          WHERE o.edge_seq = d.edge_seq AND d.edge_seq <= $1
            AND o.central_status IN ('ACCEPTED', 'ACCEPTED_WITH_SHORTFALL')`,
        [edgeSeqApplied],
      );
      return;
    }
    await tx.query(
      `DELETE FROM edge_op_delta d USING edge_op o, edge_wallet w
        WHERE o.edge_seq = d.edge_seq AND w.wallet_id = d.wallet_id
          AND d.edge_seq <= w.applied_edge_seq
          AND o.central_status IN ('ACCEPTED', 'ACCEPTED_WITH_SHORTFALL')`,
    );
  }

  /**
   * Fin d'une passe complète numéro `passId` (dernière page, rien ne reste). Annule les DUPLICATE
   * dont le résultat est antérieur au DÉBUT de cette passe. Rend les numéros annulés ; l'appelant
   * appelle `forget` après validation.
   */
  async onPassCompleted(tx: TxClient, passId: number): Promise<number[]> {
    const { rows } = await tx.query<{ edge_seq: string }>(
      `SELECT DISTINCT d.edge_seq FROM edge_op_delta d JOIN edge_op o USING (edge_seq)
        WHERE o.central_status = 'DUPLICATE'`,
    );
    const due = rows
      .map((r) => Number(r.edge_seq))
      // Inconnu en mémoire (résultat reçu avant ce démarrage) : tout passage de ce
      // processus compte.
      .filter((seq) => (this.duplicates.get(seq) ?? 0) < passId);
    if (due.length > 0) {
      await tx.query('DELETE FROM edge_op_delta WHERE edge_seq = ANY($1::bigint[])', [due]);
    }
    return due;
  }

  forget(seqs: number[]): void {
    for (const seq of seqs) this.duplicates.delete(seq);
  }
}
