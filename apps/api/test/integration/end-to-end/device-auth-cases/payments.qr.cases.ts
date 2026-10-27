// Cas de la matrice des preuves pour les routes du lot WP13 (mission 5b, T065 ; C-003 ; OP-N70) :
// `POST /payment-requests` (terminal seul) et les chemins TERMINAL de `GET /payment-requests/{id}` et
// `POST /payment-requests/{id}/cancel` (garde exclusive « terminal ou festivalier », A13).
//
// NOM DU FICHIER : le registre lit le dossier dans l'ordre alphabétique et amorce les cas dans cet ordre. Ces cas
// ont besoin de l'état posé par `payments.cases.ts` (point de vente, vendeur, session ouverte du terminal de la
// matrice, terminal en KEYPAD_TPE) : une session ouverte par une seconde amorce REMPLACERAIT la première
// (`open_vendor_session`). Le fichier se nomme donc `payments.qr.cases.ts`, qui suit `payments.cases.ts` et
// précède `vendors.cases.ts` (qui ne touche pas à la session) ; le sujet du lot WP13 porte `payment-requests`.
//
// Amorçage (une fois) : la session de vendeur ouverte du terminal est lue en base ; une demande est créée par la
// VRAIE route avec les trois preuves pour la consultation, une autre pour l'annulation (échéance de 300 s).
// Réussite servie par la vraie route (`ok`), puis la matrice la refuse pour chaque preuve absente, fausse ou
// rejouée. Le test « routes du contrat non servies : 404 » reste vert : les trois routes ont ici leur cas.
import { withOwner } from '../../../support/db';
import type { CaseContext, CaseFile, RouteCase } from './registry';

export const controllers: CaseFile['controllers'] = ['TerminalPaymentRequestsController'];

export function cases(_ctx: CaseContext): Record<string, RouteCase> {
  let sessionId = '';
  let readId = '';
  let cancelId = '';
  const prepare = async (ctx: CaseContext): Promise<void> => {
    if (sessionId !== '') return;
    const { terminal, api } = ctx;
    const open = await withOwner((db) =>
      db.query<{ id: string }>(
        'SELECT id FROM vendor_session WHERE device_id = $1 AND closed_at IS NULL',
        [terminal.deviceId],
      ),
    );
    if (open.rows.length !== 1)
      throw new Error(
        'session de vendeur du terminal absente : payments.cases.ts doit passer avant',
      );
    sessionId = open.rows[0]!.id;
    const create = async (): Promise<string> => {
      const res = await terminal.request(api.baseUrl, api.tls.serverCaPem, {
        method: 'POST',
        path: '/payment-requests',
        body: { amount: 1000, currency: 'XOF', vendor_session_id: sessionId, ttl_seconds: 300 },
        idempotencyKey: ctx.seqKey(terminal),
      });
      if (res.status !== 201)
        throw new Error(`demande d’amorçage refusée : ${res.status} ${res.text}`);
      return String(res.body.payment_request_id);
    };
    readId = await create();
    cancelId = await create();
  };
  return {
    'POST /payment-requests': {
      server: 'api',
      path: () => '/payment-requests',
      body: () => ({ amount: 1000, currency: 'XOF', vendor_session_id: sessionId }),
      ok: 201,
      idempotencyKey: (c, who) => c.seqKey(who),
      prepare,
    },
    'GET /payment-requests/{}': {
      server: 'api',
      exclusive: 'customer',
      path: () => `/payment-requests/${readId}`,
      ok: 200,
      prepare,
    },
    'POST /payment-requests/{}/cancel': {
      server: 'api',
      exclusive: 'customer',
      path: () => `/payment-requests/${cancelId}/cancel`,
      ok: 200,
      idempotencyKey: (c, who) => c.seqKey(who),
      prepare,
    },
  };
}
