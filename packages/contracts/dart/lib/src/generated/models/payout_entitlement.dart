// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'payout_entitlement_party_kind.dart';

part 'payout_entitlement.g.dart';

/// Droit net d'une partie, moins ses versements en cours.
@JsonSerializable()
class PayoutEntitlement {
  const PayoutEntitlement({
    required this.partyId,
    required this.partyKind,
    required this.currency,
    required this.netClaim,
    required this.pendingPayouts,
    required this.available,
  });

  factory PayoutEntitlement.fromJson(Map<String, Object?> json) =>
      _$PayoutEntitlementFromJson(json);

  @JsonKey(name: 'party_id')
  final String partyId;
  @JsonKey(name: 'party_kind')
  final PayoutEntitlementPartyKind partyKind;
  final Currency currency;

  /// Droit net (`party_position`).
  @JsonKey(name: 'net_claim')
  final int netClaim;

  /// Versements `INITIATED` non réglés.
  @JsonKey(name: 'pending_payouts')
  final int pendingPayouts;

  /// `net_claim` − `pending_payouts` : plafond d'un nouveau versement.
  final int available;

  Map<String, Object?> toJson() => _$PayoutEntitlementToJson(this);
}
