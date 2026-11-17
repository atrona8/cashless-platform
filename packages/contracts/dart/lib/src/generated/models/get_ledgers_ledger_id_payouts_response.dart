// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'page_meta.dart';
import 'payout.dart';

part 'get_ledgers_ledger_id_payouts_response.g.dart';

@JsonSerializable()
class GetLedgersLedgerIdPayoutsResponse {
  const GetLedgersLedgerIdPayoutsResponse({
    required this.nextCursor,
    required this.hasMore,
    required this.data,
  });

  factory GetLedgersLedgerIdPayoutsResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetLedgersLedgerIdPayoutsResponseFromJson(json);

  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;
  final List<Payout> data;

  Map<String, Object?> toJson() =>
      _$GetLedgersLedgerIdPayoutsResponseToJson(this);
}
