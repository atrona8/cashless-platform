// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'contract.dart';

part 'get_operators_operator_id_platform_contracts_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdPlatformContractsResponse {
  const GetOperatorsOperatorIdPlatformContractsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdPlatformContractsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdPlatformContractsResponseFromJson(json);

  final List<Contract> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdPlatformContractsResponseToJson(this);
}
