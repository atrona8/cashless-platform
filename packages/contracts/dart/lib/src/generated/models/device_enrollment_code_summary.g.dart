// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_enrollment_code_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceEnrollmentCodeSummary _$DeviceEnrollmentCodeSummaryFromJson(
  Map<String, dynamic> json,
) => DeviceEnrollmentCodeSummary(
  enrollmentCodeId: json['enrollment_code_id'] as String,
  eventId: json['event_id'] as String?,
  posId: json['pos_id'] as String?,
  stationName: json['station_name'] as String?,
  appMode: $enumDecodeNullable(
    _$DeviceEnrollmentCodeSummaryAppModeEnumMap,
    json['app_mode'],
  ),
  kind: $enumDecodeNullable(
    _$DeviceEnrollmentCodeSummaryKindEnumMap,
    json['kind'],
  ),
  personalPhone: json['personal_phone'] as bool,
  createdBy: json['created_by'] as String,
  createdAt: DateTime.parse(json['created_at'] as String),
  expiresAt: DateTime.parse(json['expires_at'] as String),
);

Map<String, dynamic> _$DeviceEnrollmentCodeSummaryToJson(
  DeviceEnrollmentCodeSummary instance,
) => <String, dynamic>{
  'enrollment_code_id': instance.enrollmentCodeId,
  'event_id': instance.eventId,
  'pos_id': instance.posId,
  'station_name': instance.stationName,
  'app_mode': instance.appMode,
  'kind': instance.kind,
  'personal_phone': instance.personalPhone,
  'created_by': instance.createdBy,
  'created_at': instance.createdAt.toIso8601String(),
  'expires_at': instance.expiresAt.toIso8601String(),
};

const _$DeviceEnrollmentCodeSummaryAppModeEnumMap = {
  DeviceEnrollmentCodeSummaryAppMode.catalogPos: 'CATALOG_POS',
  DeviceEnrollmentCodeSummaryAppMode.keypadTpe: 'KEYPAD_TPE',
  DeviceEnrollmentCodeSummaryAppMode.topupDesk: 'TOPUP_DESK',
  DeviceEnrollmentCodeSummaryAppMode.valueNull: null,
};

const _$DeviceEnrollmentCodeSummaryKindEnumMap = {
  DeviceEnrollmentCodeSummaryKind.pos: 'POS',
  DeviceEnrollmentCodeSummaryKind.topup: 'TOPUP',
  DeviceEnrollmentCodeSummaryKind.valueNull: null,
};
