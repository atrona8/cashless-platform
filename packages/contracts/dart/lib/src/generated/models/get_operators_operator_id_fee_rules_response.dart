// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'fee_rule.dart';

part 'get_operators_operator_id_fee_rules_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdFeeRulesResponse {
  const GetOperatorsOperatorIdFeeRulesResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdFeeRulesResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdFeeRulesResponseFromJson(json);

  final List<FeeRule> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdFeeRulesResponseToJson(this);
}
