// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'edge_handovers_handover_id_ack_request_body.g.dart';

@JsonSerializable()
class EdgeHandoversHandoverIdAckRequestBody {
  const EdgeHandoversHandoverIdAckRequestBody({
    required this.epoch,
    required this.replicatedPostingId,
  });

  factory EdgeHandoversHandoverIdAckRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$EdgeHandoversHandoverIdAckRequestBodyFromJson(json);

  final int epoch;
  @JsonKey(name: 'replicated_posting_id')
  final int replicatedPostingId;

  Map<String, Object?> toJson() =>
      _$EdgeHandoversHandoverIdAckRequestBodyToJson(this);
}
