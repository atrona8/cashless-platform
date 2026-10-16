// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'nfc_uid.dart';

part 'media_personalization_request.g.dart';

@JsonSerializable()
class MediaPersonalizationRequest {
  const MediaPersonalizationRequest({
    required this.batchId,
    required this.tokenHash,
    required this.nfcUid,
    required this.originalitySignature,
    required this.signatureOk,
    required this.stationPublicKey,
  });

  factory MediaPersonalizationRequest.fromJson(Map<String, Object?> json) =>
      _$MediaPersonalizationRequestFromJson(json);

  @JsonKey(name: 'batch_id')
  final String batchId;

  /// SHA-256 de l'identité de 16 octets écrite dans la puce (64 chiffres hexadécimaux). L'identité elle-même n'est jamais envoyée.
  @JsonKey(name: 'token_hash')
  final String tokenHash;
  @JsonKey(name: 'nfc_uid')
  final NfcUid nfcUid;

  /// Signature d'originalité NXP lue par `READ_SIG` (§7.5). Le serveur n'en garde que l'empreinte (ADR-59).
  @JsonKey(name: 'originality_signature')
  final String originalitySignature;

  /// Résultat de la vérification de la signature par le poste ; `false` fait refuser la puce.
  @JsonKey(name: 'signature_ok')
  final bool signatureOk;

  /// Clé publique ECDH P-256 à usage unique du poste (point non compressé, 65 octets, base64url) ; le mot de passe est chiffré pour elle.
  @JsonKey(name: 'station_public_key')
  final String stationPublicKey;

  Map<String, Object?> toJson() => _$MediaPersonalizationRequestToJson(this);
}
