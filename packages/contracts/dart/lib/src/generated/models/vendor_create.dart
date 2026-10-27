// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'vendor_create.g.dart';

@JsonSerializable()
class VendorCreate {
  const VendorCreate({required this.displayName, required this.pin});

  factory VendorCreate.fromJson(Map<String, Object?> json) =>
      _$VendorCreateFromJson(json);

  @JsonKey(name: 'display_name')
  final String displayName;

  /// PIN du vendeur : exactement 6 chiffres. Jamais renvoyé, journalisé ni audité ; le serveur n'en garde.
  /// que l'empreinte argon2id. Mal formé : `422 VALIDATION_FAILED`, sans écho de la valeur.
  ///
  final String pin;

  Map<String, Object?> toJson() => _$VendorCreateToJson(this);
}
