// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media.dart';
import 'tap_result_code.dart';
import 'wallet_summary.dart';

part 'tap_response.g.dart';

@JsonSerializable()
class TapResponse {
  const TapResponse({
    required this.tapId,
    required this.result,
    required this.tapExpiresAt,
    required this.media,
    required this.wallet,
  });

  factory TapResponse.fromJson(Map<String, Object?> json) =>
      _$TapResponseFromJson(json);

  /// media_tap.id ; null si la lecture n'a pas été enregistrée (UNKNOWN, RETIRED…).
  @JsonKey(name: 'tap_id')
  final int? tapId;
  final TapResultCode result;
  @JsonKey(name: 'tap_expires_at')
  final DateTime? tapExpiresAt;
  final Media? media;
  final WalletSummary? wallet;

  Map<String, Object?> toJson() => _$TapResponseToJson(this);
}
