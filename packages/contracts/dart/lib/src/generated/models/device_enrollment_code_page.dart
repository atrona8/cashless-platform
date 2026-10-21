// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_enrollment_code_summary.dart';

part 'device_enrollment_code_page.g.dart';

@JsonSerializable()
class DeviceEnrollmentCodePage {
  const DeviceEnrollmentCodePage({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory DeviceEnrollmentCodePage.fromJson(Map<String, Object?> json) =>
      _$DeviceEnrollmentCodePageFromJson(json);

  final List<DeviceEnrollmentCodeSummary> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$DeviceEnrollmentCodePageToJson(this);
}
