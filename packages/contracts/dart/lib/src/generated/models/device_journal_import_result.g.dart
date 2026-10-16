// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_journal_import_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceJournalImportResult _$DeviceJournalImportResultFromJson(
  Map<String, dynamic> json,
) => DeviceJournalImportResult(
  deviceId: json['device_id'] as String,
  results: (json['results'] as List<dynamic>)
      .map((e) => OfflineBatchResult.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$DeviceJournalImportResultToJson(
  DeviceJournalImportResult instance,
) => <String, dynamic>{
  'device_id': instance.deviceId,
  'results': instance.results,
};
