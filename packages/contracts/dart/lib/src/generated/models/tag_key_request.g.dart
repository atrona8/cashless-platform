// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tag_key_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TagKeyRequest _$TagKeyRequestFromJson(Map<String, dynamic> json) =>
    TagKeyRequest(
      dedicatedEventId: json['dedicated_event_id'] as String?,
      scope:
          $enumDecodeNullable(_$TagKeyRequestScopeEnumMap, json['scope']) ??
          TagKeyRequestScope.shared,
    );

Map<String, dynamic> _$TagKeyRequestToJson(TagKeyRequest instance) =>
    <String, dynamic>{
      'scope': instance.scope,
      'dedicated_event_id': instance.dedicatedEventId,
    };

const _$TagKeyRequestScopeEnumMap = {
  TagKeyRequestScope.shared: 'SHARED',
  TagKeyRequestScope.dedicated: 'DEDICATED',
};
