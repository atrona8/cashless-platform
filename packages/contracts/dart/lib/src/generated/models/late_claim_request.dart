// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'destination.dart';
import 'proof.dart';

part 'late_claim_request.g.dart';

@JsonSerializable()
class LateClaimRequest {
  const LateClaimRequest({
    required this.walletId,
    required this.amount,
    required this.currency,
    required this.proof,
    required this.destination,
    required this.reason,
  });

  factory LateClaimRequest.fromJson(Map<String, Object?> json) =>
      _$LateClaimRequestFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;
  final Amount amount;
  final Currency currency;
  final Proof proof;
  final Destination destination;
  final String reason;

  Map<String, Object?> toJson() => _$LateClaimRequestToJson(this);
}
