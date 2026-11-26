// Cas de la matrice x-roles : media (mission routes-backoffice, WP10 ; interfaces.md §3, research D3).
import type { XRolesCase } from './registry';

export const cases: XRolesCase[] = [
  {
    operationId: 'getMediaAuthKey',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'createTap',
    external:
      'DEVICE seulement : aucun rôle du personnel déclaré ; le personnel est seulement refusé (sonde).',
  },
  {
    operationId: 'activateMedia',
    device: true,
    prepare: (fx) => ({
      method: 'POST',
      path: `/media/activations`,
      body: { tap: fx.tap(), channel: 'DESK', occurred_at: new Date().toISOString() },
    }),
  },
  {
    operationId: 'getMedia',
    device: true,
    refusals: [404],
    note: 'PLATFORM_ADMIN n’a pas de prestataire : une personne dont le prestataire diffère de celui du terminal reçoit 404 (counter-access.ts:66), comme un terminal inconnu.',
  },
  { operationId: 'takeDeposit', device: true },
  {
    operationId: 'refundDeposit',
    device: true,
    prepare: (fx) => ({
      method: 'POST',
      path: `/media/${fx.ids.media_id}/deposit/refund`,
      body: { tap: fx.tap() },
    }),
  },
  { operationId: 'releaseMedia', device: true },
  {
    operationId: 'refundPartialCash',
    device: true,
    prepare: (fx) => ({
      method: 'POST',
      path: `/media/${fx.ids.media_id}/partial-cash-refunds`,
      body: { tap: fx.tap(), amount: 100 },
    }),
  },
  {
    operationId: 'reassignPoolMedia',
    device: true,
    prepare: (fx) => ({
      method: 'POST',
      path: `/media/${fx.ids.media_id}/reassignment`,
      body: { new_token_hash: 'a'.repeat(64) },
    }),
  },
  {
    operationId: 'replaceMedia',
    device: true,
    prepare: (fx) => ({
      method: 'POST',
      path: `/media/${fx.ids.media_id}/replace`,
      body: { new_media_tap: fx.tap(), reason: 'x-roles' },
    }),
  },
  {
    operationId: 'refundCashDue',
    device: true,
    prepare: (fx) => ({
      method: 'POST',
      path: `/media/${fx.ids.media_id}/cash-due-refunds`,
      body: { tap: fx.tap() },
    }),
  },
  {
    operationId: 'confirmMediaClaim',
    device: true,
    prepare: () => ({
      method: 'POST',
      path: `/media/claims/confirmations`,
      body: { tap_id: 1, claim_code: 'ABCDEFGHJK', confirmation_code: '123456' },
    }),
  },
  { operationId: 'listTagKeys' },
  { operationId: 'requestTagKey' },
  { operationId: 'getTagKey' },
  { operationId: 'requestDekRotation' },
  { operationId: 'requestTagKeyRetirement' },
  { operationId: 'listTagKeyJobs' },
  { operationId: 'retryTagKeyJob' },
  { operationId: 'listTagKeyCheckRuns' },
  { operationId: 'listMediaBatches' },
  { operationId: 'createMediaBatch' },
  { operationId: 'getMediaBatch' },
  { operationId: 'updateMediaBatch' },
  { operationId: 'setMediaBatchStatus' },
  { operationId: 'getMediaBatchInventory' },
  { operationId: 'issueClaimCodeOrder' },
  { operationId: 'importClaimCodeAssociations' },
  { operationId: 'closeMediaBatch' },
  { operationId: 'catchUpBatchPreload' },
  { operationId: 'listMedia' },
  { operationId: 'getMediaAdmin' },
  { operationId: 'blacklistMedia' },
  { operationId: 'requestMediaReinstatement' },
  { operationId: 'reportMediaLost' },
  { operationId: 'recoverMedia' },
  { operationId: 'registerPersonalizedMedia', server: 'personalization' },
  { operationId: 'associateClaimCode', server: 'personalization' },
];
