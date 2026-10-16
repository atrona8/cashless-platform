// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'enrollment_code.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EnrollmentCode _$EnrollmentCodeFromJson(Map<String, dynamic> json) =>
    EnrollmentCode(
      enrollmentCodeId: json['enrollment_code_id'] as String,
      code: json['code'] as String,
      expiresAt: DateTime.parse(json['expires_at'] as String),
      appMode: $enumDecode(_$DeviceAppModeEnumMap, json['app_mode']),
    );

Map<String, dynamic> _$EnrollmentCodeToJson(EnrollmentCode instance) =>
    <String, dynamic>{
      'enrollment_code_id': instance.enrollmentCodeId,
      'code': instance.code,
      'expires_at': instance.expiresAt.toIso8601String(),
      'app_mode': instance.appMode,
    };

const _$DeviceAppModeEnumMap = {
  DeviceAppMode.catalogPos: 'CATALOG_POS',
  DeviceAppMode.keypadTpe: 'KEYPAD_TPE',
  DeviceAppMode.topupDesk: 'TOPUP_DESK',
  DeviceAppMode.pairedTpe: 'PAIRED_TPE',
};
