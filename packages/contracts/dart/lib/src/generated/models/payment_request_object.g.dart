// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_request_object.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PaymentRequestObject _$PaymentRequestObjectFromJson(
  Map<String, dynamic> json,
) => PaymentRequestObject(
  paymentRequestId: json['payment_request_id'] as String,
  direction: $enumDecode(
    _$PaymentRequestObjectDirectionEnumMap,
    json['direction'],
  ),
  status: $enumDecode(_$PaymentRequestObjectStatusEnumMap, json['status']),
  currency: json['currency'] as String,
  expiresAt: DateTime.parse(json['expires_at'] as String),
  amount: (json['amount'] as num?)?.toInt(),
  merchantName: json['merchant_name'] as String?,
  qrPayload: json['qr_payload'] as String?,
  transactionId: json['transaction_id'] as String?,
);

Map<String, dynamic> _$PaymentRequestObjectToJson(
  PaymentRequestObject instance,
) => <String, dynamic>{
  'payment_request_id': instance.paymentRequestId,
  'direction': instance.direction,
  'status': instance.status,
  'amount': instance.amount,
  'currency': instance.currency,
  'merchant_name': instance.merchantName,
  'qr_payload': instance.qrPayload,
  'expires_at': instance.expiresAt.toIso8601String(),
  'transaction_id': instance.transactionId,
};

const _$PaymentRequestObjectDirectionEnumMap = {
  PaymentRequestObjectDirection.merchantQr: 'MERCHANT_QR',
  PaymentRequestObjectDirection.customerQr: 'CUSTOMER_QR',
};

const _$PaymentRequestObjectStatusEnumMap = {
  PaymentRequestObjectStatus.pending: 'PENDING',
  PaymentRequestObjectStatus.confirmed: 'CONFIRMED',
  PaymentRequestObjectStatus.expired: 'EXPIRED',
  PaymentRequestObjectStatus.cancelled: 'CANCELLED',
};
