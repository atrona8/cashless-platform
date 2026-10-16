// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'deposit_state.dart';
import 'media_status.dart';
import 'wallet_summary.dart';

part 'media_activation_response.g.dart';

@JsonSerializable()
class MediaActivationResponse {
  const MediaActivationResponse({
    required this.mediaId,
    required this.mediaStatus,
    required this.wallet,
    required this.deposit,
  });

  factory MediaActivationResponse.fromJson(Map<String, Object?> json) =>
      _$MediaActivationResponseFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  @JsonKey(name: 'media_status')
  final MediaStatus mediaStatus;
  final WalletSummary wallet;
  final DepositState deposit;

  Map<String, Object?> toJson() => _$MediaActivationResponseToJson(this);
}
