// Éligibilité d'un portefeuille au remboursement (mission 9a, WP04 ; FR-004, FR-005, décisions 6 et 8). UNE seule
// fonction pour la création de la demande, `GET /me/wallets` et (WP05) l'exécution de l'approbation : jamais deux
// copies de la règle. Aucune écriture. Les refus de fenêtre et de droit sont rendus, pas levés ; seule l'absence de
// règle de frais `PER_REFUND` lève (`422`, par le résolveur : jamais un remboursement à frais nuls).
import { fee } from '@cashless/shared-rules';
import { AuditService } from '../audit/audit.service';
import { CascadeService } from '../configuration/cascade.service';
import { effectiveRefundDeadline } from '../configuration/provisional-defaults';
import { SqlConfigResolver } from '../configuration/sql-config-resolver';
import type { TxClient } from '../db/tenant-tx';
import { isAccepted, type EventStatus, type LedgerStatus } from '../ledger/status-matrix';

export interface RefundEligibility {
  eligible: boolean;
  reason?: 'WINDOW_CLOSED' | 'NOT_ALLOWED';
  /** Date limite effective (ISO) ; `null` si l'événement n'a ni date limite ni fin. */
  deadline: string | null;
  /** Solde payé (jamais les crédits offerts). */
  paid: bigint;
  /** Frais `PER_REFUND` ; `0n` tant que les refus précédents n'ont pas appelé la règle. */
  fee: bigint;
  /** `paid - fee` quand la demande est permise, sinon `0n`. */
  estimatedAmount: bigint;
}

interface Context {
  wallet_status: string;
  ledger_id: string;
  ledger_status: LedgerStatus;
  event_id: string;
  event_status: EventStatus;
  refund_deadline: Date | null;
  ends_at: Date | null;
  paid: string;
  blacklisted: boolean;
}

// Le résolveur de configuration ne tient aucun état : une instance sans injection suffit (la cascade n'écrit pas).
let defaultResolver: SqlConfigResolver | undefined;
const resolver = (): SqlConfigResolver =>
  (defaultResolver ??= new SqlConfigResolver(new CascadeService(new AuditService())));

/**
 * Ordre : fenêtre (date limite EFFECTIVE, jamais la colonne brute), statut de l'événement (matrice du moteur),
 * blocages (portefeuille hors `ACTIVE`, bracelet `BLACKLISTED` ; un bracelet `SUSPENDED`, perdu, reste remboursable),
 * solde payé > 0, frais, frais < solde.
 */
export async function evaluateRefundEligibility(
  client: TxClient,
  walletId: string,
  at: Date,
): Promise<RefundEligibility> {
  const { rows } = await client.query<Context>(
    `SELECT w.status AS wallet_status, l.id AS ledger_id, l.status AS ledger_status, e.id AS event_id,
            e.status::text AS event_status, e.refund_deadline, e.ends_at,
            coalesce((SELECT -sum(b.balance) FROM account a JOIN account_balance b ON b.account_id = a.id
                       WHERE a.wallet_id = w.id AND a.purpose = 'WALLET_PAID'), 0)::text AS paid,
            EXISTS (SELECT 1 FROM media_assignment ma JOIN media m ON m.id = ma.media_id
                     WHERE ma.wallet_id = w.id AND m.status = 'BLACKLISTED') AS blacklisted
       FROM wallet w
       JOIN ledger l ON l.id = w.ledger_id
       JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id
      WHERE w.id = $1`,
    [walletId],
  );
  const ctx = rows[0];
  const refuse = (
    reason: 'WINDOW_CLOSED' | 'NOT_ALLOWED',
    deadline: string | null,
    paid: bigint,
  ): RefundEligibility => ({
    eligible: false,
    reason,
    deadline,
    paid,
    fee: 0n,
    estimatedAmount: 0n,
  });
  if (!ctx) return refuse('NOT_ALLOWED', null, 0n);
  const paid = BigInt(ctx.paid);
  const deadline = effectiveRefundDeadline(ctx.refund_deadline, ctx.ends_at);
  const deadlineIso = deadline ? deadline.value.toISOString() : null;
  // Ni date limite ni fin d'événement : fenêtre close (arbitrage de l'orchestrateur).
  if (!deadline || at.getTime() > deadline.value.getTime())
    return refuse('WINDOW_CLOSED', deadlineIso, paid);
  const status = isAccepted({
    eventStatus: ctx.event_status,
    ledgerStatus: ctx.ledger_status,
    type: 'WALLET_REFUND',
    source: 'BACKOFFICE',
  });
  if (!status.ok) return refuse('NOT_ALLOWED', deadlineIso, paid);
  if (ctx.wallet_status !== 'ACTIVE' || ctx.blacklisted)
    return refuse('NOT_ALLOWED', deadlineIso, paid);
  if (paid <= 0n) return refuse('NOT_ALLOWED', deadlineIso, paid);
  // Règle absente : le résolveur lève `422` à la lecture de `refundFee`, rien n'est attrapé ici.
  const config = await resolver().resolve({
    ledgerId: ctx.ledger_id,
    eventId: ctx.event_id,
    occurredAt: at,
    client,
  });
  const refundFee = fee(paid, config.refundFee);
  // Le constructeur du grand livre refuserait des frais >= au montant : même refus, avant d'écrire.
  if (refundFee >= paid) return { ...refuse('NOT_ALLOWED', deadlineIso, paid), fee: refundFee };
  return {
    eligible: true,
    deadline: deadlineIso,
    paid,
    fee: refundFee,
    estimatedAmount: paid - refundFee,
  };
}
