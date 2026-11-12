// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_unassigned_media_batch_status.dart';
import 'encrypted_blob.dart';
import 'hex32.dart';
import 'media_status.dart';
import 'nfc_uid.dart';

part 'edge_unassigned_media.g.dart';

/// Bracelet de l'événement personnalisé mais pas encore attaché (aucun portefeuille). Le flux existant.
/// (`media`, "une entrée par rattachement ouvert") ne peut pas le porter, car `SnapshotEntry.wallet_status`.
/// est obligatoire. Usage : `getMediaAuthKey` (PWD/PACK avant `PWD_AUTH`), `createTap` (`NOT_ACTIVATED` plutôt.
/// que `UNKNOWN`), `activateMedia` (vérification de l'UID et de la signature d'originalité). Sans lui,.
/// l'activation au guichet pendant la coupure est impossible, alors qu'elle est servie (ADR-52).
///
@JsonSerializable()
class EdgeUnassignedMedia {
  const EdgeUnassignedMedia({
    required this.mediaId,
    required this.nfcUid,
    required this.tokenHash,
    required this.keyIndex,
    required this.originalitySigSha256,
    required this.status,
    required this.batchEventId,
    required this.batchStatus,
    required this.pwdPackEnc,
    required this.pwdPackSha256,
  });

  factory EdgeUnassignedMedia.fromJson(Map<String, Object?> json) =>
      _$EdgeUnassignedMediaFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  @JsonKey(name: 'nfc_uid')
  final NfcUid nfcUid;
  @JsonKey(name: 'token_hash')
  final Hex32 tokenHash;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  @JsonKey(name: 'originality_sig_sha256')
  final Hex32? originalitySigSha256;
  final MediaStatus status;
  @JsonKey(name: 'batch_event_id')
  final String? batchEventId;
  @JsonKey(name: 'batch_status')
  final EdgeUnassignedMediaBatchStatus? batchStatus;

  /// PWD||PACK chiffré (AES-256-GCM) avec la clé de contenu de `ReplicationPage.pwd_pack_key`. Jamais en.
  /// clair, jamais la clé maître du bracelet (C-009, NFR-010).
  ///
  @JsonKey(name: 'pwd_pack_enc')
  final EncryptedBlob? pwdPackEnc;
  @JsonKey(name: 'pwd_pack_sha256')
  final Hex32? pwdPackSha256;

  Map<String, Object?> toJson() => _$EdgeUnassignedMediaToJson(this);
}
