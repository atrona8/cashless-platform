// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_app_mode.dart';
import 'device_kind.dart';
import 'enrollment_code_create_provided_by.dart';

part 'enrollment_code_create.g.dart';

@JsonSerializable()
class EnrollmentCodeCreate {
  const EnrollmentCodeCreate({
    required this.appMode,
    required this.kind,
    this.providedBy = EnrollmentCodeCreateProvidedBy.valueOperator,
    this.expiresInSeconds = 86400,
    this.eventId,
    this.posId,
    this.stationName,
  });

  factory EnrollmentCodeCreate.fromJson(Map<String, Object?> json) =>
      _$EnrollmentCodeCreateFromJson(json);

  @JsonKey(name: 'event_id')
  final String? eventId;
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
  @JsonKey(name: 'expires_in_seconds')
  final int expiresInSeconds;

  Map<String, Object?> toJson() => _$EnrollmentCodeCreateToJson(this);
}
