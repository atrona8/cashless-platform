// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'account_mapping_version.dart';
import 'page_meta.dart';

part 'get_operators_operator_id_account_mappings_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdAccountMappingsResponse {
  const GetOperatorsOperatorIdAccountMappingsResponse({
    required this.nextCursor,
    required this.hasMore,
    required this.data,
  });

  factory GetOperatorsOperatorIdAccountMappingsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdAccountMappingsResponseFromJson(json);

  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;
  final List<AccountMappingVersion> data;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdAccountMappingsResponseToJson(this);
}
