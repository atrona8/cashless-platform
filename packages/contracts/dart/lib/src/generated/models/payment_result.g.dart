// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PaymentResult _$PaymentResultFromJson(Map<String, dynamic> json) =>
    PaymentResult(
      transactionId: json['transaction_id'] as String,
      idempotencyKey: json['idempotency_key'] as String,
      type: $enumDecode(_$TransactionTypeEnumMap, json['type']),
      status: $enumDecode(_$PaymentResultStatusEnumMap, json['status']),
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      occurredAt: DateTime.parse(json['occurred_at'] as String),
      recordedAt: DateTime.parse(json['recorded_at'] as String),
      balanceAfter: Balance.fromJson(
        json['balance_after'] as Map<String, dynamic>,
      ),
      reversesId: json['reverses_id'] as String?,
      mediaId: json['media_id'] as String?,
      walletId: json['wallet_id'] as String?,
      receiptNumber: json['receipt_number'] as String?,
    );

Map<String, dynamic> _$PaymentResultToJson(PaymentResult instance) =>
    <String, dynamic>{
      'transaction_id': instance.transactionId,
      'idempotency_key': instance.idempotencyKey,
      'type': instance.type,
      'status': instance.status,
      'reverses_id': instance.reversesId,
      'amount': instance.amount,
      'currency': instance.currency,
      'occurred_at': instance.occurredAt.toIso8601String(),
      'recorded_at': instance.recordedAt.toIso8601String(),
      'media_id': instance.mediaId,
      'wallet_id': instance.walletId,
      'balance_after': instance.balanceAfter,
      'receipt_number': instance.receiptNumber,
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

const _$PaymentResultStatusEnumMap = {
  PaymentResultStatus.succeeded: 'SUCCEEDED',
};
