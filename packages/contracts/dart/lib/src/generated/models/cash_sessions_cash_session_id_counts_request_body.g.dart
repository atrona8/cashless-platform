// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cash_sessions_cash_session_id_counts_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CashSessionsCashSessionIdCountsRequestBody
_$CashSessionsCashSessionIdCountsRequestBodyFromJson(
  Map<String, dynamic> json,
) => CashSessionsCashSessionIdCountsRequestBody(
  countedAmount: (json['counted_amount'] as num).toInt(),
  countedAt: DateTime.parse(json['counted_at'] as String),
  note: json['note'] as String?,
);

Map<String, dynamic> _$CashSessionsCashSessionIdCountsRequestBodyToJson(
  CashSessionsCashSessionIdCountsRequestBody instance,
) => <String, dynamic>{
  'counted_amount': instance.countedAmount,
  'counted_at': instance.countedAt.toIso8601String(),
  'note': instance.note,
};
