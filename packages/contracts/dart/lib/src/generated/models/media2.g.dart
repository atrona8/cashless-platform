// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Media2 _$Media2FromJson(Map<String, dynamic> json) => Media2(
  mediaId: json['media_id'] as String,
  status: $enumDecode(_$MediaStatusEnumMap, json['status']),
  printedNumber: json['printed_number'] as String?,
);

Map<String, dynamic> _$Media2ToJson(Media2 instance) => <String, dynamic>{
  'media_id': instance.mediaId,
  'status': instance.status,
  'printed_number': instance.printedNumber,
};

const _$MediaStatusEnumMap = {
  MediaStatus.personalized: 'PERSONALIZED',
  MediaStatus.issued: 'ISSUED',
  MediaStatus.active: 'ACTIVE',
  MediaStatus.suspended: 'SUSPENDED',
  MediaStatus.replaced: 'REPLACED',
  MediaStatus.blacklisted: 'BLACKLISTED',
  MediaStatus.released: 'RELEASED',
  MediaStatus.retired: 'RETIRED',
  MediaStatus.destroyed: 'DESTROYED',
};
