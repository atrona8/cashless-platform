// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_admin.dart';

part 'device_page.g.dart';

@JsonSerializable()
class DevicePage {
  const DevicePage({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory DevicePage.fromJson(Map<String, Object?> json) =>
      _$DevicePageFromJson(json);

  final List<DeviceAdmin> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$DevicePageToJson(this);
}
