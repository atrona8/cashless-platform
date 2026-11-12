// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_device_config.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeDeviceConfig _$EdgeDeviceConfigFromJson(Map<String, dynamic> json) =>
    EdgeDeviceConfig(
      configId: (json['config_id'] as num).toInt(),
      deviceId: json['device_id'] as String,
      inForce: json['in_force'] as bool,
      offlinePolicy: OfflinePolicy.fromJson(
        json['offline_policy'] as Map<String, dynamic>,
      ),
    );

Map<String, dynamic> _$EdgeDeviceConfigToJson(EdgeDeviceConfig instance) =>
    <String, dynamic>{
      'config_id': instance.configId,
      'device_id': instance.deviceId,
      'in_force': instance.inForce,
      'offline_policy': instance.offlinePolicy,
    };
