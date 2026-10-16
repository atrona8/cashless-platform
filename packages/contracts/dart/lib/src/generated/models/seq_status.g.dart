// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'seq_status.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SeqStatus _$SeqStatusFromJson(Map<String, dynamic> json) => SeqStatus(
  deviceSerial: json['device_serial'] as String,
  contiguousAckedSeq: (json['contiguous_acked_seq'] as num).toInt(),
  maxSeenSeq: (json['max_seen_seq'] as num).toInt(),
  missingSeqs: (json['missing_seqs'] as List<dynamic>)
      .map((e) => (e as num).toInt())
      .toList(),
  nextSeqFloor: (json['next_seq_floor'] as num).toInt(),
);

Map<String, dynamic> _$SeqStatusToJson(SeqStatus instance) => <String, dynamic>{
  'device_serial': instance.deviceSerial,
  'contiguous_acked_seq': instance.contiguousAckedSeq,
  'max_seen_seq': instance.maxSeenSeq,
  'missing_seqs': instance.missingSeqs,
  'next_seq_floor': instance.nextSeqFloor,
};
