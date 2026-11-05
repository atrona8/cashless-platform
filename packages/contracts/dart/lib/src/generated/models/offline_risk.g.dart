// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_risk.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflineRisk _$OfflineRiskFromJson(Map<String, dynamic> json) => OfflineRisk(
  eventId: json['event_id'] as String,
  currency: json['currency'] as String,
  maxTotalRisk: (json['max_total_risk'] as num).toInt(),
  offlineDevices: (json['offline_devices'] as num).toInt(),
  devices: (json['devices'] as List<dynamic>)
      .map((e) => OfflineRiskDevice.fromJson(e as Map<String, dynamic>))
      .toList(),
  computedAt: DateTime.parse(json['computed_at'] as String),
);

Map<String, dynamic> _$OfflineRiskToJson(OfflineRisk instance) =>
    <String, dynamic>{
      'event_id': instance.eventId,
      'currency': instance.currency,
      'max_total_risk': instance.maxTotalRisk,
      'offline_devices': instance.offlineDevices,
      'devices': instance.devices,
      'computed_at': instance.computedAt.toIso8601String(),
    };
