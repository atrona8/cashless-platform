// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'phone_model_upsert.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PhoneModelUpsert _$PhoneModelUpsertFromJson(Map<String, dynamic> json) =>
    PhoneModelUpsert(
      nfcLevel: $enumDecode(
        _$PhoneModelUpsertNfcLevelEnumMap,
        json['nfc_level'],
      ),
      measuredAt: DateTime.parse(json['measured_at'] as String),
    );

Map<String, dynamic> _$PhoneModelUpsertToJson(PhoneModelUpsert instance) =>
    <String, dynamic>{
      'nfc_level': instance.nfcLevel,
      'measured_at': instance.measuredAt.toIso8601String(),
    };

const _$PhoneModelUpsertNfcLevelEnumMap = {
  PhoneModelUpsertNfcLevel.recommended: 'RECOMMENDED',
  PhoneModelUpsertNfcLevel.tolerated: 'TOLERATED',
};
