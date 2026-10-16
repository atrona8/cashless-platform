// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'debit_authority.dart';
import 'timestamp.dart';

part 'heartbeat_response.g.dart';

@JsonSerializable()
class HeartbeatResponse {
  const HeartbeatResponse({
    required this.serverTime,
    required this.configEtag,
    required this.latestSnapshotVersion,
    required this.debitAuthority,
    required this.syncRequested,
  });

  factory HeartbeatResponse.fromJson(Map<String, Object?> json) =>
      _$HeartbeatResponseFromJson(json);

  @JsonKey(name: 'server_time')
  final Timestamp serverTime;
  @JsonKey(name: 'config_etag')
  final String configEtag;
  @JsonKey(name: 'latest_snapshot_version')
  final int? latestSnapshotVersion;
  @JsonKey(name: 'debit_authority')
  final DebitAuthority debitAuthority;

  /// Le serveur demande l'envoi immédiat des opérations en attente.
  @JsonKey(name: 'sync_requested')
  final bool syncRequested;

  Map<String, Object?> toJson() => _$HeartbeatResponseToJson(this);
}
