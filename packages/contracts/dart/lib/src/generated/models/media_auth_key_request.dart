// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'nfc_uid.dart';

part 'media_auth_key_request.g.dart';

@JsonSerializable()
class MediaAuthKeyRequest {
  const MediaAuthKeyRequest({required this.nfcUid, required this.keyIndex});

  factory MediaAuthKeyRequest.fromJson(Map<String, Object?> json) =>
      _$MediaAuthKeyRequestFromJson(json);

  @JsonKey(name: 'nfc_uid')
  final NfcUid nfcUid;
  @JsonKey(name: 'key_index')
  final int keyIndex;

  Map<String, Object?> toJson() => _$MediaAuthKeyRequestToJson(this);
}
