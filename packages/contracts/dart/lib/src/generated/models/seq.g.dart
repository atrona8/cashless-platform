// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'seq.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Seq _$SeqFromJson(Map<String, dynamic> json) => Seq(
  nextSeqFloor: (json['next_seq_floor'] as num).toInt(),
  contiguousAckedSeq: (json['contiguous_acked_seq'] as num).toInt(),
);

Map<String, dynamic> _$SeqToJson(Seq instance) => <String, dynamic>{
  'next_seq_floor': instance.nextSeqFloor,
  'contiguous_acked_seq': instance.contiguousAckedSeq,
};
