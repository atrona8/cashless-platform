// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tag_key_check_run.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TagKeyCheckRun _$TagKeyCheckRunFromJson(Map<String, dynamic> json) =>
    TagKeyCheckRun(
      runId: json['run_id'] as String,
      operatorId: json['operator_id'] as String,
      startedAt: DateTime.parse(json['started_at'] as String),
      finishedAt: DateTime.parse(json['finished_at'] as String),
      sampled: (json['sampled'] as num).toInt(),
      mismatches: (json['mismatches'] as num).toInt(),
      status: $enumDecode(_$TagKeyCheckRunStatusEnumMap, json['status']),
      detail: json['detail'] as String?,
    );

Map<String, dynamic> _$TagKeyCheckRunToJson(TagKeyCheckRun instance) =>
    <String, dynamic>{
      'run_id': instance.runId,
      'operator_id': instance.operatorId,
      'started_at': instance.startedAt.toIso8601String(),
      'finished_at': instance.finishedAt.toIso8601String(),
      'sampled': instance.sampled,
      'mismatches': instance.mismatches,
      'status': instance.status,
      'detail': instance.detail,
    };

const _$TagKeyCheckRunStatusEnumMap = {
  TagKeyCheckRunStatus.ok: 'OK',
  TagKeyCheckRunStatus.mismatch: 'MISMATCH',
  TagKeyCheckRunStatus.error: 'ERROR',
};
