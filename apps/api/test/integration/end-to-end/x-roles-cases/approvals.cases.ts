// Cas de la matrice x-roles : approvals (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase, XRolesFixture } from './registry';

/** Demande d'approbation réelle (versement en espèces demandé par l'ORGANIZER_ADMIN) ; rend son identifiant. */
async function requestDeposit(fx: XRolesFixture): Promise<string> {
  const res = await fx.call('ORGANIZER_ADMIN', {
    method: 'POST',
    path: `/ledgers/${fx.ids.ledger_id}/cash-deposits/approval-requests`,
    body: { amount: 1000, bank_reference: 'x-roles' },
  });
  const id = (res.body.approval_request_id ?? res.body.id) as string | undefined;
  if (!id)
    throw new Error(`demande d'approbation non créée : ${res.status} ${JSON.stringify(res.body)}`);
  return id;
}

export const cases: XRolesCase[] = [
  { operationId: 'requestPspConfigurationChange' },
  { operationId: 'requestCashDeposit' },
  { operationId: 'requestWalletUnblock' },
  { operationId: 'requestLateChargeback' },
  {
    operationId: 'listApprovalRequests',
    emptyForUndeclared: true,
    note: 'Lecture filtrée : un rôle qui ne tient aucun rôle d’action reçoit 200 et une liste vide (approval.service.ts:359) ; une demande existe pour que le vide prouve le filtre.',
    prepare: async (fx) => {
      await requestDeposit(fx);
      return { method: 'GET', path: '/approval-requests' };
    },
  },
  {
    operationId: 'getApprovalRequest',
    refusals: [404],
    note: 'Demande hors de la vue du rôle : 404 (approval.service.ts:256), le serveur masque l’existence.',
    prepare: async (fx) => ({
      method: 'GET',
      path: `/approval-requests/${await requestDeposit(fx)}`,
    }),
  },
  {
    operationId: 'approveApprovalRequest',
    conditionalRoles: ['SUPERVISOR'],
    refusals: [404],
    note: 'Demande hors de la vue du rôle : 404 (approval.service.ts:359). SUPERVISOR est déclaré par union des rôles des actions (waiveSeqGap…) : la demande jouée (versement en espèces) ne l’admet pas, il n’est donc pas exigé admis ici.',
    prepare: async (fx) => ({
      method: 'POST',
      path: `/approval-requests/${await requestDeposit(fx)}/approve`,
      body: {},
    }),
  },
  {
    operationId: 'rejectApprovalRequest',
    conditionalRoles: ['SUPERVISOR'],
    refusals: [404],
    note: 'Demande hors de la vue du rôle : 404 (approval.service.ts:359). SUPERVISOR est déclaré par union des rôles des actions (waiveSeqGap…) : la demande jouée (versement en espèces) ne l’admet pas, il n’est donc pas exigé admis ici.',
    prepare: async (fx) => ({
      method: 'POST',
      path: `/approval-requests/${await requestDeposit(fx)}/reject`,
      body: { note: 'x-roles' },
    }),
  },
];
