// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'participation_create_link_type.dart';
import 'participation_create_pitch_fee_mode.dart';

part 'participation_create.g.dart';

@JsonSerializable()
class ParticipationCreate {
  const ParticipationCreate({
    required this.merchantId,
    required this.linkType,
    this.pitchFeeReference,
    this.pitchFeeMode = ParticipationCreatePitchFeeMode.deductOrDebt,
    this.pitchFee = 0,
  });

  factory ParticipationCreate.fromJson(Map<String, Object?> json) =>
      _$ParticipationCreateFromJson(json);

  @JsonKey(name: 'merchant_id')
  final String merchantId;
  @JsonKey(name: 'link_type')
  final ParticipationCreateLinkType linkType;
  @JsonKey(name: 'pitch_fee_mode')
  final ParticipationCreatePitchFeeMode pitchFeeMode;
  @JsonKey(name: 'pitch_fee')
  final int pitchFee;
  @JsonKey(name: 'pitch_fee_reference')
  final String? pitchFeeReference;

  Map<String, Object?> toJson() => _$ParticipationCreateToJson(this);
}
