// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'psp_topup_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PspTopupRequest _$PspTopupRequestFromJson(Map<String, dynamic> json) =>
    PspTopupRequest(
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      provider: $enumDecode(_$PspProviderEnumMap, json['provider']),
      walletId: json['wallet_id'] as String?,
      tapId: (json['tap_id'] as num?)?.toInt(),
      payerMsisdn: json['payer_msisdn'] as String?,
      returnUrl: json['return_url'] as String?,
    );

Map<String, dynamic> _$PspTopupRequestToJson(PspTopupRequest instance) =>
    <String, dynamic>{
      'wallet_id': instance.walletId,
      'tap_id': instance.tapId,
      'amount': instance.amount,
      'currency': instance.currency,
      'provider': instance.provider,
      'payer_msisdn': instance.payerMsisdn,
      'return_url': instance.returnUrl,
    };

const _$PspProviderEnumMap = {
  PspProvider.wave: 'WAVE',
  PspProvider.orangeMoney: 'ORANGE_MONEY',
  PspProvider.card: 'CARD',
};
