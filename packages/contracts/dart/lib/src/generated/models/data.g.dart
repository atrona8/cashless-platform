// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data _$DataFromJson(Map<String, dynamic> json) => Data(
  transactionId: json['transaction_id'] as String,
  occurredAt: DateTime.parse(json['occurred_at'] as String),
  type: json['type'] as String,
  amount: (json['amount'] as num).toInt(),
  label: json['label'] as String?,
);

Map<String, dynamic> _$DataToJson(Data instance) => <String, dynamic>{
  'transaction_id': instance.transactionId,
  'occurred_at': instance.occurredAt.toIso8601String(),
  'type': instance.type,
  'label': instance.label,
  'amount': instance.amount,
};
