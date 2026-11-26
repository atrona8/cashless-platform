// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'classification.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Classification _$ClassificationFromJson(Map<String, dynamic> json) =>
    Classification(
      reason: json['reason'] as String,
      classifiedBy: json['classified_by'] as String,
      classifiedAt: DateTime.parse(json['classified_at'] as String),
    );

Map<String, dynamic> _$ClassificationToJson(Classification instance) =>
    <String, dynamic>{
      'reason': instance.reason,
      'classified_by': instance.classifiedBy,
      'classified_at': instance.classifiedAt.toIso8601String(),
    };
