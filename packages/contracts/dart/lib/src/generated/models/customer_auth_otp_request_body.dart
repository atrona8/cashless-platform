// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'channel.dart';

part 'customer_auth_otp_request_body.g.dart';

@JsonSerializable()
class CustomerAuthOtpRequestBody {
  const CustomerAuthOtpRequestBody({
    required this.phone,
    required this.operatorCode,
    this.channel = Channel.auto,
  });

  factory CustomerAuthOtpRequestBody.fromJson(Map<String, Object?> json) =>
      _$CustomerAuthOtpRequestBodyFromJson(json);

  final String phone;

  /// Code public du prestataire (l'app est multi-prestataires ; fixe le tenant).
  @JsonKey(name: 'operator_code')
  final String operatorCode;

  /// ADR-66. `AUTO` (défaut) : WhatsApp d'abord ; si la livraison WhatsApp n'est pas confirmée dans.
  /// `otp_whatsapp_timeout_seconds` (défaut 10 s) ou si le numéro n'a pas WhatsApp, le même code part par.
  /// SMS (fournisseur principal, puis fournisseur de repli si la livraison n'est pas confirmée dans.
  /// `otp_sms_failover_seconds`, défaut 20 s). `SMS` : SMS directement (bouton « Recevoir par SMS ».
  /// de l'app, toujours proposé). `WHATSAPP` : WhatsApp seulement. Un seul code valide par défi,.
  /// quel que soit le nombre de canaux utilisés.
  ///
  final Channel channel;

  Map<String, Object?> toJson() => _$CustomerAuthOtpRequestBodyToJson(this);
}
