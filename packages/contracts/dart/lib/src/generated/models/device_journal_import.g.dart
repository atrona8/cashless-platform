// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_journal_import.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceJournalImport _$DeviceJournalImportFromJson(Map<String, dynamic> json) =>
    DeviceJournalImport(
      batches: (json['batches'] as List<dynamic>)
          .map((e) => OfflineBatch.fromJson(e as Map<String, dynamic>))
          .toList(),
      reason: json['reason'] as String,
    );

Map<String, dynamic> _$DeviceJournalImportToJson(
  DeviceJournalImport instance,
) => <String, dynamic>{'batches': instance.batches, 'reason': instance.reason};
