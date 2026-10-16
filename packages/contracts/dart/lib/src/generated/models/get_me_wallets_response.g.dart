// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_me_wallets_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetMeWalletsResponse _$GetMeWalletsResponseFromJson(
  Map<String, dynamic> json,
) => GetMeWalletsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => Wallet.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetMeWalletsResponseToJson(
  GetMeWalletsResponse instance,
) => <String, dynamic>{'data': instance.data};
