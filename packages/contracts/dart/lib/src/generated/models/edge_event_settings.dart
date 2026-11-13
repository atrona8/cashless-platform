// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'edge_event_settings_activation_modes.dart';
import 'edge_event_settings_status.dart';
import 'terminal_settings.dart';
import 'wallet_limits.dart';

part 'edge_event_settings.g.dart';

/// Réglages de l'événement. Usage : `getDeviceConfig` et `postDeviceHeartbeat` (blocs `event` et.
/// `terminal_settings`), refus `EVENT_CLOSING` / `LEDGER_LOCKED` des ventes et recharges, mode d'activation.
/// autorisé de `activateMedia` (`422 ACTIVATION_MODE_NOT_ALLOWED`), plafonds de `createCashTopup`.
///
@JsonSerializable()
class EdgeEventSettings {
  const EdgeEventSettings({
    required this.eventId,
    required this.name,
    required this.currency,
    required this.minorUnits,
    required this.timezone,
    required this.status,
    required this.activationModes,
    required this.terminalSettings,
    required this.walletLimits,
  });

  factory EdgeEventSettings.fromJson(Map<String, Object?> json) =>
      _$EdgeEventSettingsFromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final String name;
  final Currency currency;
  @JsonKey(name: 'minor_units')
  final int minorUnits;
  final String timezone;
  final EdgeEventSettingsStatus status;
  @JsonKey(name: 'activation_modes')
  final List<EdgeEventSettingsActivationModes> activationModes;
  @JsonKey(name: 'terminal_settings')
  final TerminalSettings terminalSettings;

  /// Plafonds de la législation du grand livre (`jurisdiction_profile`), en unités mineures ; nul = aucun.
  /// plafond. Quatre valeurs, celles que lit `check_wallet_limits` ; rien d'autre du profil n'est servi.
  ///
  @JsonKey(name: 'wallet_limits')
  final WalletLimits walletLimits;

  Map<String, Object?> toJson() => _$EdgeEventSettingsToJson(this);
}
