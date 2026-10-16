// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_guichet.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeGuichet _$EdgeGuichetFromJson(Map<String, dynamic> json) => EdgeGuichet(
  mediaId: json['media_id'] as String,
  walletId: json['wallet_id'] as String?,
  eventId: json['event_id'] as String?,
  channel: $enumDecodeNullable(_$Channel2EnumMap, json['channel']),
  depositAmount: (json['deposit_amount'] as num?)?.toInt(),
  cashDeskAccountId: json['cash_desk_account_id'] as String?,
);

Map<String, dynamic> _$EdgeGuichetToJson(EdgeGuichet instance) =>
    <String, dynamic>{
      'media_id': instance.mediaId,
      'wallet_id': instance.walletId,
      'event_id': instance.eventId,
      'channel': instance.channel,
      'deposit_amount': instance.depositAmount,
      'cash_desk_account_id': instance.cashDeskAccountId,
    };

const _$Channel2EnumMap = {Channel2.desk: 'DESK'};
