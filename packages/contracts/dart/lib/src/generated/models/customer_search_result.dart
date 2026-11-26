// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'wallet_overview.dart';

part 'customer_search_result.g.dart';

@JsonSerializable()
class CustomerSearchResult {
  const CustomerSearchResult({
    required this.maskedPhone,
    required this.wallets,
  });

  factory CustomerSearchResult.fromJson(Map<String, Object?> json) =>
      _$CustomerSearchResultFromJson(json);

  /// Numéro masqué (indicatif, deux chiffres, étoiles, deux derniers chiffres).
  @JsonKey(name: 'masked_phone')
  final String maskedPhone;
  final List<WalletOverview> wallets;

  Map<String, Object?> toJson() => _$CustomerSearchResultToJson(this);
}
