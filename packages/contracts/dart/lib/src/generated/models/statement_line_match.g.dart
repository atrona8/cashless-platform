// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'statement_line_match.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StatementLineMatch _$StatementLineMatchFromJson(Map<String, dynamic> json) =>
    StatementLineMatch(
      transactionId: json['transaction_id'] as String?,
      anomalyId: json['anomaly_id'] as String?,
    );

Map<String, dynamic> _$StatementLineMatchToJson(StatementLineMatch instance) =>
    <String, dynamic>{
      'transaction_id': instance.transactionId,
      'anomaly_id': instance.anomalyId,
    };
