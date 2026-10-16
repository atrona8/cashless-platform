// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'participation_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ParticipationCreate _$ParticipationCreateFromJson(Map<String, dynamic> json) =>
    ParticipationCreate(
      merchantId: json['merchant_id'] as String,
      linkType: $enumDecode(
        _$ParticipationCreateLinkTypeEnumMap,
        json['link_type'],
      ),
      pitchFeeReference: json['pitch_fee_reference'] as String?,
      pitchFeeMode:
          $enumDecodeNullable(
            _$ParticipationCreatePitchFeeModeEnumMap,
            json['pitch_fee_mode'],
          ) ??
          ParticipationCreatePitchFeeMode.deductOrDebt,
      pitchFee: (json['pitch_fee'] as num?)?.toInt() ?? 0,
    );

Map<String, dynamic> _$ParticipationCreateToJson(
  ParticipationCreate instance,
) => <String, dynamic>{
  'merchant_id': instance.merchantId,
  'link_type': instance.linkType,
  'pitch_fee_mode': instance.pitchFeeMode,
  'pitch_fee': instance.pitchFee,
  'pitch_fee_reference': instance.pitchFeeReference,
};

const _$ParticipationCreateLinkTypeEnumMap = {
  ParticipationCreateLinkType.internal: 'INTERNAL',
  ParticipationCreateLinkType.valueExternal: 'EXTERNAL',
};

const _$ParticipationCreatePitchFeeModeEnumMap = {
  ParticipationCreatePitchFeeMode.deductOrDebt: 'DEDUCT_OR_DEBT',
  ParticipationCreatePitchFeeMode.prepaid: 'PREPAID',
  ParticipationCreatePitchFeeMode.deductCapped: 'DEDUCT_CAPPED',
};
