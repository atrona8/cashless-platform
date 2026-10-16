// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'hex32.dart';

part 'edge_handovers_handover_id_release_request_body.g.dart';

@JsonSerializable()
class EdgeHandoversHandoverIdReleaseRequestBody {
  const EdgeHandoversHandoverIdReleaseRequestBody({
    required this.epoch,
    required this.finalEdgeSeq,
    required this.lastChainHash,
    required this.operationsCount,
  });

  factory EdgeHandoversHandoverIdReleaseRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$EdgeHandoversHandoverIdReleaseRequestBodyFromJson(json);

  final int epoch;
  @JsonKey(name: 'final_edge_seq')
  final int finalEdgeSeq;
  @JsonKey(name: 'last_chain_hash')
  final Hex32 lastChainHash;
  @JsonKey(name: 'operations_count')
  final int operationsCount;

  Map<String, Object?> toJson() =>
      _$EdgeHandoversHandoverIdReleaseRequestBodyToJson(this);
}
