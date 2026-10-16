// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'wallet.dart';

part 'get_me_wallets_response.g.dart';

@JsonSerializable()
class GetMeWalletsResponse {
  const GetMeWalletsResponse({required this.data});

  factory GetMeWalletsResponse.fromJson(Map<String, Object?> json) =>
      _$GetMeWalletsResponseFromJson(json);

  final List<Wallet> data;

  Map<String, Object?> toJson() => _$GetMeWalletsResponseToJson(this);
}
