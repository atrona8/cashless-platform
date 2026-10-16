// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'merchant.dart';

part 'get_operators_operator_id_merchants_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdMerchantsResponse {
  const GetOperatorsOperatorIdMerchantsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdMerchantsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdMerchantsResponseFromJson(json);

  final List<Merchant> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdMerchantsResponseToJson(this);
}
