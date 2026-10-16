// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'kind.dart';

part 'proof.g.dart';

@JsonSerializable()
class Proof {
  const Proof({required this.kind, this.tapId});

  factory Proof.fromJson(Map<String, Object?> json) => _$ProofFromJson(json);

  final Kind kind;

  /// Obligatoire si `kind = MEDIA_TAP`.
  @JsonKey(name: 'tap_id')
  final int? tapId;

  Map<String, Object?> toJson() => _$ProofToJson(this);
}
