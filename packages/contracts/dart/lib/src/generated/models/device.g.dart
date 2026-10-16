// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Device _$DeviceFromJson(Map<String, dynamic> json) => Device(
  deviceId: json['device_id'] as String,
  serial: json['serial'] as String,
  kind: $enumDecode(_$DeviceKindEnumMap, json['kind']),
  appMode: $enumDecode(_$DeviceAppModeEnumMap, json['app_mode']),
  os: $enumDecode(_$OsEnumMap, json['os']),
  nfcEnabled: json['nfc_enabled'] as bool,
  status: $enumDecode(_$DeviceStatusEnumMap, json['status']),
  stationName: json['station_name'] as String?,
);

Map<String, dynamic> _$DeviceToJson(Device instance) => <String, dynamic>{
  'device_id': instance.deviceId,
  'serial': instance.serial,
  'kind': instance.kind,
  'app_mode': instance.appMode,
  'os': instance.os,
  'nfc_enabled': instance.nfcEnabled,
  'status': instance.status,
  'station_name': instance.stationName,
};

const _$DeviceKindEnumMap = {DeviceKind.pos: 'POS', DeviceKind.topup: 'TOPUP'};

const _$DeviceAppModeEnumMap = {
  DeviceAppMode.catalogPos: 'CATALOG_POS',
  DeviceAppMode.keypadTpe: 'KEYPAD_TPE',
  DeviceAppMode.topupDesk: 'TOPUP_DESK',
  DeviceAppMode.pairedTpe: 'PAIRED_TPE',
};

const _$OsEnumMap = {Os.android: 'ANDROID', Os.ios: 'IOS'};

const _$DeviceStatusEnumMap = {
  DeviceStatus.active: 'ACTIVE',
  DeviceStatus.suspended: 'SUSPENDED',
  DeviceStatus.revoked: 'REVOKED',
};
