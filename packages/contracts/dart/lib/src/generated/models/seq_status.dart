// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'seq_status.g.dart';

@JsonSerializable()
class SeqStatus {
  const SeqStatus({
    required this.deviceSerial,
    required this.contiguousAckedSeq,
    required this.maxSeenSeq,
    required this.missingSeqs,
    required this.nextSeqFloor,
  });

  factory SeqStatus.fromJson(Map<String, Object?> json) =>
      _$SeqStatusFromJson(json);

  @JsonKey(name: 'device_serial')
  final String deviceSerial;
  @JsonKey(name: 'contiguous_acked_seq')
  final int contiguousAckedSeq;
  @JsonKey(name: 'max_seen_seq')
  final int maxSeenSeq;
  @JsonKey(name: 'missing_seqs')
  final List<int> missingSeqs;
  @JsonKey(name: 'next_seq_floor')
  final int nextSeqFloor;

  Map<String, Object?> toJson() => _$SeqStatusToJson(this);
}
