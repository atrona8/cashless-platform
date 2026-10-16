// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'devices.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Devices _$DevicesFromJson(Map<String, dynamic> json) => Devices(
  deviceId: json['device_id'] as String,
  serial: json['serial'] as String,
  caughtUp: json['caught_up'] as bool,
  reason: $enumDecodeNullable(_$ReasonEnumMap, json['reason']),
);

Map<String, dynamic> _$DevicesToJson(Devices instance) => <String, dynamic>{
  'device_id': instance.deviceId,
  'serial': instance.serial,
  'caught_up': instance.caughtUp,
  'reason': instance.reason,
};

const _$ReasonEnumMap = {
  Reason.notSeenSinceClosing: 'NOT_SEEN_SINCE_CLOSING',
  Reason.seqGap: 'SEQ_GAP',
  Reason.batchInProgress: 'BATCH_IN_PROGRESS',
  Reason.valueNull: null,
};
