// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'vendor_session_open.g.dart';

@JsonSerializable()
class VendorSessionOpen {
  const VendorSessionOpen({required this.vendorId, required this.pin});

  factory VendorSessionOpen.fromJson(Map<String, Object?> json) =>
      _$VendorSessionOpenFromJson(json);

  @JsonKey(name: 'vendor_id')
  final String vendorId;

  /// PIN du vendeur : exactement 6 chiffres. Jamais renvoyé, journalisé ni audité ; le serveur n'en garde.
  /// que l'empreinte argon2id. Mal formé : `422 VALIDATION_FAILED`, sans écho de la valeur.
  ///
  final String pin;

  Map<String, Object?> toJson() => _$VendorSessionOpenToJson(this);
}
