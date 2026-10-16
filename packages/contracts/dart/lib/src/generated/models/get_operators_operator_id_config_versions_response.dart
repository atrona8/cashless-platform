// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'config_version.dart';

part 'get_operators_operator_id_config_versions_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdConfigVersionsResponse {
  const GetOperatorsOperatorIdConfigVersionsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdConfigVersionsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdConfigVersionsResponseFromJson(json);

  final List<ConfigVersion> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdConfigVersionsResponseToJson(this);
}
