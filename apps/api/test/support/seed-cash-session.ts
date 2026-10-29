// Session de caisse OUVERTE posée par le propriétaire pour les fixtures du moteur : depuis le retrait de
// `take_deposit` / `refund_deposit` à `cashless_app` (WP14 cycle 2, OP-N84), une caution en espèces passe par
// `take_deposit_for_session`, qui tire le compte de la session. La session porte un compte de caisse existant du
// grand livre (ex. `A-CAISSE-C1`), sans inscription au registre des caisses (la garde ne s'y applique donc pas).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

export async function seedOpenCashSession(
  db: Pick<Client, 'query'>,
  args: { operatorId: string; ledgerId: string; eventId: string; accountCode: string },
): Promise<string> {
  const { operatorId, ledgerId, eventId, accountCode } = args;
  const subject = `seed-cash-${randomUUID()}`;
  const user = await db.query<{ id: string }>(
    `INSERT INTO app_user (operator_id, issuer, subject, email, display_name)
     VALUES ($1, 'https://seed-cash.test', $2, $3, 'Caissier de fixture') RETURNING id`,
    [operatorId, subject, `${subject}@test.local`],
  );
  const device = await db.query<{ id: string }>(
    // Sans événement : un terminal affecté non synchronisé bloquerait le passage SETTLING (CL019).
    `INSERT INTO device (operator_id, kind, app_mode, serial)
     VALUES ($1, 'TOPUP', 'TOPUP_DESK', $2) RETURNING id`,
    [operatorId, `seed-cash-${randomUUID()}`],
  );
  const session = await db.query<{ id: string }>(
    `INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id, cash_account_id, opened_by)
     SELECT $1, $2, $3, $4, a.id, $5 FROM account a WHERE a.ledger_id = $2 AND a.code = $6
     RETURNING cash_session_id AS id`,
    [operatorId, ledgerId, eventId, device.rows[0]!.id, user.rows[0]!.id, accountCode],
  );
  if (!session.rows[0]) throw new Error(`compte de caisse introuvable : ${accountCode}`);
  return session.rows[0].id;
}
