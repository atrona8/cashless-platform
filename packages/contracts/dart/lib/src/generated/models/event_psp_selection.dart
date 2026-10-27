// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'psp_provider.dart';
import 'timestamp.dart';

part 'event_psp_selection.g.dart';

/// Choix de la configuration PSP d'un moyen pour un événement (`event_psp_selection`).
@JsonSerializable()
class EventPspSelection {
  const EventPspSelection({
    required this.eventId,
    required this.method,
    required this.pspConfigId,
    required this.selectedBy,
    required this.selectedAt,
    this.approvedBy,
  });

  factory EventPspSelection.fromJson(Map<String, Object?> json) =>
      _$EventPspSelectionFromJson(json);

  @JsonKey(name: 'event_id')
  final String eventId;
  final PspProvider method;
  @JsonKey(name: 'psp_config_id')
  final String pspConfigId;
  @JsonKey(name: 'selected_by')
  final String selectedBy;

  /// Seconde personne, pour un choix fait pendant `LIVE` ; null sinon.
  @JsonKey(name: 'approved_by')
  final String? approvedBy;
  @JsonKey(name: 'selected_at')
  final Timestamp selectedAt;

  Map<String, Object?> toJson() => _$EventPspSelectionToJson(this);
}
