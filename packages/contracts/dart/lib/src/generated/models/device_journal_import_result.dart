// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'offline_batch_result.dart';

part 'device_journal_import_result.g.dart';

/// Résultat de `importDeviceJournal`, renvoyé dans `ApprovalRequest.result` à l'exécution.
@JsonSerializable()
class DeviceJournalImportResult {
  const DeviceJournalImportResult({
    required this.deviceId,
    required this.results,
  });

  factory DeviceJournalImportResult.fromJson(Map<String, Object?> json) =>
      _$DeviceJournalImportResultFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;
  final List<OfflineBatchResult> results;

  Map<String, Object?> toJson() => _$DeviceJournalImportResultToJson(this);
}
