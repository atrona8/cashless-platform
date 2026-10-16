// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'media_status.dart';
import 'recent.dart';

part 'post_public_balance_lookups_response.g.dart';

@JsonSerializable()
class PostPublicBalanceLookupsResponse {
  const PostPublicBalanceLookupsResponse({
    required this.currency,
    required this.spendable,
    required this.mediaStatus,
    required this.recent,
  });

  factory PostPublicBalanceLookupsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$PostPublicBalanceLookupsResponseFromJson(json);

  final Currency currency;

  /// Solde disponible (crédits payés + offerts).
  final int spendable;
  @JsonKey(name: 'media_status')
  final MediaStatus mediaStatus;
  final List<Recent> recent;

  Map<String, Object?> toJson() =>
      _$PostPublicBalanceLookupsResponseToJson(this);
}
