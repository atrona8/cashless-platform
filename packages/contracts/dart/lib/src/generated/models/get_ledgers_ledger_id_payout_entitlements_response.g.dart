// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_ledgers_ledger_id_payout_entitlements_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetLedgersLedgerIdPayoutEntitlementsResponse
_$GetLedgersLedgerIdPayoutEntitlementsResponseFromJson(
  Map<String, dynamic> json,
) => GetLedgersLedgerIdPayoutEntitlementsResponse(
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
  data: (json['data'] as List<dynamic>)
      .map((e) => PayoutEntitlement.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetLedgersLedgerIdPayoutEntitlementsResponseToJson(
  GetLedgersLedgerIdPayoutEntitlementsResponse instance,
) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
  'data': instance.data,
};
