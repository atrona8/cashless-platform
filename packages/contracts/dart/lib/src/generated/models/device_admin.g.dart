// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_admin.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceAdmin _$DeviceAdminFromJson(Map<String, dynamic> json) => DeviceAdmin(
  deviceId: json['device_id'] as String,
  serial: json['serial'] as String,
  kind: $enumDecode(_$DeviceKindEnumMap, json['kind']),
  appMode: $enumDecode(_$DeviceAppModeEnumMap, json['app_mode']),
  os: $enumDecode(_$DeviceAdminOsEnumMap, json['os']),
  personalPhone: json['personal_phone'] as bool,
  nfcEnabled: json['nfc_enabled'] as bool,
  status: $enumDecode(_$DeviceStatusEnumMap, json['status']),
  statusReason: json['status_reason'] as String?,
  eventId: json['event_id'] as String?,
  posId: json['pos_id'] as String?,
  stationName: json['station_name'] as String?,
  appVersion: json['app_version'] as String?,
  attestationKind: $enumDecodeNullable(
    _$DeviceAdminAttestationKindEnumMap,
    json['attestation_kind'],
  ),
  attestationSecurityLevel: $enumDecodeNullable(
    _$DeviceAdminAttestationSecurityLevelEnumMap,
    json['attestation_security_level'],
  ),
  enrolledAt: json['enrolled_at'] == null
      ? null
      : DateTime.parse(json['enrolled_at'] as String),
  lastSeenAt: json['last_seen_at'] == null
      ? null
      : DateTime.parse(json['last_seen_at'] as String),
  certNotAfter: json['cert_not_after'] == null
      ? null
      : DateTime.parse(json['cert_not_after'] as String),
  providedBy: $enumDecodeNullable(
    _$DeviceAdminProvidedByEnumMap,
    json['provided_by'],
  ),
);

Map<String, dynamic> _$DeviceAdminToJson(DeviceAdmin instance) =>
    <String, dynamic>{
      'device_id': instance.deviceId,
      'serial': instance.serial,
      'kind': instance.kind,
      'app_mode': instance.appMode,
      'os': instance.os,
      'personal_phone': instance.personalPhone,
      'nfc_enabled': instance.nfcEnabled,
      'provided_by': instance.providedBy,
      'status': instance.status,
      'status_reason': instance.statusReason,
      'event_id': instance.eventId,
      'pos_id': instance.posId,
      'station_name': instance.stationName,
      'app_version': instance.appVersion,
      'attestation_kind': instance.attestationKind,
      'attestation_security_level': instance.attestationSecurityLevel,
      'enrolled_at': instance.enrolledAt?.toIso8601String(),
      'last_seen_at': instance.lastSeenAt?.toIso8601String(),
      'cert_not_after': instance.certNotAfter?.toIso8601String(),
    };

const _$DeviceKindEnumMap = {DeviceKind.pos: 'POS', DeviceKind.topup: 'TOPUP'};

const _$DeviceAppModeEnumMap = {
  DeviceAppMode.catalogPos: 'CATALOG_POS',
  DeviceAppMode.keypadTpe: 'KEYPAD_TPE',
  DeviceAppMode.topupDesk: 'TOPUP_DESK',
  DeviceAppMode.pairedTpe: 'PAIRED_TPE',
};

const _$DeviceAdminOsEnumMap = {
  DeviceAdminOs.android: 'ANDROID',
  DeviceAdminOs.ios: 'IOS',
};

const _$DeviceStatusEnumMap = {
  DeviceStatus.active: 'ACTIVE',
  DeviceStatus.suspended: 'SUSPENDED',
  DeviceStatus.revoked: 'REVOKED',
};

const _$DeviceAdminAttestationKindEnumMap = {
  DeviceAdminAttestationKind.androidKeyAttestation: 'ANDROID_KEY_ATTESTATION',
  DeviceAdminAttestationKind.iosAppAttest: 'IOS_APP_ATTEST',
  DeviceAdminAttestationKind.valueNull: null,
};

const _$DeviceAdminAttestationSecurityLevelEnumMap = {
  DeviceAdminAttestationSecurityLevel.trustedEnvironment: 'TRUSTED_ENVIRONMENT',
  DeviceAdminAttestationSecurityLevel.strongbox: 'STRONGBOX',
  DeviceAdminAttestationSecurityLevel.valueNull: null,
};

const _$DeviceAdminProvidedByEnumMap = {
  DeviceAdminProvidedBy.platform: 'PLATFORM',
  DeviceAdminProvidedBy.valueOperator: 'OPERATOR',
  DeviceAdminProvidedBy.organizer: 'ORGANIZER',
  DeviceAdminProvidedBy.merchant: 'MERCHANT',
};
