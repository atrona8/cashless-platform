// Cas de la matrice des preuves pour la route du lot WP12 (mission 5b, T060 ; C-003 ; OP-N70) :
// `POST /payments/{transaction_id}/reversal` (`reversePayment`), terminal seul (garde exclusive « terminal ou
// personne » : sans les trois preuves, jamais de repli sur le chemin de la personne).
//
// Amorçage (une fois) : la session de vendeur ouverte du terminal de la matrice est celle de `payments.cases.ts`
// (le fichier `payments` passe avant, ordre alphabétique) ; une vente est faite par la route `POST /payments` avec
// les trois preuves, puis `reversePayment` l'annule (`ok: 201`, vendeur de la vente, dans la fenêtre). Les refus de
// preuve (absente, fausse, rejouée) sont joués par la matrice sur ce même cas.
import { withOwner } from '../../../support/db';
import { tapBody } from '../../../support/media-fixtures';
import type { CaseContext, CaseFile, RouteCase } from './registry';

export const controllers: CaseFile['controllers'] = ['ReversalsController'];

export function cases(_ctx: CaseContext): Record<string, RouteCase> {
  let saleId = '';
  let sessionId = '';
  const prepare = async (c: CaseContext): Promise<void> => {
    if (saleId !== '') return;
    const { terminal, api } = c;
    const sessions = await withOwner((db) =>
      db.query<{ id: string }>(
        `SELECT id FROM vendor_session WHERE device_id = $1 AND closed_at IS NULL ORDER BY opened_at DESC`,
        [terminal.deviceId],
      ),
    );
    if (sessions.rows.length === 0)
      throw new Error('reversals.cases : session de vendeur du terminal absente (payments.cases)');
    sessionId = sessions.rows[0]!.id;
    const sale = await terminal.request(
      api.baseUrl,
      api.tls.serverCaPem,
      {
        method: 'POST',
        path: '/payments',
        body: {
          amount: 500,
          currency: 'XOF',
          occurred_at: new Date().toISOString(),
          vendor_session_id: sessionId,
          tap: tapBody(c.media, c.next()),
        },
        idempotencyKey: c.seqKey(terminal),
      },
      { headers: { 'x-authority-epoch': '0' } },
    );
    if (sale.status !== 201)
      throw new Error(`vente d’amorçage de l’annulation refusée : ${sale.status} ${sale.text}`);
    saleId = String(sale.body.transaction_id);
  };
  return {
    'POST /payments/{}/reversal': {
      server: 'api',
      exclusive: 'person',
      path: () => `/payments/${saleId}/reversal`,
      body: () => ({
        reason: 'INPUT_ERROR',
        comment: 'Matrice des preuves',
        occurred_at: new Date().toISOString(),
        vendor_session_id: sessionId,
      }),
      ok: 201,
      idempotencyKey: (c, who) => c.seqKey(who),
      headers: () => ({ 'x-authority-epoch': '0' }),
      prepare,
    },
  };
}
