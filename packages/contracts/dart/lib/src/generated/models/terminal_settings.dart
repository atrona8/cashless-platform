// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'terminal_settings.g.dart';

@JsonSerializable()
class TerminalSettings {
  const TerminalSettings({
    this.onlineConnectTimeoutMs = 2000,
    this.onlineTotalTimeoutMs = 3000,
    this.onlineRetries = 2,
    this.pendingSyncSeconds = 30,
    this.reconcileSyncSeconds = 300,
    this.heartbeatSeconds = 60,
    this.reversalWindowMinutes = 15,
    this.localRetentionDays = 7,
    this.tapReplayWindowSeconds = 120,
  });

  factory TerminalSettings.fromJson(Map<String, Object?> json) =>
      _$TerminalSettingsFromJson(json);

  @JsonKey(name: 'online_connect_timeout_ms')
  final int onlineConnectTimeoutMs;
  @JsonKey(name: 'online_total_timeout_ms')
  final int onlineTotalTimeoutMs;
  @JsonKey(name: 'online_retries')
  final int onlineRetries;
  @JsonKey(name: 'pending_sync_seconds')
  final int pendingSyncSeconds;
  @JsonKey(name: 'reconcile_sync_seconds')
  final int reconcileSyncSeconds;
  @JsonKey(name: 'heartbeat_seconds')
  final int heartbeatSeconds;
  @JsonKey(name: 'reversal_window_minutes')
  final int reversalWindowMinutes;
  @JsonKey(name: 'local_retention_days')
  final int localRetentionDays;
  @JsonKey(name: 'tap_replay_window_seconds')
  final int tapReplayWindowSeconds;

  Map<String, Object?> toJson() => _$TerminalSettingsToJson(this);
}
