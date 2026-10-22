// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_admin_attestation_kind.dart';
import 'device_admin_attestation_security_level.dart';
import 'device_admin_os.dart';
import 'device_admin_provided_by.dart';
import 'device_app_mode.dart';
import 'device_kind.dart';
import 'device_status.dart';

part 'device_admin.g.dart';

/// Terminal vu du back-office (nommé comme `MediaAdmin` : `Device` désigne déjà, dans les types Dart, l'objet.
/// `device` de `DeviceConfig`). Ne porte JAMAIS de clé publique (`public_key`), de clé d'accord.
/// (`agreement_public_key`), d'empreinte de certificat (`cert_sha256`) ni de jeton.
///
@JsonSerializable()
class DeviceAdmin {
  const DeviceAdmin({
    required this.deviceId,
    required this.serial,
    required this.kind,
    required this.appMode,
    required this.os,
    required this.personalPhone,
    required this.nfcEnabled,
    required this.status,
    required this.statusReason,
    required this.eventId,
    required this.posId,
    required this.stationName,
    required this.appVersion,
    required this.attestationKind,
    required this.attestationSecurityLevel,
    required this.enrolledAt,
    required this.lastSeenAt,
    required this.certNotAfter,
    this.providedBy,
  });

  factory DeviceAdmin.fromJson(Map<String, Object?> json) =>
      _$DeviceAdminFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;
  final String serial;
  final DeviceKind kind;
  @JsonKey(name: 'app_mode')
  final DeviceAppMode appMode;
  final DeviceAdminOs os;
  @JsonKey(name: 'personal_phone')
  final bool personalPhone;
  @JsonKey(name: 'nfc_enabled')
  final bool nfcEnabled;
  @JsonKey(name: 'provided_by')
  final DeviceAdminProvidedBy? providedBy;
  final DeviceStatus status;

  /// Motif du dernier changement de statut.
  @JsonKey(name: 'status_reason')
  final String? statusReason;
  @JsonKey(name: 'event_id')
  final String? eventId;
  @JsonKey(name: 'pos_id')
  final String? posId;
  @JsonKey(name: 'station_name')
  final String? stationName;

  /// Version de l'app à l'enrôlement, mise à jour par le battement de cœur.
  @JsonKey(name: 'app_version')
  final String? appVersion;

  /// Preuve d'attestation vérifiée à l'enrôlement (`null` pour un terminal antérieur à la mission).
  @JsonKey(name: 'attestation_kind')
  final DeviceAdminAttestationKind? attestationKind;

  /// Android : niveau de sécurité de la clé attestée ; iOS : `null`.
  @JsonKey(name: 'attestation_security_level')
  final DeviceAdminAttestationSecurityLevel? attestationSecurityLevel;
  @JsonKey(name: 'enrolled_at')
  final DateTime? enrolledAt;
  @JsonKey(name: 'last_seen_at')
  final DateTime? lastSeenAt;

  /// Fin de validité du certificat client.
  @JsonKey(name: 'cert_not_after')
  final DateTime? certNotAfter;

  Map<String, Object?> toJson() => _$DeviceAdminToJson(this);
}
