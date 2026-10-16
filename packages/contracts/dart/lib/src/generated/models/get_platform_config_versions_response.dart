// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'config_version.dart';

part 'get_platform_config_versions_response.g.dart';

@JsonSerializable()
class GetPlatformConfigVersionsResponse {
  const GetPlatformConfigVersionsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetPlatformConfigVersionsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetPlatformConfigVersionsResponseFromJson(json);

  final List<ConfigVersion> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetPlatformConfigVersionsResponseToJson(this);
}
