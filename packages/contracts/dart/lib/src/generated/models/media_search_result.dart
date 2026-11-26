// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_status.dart';

part 'media_search_result.g.dart';

/// Bracelet trouvé, avec les soldes de son portefeuille (unités mineures). `wallet_id` et les soldes sont.
/// `null` pour un bracelet sans portefeuille.
///
@JsonSerializable()
class MediaSearchResult {
  const MediaSearchResult({
    required this.mediaId,
    required this.status,
    required this.eventId,
    required this.walletId,
    required this.printedNumber,
    required this.paidBalance,
    required this.promoBalance,
    required this.deposit,
  });

  factory MediaSearchResult.fromJson(Map<String, Object?> json) =>
      _$MediaSearchResultFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  final MediaStatus status;
  @JsonKey(name: 'event_id')
  final String? eventId;
  @JsonKey(name: 'wallet_id')
  final String? walletId;
  @JsonKey(name: 'printed_number')
  final String? printedNumber;
  @JsonKey(name: 'paid_balance')
  final int? paidBalance;
  @JsonKey(name: 'promo_balance')
  final int? promoBalance;
  final int? deposit;

  Map<String, Object?> toJson() => _$MediaSearchResultToJson(this);
}
