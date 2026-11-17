// Liste FIGÉE des 20 opérations ajoutées au contrat par la mission versements-rapprochements-cloture
// (`kitty-specs/versements-rapprochements-cloture-01M7JT4G/contracts/contract-additions.md`, validé le 17/11/2026).
// Les balayages d'isolation des missions antérieures (configuration, bracelets) les écartent de leur sélection par le
// contrat ; elles ont leur propre balayage : `integration/invariants-cloture/isolation-9b.spec.ts`, qui échoue si l'une
// de ces opérations n'a pas de cas, ou si cette liste s'écarte du contrat ou du fichier des ajouts.
export const MISSION_9B_OPERATIONS: readonly string[] = [
  'listEventClosingSteps',
  'previewEventClosingStep',
  'executeEventClosingStep',
  'getEventRemainingBalances',
  'listPayoutEntitlements',
  'requestPayoutBatch',
  'listPayouts',
  'exportPayoutBatch',
  'confirmPayout',
  'importAccountStatement',
  'listStatementLines',
  'matchStatementLine',
  'getLedgerReconciliation',
  'postLateAdjustment',
  'createRefundRequest',
  'getPartyStatement',
  'getMyWalletStatement',
  'listAccountMappings',
  'createAccountMappingVersion',
  'exportAccounting',
];
