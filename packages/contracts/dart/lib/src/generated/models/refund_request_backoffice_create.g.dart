// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'refund_request_backoffice_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RefundRequestBackofficeCreate _$RefundRequestBackofficeCreateFromJson(
  Map<String, dynamic> json,
) => RefundRequestBackofficeCreate(
  walletId: json['wallet_id'] as String,
  destination: Destination4.fromJson(
    json['destination'] as Map<String, dynamic>,
  ),
  reason: json['reason'] as String,
);

Map<String, dynamic> _$RefundRequestBackofficeCreateToJson(
  RefundRequestBackofficeCreate instance,
) => <String, dynamic>{
  'wallet_id': instance.walletId,
  'destination': instance.destination,
  'reason': instance.reason,
};
