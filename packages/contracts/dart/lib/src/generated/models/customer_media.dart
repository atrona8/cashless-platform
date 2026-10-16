// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'deposit_status.dart';
import 'media_status.dart';

part 'customer_media.g.dart';

@JsonSerializable()
class CustomerMedia {
  const CustomerMedia({
    required this.mediaId,
    required this.status,
    required this.depositStatus,
    this.printedNumber,
    this.walletId,
  });

  factory CustomerMedia.fromJson(Map<String, Object?> json) =>
      _$CustomerMediaFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  @JsonKey(name: 'printed_number')
  final String? printedNumber;
  final MediaStatus status;
  @JsonKey(name: 'deposit_status')
  final DepositStatus depositStatus;
  @JsonKey(name: 'wallet_id')
  final String? walletId;

  Map<String, Object?> toJson() => _$CustomerMediaToJson(this);
}
