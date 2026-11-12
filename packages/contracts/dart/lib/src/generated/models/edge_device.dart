// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_app_mode.dart';
import 'device_kind.dart';
import 'device_status.dart';
import 'edge_device_os.dart';
import 'hex32.dart';
import 'pos2.dart';
import 'token_family.dart';

part 'edge_device.g.dart';

/// Terminal de l'événement. Usage : les trois preuves du terminal sur chacune des 16 opérations (certificat,.
/// clé de signature de requête, état), blocs `device` et `pos` de `getDeviceConfig`, enveloppe du mot de.
/// passe pour ce terminal (`getMediaAuthKey`, `getOfflineSnapshot`), `getDeviceSeqStatus`. Un terminal.
/// suspendu ou révoqué au central l'est sur la passerelle dès réception. Aucune de ces valeurs n'est.
/// secrète (certificat, clés publiques), sauf `token_family` (empreinte d'un jeton de rafraîchissement, voir sa.
/// description) ; elles ne sortent que par `/edge/*`, comme `DeviceAdmin` les cache aux écrans.
///
@JsonSerializable()
class EdgeDevice {
  const EdgeDevice({
    required this.deviceId,
    required this.serial,
    required this.kind,
    required this.appMode,
    required this.os,
    required this.nfcEnabled,
    required this.status,
    required this.publicKey,
    required this.certSha256,
    this.stationName,
    this.pos,
    this.cashDeskAccountId,
    this.agreementPublicKey,
    this.tokenFamily,
  });

  factory EdgeDevice.fromJson(Map<String, Object?> json) =>
      _$EdgeDeviceFromJson(json);

  @JsonKey(name: 'device_id')
  final String deviceId;
  final String serial;
  final DeviceKind kind;
  @JsonKey(name: 'app_mode')
  final DeviceAppMode appMode;
  final EdgeDeviceOs os;
  @JsonKey(name: 'nfc_enabled')
  final bool nfcEnabled;
  final DeviceStatus status;
  @JsonKey(name: 'station_name')
  final String? stationName;

  /// Point de vente du terminal (bloc `pos` de `DeviceConfig`) ; nul sans point de vente.
  final Pos2? pos;

  /// Compte d'espèces de la station du terminal. Usage : `EdgeSyncOperation.edge_guichet.cash_desk_account_id`,.
  /// obligatoire pour une opération `DEPOSIT_CASH` de la file ; sans ce champ la passerelle ne peut pas.
  /// décrire une caution en espèces.
  ///
  @JsonKey(name: 'cash_desk_account_id')
  final String? cashDeskAccountId;

  /// Clé publique de signature du terminal (`device.public_key`) ; épingle `cnf.jkt` et vérifie RFC 9421.
  @JsonKey(name: 'public_key')
  final String publicKey;
  @JsonKey(name: 'cert_sha256')
  final Hex32 certSha256;

  /// Clé d'accord ECDH P-256 du terminal ; nulle pour un terminal sans mots de passe hors ligne.
  @JsonKey(name: 'agreement_public_key')
  final String? agreementPublicKey;

  /// Famille de jetons d'appareil du terminal, pour `refreshDeviceToken` sur la passerelle SANS rotation.
  /// (décision 11 du porteur, A01) : la passerelle vérifie le jeton de rafraîchissement présenté contre.
  /// l'empreinte courante, avec la preuve de possession (signature du terminal) et le certificat, puis émet un.
  /// jeton d'accès court, valable sur elle seule (`aud` de la passerelle), sans consommer ni faire tourner le.
  /// jeton de rafraîchissement. Le central ne sert l'empreinte qu'à la passerelle `PRIMARY` de l'événement,.
  /// marque la famille `edge_exposed` et force la rotation au rendu (la détection de réutilisation est.
  /// retrouvée). C'est un secret dérivé de plus sur le site : écart accepté, ADR et OP à l'appui.
  ///
  @JsonKey(name: 'token_family')
  final TokenFamily? tokenFamily;

  Map<String, Object?> toJson() => _$EdgeDeviceToJson(this);
}
