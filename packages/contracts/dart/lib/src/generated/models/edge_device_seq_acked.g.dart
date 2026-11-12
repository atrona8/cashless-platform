// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_device_seq_acked.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeDeviceSeqAcked _$EdgeDeviceSeqAckedFromJson(Map<String, dynamic> json) =>
    EdgeDeviceSeqAcked(
      deviceId: json['device_id'] as String,
      contiguousAckedSeq: (json['contiguous_acked_seq'] as num).toInt(),
      maxSeenSeq: (json['max_seen_seq'] as num).toInt(),
      missingSeqs: (json['missing_seqs'] as List<dynamic>)
          .map((e) => (e as num).toInt())
          .toList(),
      nextSeqFloor: (json['next_seq_floor'] as num).toInt(),
      asOf: DateTime.parse(json['as_of'] as String),
    );

Map<String, dynamic> _$EdgeDeviceSeqAckedToJson(EdgeDeviceSeqAcked instance) =>
    <String, dynamic>{
      'device_id': instance.deviceId,
      'contiguous_acked_seq': instance.contiguousAckedSeq,
      'max_seen_seq': instance.maxSeenSeq,
      'missing_seqs': instance.missingSeqs,
      'next_seq_floor': instance.nextSeqFloor,
      'as_of': instance.asOf.toIso8601String(),
    };
