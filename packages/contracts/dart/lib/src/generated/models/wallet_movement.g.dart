// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wallet_movement.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

WalletMovement _$WalletMovementFromJson(Map<String, dynamic> json) =>
    WalletMovement(
      transactionId: json['transaction_id'] as String,
      type: $enumDecode(_$TransactionTypeEnumMap, json['type']),
      source: $enumDecode(_$TransactionSourceEnumMap, json['source']),
      occurredAt: DateTime.parse(json['occurred_at'] as String),
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      label: json['label'] as String,
      reversesId: json['reverses_id'] as String?,
      reversedById: json['reversed_by_id'] as String?,
    );

Map<String, dynamic> _$WalletMovementToJson(WalletMovement instance) =>
    <String, dynamic>{
      'transaction_id': instance.transactionId,
      'type': instance.type,
      'source': instance.source,
      'occurred_at': instance.occurredAt.toIso8601String(),
      'amount': instance.amount,
      'currency': instance.currency,
      'label': instance.label,
      'reverses_id': instance.reversesId,
      'reversed_by_id': instance.reversedById,
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

const _$TransactionSourceEnumMap = {
  TransactionSource.online: 'ONLINE',
  TransactionSource.offlineSync: 'OFFLINE_SYNC',
  TransactionSource.edgeSync: 'EDGE_SYNC',
  TransactionSource.pspWebhook: 'PSP_WEBHOOK',
  TransactionSource.batch: 'BATCH',
  TransactionSource.backoffice: 'BACKOFFICE',
};
