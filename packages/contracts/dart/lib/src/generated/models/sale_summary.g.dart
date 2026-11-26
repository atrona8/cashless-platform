// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'sale_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SaleSummary _$SaleSummaryFromJson(Map<String, dynamic> json) => SaleSummary(
  transactionId: json['transaction_id'] as String,
  eventId: json['event_id'] as String,
  occurredAt: DateTime.parse(json['occurred_at'] as String),
  amount: (json['amount'] as num).toInt(),
  currency: json['currency'] as String,
  posId: json['pos_id'] as String?,
  merchantId: json['merchant_id'] as String?,
  vendorId: json['vendor_id'] as String?,
  deviceId: json['device_id'] as String?,
  source: $enumDecode(_$SaleSummarySourceEnumMap, json['source']),
  channel: $enumDecode(_$SaleSummaryChannelEnumMap, json['channel']),
  status: $enumDecode(_$SaleSummaryStatusEnumMap, json['status']),
  reversalTransactionId: json['reversal_transaction_id'] as String?,
);

Map<String, dynamic> _$SaleSummaryToJson(SaleSummary instance) =>
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
    };

const _$SaleSummarySourceEnumMap = {
  SaleSummarySource.online: 'ONLINE',
  SaleSummarySource.edgeSync: 'EDGE_SYNC',
  SaleSummarySource.offlineSync: 'OFFLINE_SYNC',
};

const _$SaleSummaryChannelEnumMap = {
  SaleSummaryChannel.nfc: 'NFC',
  SaleSummaryChannel.merchantQr: 'MERCHANT_QR',
  SaleSummaryChannel.customerQr: 'CUSTOMER_QR',
};

const _$SaleSummaryStatusEnumMap = {
  SaleSummaryStatus.valid: 'VALID',
  SaleSummaryStatus.reversed: 'REVERSED',
};
