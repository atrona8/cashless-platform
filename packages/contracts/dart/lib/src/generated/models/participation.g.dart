// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'participation.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Participation _$ParticipationFromJson(Map<String, dynamic> json) =>
    Participation(
      participationId: json['participation_id'] as String,
      operatorId: json['operator_id'] as String,
      eventId: json['event_id'] as String,
      merchantId: json['merchant_id'] as String,
      linkType: $enumDecode(_$ParticipationLinkTypeEnumMap, json['link_type']),
      payoutTo: json['payout_to'] as String,
      pitchFeeMode: $enumDecode(
        _$ParticipationPitchFeeModeEnumMap,
        json['pitch_fee_mode'],
      ),
      pitchFee: (json['pitch_fee'] as num).toInt(),
      pitchFeeReference: json['pitch_fee_reference'] as String?,
      accountId: json['account_id'] as String,
    );

Map<String, dynamic> _$ParticipationToJson(Participation instance) =>
    <String, dynamic>{
      'participation_id': instance.participationId,
      'operator_id': instance.operatorId,
      'event_id': instance.eventId,
      'merchant_id': instance.merchantId,
      'link_type': instance.linkType,
      'payout_to': instance.payoutTo,
      'pitch_fee_mode': instance.pitchFeeMode,
      'pitch_fee': instance.pitchFee,
      'pitch_fee_reference': instance.pitchFeeReference,
      'account_id': instance.accountId,
    };

const _$ParticipationLinkTypeEnumMap = {
  ParticipationLinkType.internal: 'INTERNAL',
  ParticipationLinkType.valueExternal: 'EXTERNAL',
};

const _$ParticipationPitchFeeModeEnumMap = {
  ParticipationPitchFeeMode.deductOrDebt: 'DEDUCT_OR_DEBT',
  ParticipationPitchFeeMode.prepaid: 'PREPAID',
  ParticipationPitchFeeMode.deductCapped: 'DEDUCT_CAPPED',
};
