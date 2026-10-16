// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_operation_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflineOperationResult _$OfflineOperationResultFromJson(
  Map<String, dynamic> json,
) => OfflineOperationResult(
  seq: (json['seq'] as num).toInt(),
  idempotencyKey: json['idempotency_key'] as String,
  status: $enumDecode(_$OfflineOperationStatusEnumMap, json['status']),
  transactionId: json['transaction_id'] as String?,
  effect: $enumDecodeNullable(
    _$OfflineOperationResultEffectEnumMap,
    json['effect'],
  ),
  chargedToWallet: (json['charged_to_wallet'] as num?)?.toInt(),
  shortfallAmount: (json['shortfall_amount'] as num?)?.toInt(),
  shortfallReason: $enumDecodeNullable(
    _$ShortfallReasonEnumMap,
    json['shortfall_reason'],
  ),
  anomalyId: json['anomaly_id'] as String?,
  tapResult: $enumDecodeNullable(_$TapResultCodeEnumMap, json['tap_result']),
  rejectReason: $enumDecodeNullable(
    _$OfflineRejectReasonEnumMap,
    json['reject_reason'],
  ),
  retryable: json['retryable'] as bool?,
  detail: json['detail'] as String?,
);

Map<String, dynamic> _$OfflineOperationResultToJson(
  OfflineOperationResult instance,
) => <String, dynamic>{
  'seq': instance.seq,
  'idempotency_key': instance.idempotencyKey,
  'status': instance.status,
  'transaction_id': instance.transactionId,
  'effect': instance.effect,
  'charged_to_wallet': instance.chargedToWallet,
  'shortfall_amount': instance.shortfallAmount,
  'shortfall_reason': instance.shortfallReason,
  'anomaly_id': instance.anomalyId,
  'tap_result': instance.tapResult,
  'reject_reason': instance.rejectReason,
  'retryable': instance.retryable,
  'detail': instance.detail,
};

const _$OfflineOperationStatusEnumMap = {
  OfflineOperationStatus.accepted: 'ACCEPTED',
  OfflineOperationStatus.duplicate: 'DUPLICATE',
  OfflineOperationStatus.acceptedWithShortfall: 'ACCEPTED_WITH_SHORTFALL',
  OfflineOperationStatus.rejected: 'REJECTED',
};

const _$OfflineOperationResultEffectEnumMap = {
  OfflineOperationResultEffect.ledgerWritten: 'LEDGER_WRITTEN',
  OfflineOperationResultEffect.none: 'NONE',
};

const _$ShortfallReasonEnumMap = {
  ShortfallReason.insufficientFunds: 'INSUFFICIENT_FUNDS',
  ShortfallReason.mediaBlockedAfterSnapshot: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
  ShortfallReason.mediaCloneSuspected: 'MEDIA_CLONE_SUSPECTED',
  ShortfallReason.mediaUidMismatch: 'MEDIA_UID_MISMATCH',
  ShortfallReason.mediaSignatureMismatch: 'MEDIA_SIGNATURE_MISMATCH',
  ShortfallReason.walletBlocked: 'WALLET_BLOCKED',
};

const _$TapResultCodeEnumMap = {
  TapResultCode.ok: 'OK',
  TapResultCode.unknown: 'UNKNOWN',
  TapResultCode.blocked: 'BLOCKED',
  TapResultCode.uidMismatch: 'UID_MISMATCH',
  TapResultCode.signatureMismatch: 'SIGNATURE_MISMATCH',
  TapResultCode.signatureMissing: 'SIGNATURE_MISSING',
  TapResultCode.cloneSuspected: 'CLONE_SUSPECTED',
  TapResultCode.retired: 'RETIRED',
  TapResultCode.replaced: 'REPLACED',
  TapResultCode.notActivated: 'NOT_ACTIVATED',
  TapResultCode.released: 'RELEASED',
  TapResultCode.batchInactive: 'BATCH_INACTIVE',
  TapResultCode.wrongEvent: 'WRONG_EVENT',
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
