// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'refund_request_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RefundRequestCreate _$RefundRequestCreateFromJson(Map<String, dynamic> json) =>
    RefundRequestCreate(
      walletId: json['wallet_id'] as String,
      destination: Destination2.fromJson(
        json['destination'] as Map<String, dynamic>,
      ),
    );

Map<String, dynamic> _$RefundRequestCreateToJson(
  RefundRequestCreate instance,
) => <String, dynamic>{
  'wallet_id': instance.walletId,
  'destination': instance.destination,
};
