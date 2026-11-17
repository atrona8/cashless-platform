// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'page_meta.dart';
import 'statement_line.dart';

part 'get_ledgers_ledger_id_statement_lines_response.g.dart';

@JsonSerializable()
class GetLedgersLedgerIdStatementLinesResponse {
  const GetLedgersLedgerIdStatementLinesResponse({
    required this.nextCursor,
    required this.hasMore,
    required this.data,
  });

  factory GetLedgersLedgerIdStatementLinesResponse.fromJson(
    Map<String, Object?> json,
  ) => _$GetLedgersLedgerIdStatementLinesResponseFromJson(json);

  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;
  final List<StatementLine> data;

  Map<String, Object?> toJson() =>
      _$GetLedgersLedgerIdStatementLinesResponseToJson(this);
}
