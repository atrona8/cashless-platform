// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'config_level.dart';
import 'timestamp.dart';

part 'config_version.g.dart';

/// État figé d'un niveau de la cascade à partir d'une date (`config_version`). `settings` est le contenu complet.
/// du niveau ; pour un événement il contient aussi l'instantané des réglages portés par ses colonnes.
///
@JsonSerializable()
class ConfigVersion {
  const ConfigVersion({
    required this.configVersionId,
    required this.operatorId,
    required this.scopeType,
    required this.scopeId,
    required this.version,
    required this.validFrom,
    required this.settings,
  });

  factory ConfigVersion.fromJson(Map<String, Object?> json) =>
      _$ConfigVersionFromJson(json);

  @JsonKey(name: 'config_version_id')
  final String configVersionId;

  /// `null` pour le niveau `PLATFORM`.
  @JsonKey(name: 'operator_id')
  final String? operatorId;
  @JsonKey(name: 'scope_type')
  final ConfigLevel scopeType;
  @JsonKey(name: 'scope_id')
  final String scopeId;
  final int version;
  @JsonKey(name: 'valid_from')
  final Timestamp validFrom;
  final dynamic settings;

  Map<String, Object?> toJson() => _$ConfigVersionToJson(this);
}
