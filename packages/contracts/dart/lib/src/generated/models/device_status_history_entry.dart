// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_status.dart';
import 'device_status_history_entry_from_status.dart';
import 'timestamp.dart';

part 'device_status_history_entry.g.dart';

/// Changement de statut d'un terminal (ajout seul).
@JsonSerializable()
class DeviceStatusHistoryEntry {
  const DeviceStatusHistoryEntry({
    required this.fromStatus,
    required this.toStatus,
    required this.reason,
    required this.actorId,
    required this.at,
  });

  factory DeviceStatusHistoryEntry.fromJson(Map<String, Object?> json) =>
      _$DeviceStatusHistoryEntryFromJson(json);

  /// `null` pour l'enrôlement.
  @JsonKey(name: 'from_status')
  final DeviceStatusHistoryEntryFromStatus? fromStatus;
  @JsonKey(name: 'to_status')
  final DeviceStatus toStatus;
  final String? reason;

  /// Personne auteur du changement (`null` pour l'enrôlement).
  @JsonKey(name: 'actor_id')
  final String? actorId;
  final Timestamp at;

  Map<String, Object?> toJson() => _$DeviceStatusHistoryEntryToJson(this);
}
