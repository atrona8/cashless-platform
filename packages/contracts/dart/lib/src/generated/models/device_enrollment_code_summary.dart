// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_enrollment_code_summary_app_mode.dart';
import 'device_enrollment_code_summary_kind.dart';
import 'timestamp.dart';

part 'device_enrollment_code_summary.g.dart';

/// Code d'enrôlement en cours, vu du back-office. Ne porte JAMAIS le code ni son empreinte.
@JsonSerializable()
class DeviceEnrollmentCodeSummary {
  const DeviceEnrollmentCodeSummary({
    required this.enrollmentCodeId,
    required this.eventId,
    required this.posId,
    required this.stationName,
    required this.appMode,
    required this.kind,
    required this.personalPhone,
    required this.createdBy,
    required this.createdAt,
    required this.expiresAt,
  });

  factory DeviceEnrollmentCodeSummary.fromJson(Map<String, Object?> json) =>
      _$DeviceEnrollmentCodeSummaryFromJson(json);

  @JsonKey(name: 'enrollment_code_id')
  final String enrollmentCodeId;
  @JsonKey(name: 'event_id')
  final String? eventId;
  @JsonKey(name: 'pos_id')
  final String? posId;
  @JsonKey(name: 'station_name')
  final String? stationName;
  @JsonKey(name: 'app_mode')
  final DeviceEnrollmentCodeSummaryAppMode? appMode;
  final DeviceEnrollmentCodeSummaryKind? kind;
  @JsonKey(name: 'personal_phone')
  final bool personalPhone;
  @JsonKey(name: 'created_by')
  final String createdBy;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  @JsonKey(name: 'expires_at')
  final Timestamp expiresAt;

  Map<String, Object?> toJson() => _$DeviceEnrollmentCodeSummaryToJson(this);
}
