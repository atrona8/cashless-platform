// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'data_key_versions.dart';
import 'tag_key_job.dart';
import 'tag_key_scope.dart';
import 'tag_key_status.dart';
import 'timestamp.dart';

part 'tag_key_detail.g.dart';

@JsonSerializable()
class TagKeyDetail {
  const TagKeyDetail({
    required this.operatorId,
    required this.keyIndex,
    required this.status,
    required this.scope,
    required this.kmsKeyRefSuffix,
    required this.createdAt,
    required this.dataKeyVersions,
    required this.jobs,
    this.dedicatedEventId,
    this.kmsDisabledAt,
  });

  factory TagKeyDetail.fromJson(Map<String, Object?> json) =>
      _$TagKeyDetailFromJson(json);

  @JsonKey(name: 'operator_id')
  final String operatorId;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  final TagKeyStatus status;
  final TagKeyScope scope;
  @JsonKey(name: 'dedicated_event_id')
  final String? dedicatedEventId;

  /// Derniers caractères de la référence de la clé dans le service de clés (la référence complète n'est jamais rendue).
  @JsonKey(name: 'kms_key_ref_suffix')
  final String kmsKeyRefSuffix;
  @JsonKey(name: 'kms_disabled_at')
  final DateTime? kmsDisabledAt;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  @JsonKey(name: 'data_key_versions')
  final List<DataKeyVersions> dataKeyVersions;

  /// Travaux non terminés de cette clé.
  final List<TagKeyJob> jobs;

  Map<String, Object?> toJson() => _$TagKeyDetailToJson(this);
}
