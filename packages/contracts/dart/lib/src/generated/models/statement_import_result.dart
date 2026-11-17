// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'statement_import_result.g.dart';

/// Résultat d'un import de relevé.
@JsonSerializable()
class StatementImportResult {
  const StatementImportResult({
    required this.statementImportId,
    required this.accountId,
    required this.linesCreated,
    required this.linesMatched,
    required this.linesExisting,
  });

  factory StatementImportResult.fromJson(Map<String, Object?> json) =>
      _$StatementImportResultFromJson(json);

  @JsonKey(name: 'statement_import_id')
  final String statementImportId;
  @JsonKey(name: 'account_id')
  final String accountId;
  @JsonKey(name: 'lines_created')
  final int linesCreated;

  /// Lignes créées puis rapprochées automatiquement.
  @JsonKey(name: 'lines_matched')
  final int linesMatched;

  /// Lignes déjà présentes (réimport), ignorées.
  @JsonKey(name: 'lines_existing')
  final int linesExisting;

  Map<String, Object?> toJson() => _$StatementImportResultToJson(this);
}
