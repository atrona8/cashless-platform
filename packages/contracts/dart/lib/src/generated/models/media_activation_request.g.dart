// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_activation_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaActivationRequest _$MediaActivationRequestFromJson(
  Map<String, dynamic> json,
) => MediaActivationRequest(
  tap: TapInput.fromJson(json['tap'] as Map<String, dynamic>),
  channel: $enumDecode(_$MediaActivationRequestChannelEnumMap, json['channel']),
  occurredAt: DateTime.parse(json['occurred_at'] as String),
  tapId: (json['tap_id'] as num?)?.toInt(),
  walletId: json['wallet_id'] as String?,
  customerId: json['customer_id'] as String?,
  depositPayment: json['deposit_payment'] == null
      ? null
      : MoneyMovement.fromJson(json['deposit_payment'] as Map<String, dynamic>),
);

Map<String, dynamic> _$MediaActivationRequestToJson(
  MediaActivationRequest instance,
) => <String, dynamic>{
  'tap': instance.tap,
  'tap_id': instance.tapId,
  'channel': instance.channel,
  'wallet_id': instance.walletId,
  'customer_id': instance.customerId,
  'deposit_payment': instance.depositPayment,
  'occurred_at': instance.occurredAt.toIso8601String(),
};

const _$MediaActivationRequestChannelEnumMap = {
  MediaActivationRequestChannel.desk: 'DESK',
  MediaActivationRequestChannel.firstTopup: 'FIRST_TOPUP',
};
