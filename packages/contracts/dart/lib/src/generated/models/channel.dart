// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// ADR-66. `AUTO` (défaut) : WhatsApp d'abord ; si la livraison WhatsApp n'est pas confirmée dans.
/// `otp_whatsapp_timeout_seconds` (défaut 10 s) ou si le numéro n'a pas WhatsApp, le même code part par.
/// SMS (fournisseur principal, puis fournisseur de repli si la livraison n'est pas confirmée dans.
/// `otp_sms_failover_seconds`, défaut 20 s). `SMS` : SMS directement (bouton « Recevoir par SMS ».
/// de l'app, toujours proposé). `WHATSAPP` : WhatsApp seulement. Un seul code valide par défi,.
/// quel que soit le nombre de canaux utilisés.
///
@JsonEnum()
enum Channel {
  @JsonValue('AUTO')
  auto('AUTO'),
  @JsonValue('SMS')
  sms('SMS'),
  @JsonValue('WHATSAPP')
  whatsapp('WHATSAPP');

  const Channel(this.json);

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError(
        'Cannot convert enum value with null JSON representation to String. '
        'This usually happens for \$unknown or @JsonValue(null) entries.',
      );
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
}
