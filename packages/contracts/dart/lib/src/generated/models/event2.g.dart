// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'event2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Event2 _$Event2FromJson(Map<String, dynamic> json) => Event2(
  eventId: json['event_id'] as String,
  name: json['name'] as String,
  status: json['status'] as String,
);

Map<String, dynamic> _$Event2ToJson(Event2 instance) => <String, dynamic>{
  'event_id': instance.eventId,
  'name': instance.name,
  'status': instance.status,
};
