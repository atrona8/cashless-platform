// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'anomaly.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Anomaly _$AnomalyFromJson(Map<String, dynamic> json) => Anomaly(
  anomalyId: json['anomaly_id'] as String,
  kind: $enumDecode(_$AnomalyKindEnumMap, json['kind']),
  status: $enumDecode(_$AnomalyStatusEnumMap, json['status']),
  eventId: json['event_id'] as String?,
  createdAt: DateTime.parse(json['created_at'] as String),
  amount: (json['amount'] as num?)?.toInt(),
  currency: json['currency'] as String?,
  mediaId: json['media_id'] as String?,
  deviceId: json['device_id'] as String?,
  transactionId: json['transaction_id'] as String?,
  classifiable: json['classifiable'] as bool,
  classification: json['classification'] == null
      ? null
      : Classification.fromJson(json['classification'] as Map<String, dynamic>),
);

Map<String, dynamic> _$AnomalyToJson(Anomaly instance) => <String, dynamic>{
  'anomaly_id': instance.anomalyId,
  'kind': instance.kind,
  'status': instance.status,
  'event_id': instance.eventId,
  'created_at': instance.createdAt.toIso8601String(),
  'amount': instance.amount,
  'currency': instance.currency,
  'media_id': instance.mediaId,
  'device_id': instance.deviceId,
  'transaction_id': instance.transactionId,
  'classifiable': instance.classifiable,
  'classification': instance.classification,
};

const _$AnomalyKindEnumMap = {
  AnomalyKind.offlineShortfall: 'OFFLINE_SHORTFALL',
  AnomalyKind.counterDuplicate: 'COUNTER_DUPLICATE',
  AnomalyKind.counterTimeInversion: 'COUNTER_TIME_INVERSION',
  AnomalyKind.uidMismatch: 'UID_MISMATCH',
  AnomalyKind.retiredIdentity: 'RETIRED_IDENTITY',
  AnomalyKind.seqGap: 'SEQ_GAP',
  AnomalyKind.chainBroken: 'CHAIN_BROKEN',
  AnomalyKind.clockSkew: 'CLOCK_SKEW',
  AnomalyKind.voidConflict: 'VOID_CONFLICT',
  AnomalyKind.onlineConfirmedMissing: 'ONLINE_CONFIRMED_MISSING',
  AnomalyKind.idempotencyConflict: 'IDEMPOTENCY_CONFLICT',
  AnomalyKind.nonCompliantOperation: 'NON_COMPLIANT_OPERATION',
  AnomalyKind.periodClosedOperation: 'PERIOD_CLOSED_OPERATION',
  AnomalyKind.lateOfflineSync: 'LATE_OFFLINE_SYNC',
  AnomalyKind.signatureMismatch: 'SIGNATURE_MISMATCH',
  AnomalyKind.cashTopupOverLimit: 'CASH_TOPUP_OVER_LIMIT',
  AnomalyKind.cashDiff: 'CASH_DIFF',
  AnomalyKind.pspMismatch: 'PSP_MISMATCH',
  AnomalyKind.pspTopupOverLimit: 'PSP_TOPUP_OVER_LIMIT',
  AnomalyKind.edgeReplayFailed: 'EDGE_REPLAY_FAILED',
  AnomalyKind.lateChargeback: 'LATE_CHARGEBACK',
  AnomalyKind.cardVelocity: 'CARD_VELOCITY',
  AnomalyKind.pspTopupNotCredited: 'PSP_TOPUP_NOT_CREDITED',
};

const _$AnomalyStatusEnumMap = {
  AnomalyStatus.open: 'OPEN',
  AnomalyStatus.resolved: 'RESOLVED',
};
