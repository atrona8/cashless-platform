// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_search_result.dart';

part 'get_search_media_response.g.dart';

@JsonSerializable()
class GetSearchMediaResponse {
  const GetSearchMediaResponse({required this.data});

  factory GetSearchMediaResponse.fromJson(Map<String, Object?> json) =>
      _$GetSearchMediaResponseFromJson(json);

  final List<MediaSearchResult> data;

  Map<String, Object?> toJson() => _$GetSearchMediaResponseToJson(this);
}
