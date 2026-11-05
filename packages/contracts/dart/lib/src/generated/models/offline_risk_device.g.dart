// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_risk_device.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflineRiskDevice _$OfflineRiskDeviceFromJson(Map<String, dynamic> json) =>
    OfflineRiskDevice(
      deviceId: json['device_id'] as String,
      serial: json['serial'] as String,
      maxTotalPerDevice: (json['max_total_per_device'] as num).toInt(),
      capped: json['capped'] as bool,
    );

Map<String, dynamic> _$OfflineRiskDeviceToJson(OfflineRiskDevice instance) =>
    <String, dynamic>{
      'device_id': instance.deviceId,
      'serial': instance.serial,
      'max_total_per_device': instance.maxTotalPerDevice,
      'capped': instance.capped,
    };
