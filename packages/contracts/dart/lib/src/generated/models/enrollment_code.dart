// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_app_mode.dart';
import 'timestamp.dart';

part 'enrollment_code.g.dart';

@JsonSerializable()
class EnrollmentCode {
  const EnrollmentCode({
    required this.enrollmentCodeId,
    required this.code,
    required this.expiresAt,
    required this.appMode,
  });

  factory EnrollmentCode.fromJson(Map<String, Object?> json) =>
      _$EnrollmentCodeFromJson(json);

  @JsonKey(name: 'enrollment_code_id')
  final String enrollmentCodeId;
  final String code;
  @JsonKey(name: 'expires_at')
  final Timestamp expiresAt;
  @JsonKey(name: 'app_mode')
  final DeviceAppMode appMode;

  Map<String, Object?> toJson() => _$EnrollmentCodeToJson(this);
}
