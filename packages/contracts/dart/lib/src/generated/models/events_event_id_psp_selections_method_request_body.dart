// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'events_event_id_psp_selections_method_request_body.g.dart';

@JsonSerializable()
class EventsEventIdPspSelectionsMethodRequestBody {
  const EventsEventIdPspSelectionsMethodRequestBody({
    required this.pspConfigId,
  });

  factory EventsEventIdPspSelectionsMethodRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$EventsEventIdPspSelectionsMethodRequestBodyFromJson(json);

  @JsonKey(name: 'psp_config_id')
  final String pspConfigId;

  Map<String, Object?> toJson() =>
      _$EventsEventIdPspSelectionsMethodRequestBodyToJson(this);
}
