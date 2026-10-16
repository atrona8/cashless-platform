// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Liste fermée des types du grand livre (contrainte CHECK de journal_transaction.type ; voir SPECIFICATION.md).
@JsonEnum()
enum TransactionType {
  @JsonValue('TOPUP')
  topup('TOPUP'),
  @JsonValue('TOPUP_CASH')
  topupCash('TOPUP_CASH'),
  @JsonValue('PROMO_CREDIT')
  promoCredit('PROMO_CREDIT'),
  @JsonValue('PROMO_EXPIRY')
  promoExpiry('PROMO_EXPIRY'),
  @JsonValue('ACTIVATION_FEE')
  activationFee('ACTIVATION_FEE'),
  @JsonValue('DEPOSIT_TAKEN')
  depositTaken('DEPOSIT_TAKEN'),
  @JsonValue('DEPOSIT_REFUNDED')
  depositRefunded('DEPOSIT_REFUNDED'),
  @JsonValue('DEPOSIT_FORFEITED')
  depositForfeited('DEPOSIT_FORFEITED'),
  @JsonValue('PURCHASE')
  purchase('PURCHASE'),
  @JsonValue('REVERSAL')
  reversal('REVERSAL'),
  @JsonValue('PITCH_FEE')
  pitchFee('PITCH_FEE'),
  @JsonValue('OPERATOR_FEE')
  operatorFee('OPERATOR_FEE'),
  @JsonValue('PLATFORM_FEE')
  platformFee('PLATFORM_FEE'),
  @JsonValue('ANOMALY_RESOLUTION')
  anomalyResolution('ANOMALY_RESOLUTION'),
  @JsonValue('CASH_CLOSE')
  cashClose('CASH_CLOSE'),
  @JsonValue('CASH_DEPOSIT')
  cashDeposit('CASH_DEPOSIT'),
  @JsonValue('PSP_SETTLEMENT')
  pspSettlement('PSP_SETTLEMENT'),
  @JsonValue('CHARGEBACK')
  chargeback('CHARGEBACK'),
  @JsonValue('WALLET_REFUND')
  walletRefund('WALLET_REFUND'),
  @JsonValue('BREAKAGE')
  breakage('BREAKAGE'),
  @JsonValue('PAYOUT_INITIATED')
  payoutInitiated('PAYOUT_INITIATED'),
  @JsonValue('PAYOUT_CONFIRMED')
  payoutConfirmed('PAYOUT_CONFIRMED'),
  @JsonValue('PAYOUT_FAILED')
  payoutFailed('PAYOUT_FAILED'),
  @JsonValue('ADJUSTMENT')
  adjustment('ADJUSTMENT'),
  @JsonValue('MERCHANT_DEBT_TRANSFER')
  merchantDebtTransfer('MERCHANT_DEBT_TRANSFER'),
  @JsonValue('BREAKAGE_REVERSAL')
  breakageReversal('BREAKAGE_REVERSAL');

  const TransactionType(this.json);

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
