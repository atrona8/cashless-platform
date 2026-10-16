// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'refund.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Refund _$RefundFromJson(Map<String, dynamic> json) => Refund(
  eligible: json['eligible'] as bool,
  deadline: json['deadline'] == null
      ? null
      : DateTime.parse(json['deadline'] as String),
  fee: (json['fee'] as num?)?.toInt(),
);

Map<String, dynamic> _$RefundToJson(Refund instance) => <String, dynamic>{
  'eligible': instance.eligible,
  'deadline': instance.deadline?.toIso8601String(),
  'fee': instance.fee,
};
