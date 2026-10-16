// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_decision.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeDecision _$EdgeDecisionFromJson(Map<String, dynamic> json) => EdgeDecision(
  status: $enumDecode(_$OfflineOperationStatusEnumMap, json['status']),
  chargedToWallet: (json['charged_to_wallet'] as num).toInt(),
  shortfallAmount: (json['shortfall_amount'] as num).toInt(),
  shortfallReason: $enumDecodeNullable(
    _$ShortfallReasonEnumMap,
    json['shortfall_reason'],
  ),
  rejectReason: $enumDecodeNullable(
    _$OfflineRejectReasonEnumMap,
    json['reject_reason'],
  ),
);

Map<String, dynamic> _$EdgeDecisionToJson(EdgeDecision instance) =>
    <String, dynamic>{
      'status': instance.status,
      'charged_to_wallet': instance.chargedToWallet,
      'shortfall_amount': instance.shortfallAmount,
      'shortfall_reason': instance.shortfallReason,
      'reject_reason': instance.rejectReason,
    };

const _$OfflineOperationStatusEnumMap = {
  OfflineOperationStatus.accepted: 'ACCEPTED',
  OfflineOperationStatus.duplicate: 'DUPLICATE',
  OfflineOperationStatus.acceptedWithShortfall: 'ACCEPTED_WITH_SHORTFALL',
  OfflineOperationStatus.rejected: 'REJECTED',
};

const _$ShortfallReasonEnumMap = {
  ShortfallReason.insufficientFunds: 'INSUFFICIENT_FUNDS',
  ShortfallReason.mediaBlockedAfterSnapshot: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
  ShortfallReason.mediaCloneSuspected: 'MEDIA_CLONE_SUSPECTED',
  ShortfallReason.mediaUidMismatch: 'MEDIA_UID_MISMATCH',
  ShortfallReason.mediaSignatureMismatch: 'MEDIA_SIGNATURE_MISMATCH',
  ShortfallReason.walletBlocked: 'WALLET_BLOCKED',
};

const _$OfflineRejectReasonEnumMap = {
  OfflineRejectReason.idempotencyKeyReused: 'IDEMPOTENCY_KEY_REUSED',
  OfflineRejectReason.malformedOperation: 'MALFORMED_OPERATION',
  OfflineRejectReason.currencyMismatch: 'CURRENCY_MISMATCH',
  OfflineRejectReason.offlineNotAllowed: 'OFFLINE_NOT_ALLOWED',
  OfflineRejectReason.policyLimitExceeded: 'POLICY_LIMIT_EXCEEDED',
  OfflineRejectReason.snapshotTooOld: 'SNAPSHOT_TOO_OLD',
  OfflineRejectReason.snapshotVersionUnknown: 'SNAPSHOT_VERSION_UNKNOWN',
  OfflineRejectReason.mediaNotInSnapshot: 'MEDIA_NOT_IN_SNAPSHOT',
  OfflineRejectReason.mediaBlockedInSnapshot: 'MEDIA_BLOCKED_IN_SNAPSHOT',
  OfflineRejectReason.mediaWrongEvent: 'MEDIA_WRONG_EVENT',
  OfflineRejectReason.packNotVerified: 'PACK_NOT_VERIFIED',
  OfflineRejectReason.reversalTargetNotFound: 'REVERSAL_TARGET_NOT_FOUND',
  OfflineRejectReason.alreadyReversed: 'ALREADY_REVERSED',
  OfflineRejectReason.periodClosed: 'PERIOD_CLOSED',
  OfflineRejectReason.ledgerLocked: 'LEDGER_LOCKED',
  OfflineRejectReason.walletLimitExceeded: 'WALLET_LIMIT_EXCEEDED',
  OfflineRejectReason.insufficientFundsRetry: 'INSUFFICIENT_FUNDS_RETRY',
  OfflineRejectReason.syncDeadlinePassed: 'SYNC_DEADLINE_PASSED',
  OfflineRejectReason.edgeReplayFailed: 'EDGE_REPLAY_FAILED',
};
