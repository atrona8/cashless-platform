// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'tag_key_scope.dart';
import 'tag_key_status.dart';
import 'timestamp.dart';

part 'tag_key.g.dart';

@JsonSerializable()
class TagKey {
  const TagKey({
    required this.operatorId,
    required this.keyIndex,
    required this.status,
    required this.scope,
    required this.kmsKeyRefSuffix,
    required this.createdAt,
    this.dedicatedEventId,
    this.kmsDisabledAt,
  });

  factory TagKey.fromJson(Map<String, Object?> json) => _$TagKeyFromJson(json);

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
  final Timestamp? kmsDisabledAt;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;

  Map<String, Object?> toJson() => _$TagKeyToJson(this);
}
