// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sale_detail.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SaleDetail _$SaleDetailFromJson(Map<String, dynamic> json) => SaleDetail(
  transactionId: json['transaction_id'] as String,
  eventId: json['event_id'] as String,
  occurredAt: DateTime.parse(json['occurred_at'] as String),
  amount: (json['amount'] as num).toInt(),
  currency: json['currency'] as String,
  posId: json['pos_id'] as String?,
  merchantId: json['merchant_id'] as String?,
  vendorId: json['vendor_id'] as String?,
  deviceId: json['device_id'] as String?,
  source: $enumDecode(_$SaleDetailSourceEnumMap, json['source']),
  channel: $enumDecode(_$SaleDetailChannelEnumMap, json['channel']),
  status: $enumDecode(_$SaleDetailStatusEnumMap, json['status']),
  lines: (json['lines'] as List<dynamic>)
      .map((e) => SaleDetailLine.fromJson(e as Map<String, dynamic>))
      .toList(),
  reversalTransactionId: json['reversal_transaction_id'] as String?,
);

Map<String, dynamic> _$SaleDetailToJson(SaleDetail instance) =>
    <String, dynamic>{
      'transaction_id': instance.transactionId,
      'event_id': instance.eventId,
      'occurred_at': instance.occurredAt.toIso8601String(),
      'amount': instance.amount,
      'currency': instance.currency,
      'pos_id': instance.posId,
      'merchant_id': instance.merchantId,
      'vendor_id': instance.vendorId,
      'device_id': instance.deviceId,
      'source': instance.source,
      'channel': instance.channel,
      'status': instance.status,
      'reversal_transaction_id': instance.reversalTransactionId,
      'lines': instance.lines,
    };

const _$SaleDetailSourceEnumMap = {
  SaleDetailSource.online: 'ONLINE',
  SaleDetailSource.edgeSync: 'EDGE_SYNC',
  SaleDetailSource.offlineSync: 'OFFLINE_SYNC',
};

const _$SaleDetailChannelEnumMap = {
  SaleDetailChannel.nfc: 'NFC',
  SaleDetailChannel.merchantQr: 'MERCHANT_QR',
  SaleDetailChannel.customerQr: 'CUSTOMER_QR',
};

const _$SaleDetailStatusEnumMap = {
  SaleDetailStatus.valid: 'VALID',
  SaleDetailStatus.reversed: 'REVERSED',
};
