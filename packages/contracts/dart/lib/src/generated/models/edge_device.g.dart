// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_device.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeDevice _$EdgeDeviceFromJson(Map<String, dynamic> json) => EdgeDevice(
  deviceId: json['device_id'] as String,
  serial: json['serial'] as String,
  kind: $enumDecode(_$DeviceKindEnumMap, json['kind']),
  appMode: $enumDecode(_$DeviceAppModeEnumMap, json['app_mode']),
  os: $enumDecode(_$EdgeDeviceOsEnumMap, json['os']),
  nfcEnabled: json['nfc_enabled'] as bool,
  status: $enumDecode(_$DeviceStatusEnumMap, json['status']),
  publicKey: json['public_key'] as String,
  certSha256: json['cert_sha256'] as String,
  stationName: json['station_name'] as String?,
  pos: json['pos'] == null
      ? null
      : Pos2.fromJson(json['pos'] as Map<String, dynamic>),
  cashDeskAccountId: json['cash_desk_account_id'] as String?,
  agreementPublicKey: json['agreement_public_key'] as String?,
  tokenFamily: json['token_family'] == null
      ? null
      : TokenFamily.fromJson(json['token_family'] as Map<String, dynamic>),
);

Map<String, dynamic> _$EdgeDeviceToJson(EdgeDevice instance) =>
    <String, dynamic>{
      'device_id': instance.deviceId,
      'serial': instance.serial,
      'kind': instance.kind,
      'app_mode': instance.appMode,
      'os': instance.os,
      'nfc_enabled': instance.nfcEnabled,
      'status': instance.status,
      'station_name': instance.stationName,
      'pos': instance.pos,
      'cash_desk_account_id': instance.cashDeskAccountId,
      'public_key': instance.publicKey,
      'cert_sha256': instance.certSha256,
      'agreement_public_key': instance.agreementPublicKey,
      'token_family': instance.tokenFamily,
    };

const _$DeviceKindEnumMap = {DeviceKind.pos: 'POS', DeviceKind.topup: 'TOPUP'};

const _$DeviceAppModeEnumMap = {
  DeviceAppMode.catalogPos: 'CATALOG_POS',
  DeviceAppMode.keypadTpe: 'KEYPAD_TPE',
  DeviceAppMode.topupDesk: 'TOPUP_DESK',
  DeviceAppMode.pairedTpe: 'PAIRED_TPE',
};

const _$EdgeDeviceOsEnumMap = {
  EdgeDeviceOs.android: 'ANDROID',
  EdgeDeviceOs.ios: 'IOS',
};

const _$DeviceStatusEnumMap = {
  DeviceStatus.active: 'ACTIVE',
  DeviceStatus.suspended: 'SUSPENDED',
  DeviceStatus.revoked: 'REVOKED',
};
