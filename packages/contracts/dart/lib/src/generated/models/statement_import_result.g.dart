// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'statement_import_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StatementImportResult _$StatementImportResultFromJson(
  Map<String, dynamic> json,
) => StatementImportResult(
  statementImportId: json['statement_import_id'] as String,
  accountId: json['account_id'] as String,
  linesCreated: (json['lines_created'] as num).toInt(),
  linesMatched: (json['lines_matched'] as num).toInt(),
  linesExisting: (json['lines_existing'] as num).toInt(),
);

Map<String, dynamic> _$StatementImportResultToJson(
  StatementImportResult instance,
) => <String, dynamic>{
  'statement_import_id': instance.statementImportId,
  'account_id': instance.accountId,
  'lines_created': instance.linesCreated,
  'lines_matched': instance.linesMatched,
  'lines_existing': instance.linesExisting,
};
