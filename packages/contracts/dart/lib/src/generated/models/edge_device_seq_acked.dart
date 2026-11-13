// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'edge_device_seq_acked.g.dart';

/// État des numéros d'un terminal vu par le central à la date de la page : base de `getDeviceSeqStatus` et de.
/// `DeviceConfig.seq`. Un seul endroit du flux le porte (A02).
///
@JsonSerializable()
class EdgeDeviceSeqAcked {
  const EdgeDeviceSeqAcked({
    required this.deviceId,
    required this.contiguousAckedSeq,
    required this.maxSeenSeq,
    required this.missingSeqs,
    required this.nextSeqFloor,
    required this.asOf,
  });

  factory EdgeDeviceSeqAcked.fromJson(Map<String, Object?> json) =>
      _$EdgeDeviceSeqAckedFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;
  @JsonKey(name: 'contiguous_acked_seq')
  final int contiguousAckedSeq;
  @JsonKey(name: 'max_seen_seq')
  final int maxSeenSeq;
  @JsonKey(name: 'missing_seqs')
  final List<int> missingSeqs;
  @JsonKey(name: 'next_seq_floor')
  final int nextSeqFloor;
  @JsonKey(name: 'as_of')
  final Timestamp asOf;

  Map<String, Object?> toJson() => _$EdgeDeviceSeqAckedToJson(this);
}
