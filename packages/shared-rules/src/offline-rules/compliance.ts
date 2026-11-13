// Conformité d'une opération hors ligne (contracts/compliance.md, dix contrôles dans l'ordre).
// Tous tournent ; le premier échec donne `reason`, les autres vont dans `detail` (codes seuls).
import type { ComplianceInput, OfflineRejectReason } from './types';

export type ComplianceResult =
  | { ok: true }
  | { ok: false; reason: OfflineRejectReason; detail: string[] };

interface Failure {
  reason: OfflineRejectReason;
  subs: string[];
}

export function checkCompliance(i: ComplianceInput): ComplianceResult {
  // Défense en profondeur : aucune recharge espèces hors ligne, même confirmée.
  if (i.type === 'TOPUP_CASH') {
    return { ok: false, reason: 'OFFLINE_NOT_ALLOWED', detail: ['TOPUP_CASH'] };
  }
  if (i.exempt) return { ok: true };

  const tol = i.tolMs;
  const at = i.occurredAtCorrected.getTime();
  const failures: Failure[] = [];
  const fail = (reason: OfflineRejectReason, ...subs: string[]): number =>
    failures.push({ reason, subs });

  // 1. Devise.
  if (
    i.walletCurrency === null ||
    i.eventCurrency === null ||
    i.walletCurrency !== i.eventCurrency
  ) {
    fail('CURRENCY_MISMATCH');
  }

  // 2. Terminal actif à l'heure corrigée, hors ligne permis, session de vendeur ouverte.
  const subs2: string[] = [];
  const status = i.device.statusAtOccurred;
  if (status === 'SUSPENDED') subs2.push('DEVICE_SUSPENDED');
  else if (status !== 'ACTIVE') subs2.push('DEVICE_REVOKED');
  if (i.configInForce?.offlineEnabled !== true) subs2.push('OFFLINE_DISABLED');
  if (i.device.vendorSessionOpen !== true) subs2.push('VENDOR_SESSION');
  if (subs2.length > 0) fail('OFFLINE_NOT_ALLOWED', ...subs2);

  // 3. Configuration détenue et plafonds (plafond atteint exactement : admis). Une annulation ne
  //    crée pas d'exposition : seule la configuration citée est contrôlée.
  const cfg = i.configInForce;
  let policyOk = cfg !== null && i.tapConfigId !== null && i.tapConfigId === cfg.configId;
  if (policyOk && i.type === 'PURCHASE' && cfg !== null) {
    policyOk =
      i.amount <= cfg.maxPerSale &&
      i.exposure.mediaCumulative + i.amount <= cfg.maxPerMedia &&
      i.exposure.deviceCumulative + i.amount <= cfg.maxPerDevice;
  }
  if (!policyOk) fail('POLICY_LIMIT_EXCEEDED');

  // 4. Version inscrite avant l'heure + tol, enveloppée pour ce terminal, au moins au plancher
  //    d'accusé.
  const snap = i.snapshot;
  if (
    snap === null ||
    snap.registeredAt.getTime() > at + tol ||
    snap.envelopedForDevice !== true ||
    (i.ackFloor !== null && snap.version < i.ackFloor)
  ) {
    fail('SNAPSHOT_VERSION_UNKNOWN');
  }

  // 5. Âge : égal à la limite admis. Snapshot inconnu : refus.
  if (snap === null) {
    fail('SNAPSHOT_TOO_OLD');
  } else {
    const generated = snap.generatedAt.getTime();
    let limit = snap.maxSnapshotAgeMs;
    if (snap.validUntil !== null) limit = Math.min(limit, snap.validUntil.getTime() - generated);
    if (at - generated > limit + tol) fail('SNAPSHOT_TOO_OLD');
  }

  // 6 à 8. État à la version utilisée (7 et 8 n'ont de sens que si le bracelet y figure).
  const m = i.mediaAtVersion;
  if (m.present !== true) {
    fail('MEDIA_NOT_IN_SNAPSHOT');
  } else {
    if (!(m.mediaUsable === true && m.batchUsable === true && m.walletUsable === true)) {
      fail('MEDIA_BLOCKED_IN_SNAPSHOT');
    }
    if (m.batchBelongsToEvent !== true) fail('MEDIA_WRONG_EVENT');
  }

  // 9. Pack vérifié (absent = faux).
  if (i.packVerified !== true) fail('PACK_NOT_VERIFIED');

  // 10. Annulation : cible de ce terminal, non annulée.
  if (i.type === 'REVERSAL') {
    const t = i.reversalTarget;
    if (t === null || t.foundOnThisDevice !== true) fail('REVERSAL_TARGET_NOT_FOUND');
    else if (t.alreadyReversed !== false) fail('ALREADY_REVERSED');
  }

  const first = failures[0];
  if (first === undefined) return { ok: true };
  const detail = [...first.subs];
  for (const f of failures.slice(1)) detail.push(f.reason, ...f.subs);
  return { ok: false, reason: first.reason, detail };
}
