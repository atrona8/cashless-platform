// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_release_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaReleaseResponse _$MediaReleaseResponseFromJson(
  Map<String, dynamic> json,
) => MediaReleaseResponse(
  mediaId: json['media_id'] as String,
  mediaStatus: $enumDecode(_$MediaStatusEnumMap, json['media_status']),
  depositRefundTransactionId: json['deposit_refund_transaction_id'] as String?,
  promoExpiryTransactionId: json['promo_expiry_transaction_id'] as String?,
  balanceRefundTransactionId: json['balance_refund_transaction_id'] as String?,
  cashToHandBack: (json['cash_to_hand_back'] as num?)?.toInt(),
  cashSessionId: json['cash_session_id'] as String?,
);

Map<String, dynamic> _$MediaReleaseResponseToJson(
  MediaReleaseResponse instance,
) => <String, dynamic>{
  'media_id': instance.mediaId,
  'media_status': instance.mediaStatus,
  'deposit_refund_transaction_id': instance.depositRefundTransactionId,
  'promo_expiry_transaction_id': instance.promoExpiryTransactionId,
  'balance_refund_transaction_id': instance.balanceRefundTransactionId,
  'cash_to_hand_back': instance.cashToHandBack,
  'cash_session_id': instance.cashSessionId,
};

const _$MediaStatusEnumMap = {
  MediaStatus.personalized: 'PERSONALIZED',
  MediaStatus.issued: 'ISSUED',
  MediaStatus.active: 'ACTIVE',
  MediaStatus.suspended: 'SUSPENDED',
  MediaStatus.replaced: 'REPLACED',
  MediaStatus.blacklisted: 'BLACKLISTED',
  MediaStatus.released: 'RELEASED',
  MediaStatus.retired: 'RETIRED',
  MediaStatus.destroyed: 'DESTROYED',
};
