// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_journal_import_result_status.dart';
import 'offline_batch_result.dart';

part 'device_journal_import_result.g.dart';

/// Résultat de `importDeviceJournal`, renvoyé dans `ApprovalRequest.result` à l'exécution de l'approbation.
/// Le traitement des lots est asynchrone (travailleur `journal-import`) : à l'exécution, `status` vaut.
/// `PROCESSING` et `results` est absent ou vide. Le résultat final (`APPLIED` ou `FAILED`) ne figure pas.
/// dans cette réponse : il se lit par `getDeviceJournalImport`.
///
@JsonSerializable()
class DeviceJournalImportResult {
  const DeviceJournalImportResult({
    required this.deviceId,
    required this.status,
    this.results,
  });

  factory DeviceJournalImportResult.fromJson(Map<String, Object?> json) =>
      _$DeviceJournalImportResultFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;

  /// `PROCESSING` à l'exécution de l'approbation ; `APPLIED` ou `FAILED` une fois le traitement terminé.
  final DeviceJournalImportResultStatus status;

  /// Résultats par lot ; vide tant que `status = PROCESSING`.
  final List<OfflineBatchResult>? results;

  Map<String, Object?> toJson() => _$DeviceJournalImportResultToJson(this);
}
