// Liste FIGÉE des 11 opérations ajoutées au contrat par la mission routes-backoffice (11b ;
// `kitty-specs/routes-backoffice-01M86KT6/interfaces.md` §3, validé le 24/11/2026). Les balayages d'isolation des
// missions antérieures (`media-isolation`) les écartent de leur sélection par le contrat ; elles ont leur propre
// balayage : `integration/end-to-end/backoffice-isolation.spec.ts`, qui exige un cas du registre pour chaque
// opération SERVIE par l'application, et dont un test de garde échoue si cette liste s'écarte du contrat.
export const MISSION_11B_OPERATIONS: readonly string[] = [
  'getStaffProfile',
  'listEventSales',
  'getSale',
  'listAnomalies',
  'classifyAnomaly',
  'searchMedia',
  'getWalletOverview',
  'searchCustomerByPhone',
  'listPhoneModels',
  'upsertPhoneModel',
  'deletePhoneModel',
];
