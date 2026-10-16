// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_batch.dart';

part 'device_journal_import.g.dart';

@JsonSerializable()
class DeviceJournalImport {
  const DeviceJournalImport({required this.batches, required this.reason});

  factory DeviceJournalImport.fromJson(Map<String, Object?> json) =>
      _$DeviceJournalImportFromJson(json);

  /// Lots exportés par l'application du terminal, dans l'ordre des numéros, signatures d'origine.
  final List<OfflineBatch> batches;
  final String reason;

  Map<String, Object?> toJson() => _$DeviceJournalImportToJson(this);
}
