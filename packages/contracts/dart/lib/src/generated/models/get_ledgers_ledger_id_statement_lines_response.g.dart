// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_ledgers_ledger_id_statement_lines_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetLedgersLedgerIdStatementLinesResponse
_$GetLedgersLedgerIdStatementLinesResponseFromJson(Map<String, dynamic> json) =>
    GetLedgersLedgerIdStatementLinesResponse(
      nextCursor: json['next_cursor'] as String?,
      hasMore: json['has_more'] as bool,
      data: (json['data'] as List<dynamic>)
          .map((e) => StatementLine.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetLedgersLedgerIdStatementLinesResponseToJson(
  GetLedgersLedgerIdStatementLinesResponse instance,
) => <String, dynamic>{
  'next_cursor': instance.nextCursor,
  'has_more': instance.hasMore,
  'data': instance.data,
};
