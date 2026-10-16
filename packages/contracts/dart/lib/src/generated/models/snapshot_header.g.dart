// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'snapshot_header.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SnapshotHeader _$SnapshotHeaderFromJson(Map<String, dynamic> json) =>
    SnapshotHeader(
      format: json['format'] as String,
      kind: $enumDecode(_$SnapshotHeaderKindEnumMap, json['kind']),
      operatorId: json['operator_id'] as String,
      ledgerId: json['ledger_id'] as String,
      eventId: json['event_id'] as String,
      currency: json['currency'] as String,
      version: (json['version'] as num).toInt(),
      baseVersion: (json['base_version'] as num?)?.toInt(),
      generatedAt: DateTime.parse(json['generated_at'] as String),
      validUntil: DateTime.parse(json['valid_until'] as String),
      entries: (json['entries'] as num).toInt(),
      removed: (json['removed'] as num).toInt(),
      contentSha256: json['content_sha256'] as String,
      authorityEpoch: (json['authority_epoch'] as num).toInt(),
      keyId: json['key_id'] as String,
    );

Map<String, dynamic> _$SnapshotHeaderToJson(SnapshotHeader instance) =>
    <String, dynamic>{
      'format': instance.format,
      'kind': instance.kind,
      'operator_id': instance.operatorId,
      'ledger_id': instance.ledgerId,
      'event_id': instance.eventId,
      'currency': instance.currency,
      'version': instance.version,
      'base_version': instance.baseVersion,
      'generated_at': instance.generatedAt.toIso8601String(),
      'valid_until': instance.validUntil.toIso8601String(),
      'entries': instance.entries,
      'removed': instance.removed,
      'content_sha256': instance.contentSha256,
      'authority_epoch': instance.authorityEpoch,
      'key_id': instance.keyId,
    };

const _$SnapshotHeaderKindEnumMap = {
  SnapshotHeaderKind.full: 'FULL',
  SnapshotHeaderKind.delta: 'DELTA',
};
