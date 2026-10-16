// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'participation_update.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ParticipationUpdate _$ParticipationUpdateFromJson(Map<String, dynamic> json) =>
    ParticipationUpdate(
      pitchFeeMode: $enumDecodeNullable(
        _$ParticipationUpdatePitchFeeModeEnumMap,
        json['pitch_fee_mode'],
      ),
      pitchFee: (json['pitch_fee'] as num?)?.toInt(),
      pitchFeeReference: json['pitch_fee_reference'] as String?,
    );

Map<String, dynamic> _$ParticipationUpdateToJson(
  ParticipationUpdate instance,
) => <String, dynamic>{
  'pitch_fee_mode': instance.pitchFeeMode,
  'pitch_fee': instance.pitchFee,
  'pitch_fee_reference': instance.pitchFeeReference,
};

const _$ParticipationUpdatePitchFeeModeEnumMap = {
  ParticipationUpdatePitchFeeMode.deductOrDebt: 'DEDUCT_OR_DEBT',
  ParticipationUpdatePitchFeeMode.prepaid: 'PREPAID',
  ParticipationUpdatePitchFeeMode.deductCapped: 'DEDUCT_CAPPED',
};
