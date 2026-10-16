// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tag_key_job.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TagKeyJob _$TagKeyJobFromJson(Map<String, dynamic> json) => TagKeyJob(
  jobId: json['job_id'] as String,
  operatorId: json['operator_id'] as String,
  keyIndex: (json['key_index'] as num).toInt(),
  kind: $enumDecode(_$TagKeyJobKindEnumMap, json['kind']),
  status: $enumDecode(_$TagKeyJobStatusEnumMap, json['status']),
  attempts: (json['attempts'] as num).toInt(),
  createdAt: DateTime.parse(json['created_at'] as String),
  awaiting: $enumDecodeNullable(_$TagKeyJobAwaitingEnumMap, json['awaiting']),
  lastError: json['last_error'] as String?,
  progress: json['progress'],
  approvalRequestId: json['approval_request_id'] as String?,
  finishedAt: json['finished_at'] == null
      ? null
      : DateTime.parse(json['finished_at'] as String),
);

Map<String, dynamic> _$TagKeyJobToJson(TagKeyJob instance) => <String, dynamic>{
  'job_id': instance.jobId,
  'operator_id': instance.operatorId,
  'key_index': instance.keyIndex,
  'kind': instance.kind,
  'status': instance.status,
  'awaiting': instance.awaiting,
  'attempts': instance.attempts,
  'last_error': instance.lastError,
  'progress': instance.progress,
  'approval_request_id': instance.approvalRequestId,
  'created_at': instance.createdAt.toIso8601String(),
  'finished_at': instance.finishedAt?.toIso8601String(),
};

const _$TagKeyJobKindEnumMap = {
  TagKeyJobKind.createKey: 'CREATE_KEY',
  TagKeyJobKind.rotateDek: 'ROTATE_DEK',
  TagKeyJobKind.reencrypt: 'REENCRYPT',
  TagKeyJobKind.retireKey: 'RETIRE_KEY',
  TagKeyJobKind.disableKmsKey: 'DISABLE_KMS_KEY',
};

const _$TagKeyJobStatusEnumMap = {
  TagKeyJobStatus.pending: 'PENDING',
  TagKeyJobStatus.running: 'RUNNING',
  TagKeyJobStatus.done: 'DONE',
  TagKeyJobStatus.failed: 'FAILED',
};

const _$TagKeyJobAwaitingEnumMap = {
  TagKeyJobAwaiting.keyAdminCommand: 'KEY_ADMIN_COMMAND',
};
