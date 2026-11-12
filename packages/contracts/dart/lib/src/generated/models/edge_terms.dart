// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'spend_order.dart';
import 'deposit_batches.dart';

part 'edge_terms.g.dart';

@JsonSerializable()
class EdgeTerms {
  const EdgeTerms({
    this.maxCashTopup,
    this.activationFee,
    this.spendOrder,
    this.depositBatches,
  });

  factory EdgeTerms.fromJson(Map<String, Object?> json) =>
      _$EdgeTermsFromJson(json);

  /// Plafond par recharge en espèces, unités mineures (réglage de plateforme `replay_max_per_cash_topup`,.
  /// 500 000 XOF par défaut, décision 21). Absent si aucun réglage n'existe pour la devise du grand livre.
  ///
  @JsonKey(name: 'max_cash_topup')
  final int? maxCashTopup;

  /// Frais d'activation par support, TTC, unités mineures (règle de frais `EVENT`, `ORG_FFEST`,.
  /// `PER_MEDIA` en vigueur ; 0 sans règle). Absent si plusieurs règles sont en vigueur (ambigu).
  ///
  @JsonKey(name: 'activation_fee')
  final int? activationFee;

  /// Ordre de dépense du crédit offert et du crédit payé de l'événement (réglage `spend_order` de la.
  /// cascade, état courant du central ; `PROMO_FIRST` par défaut au central). La passerelle l'applique à.
  /// ses ventes (`createPayment`). Clé absente : « inconnu », et la passerelle refuse toute vente dont la.
  /// répartition dépend de l'ordre (portefeuille détenant du crédit payé et du crédit offert), échec fermé.
  ///
  @JsonKey(name: 'spend_order')
  final SpendOrder? spendOrder;

  /// Conditions de caution de chaque lot de bracelets de l'événement.
  @JsonKey(name: 'deposit_batches')
  final List<DepositBatches>? depositBatches;

  Map<String, Object?> toJson() => _$EdgeTermsToJson(this);
}
