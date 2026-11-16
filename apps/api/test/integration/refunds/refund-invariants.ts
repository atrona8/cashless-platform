// Invariants du grand livre après un remboursement (mission 9a, WP07, NFR-003) : écrits UNE fois, appelés par
// `journey.spec.ts` et `concurrency.spec.ts`. Lecture seule (propriétaire) ; aucune écriture.
import { ownerRows as rows, ledgerIsSound } from '../../support/media-fixtures';
import { paidBalance } from './refund-flow-fixtures';

/** Solde cumulé de chaque compte du grand livre, par code (et par portefeuille pour les comptes de portefeuille). */
export async function ledgerBalances(ledgerId: string): Promise<Record<string, number>> {
  const list = await rows<{ k: string; s: string }>(
    `SELECT coalesce(a.wallet_id::text, '') || ':' || a.code AS k, coalesce(sum(p.amount), 0)::text AS s
       FROM account a LEFT JOIN posting p ON p.account_id = a.id
      WHERE a.ledger_id = $1 GROUP BY a.id, a.wallet_id, a.code`,
    [ledgerId],
  );
  return Object.fromEntries(list.map((x) => [x.k, Number(x.s)]));
}

/** Somme des soldes de tous les comptes dont le code commence par `prefix` (ou égal à `prefix`). */
export async function balanceOfCode(ledgerId: string, prefix: string): Promise<number> {
  const [row] = await rows<{ s: string }>(
    `SELECT coalesce(sum(p.amount), 0)::text AS s FROM account a JOIN posting p ON p.account_id = a.id
      WHERE a.ledger_id = $1 AND a.code LIKE $2`,
    [ledgerId, `${prefix}%`],
  );
  return Number(row!.s);
}

/**
 * NFR-003 : (1) la somme des lignes de chaque transaction est nulle et les soldes en cache égalent le recalcul ;
 * (2) le solde payé du portefeuille = solde initial moins les remboursements (nets des contre-passations) ;
 * (3) `unchangedSince` (instantané pris avant une confirmation `PAID`) : aucun compte n'a bougé.
 */
export async function expectRefundInvariants(input: {
  ledgerId: string;
  walletId?: string;
  initialPaid?: number;
  refundedPaid?: number;
  unchangedSince?: Record<string, number>;
}): Promise<void> {
  expect(await ledgerIsSound(input.ledgerId)).toEqual({ unbalanced: 0, drift: 0 });
  if (input.walletId !== undefined && input.initialPaid !== undefined)
    expect(await paidBalance(input.walletId)).toBe(input.initialPaid - (input.refundedPaid ?? 0));
  if (input.unchangedSince)
    expect(await ledgerBalances(input.ledgerId)).toEqual(input.unchangedSince);
}

/** Dernier envoi au titulaire : code et lien (identifiants) tels que reçus par l'envoyeur, sans lecture en base. */
export function holderLinkFor(
  sender: {
    sent: Array<{
      phone: string;
      code: string;
      link?: { refundRequestId: string; otpRequestId: string };
    }>;
  },
  phone: string,
  refundRequestId: string,
) {
  const found = [...sender.sent]
    .reverse()
    .find((x) => x.phone === phone && x.link?.refundRequestId === refundRequestId);
  if (!found?.link) throw new Error(`aucun lien envoyé à ${phone}`);
  return { otp_request_id: found.link.otpRequestId, code: found.code };
}
