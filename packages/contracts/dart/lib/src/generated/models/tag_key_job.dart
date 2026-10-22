// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tag_key_job_awaiting.dart';
import 'tag_key_job_kind.dart';
import 'tag_key_job_status.dart';
import 'timestamp.dart';

part 'tag_key_job.g.dart';

@JsonSerializable()
class TagKeyJob {
  const TagKeyJob({
    required this.jobId,
    required this.operatorId,
    required this.keyIndex,
    required this.kind,
    required this.status,
    required this.attempts,
    required this.createdAt,
    this.awaiting,
    this.lastError,
    this.progress,
    this.approvalRequestId,
    this.finishedAt,
  });

  factory TagKeyJob.fromJson(Map<String, Object?> json) =>
      _$TagKeyJobFromJson(json);

  @JsonKey(name: 'job_id')
  final String jobId;
  @JsonKey(name: 'operator_id')
  final String operatorId;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  final TagKeyJobKind kind;
  final TagKeyJobStatus status;

  /// Le travail attend la commande d'administration des clés, lancée par l'exploitant.
  final TagKeyJobAwaiting? awaiting;
  final int attempts;
  @JsonKey(name: 'last_error')
  final String? lastError;

  /// Avancement (compteurs) ; jamais de secret.
  final dynamic progress;
  @JsonKey(name: 'approval_request_id')
  final String? approvalRequestId;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  @JsonKey(name: 'finished_at')
  final DateTime? finishedAt;

  Map<String, Object?> toJson() => _$TagKeyJobToJson(this);
}
