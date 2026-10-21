// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_app_mode.dart';
import 'device_kind.dart';
import 'enrollment_code_create_provided_by.dart';

part 'enrollment_code_create.g.dart';

/// Création d'un code d'enrôlement (`createDeviceEnrollmentCode`). `event_id` est obligatoire : tout terminal.
/// est affecté à un événement (condition de `DeviceConfig`). `personal_phone` est obligatoire et sans défaut.
///
@JsonSerializable()
class EnrollmentCodeCreate {
  const EnrollmentCodeCreate({
    required this.eventId,
    required this.appMode,
    required this.kind,
    required this.personalPhone,
    this.providedBy = EnrollmentCodeCreateProvidedBy.valueOperator,
    this.expiresInSeconds = 86400,
    this.posId,
    this.stationName,
  });

  factory EnrollmentCodeCreate.fromJson(Map<String, Object?> json) =>
      _$EnrollmentCodeCreateFromJson(json);

  /// Événement du terminal (même prestataire ; pour `ORGANIZER_ADMIN`, un événement de son organisateur).
  @JsonKey(name: 'event_id')
  final String eventId;
  @JsonKey(name: 'pos_id')
  final String? posId;
  @JsonKey(name: 'station_name')
  final String? stationName;
  @JsonKey(name: 'app_mode')
  final DeviceAppMode appMode;
  final DeviceKind kind;

  /// Qui fournit le terminal ; désigne qui porte la perte d'une opération non conforme (ADR-58).
  @JsonKey(name: 'provided_by')
  final EnrollmentCodeCreateProvidedBy providedBy;

  /// Téléphone personnel (sans MDM) : choix obligatoire de l'administrateur, sans défaut (un défaut `false`.
  /// donnerait le hors ligne par oubli). `true` impose `app_mode = KEYPAD_TPE` (sinon.
  /// `422 DEVICE_MODE_NOT_ALLOWED`) et une politique effective sans hors ligne, sans recharge, remboursement.
  /// ni caution. Le terminal ne le déclare jamais lui-même.
  ///
  @JsonKey(name: 'personal_phone')
  final bool personalPhone;

  /// Durée de validité du code, de 5 min à 7 jours (défaut 24 h) ; hors bornes `422 VALIDATION_FAILED`.
  @JsonKey(name: 'expires_in_seconds')
  final int expiresInSeconds;

  Map<String, Object?> toJson() => _$EnrollmentCodeCreateToJson(this);
}
