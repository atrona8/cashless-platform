// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'page_meta.dart';
import 'wallet_movement.dart';

part 'get_me_wallets_wallet_id_transactions_response.g.dart';

@JsonSerializable()
class GetMeWalletsWalletIdTransactionsResponse {
  const GetMeWalletsWalletIdTransactionsResponse({
    required this.nextCursor,
    required this.hasMore,
    required this.data,
  });

  factory GetMeWalletsWalletIdTransactionsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetMeWalletsWalletIdTransactionsResponseFromJson(json);

  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;
  final List<WalletMovement> data;

  Map<String, Object?> toJson() =>
      _$GetMeWalletsWalletIdTransactionsResponseToJson(this);
}
