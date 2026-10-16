// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'organizer.dart';

part 'get_operators_operator_id_organizers_response.g.dart';

@JsonSerializable()
class GetOperatorsOperatorIdOrganizersResponse {
  const GetOperatorsOperatorIdOrganizersResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOperatorsOperatorIdOrganizersResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOperatorsOperatorIdOrganizersResponseFromJson(json);

  final List<Organizer> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOperatorsOperatorIdOrganizersResponseToJson(this);
}
