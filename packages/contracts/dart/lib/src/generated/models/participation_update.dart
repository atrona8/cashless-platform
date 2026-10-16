// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'participation_update_pitch_fee_mode.dart';

part 'participation_update.g.dart';

@JsonSerializable()
class ParticipationUpdate {
  const ParticipationUpdate({
    this.pitchFeeMode,
    this.pitchFee,
    this.pitchFeeReference,
  });

  factory ParticipationUpdate.fromJson(Map<String, Object?> json) =>
      _$ParticipationUpdateFromJson(json);

  @JsonKey(name: 'pitch_fee_mode')
  final ParticipationUpdatePitchFeeMode? pitchFeeMode;
  @JsonKey(name: 'pitch_fee')
  final int? pitchFee;
  @JsonKey(name: 'pitch_fee_reference')
  final String? pitchFeeReference;

  Map<String, Object?> toJson() => _$ParticipationUpdateToJson(this);
}
