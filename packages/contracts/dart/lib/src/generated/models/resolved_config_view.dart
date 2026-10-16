// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'config_level.dart';

part 'resolved_config_view.g.dart';

@JsonSerializable()
class ResolvedConfigView {
  const ResolvedConfigView({
    required this.value,
    required this.level,
    required this.version,
    required this.configVersionId,
    required this.provisional,
  });

  factory ResolvedConfigView.fromJson(Map<String, Object?> json) =>
      _$ResolvedConfigViewFromJson(json);

  /// Valeur en vigueur.
  final dynamic value;

  /// Niveau qui définit la valeur ; `null` si elle vient du défaut du catalogue.
  final ConfigLevel? level;
  final int? version;
  @JsonKey(name: 'config_version_id')
  final String? configVersionId;

  /// `true` si la valeur est un défaut provisoire de §17.2, à confirmer.
  final bool provisional;

  Map<String, Object?> toJson() => _$ResolvedConfigViewToJson(this);
}
