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
  status: $enumDecode(_$StatusEnumMap, json['status']),
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

const _$StatusEnumMap = {
  Status.draft: 'DRAFT',
  Status.live: 'LIVE',
  Status.closing: 'CLOSING',
  Status.reconciling: 'RECONCILING',
  Status.settling: 'SETTLING',
  Status.refundWindow: 'REFUND_WINDOW',
  Status.closed: 'CLOSED',
};

const _$ActivationModesEnumMap = {
  ActivationModes.desk: 'DESK',
  ActivationModes.selfApp: 'SELF_APP',
  ActivationModes.firstTopup: 'FIRST_TOPUP',
};
