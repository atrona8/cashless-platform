// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'organizer.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Organizer _$OrganizerFromJson(Map<String, dynamic> json) => Organizer(
  organizerId: json['organizer_id'] as String,
  operatorId: json['operator_id'] as String,
  legalName: json['legal_name'] as String,
  countryCode: json['country_code'] as String?,
  taxId: json['tax_id'] as String?,
  createdAt: DateTime.parse(json['created_at'] as String),
);

Map<String, dynamic> _$OrganizerToJson(Organizer instance) => <String, dynamic>{
  'organizer_id': instance.organizerId,
  'operator_id': instance.operatorId,
  'legal_name': instance.legalName,
  'country_code': instance.countryCode,
  'tax_id': instance.taxId,
  'created_at': instance.createdAt.toIso8601String(),
};
