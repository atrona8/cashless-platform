// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Étape de clôture d'un événement, dans l'ordre d'exécution (SPECIFICATION §12.1). `PITCH_FEES`, `OPERATOR_FEE`.
/// et `PLATFORM_FEE` se font en `SETTLING` ; les quatre suivantes en `REFUND_WINDOW`, après `refund_deadline`.
/// `OPERATOR_FEE_REGULARIZATION` n'a d'objet que si `operator_fee_basis = NET_OF_REFUNDS`.
///
@JsonEnum()
enum ClosingStep {
  @JsonValue('PITCH_FEES')
  pitchFees('PITCH_FEES'),
  @JsonValue('OPERATOR_FEE')
  operatorFee('OPERATOR_FEE'),
  @JsonValue('PLATFORM_FEE')
  platformFee('PLATFORM_FEE'),
  @JsonValue('OPERATOR_FEE_REGULARIZATION')
  operatorFeeRegularization('OPERATOR_FEE_REGULARIZATION'),
  @JsonValue('BREAKAGE')
  breakage('BREAKAGE'),
  @JsonValue('DEPOSIT_FORFEIT')
  depositForfeit('DEPOSIT_FORFEIT'),
  @JsonValue('PROMO_EXPIRY')
  promoExpiry('PROMO_EXPIRY');

  const ClosingStep(this.json);

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
