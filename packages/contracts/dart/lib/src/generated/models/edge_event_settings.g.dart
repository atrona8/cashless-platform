// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_event_settings.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeEventSettings _$EdgeEventSettingsFromJson(Map<String, dynamic> json) =>
    EdgeEventSettings(
      eventId: json['event_id'] as String,
      name: json['name'] as String,
      currency: json['currency'] as String,
      minorUnits: (json['minor_units'] as num).toInt(),
      timezone: json['timezone'] as String,
      status: $enumDecode(_$EdgeEventSettingsStatusEnumMap, json['status']),
      activationModes: (json['activation_modes'] as List<dynamic>)
          .map((e) => $enumDecode(_$EdgeEventSettingsActivationModesEnumMap, e))
          .toList(),
      terminalSettings: TerminalSettings.fromJson(
        json['terminal_settings'] as Map<String, dynamic>,
      ),
      walletLimits: WalletLimits.fromJson(
        json['wallet_limits'] as Map<String, dynamic>,
      ),
    );

Map<String, dynamic> _$EdgeEventSettingsToJson(EdgeEventSettings instance) =>
    <String, dynamic>{
      'event_id': instance.eventId,
      'name': instance.name,
      'currency': instance.currency,
      'minor_units': instance.minorUnits,
      'timezone': instance.timezone,
      'status': instance.status,
      'activation_modes': instance.activationModes,
      'terminal_settings': instance.terminalSettings,
      'wallet_limits': instance.walletLimits,
    };

const _$EdgeEventSettingsStatusEnumMap = {
  EdgeEventSettingsStatus.draft: 'DRAFT',
  EdgeEventSettingsStatus.live: 'LIVE',
  EdgeEventSettingsStatus.closing: 'CLOSING',
  EdgeEventSettingsStatus.reconciling: 'RECONCILING',
  EdgeEventSettingsStatus.settling: 'SETTLING',
  EdgeEventSettingsStatus.refundWindow: 'REFUND_WINDOW',
  EdgeEventSettingsStatus.closed: 'CLOSED',
};

const _$EdgeEventSettingsActivationModesEnumMap = {
  EdgeEventSettingsActivationModes.desk: 'DESK',
  EdgeEventSettingsActivationModes.selfApp: 'SELF_APP',
  EdgeEventSettingsActivationModes.firstTopup: 'FIRST_TOPUP',
};
