// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'point_of_sale.dart';

part 'get_operators_operator_id_participations_participation_id_points_of_sale_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponse {
  const GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponse.fromJson(
    Map<String, Object?> json,
  ) =>
      _$GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponseFromJson(
        json,
      );

  final List<PointOfSale> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponseToJson(
        this,
      );
}
