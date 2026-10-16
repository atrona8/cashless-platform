// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_activation_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaActivationResponse _$MediaActivationResponseFromJson(
  Map<String, dynamic> json,
) => MediaActivationResponse(
  mediaId: json['media_id'] as String,
  mediaStatus: $enumDecode(_$MediaStatusEnumMap, json['media_status']),
  wallet: WalletSummary.fromJson(json['wallet'] as Map<String, dynamic>),
  deposit: DepositState.fromJson(json['deposit'] as Map<String, dynamic>),
);

Map<String, dynamic> _$MediaActivationResponseToJson(
  MediaActivationResponse instance,
) => <String, dynamic>{
  'media_id': instance.mediaId,
  'media_status': instance.mediaStatus,
  'wallet': instance.wallet,
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
