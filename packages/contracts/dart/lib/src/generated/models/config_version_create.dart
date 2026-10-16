// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'config_version_create.g.dart';

/// Contenu complet du niveau (pas un différentiel). La version et la date d'effet sont posées par le serveur.
@JsonSerializable()
class ConfigVersionCreate {
  const ConfigVersionCreate({required this.settings});

  factory ConfigVersionCreate.fromJson(Map<String, Object?> json) =>
      _$ConfigVersionCreateFromJson(json);

  final dynamic settings;

  Map<String, Object?> toJson() => _$ConfigVersionCreateToJson(this);
}
