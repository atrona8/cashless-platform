// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'event.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Event _$EventFromJson(Map<String, dynamic> json) => Event(
  eventId: json['event_id'] as String,
  name: json['name'] as String,
  currency: json['currency'] as String,
  minorUnits: (json['minor_units'] as num).toInt(),
  timezone: json['timezone'] as String,
  status: $enumDecode(_$Status5EnumMap, json['status']),
  activationModes: (json['activation_modes'] as List<dynamic>)
      .map((e) => $enumDecode(_$ActivationModesEnumMap, e))
      .toList(),
);

Map<String, dynamic> _$EventToJson(Event instance) => <String, dynamic>{
  'event_id': instance.eventId,
  'name': instance.name,
  'currency': instance.currency,
  'minor_units': instance.minorUnits,
  'timezone': instance.timezone,
  'status': instance.status,
  'activation_modes': instance.activationModes,
};

const _$Status5EnumMap = {
  Status5.draft: 'DRAFT',
  Status5.live: 'LIVE',
  Status5.closing: 'CLOSING',
  Status5.reconciling: 'RECONCILING',
  Status5.settling: 'SETTLING',
  Status5.refundWindow: 'REFUND_WINDOW',
  Status5.closed: 'CLOSED',
};

const _$ActivationModesEnumMap = {
  ActivationModes.desk: 'DESK',
  ActivationModes.selfApp: 'SELF_APP',
  ActivationModes.firstTopup: 'FIRST_TOPUP',
};
