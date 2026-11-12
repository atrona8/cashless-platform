// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Ordre de dépense du crédit offert et du crédit payé de l'événement (réglage `spend_order` de la.
/// cascade, état courant du central ; `PROMO_FIRST` par défaut au central). La passerelle l'applique à.
/// ses ventes (`createPayment`). Clé absente : « inconnu », et la passerelle refuse toute vente dont la.
/// répartition dépend de l'ordre (portefeuille détenant du crédit payé et du crédit offert), échec fermé.
///
@JsonEnum()
enum SpendOrder {
  @JsonValue('PROMO_FIRST')
  promoFirst('PROMO_FIRST'),
  @JsonValue('PAID_FIRST')
  paidFirst('PAID_FIRST');

  const SpendOrder(this.json);

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError(
        'Cannot convert enum value with null JSON representation to String. '
        'This usually happens for \$unknown or @JsonValue(null) entries.',
      );
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
}
