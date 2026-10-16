// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_config.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceConfig _$DeviceConfigFromJson(Map<String, dynamic> json) => DeviceConfig(
  terminalSettings: TerminalSettings.fromJson(
    json['terminal_settings'] as Map<String, dynamic>,
  ),
  configId: (json['config_id'] as num).toInt(),
  device: Device.fromJson(json['device'] as Map<String, dynamic>),
  event: Event.fromJson(json['event'] as Map<String, dynamic>),
  offlinePolicy: OfflinePolicy.fromJson(
    json['offline_policy'] as Map<String, dynamic>,
  ),
  snapshotKeys: (json['snapshot_keys'] as List<dynamic>)
      .map((e) => SnapshotKeys.fromJson(e as Map<String, dynamic>))
      .toList(),
  debitAuthority: DebitAuthority.fromJson(
    json['debit_authority'] as Map<String, dynamic>,
  ),
  seq: Seq.fromJson(json['seq'] as Map<String, dynamic>),
  serverTime: DateTime.parse(json['server_time'] as String),
  clockToleranceSeconds:
      (json['clock_tolerance_seconds'] as num?)?.toInt() ?? 120,
  pos: json['pos'] == null
      ? null
      : Pos.fromJson(json['pos'] as Map<String, dynamic>),
  catalog: json['catalog'] == null
      ? null
      : Catalog.fromJson(json['catalog'] as Map<String, dynamic>),
);

Map<String, dynamic> _$DeviceConfigToJson(DeviceConfig instance) =>
    <String, dynamic>{
      'terminal_settings': instance.terminalSettings,
      'config_id': instance.configId,
      'device': instance.device,
      'event': instance.event,
      'pos': instance.pos,
      'catalog': instance.catalog,
      'offline_policy': instance.offlinePolicy,
      'snapshot_keys': instance.snapshotKeys,
      'debit_authority': instance.debitAuthority,
      'seq': instance.seq,
      'server_time': instance.serverTime.toIso8601String(),
      'clock_tolerance_seconds': instance.clockToleranceSeconds,
    };
