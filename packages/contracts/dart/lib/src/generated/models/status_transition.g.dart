// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'status_transition.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StatusTransition _$StatusTransitionFromJson(Map<String, dynamic> json) =>
    StatusTransition(to: $enumDecode(_$EventStatusEnumMap, json['to']));

Map<String, dynamic> _$StatusTransitionToJson(StatusTransition instance) =>
    <String, dynamic>{'to': instance.to};

const _$EventStatusEnumMap = {
  EventStatus.draft: 'DRAFT',
  EventStatus.live: 'LIVE',
  EventStatus.closing: 'CLOSING',
  EventStatus.reconciling: 'RECONCILING',
  EventStatus.settling: 'SETTLING',
  EventStatus.refundWindow: 'REFUND_WINDOW',
  EventStatus.closed: 'CLOSED',
};
