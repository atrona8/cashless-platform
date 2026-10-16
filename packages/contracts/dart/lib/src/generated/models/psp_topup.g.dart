// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'psp_topup.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PspTopup _$PspTopupFromJson(Map<String, dynamic> json) => PspTopup(
  topupId: json['topup_id'] as String,
  status: $enumDecode(_$PspTopupStatusEnumMap, json['status']),
  provider: $enumDecode(_$PspProviderEnumMap, json['provider']),
  amount: (json['amount'] as num).toInt(),
  currency: json['currency'] as String,
  walletId: json['wallet_id'] as String,
  pspConfigId: json['psp_config_id'] as String?,
  providerReference: json['provider_reference'] as String?,
  checkoutUrl: json['checkout_url'] as String?,
  expiresAt: json['expires_at'] == null
      ? null
      : DateTime.parse(json['expires_at'] as String),
  transactionId: json['transaction_id'] as String?,
  failureReason: json['failure_reason'] as String?,
);

Map<String, dynamic> _$PspTopupToJson(PspTopup instance) => <String, dynamic>{
  'topup_id': instance.topupId,
  'status': instance.status,
  'provider': instance.provider,
  'psp_config_id': instance.pspConfigId,
  'provider_reference': instance.providerReference,
  'amount': instance.amount,
  'currency': instance.currency,
  'wallet_id': instance.walletId,
  'checkout_url': instance.checkoutUrl,
  'expires_at': instance.expiresAt?.toIso8601String(),
  'transaction_id': instance.transactionId,
  'failure_reason': instance.failureReason,
};

const _$PspTopupStatusEnumMap = {
  PspTopupStatus.pending: 'PENDING',
  PspTopupStatus.succeeded: 'SUCCEEDED',
  PspTopupStatus.failed: 'FAILED',
  PspTopupStatus.expired: 'EXPIRED',
  PspTopupStatus.cancelled: 'CANCELLED',
};

const _$PspProviderEnumMap = {
  PspProvider.wave: 'WAVE',
  PspProvider.orangeMoney: 'ORANGE_MONEY',
  PspProvider.card: 'CARD',
};
