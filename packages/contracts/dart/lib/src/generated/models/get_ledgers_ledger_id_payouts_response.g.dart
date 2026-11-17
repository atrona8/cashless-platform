// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_ledgers_ledger_id_payouts_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetLedgersLedgerIdPayoutsResponse _$GetLedgersLedgerIdPayoutsResponseFromJson(
  Map<String, dynamic> json,
) => GetLedgersLedgerIdPayoutsResponse(
  nextCursor: json['next_cursor'] as String?,
  hasMore: json['has_more'] as bool,
  data: (json['data'] as List<dynamic>)
      .map((e) => Payout.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetLedgersLedgerIdPayoutsResponseToJson(
  GetLedgersLedgerIdPayoutsResponse instance,
) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
  'data': instance.data,
};
