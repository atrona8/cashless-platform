// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_operators_operator_id_participations_participation_id_points_of_sale_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponse
_$GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponseFromJson(
  Map<String, dynamic> json,
) => GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => PointOfSale.fromJson(e as Map<String, dynamic>))
      .toList(),
  hasMore: json['has_more'] as bool,
  nextCursor: json['next_cursor'] as String?,
);

Map<String, dynamic>
_$GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponseToJson(
  GetOperatorsOperatorIdParticipationsParticipationIdPointsOfSaleResponse
  instance,
) => <String, dynamic>{
  'data': instance.data,
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
};
