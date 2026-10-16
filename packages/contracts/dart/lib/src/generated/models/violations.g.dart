// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'violations.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Violations _$ViolationsFromJson(Map<String, dynamic> json) => Violations(
  field: json['field'] as String,
  rule: json['rule'] as String,
  requested: json['requested'],
  limit: json['limit'],
  source: json['source'] as String,
);

Map<String, dynamic> _$ViolationsToJson(Violations instance) =>
    <String, dynamic>{
      'field': instance.field,
      'rule': instance.rule,
      'requested': instance.requested,
      'limit': instance.limit,
      'source': instance.source,
    };
