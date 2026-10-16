// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'customer_media.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CustomerMedia _$CustomerMediaFromJson(Map<String, dynamic> json) =>
    CustomerMedia(
      mediaId: json['media_id'] as String,
      status: $enumDecode(_$MediaStatusEnumMap, json['status']),
      depositStatus: $enumDecode(
        _$DepositStatusEnumMap,
        json['deposit_status'],
      ),
      printedNumber: json['printed_number'] as String?,
      walletId: json['wallet_id'] as String?,
    );

Map<String, dynamic> _$CustomerMediaToJson(CustomerMedia instance) =>
    <String, dynamic>{
      'media_id': instance.mediaId,
      'printed_number': instance.printedNumber,
      'status': instance.status,
      'deposit_status': instance.depositStatus,
      'wallet_id': instance.walletId,
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

const _$DepositStatusEnumMap = {
  DepositStatus.none: 'NONE',
  DepositStatus.due: 'DUE',
  DepositStatus.held: 'HELD',
  DepositStatus.refunded: 'REFUNDED',
  DepositStatus.forfeited: 'FORFEITED',
};
