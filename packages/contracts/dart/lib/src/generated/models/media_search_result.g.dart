// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_search_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaSearchResult _$MediaSearchResultFromJson(Map<String, dynamic> json) =>
    MediaSearchResult(
      mediaId: json['media_id'] as String,
      status: $enumDecode(_$MediaStatusEnumMap, json['status']),
      eventId: json['event_id'] as String?,
      walletId: json['wallet_id'] as String?,
      printedNumber: json['printed_number'] as String?,
      paidBalance: (json['paid_balance'] as num?)?.toInt(),
      promoBalance: (json['promo_balance'] as num?)?.toInt(),
      deposit: (json['deposit'] as num?)?.toInt(),
    );

Map<String, dynamic> _$MediaSearchResultToJson(MediaSearchResult instance) =>
    <String, dynamic>{
      'media_id': instance.mediaId,
      'status': instance.status,
      'event_id': instance.eventId,
      'wallet_id': instance.walletId,
      'printed_number': instance.printedNumber,
      'paid_balance': instance.paidBalance,
      'promo_balance': instance.promoBalance,
      'deposit': instance.deposit,
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
