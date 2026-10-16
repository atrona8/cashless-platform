// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'clock.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Clock _$ClockFromJson(Map<String, dynamic> json) => Clock(
  monotonicMs: (json['monotonic_ms'] as num?)?.toInt(),
  bootId: json['boot_id'] as String?,
  offsetMs: (json['offset_ms'] as num?)?.toInt(),
);

Map<String, dynamic> _$ClockToJson(Clock instance) => <String, dynamic>{
  'monotonic_ms': instance.monotonicMs,
  'boot_id': instance.bootId,
  'offset_ms': instance.offsetMs,
};
