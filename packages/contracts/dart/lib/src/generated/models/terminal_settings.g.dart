// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'terminal_settings.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TerminalSettings _$TerminalSettingsFromJson(Map<String, dynamic> json) =>
    TerminalSettings(
      onlineConnectTimeoutMs:
          (json['online_connect_timeout_ms'] as num?)?.toInt() ?? 2000,
      onlineTotalTimeoutMs:
          (json['online_total_timeout_ms'] as num?)?.toInt() ?? 3000,
      onlineRetries: (json['online_retries'] as num?)?.toInt() ?? 2,
      pendingSyncSeconds: (json['pending_sync_seconds'] as num?)?.toInt() ?? 30,
      reconcileSyncSeconds:
          (json['reconcile_sync_seconds'] as num?)?.toInt() ?? 300,
      heartbeatSeconds: (json['heartbeat_seconds'] as num?)?.toInt() ?? 60,
      reversalWindowMinutes:
          (json['reversal_window_minutes'] as num?)?.toInt() ?? 15,
      localRetentionDays: (json['local_retention_days'] as num?)?.toInt() ?? 7,
      tapReplayWindowSeconds:
          (json['tap_replay_window_seconds'] as num?)?.toInt() ?? 120,
    );

Map<String, dynamic> _$TerminalSettingsToJson(TerminalSettings instance) =>
    <String, dynamic>{
      'online_connect_timeout_ms': instance.onlineConnectTimeoutMs,
      'online_total_timeout_ms': instance.onlineTotalTimeoutMs,
      'online_retries': instance.onlineRetries,
      'pending_sync_seconds': instance.pendingSyncSeconds,
      'reconcile_sync_seconds': instance.reconcileSyncSeconds,
      'heartbeat_seconds': instance.heartbeatSeconds,
      'reversal_window_minutes': instance.reversalWindowMinutes,
      'local_retention_days': instance.localRetentionDays,
      'tap_replay_window_seconds': instance.tapReplayWindowSeconds,
    };
