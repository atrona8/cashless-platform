// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_policy.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflinePolicy _$OfflinePolicyFromJson(Map<String, dynamic> json) =>
    OfflinePolicy(
      offlineEnabled: json['offline_enabled'] as bool,
      maxPerSale: (json['max_per_sale'] as num).toInt(),
      maxPerMediaPerDevice: (json['max_per_media_per_device'] as num).toInt(),
      maxTotalPerDevice: (json['max_total_per_device'] as num).toInt(),
      cashTopupOffline: json['cash_topup_offline'] as bool,
      capped: json['capped'] as bool,
      maxSnapshotAgeSeconds:
          (json['max_snapshot_age_seconds'] as num?)?.toInt() ?? 900,
    );

Map<String, dynamic> _$OfflinePolicyToJson(OfflinePolicy instance) =>
    <String, dynamic>{
      'offline_enabled': instance.offlineEnabled,
      'max_per_sale': instance.maxPerSale,
      'max_per_media_per_device': instance.maxPerMediaPerDevice,
      'max_total_per_device': instance.maxTotalPerDevice,
      'max_snapshot_age_seconds': instance.maxSnapshotAgeSeconds,
      'cash_topup_offline': instance.cashTopupOffline,
      'capped': instance.capped,
    };
