// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cash_session.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CashSession _$CashSessionFromJson(Map<String, dynamic> json) => CashSession(
  cashSessionId: json['cash_session_id'] as String,
  cashAccountId: json['cash_account_id'] as String,
  status: $enumDecode(_$CashSessionStatusEnumMap, json['status']),
  openedBy: json['opened_by'] as String,
  openedAt: DateTime.parse(json['opened_at'] as String),
  deviceId: json['device_id'] as String?,
  lastCount: json['last_count'] == null
      ? null
      : LastCount.fromJson(json['last_count'] as Map<String, dynamic>),
  closedAt: json['closed_at'] == null
      ? null
      : DateTime.parse(json['closed_at'] as String),
  closedBy: json['closed_by'] as String?,
  countedAmount: (json['counted_amount'] as num?)?.toInt(),
  expectedAmount: (json['expected_amount'] as num?)?.toInt(),
  cashCloseTransactionId: json['cash_close_transaction_id'] as String?,
  difference: (json['difference'] as num?)?.toInt(),
  cashDiffAnomalyId: json['cash_diff_anomaly_id'] as String?,
);

Map<String, dynamic> _$CashSessionToJson(CashSession instance) =>
    <String, dynamic>{
      'cash_session_id': instance.cashSessionId,
      'cash_account_id': instance.cashAccountId,
      'device_id': instance.deviceId,
      'status': instance.status,
      'opened_by': instance.openedBy,
      'opened_at': instance.openedAt.toIso8601String(),
      'last_count': instance.lastCount,
      'closed_at': instance.closedAt?.toIso8601String(),
      'closed_by': instance.closedBy,
      'counted_amount': instance.countedAmount,
      'expected_amount': instance.expectedAmount,
      'cash_close_transaction_id': instance.cashCloseTransactionId,
      'difference': instance.difference,
      'cash_diff_anomaly_id': instance.cashDiffAnomalyId,
    };

const _$CashSessionStatusEnumMap = {
  CashSessionStatus.open: 'OPEN',
  CashSessionStatus.closed: 'CLOSED',
};
