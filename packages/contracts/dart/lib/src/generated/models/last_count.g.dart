// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'last_count.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LastCount _$LastCountFromJson(Map<String, dynamic> json) => LastCount(
  countedAmount: (json['counted_amount'] as num).toInt(),
  countedAt: DateTime.parse(json['counted_at'] as String),
  countedBy: json['counted_by'] as String,
);

Map<String, dynamic> _$LastCountToJson(LastCount instance) => <String, dynamic>{
  'counted_amount': instance.countedAmount,
  'counted_at': instance.countedAt.toIso8601String(),
  'counted_by': instance.countedBy,
};
