// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_public_balance_lookups_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostPublicBalanceLookupsResponse _$PostPublicBalanceLookupsResponseFromJson(
  Map<String, dynamic> json,
) => PostPublicBalanceLookupsResponse(
  currency: json['currency'] as String,
  spendable: (json['spendable'] as num).toInt(),
  mediaStatus: $enumDecode(_$MediaStatusEnumMap, json['media_status']),
  recent: (json['recent'] as List<dynamic>)
      .map((e) => Recent.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$PostPublicBalanceLookupsResponseToJson(
  PostPublicBalanceLookupsResponse instance,
) => <String, dynamic>{
  'currency': instance.currency,
  'spendable': instance.spendable,
  'media_status': instance.mediaStatus,
  'recent': instance.recent,
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
