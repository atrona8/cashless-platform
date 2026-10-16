// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encrypted_blob.dart';
import 'nfc_uid.dart';

part 'media_auth_key.g.dart';

@JsonSerializable()
class MediaAuthKey {
  const MediaAuthKey({
    required this.nfcUid,
    required this.keyIndex,
    required this.enc,
    required this.ttlSeconds,
  });

  factory MediaAuthKey.fromJson(Map<String, Object?> json) =>
      _$MediaAuthKeyFromJson(json);

  @JsonKey(name: 'nfc_uid')
  final NfcUid nfcUid;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  final EncryptedBlob enc;

  /// Durée pendant laquelle le terminal peut garder le PWD en mémoire vive.
  @JsonKey(name: 'ttl_seconds')
  final int ttlSeconds;

  Map<String, Object?> toJson() => _$MediaAuthKeyToJson(this);
}
