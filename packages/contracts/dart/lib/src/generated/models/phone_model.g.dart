// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'phone_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PhoneModel _$PhoneModelFromJson(Map<String, dynamic> json) => PhoneModel(
  manufacturer: json['manufacturer'] as String,
  model: json['model'] as String,
  nfcLevel: $enumDecode(_$PhoneModelNfcLevelEnumMap, json['nfc_level']),
  measuredAt: DateTime.parse(json['measured_at'] as String),
  updatedAt: DateTime.parse(json['updated_at'] as String),
);

Map<String, dynamic> _$PhoneModelToJson(PhoneModel instance) =>
    <String, dynamic>{
      'manufacturer': instance.manufacturer,
      'model': instance.model,
      'nfc_level': instance.nfcLevel,
      'measured_at': instance.measuredAt.toIso8601String(),
      'updated_at': instance.updatedAt.toIso8601String(),
    };

const _$PhoneModelNfcLevelEnumMap = {
  PhoneModelNfcLevel.recommended: 'RECOMMENDED',
  PhoneModelNfcLevel.tolerated: 'TOLERATED',
};
