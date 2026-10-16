// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tag_key.dart';

part 'get_operators_operator_id_tag_keys_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdTagKeysResponse {
  const GetOperatorsOperatorIdTagKeysResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdTagKeysResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdTagKeysResponseFromJson(json);

  final List<TagKey> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdTagKeysResponseToJson(this);
}
