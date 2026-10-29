// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'psp_configuration.dart';

part 'get_organizers_organizer_id_psp_configurations_response.g.dart';

@JsonSerializable()
class GetOrganizersOrganizerIdPspConfigurationsResponse {
  const GetOrganizersOrganizerIdPspConfigurationsResponse({
    required this.data,
    required this.hasMore,
    this.nextCursor,
  });

  factory GetOrganizersOrganizerIdPspConfigurationsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetOrganizersOrganizerIdPspConfigurationsResponseFromJson(json);

  final List<PspConfiguration> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() =>
      _$GetOrganizersOrganizerIdPspConfigurationsResponseToJson(this);
}
