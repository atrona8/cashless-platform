// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'enrollment_code_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EnrollmentCodeCreate _$EnrollmentCodeCreateFromJson(
  Map<String, dynamic> json,
) => EnrollmentCodeCreate(
  appMode: $enumDecode(_$DeviceAppModeEnumMap, json['app_mode']),
  kind: $enumDecode(_$DeviceKindEnumMap, json['kind']),
  providedBy:
      $enumDecodeNullable(
        _$EnrollmentCodeCreateProvidedByEnumMap,
        json['provided_by'],
      ) ??
      EnrollmentCodeCreateProvidedBy.valueOperator,
  expiresInSeconds: (json['expires_in_seconds'] as num?)?.toInt() ?? 86400,
  eventId: json['event_id'] as String?,
  posId: json['pos_id'] as String?,
  stationName: json['station_name'] as String?,
);

Map<String, dynamic> _$EnrollmentCodeCreateToJson(
  EnrollmentCodeCreate instance,
) => <String, dynamic>{
  'event_id': instance.eventId,
  'pos_id': instance.posId,
  'station_name': instance.stationName,
  'app_mode': instance.appMode,
  'kind': instance.kind,
  'provided_by': instance.providedBy,
  'expires_in_seconds': instance.expiresInSeconds,
};

const _$DeviceAppModeEnumMap = {
  DeviceAppMode.catalogPos: 'CATALOG_POS',
  DeviceAppMode.keypadTpe: 'KEYPAD_TPE',
  DeviceAppMode.topupDesk: 'TOPUP_DESK',
  DeviceAppMode.pairedTpe: 'PAIRED_TPE',
};

const _$DeviceKindEnumMap = {DeviceKind.pos: 'POS', DeviceKind.topup: 'TOPUP'};

const _$EnrollmentCodeCreateProvidedByEnumMap = {
  EnrollmentCodeCreateProvidedBy.platform: 'PLATFORM',
  EnrollmentCodeCreateProvidedBy.valueOperator: 'OPERATOR',
  EnrollmentCodeCreateProvidedBy.organizer: 'ORGANIZER',
  EnrollmentCodeCreateProvidedBy.merchant: 'MERCHANT',
};
