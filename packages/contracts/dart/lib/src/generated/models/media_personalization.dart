// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encrypted_blob.dart';

part 'media_personalization.g.dart';

@JsonSerializable()
class MediaPersonalization {
  const MediaPersonalization({
    required this.mediaId,
    required this.keyIndex,
    required this.pwdPack,
  });

  factory MediaPersonalization.fromJson(Map<String, Object?> json) =>
      _$MediaPersonalizationFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  @JsonKey(name: 'key_index')
  final int keyIndex;

  /// `PWD‖PACK` (6 octets) sous enveloppe pour la clé du poste : ECDH-ES P-256 + HKDF-SHA256 + AES-256-GCM,.
  /// AAD = `"CASHLESS/PWDPACK/PERSO/v1" || media_id || nfc_uid`. Jamais transmis en clair.
  ///
  @JsonKey(name: 'pwd_pack')
  final EncryptedBlob pwdPack;

  Map<String, Object?> toJson() => _$MediaPersonalizationToJson(this);
}
