// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'operator.dart';

part 'get_operators_response.g.dart';

@JsonSerializable()
class GetOperatorsResponse {
  const GetOperatorsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsResponse.fromJson(Map<String, Object?> json) =>
      _$GetOperatorsResponseFromJson(json);

  final List<Operator> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$GetOperatorsResponseToJson(this);
}
