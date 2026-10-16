// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'seq.g.dart';

@JsonSerializable()
class Seq {
  const Seq({required this.nextSeqFloor, required this.contiguousAckedSeq});

  factory Seq.fromJson(Map<String, Object?> json) => _$SeqFromJson(json);

  /// Le terminal DOIT utiliser seq ≥ max(local + 1, next_seq_floor).
  @JsonKey(name: 'next_seq_floor')
  final int nextSeqFloor;
  @JsonKey(name: 'contiguous_acked_seq')
  final int contiguousAckedSeq;

  Map<String, Object?> toJson() => _$SeqToJson(this);
}
