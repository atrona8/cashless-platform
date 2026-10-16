// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_handovers_handover_id_ack_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeHandoversHandoverIdAckRequestBody
_$EdgeHandoversHandoverIdAckRequestBodyFromJson(Map<String, dynamic> json) =>
    EdgeHandoversHandoverIdAckRequestBody(
      epoch: (json['epoch'] as num).toInt(),
      replicatedPostingId: (json['replicated_posting_id'] as num).toInt(),
    );

Map<String, dynamic> _$EdgeHandoversHandoverIdAckRequestBodyToJson(
  EdgeHandoversHandoverIdAckRequestBody instance,
) => <String, dynamic>{
  'epoch': instance.epoch,
  'replicated_posting_id': instance.replicatedPostingId,
};
