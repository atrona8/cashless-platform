// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'event_psp_selection.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EventPspSelection _$EventPspSelectionFromJson(Map<String, dynamic> json) =>
    EventPspSelection(
      eventId: json['event_id'] as String,
      method: $enumDecode(_$PspProviderEnumMap, json['method']),
      pspConfigId: json['psp_config_id'] as String,
      selectedBy: json['selected_by'] as String,
      selectedAt: DateTime.parse(json['selected_at'] as String),
      approvedBy: json['approved_by'] as String?,
    );

Map<String, dynamic> _$EventPspSelectionToJson(EventPspSelection instance) =>
    <String, dynamic>{
      'event_id': instance.eventId,
      'method': instance.method,
      'psp_config_id': instance.pspConfigId,
      'selected_by': instance.selectedBy,
      'approved_by': instance.approvedBy,
      'selected_at': instance.selectedAt.toIso8601String(),
    };

const _$PspProviderEnumMap = {
  PspProvider.wave: 'WAVE',
  PspProvider.orangeMoney: 'ORANGE_MONEY',
  PspProvider.card: 'CARD',
};
