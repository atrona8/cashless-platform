// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'page_meta.dart';
import 'payout_entitlement.dart';

part 'get_ledgers_ledger_id_payout_entitlements_response.g.dart';

@JsonSerializable()
class GetLedgersLedgerIdPayoutEntitlementsResponse {
  const GetLedgersLedgerIdPayoutEntitlementsResponse({
    required this.nextCursor,
    required this.hasMore,
    required this.data,
  });

  factory GetLedgersLedgerIdPayoutEntitlementsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetLedgersLedgerIdPayoutEntitlementsResponseFromJson(json);

  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;
  final List<PayoutEntitlement> data;

  Map<String, Object?> toJson() =>
      _$GetLedgersLedgerIdPayoutEntitlementsResponseToJson(this);
}
