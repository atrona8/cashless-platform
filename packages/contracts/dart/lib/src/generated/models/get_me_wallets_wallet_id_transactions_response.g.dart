// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_me_wallets_wallet_id_transactions_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetMeWalletsWalletIdTransactionsResponse
_$GetMeWalletsWalletIdTransactionsResponseFromJson(Map<String, dynamic> json) =>
    GetMeWalletsWalletIdTransactionsResponse(
      nextCursor: json['next_cursor'] as String?,
      hasMore: json['has_more'] as bool,
      data: (json['data'] as List<dynamic>)
          .map((e) => WalletMovement.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetMeWalletsWalletIdTransactionsResponseToJson(
  GetMeWalletsWalletIdTransactionsResponse instance,
) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
  'data': instance.data,
};
