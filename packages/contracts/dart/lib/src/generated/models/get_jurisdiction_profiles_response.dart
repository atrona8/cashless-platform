// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'jurisdiction_profile.dart';

part 'get_jurisdiction_profiles_response.g.dart';

@JsonSerializable()
class GetJurisdictionProfilesResponse {
  const GetJurisdictionProfilesResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetJurisdictionProfilesResponse.fromJson(Map<String, Object?> json) =>
      _$GetJurisdictionProfilesResponseFromJson(json);

  final List<JurisdictionProfile> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetJurisdictionProfilesResponseToJson(this);
}
