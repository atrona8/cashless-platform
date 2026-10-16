// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tag_key_check_run_status.dart';
import 'timestamp.dart';

part 'tag_key_check_run.g.dart';

@JsonSerializable()
class TagKeyCheckRun {
  const TagKeyCheckRun({
    required this.runId,
    required this.operatorId,
    required this.startedAt,
    required this.finishedAt,
    required this.sampled,
    required this.mismatches,
    required this.status,
    this.detail,
  });

  factory TagKeyCheckRun.fromJson(Map<String, Object?> json) =>
      _$TagKeyCheckRunFromJson(json);

  @JsonKey(name: 'run_id')
  final String runId;
  @JsonKey(name: 'operator_id')
  final String operatorId;
  @JsonKey(name: 'started_at')
  final Timestamp startedAt;
  @JsonKey(name: 'finished_at')
  final Timestamp finishedAt;
  final int sampled;
  final int mismatches;
  final TagKeyCheckRunStatus status;
  final String? detail;

  Map<String, Object?> toJson() => _$TagKeyCheckRunToJson(this);
}
