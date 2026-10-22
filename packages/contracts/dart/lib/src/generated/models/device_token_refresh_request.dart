// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'device_token_refresh_request.g.dart';

/// Bornes identiques à celles du serveur (`refresh.dto.ts`, ADR-118) : un champ hors de son motif est refusé.
/// en `400 VALIDATION_FAILED`. Aucun champ ne peut contenir l'octet nul : le découpage du message signé est.
/// unique.
///
@JsonSerializable()
class DeviceTokenRefreshRequest {
  const DeviceTokenRefreshRequest({
    required this.serial,
    required this.refreshToken,
    required this.nonce,
    required this.signature,
  });

  factory DeviceTokenRefreshRequest.fromJson(Map<String, Object?> json) =>
      _$DeviceTokenRefreshRequestFromJson(json);

  final String serial;

  /// Jeton de rafraîchissement reçu (`drt_` puis 256 bits en base64url), 16 à 128 caractères.
  @JsonKey(name: 'refresh_token')
  final String refreshToken;

  /// Nonce choisi par le terminal, 16 à 64 caractères base64 ou base64url.
  final String nonce;

  /// Preuve de possession : signature ECDSA P-256 / SHA-256, par la clé de signature du terminal, de.
  /// `"cashless-refresh-v1" ‖ 0x00 ‖ nonce ‖ 0x00 ‖ serial ‖ 0x00 ‖ refresh_token` (octets UTF-8), au.
  /// format brut `r ‖ s` de 64 octets (`ieee-p1363`, comme la signature des requêtes), en base64 (88.
  /// caractères). Une signature qui n'est pas du base64 : `400` ; d'une autre longueur, ou invalide :.
  /// `401 REFRESH_TOKEN_INVALID`.
  ///
  final String signature;

  Map<String, Object?> toJson() => _$DeviceTokenRefreshRequestToJson(this);
}
