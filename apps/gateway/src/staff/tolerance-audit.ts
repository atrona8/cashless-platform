// Ligne d'audit d'un jeton de personne EXPIRÉ toléré (R-20 condition 7, décision 18). Écrite DANS
// la transaction de l'opération qu'elle autorise : si l'opération échoue, la ligne disparaît avec
// elle ; l'opération n'existe jamais sans sa ligne. La forme de `detail` est celle que
// `queue/staff-audit-feed.ts` (WP20) verse au central : `sub`, `iss`, `jti`, `seconds_past_expiry`
// (entier >= 1), `route`, `device_serial`, `cash_session_id` (facultatif).
import type { TxClient } from '../db/gateway-tx';

export type ToleranceRoute = 'activateMedia' | 'takeDeposit' | 'createCashTopup';
export const TOLERANCE_ROUTES: ReadonlySet<string> = new Set<ToleranceRoute>([
  'activateMedia',
  'takeDeposit',
  'createCashTopup',
]);

export interface ToleranceUse {
  subject: string;
  issuer: string;
  jti: string;
  secondsPastExpiry: number;
  route: ToleranceRoute;
  deviceSerial: string;
  deviceId: string;
  cashSessionId: string;
}

export async function writeToleranceAudit(
  tx: TxClient,
  use: ToleranceUse,
  edgeSeq: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO edge_audit (kind, actor, device_id, edge_seq, detail)
     VALUES ('STAFF_TOKEN_TOLERATED', 'staff', $1, $2, $3)`,
    [
      use.deviceId,
      edgeSeq,
      JSON.stringify({
        sub: use.subject,
        iss: use.issuer,
        jti: use.jti,
        seconds_past_expiry: use.secondsPastExpiry,
        route: use.route,
        device_serial: use.deviceSerial,
        cash_session_id: use.cashSessionId,
      }),
    ],
  );
}
