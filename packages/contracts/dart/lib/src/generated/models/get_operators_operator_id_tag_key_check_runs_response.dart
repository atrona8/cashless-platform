// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tag_key_check_run.dart';

part 'get_operators_operator_id_tag_key_check_runs_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdTagKeyCheckRunsResponse {
  const GetOperatorsOperatorIdTagKeyCheckRunsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdTagKeyCheckRunsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdTagKeyCheckRunsResponseFromJson(json);

  final List<TagKeyCheckRun> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdTagKeyCheckRunsResponseToJson(this);
}
