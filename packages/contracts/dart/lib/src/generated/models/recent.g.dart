// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'recent.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Recent _$RecentFromJson(Map<String, dynamic> json) => Recent(
  occurredAt: DateTime.parse(json['occurred_at'] as String),
  type: $enumDecode(_$TransactionTypeEnumMap, json['type']),
  amount: (json['amount'] as num).toInt(),
);

Map<String, dynamic> _$RecentToJson(Recent instance) => <String, dynamic>{
  'occurred_at': instance.occurredAt.toIso8601String(),
  'type': instance.type,
  'amount': instance.amount,
};

const _$TransactionTypeEnumMap = {
  TransactionType.topup: 'TOPUP',
  TransactionType.topupCash: 'TOPUP_CASH',
  TransactionType.promoCredit: 'PROMO_CREDIT',
  TransactionType.promoExpiry: 'PROMO_EXPIRY',
  TransactionType.activationFee: 'ACTIVATION_FEE',
  TransactionType.depositTaken: 'DEPOSIT_TAKEN',
  TransactionType.depositRefunded: 'DEPOSIT_REFUNDED',
  TransactionType.depositForfeited: 'DEPOSIT_FORFEITED',
  TransactionType.purchase: 'PURCHASE',
  TransactionType.reversal: 'REVERSAL',
  TransactionType.pitchFee: 'PITCH_FEE',
  TransactionType.operatorFee: 'OPERATOR_FEE',
  TransactionType.platformFee: 'PLATFORM_FEE',
  TransactionType.anomalyResolution: 'ANOMALY_RESOLUTION',
  TransactionType.cashClose: 'CASH_CLOSE',
  TransactionType.cashDeposit: 'CASH_DEPOSIT',
  TransactionType.pspSettlement: 'PSP_SETTLEMENT',
  TransactionType.chargeback: 'CHARGEBACK',
  TransactionType.walletRefund: 'WALLET_REFUND',
  TransactionType.breakage: 'BREAKAGE',
  TransactionType.payoutInitiated: 'PAYOUT_INITIATED',
  TransactionType.payoutConfirmed: 'PAYOUT_CONFIRMED',
  TransactionType.payoutFailed: 'PAYOUT_FAILED',
  TransactionType.adjustment: 'ADJUSTMENT',
  TransactionType.merchantDebtTransfer: 'MERCHANT_DEBT_TRANSFER',
  TransactionType.breakageReversal: 'BREAKAGE_REVERSAL',
};
