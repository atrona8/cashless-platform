// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'lines.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Lines _$LinesFromJson(Map<String, dynamic> json) => Lines(
  partyId: json['party_id'] as String,
  amount: (json['amount'] as num).toInt(),
  label: json['label'] as String?,
  reference: json['reference'] as String?,
);

Map<String, dynamic> _$LinesToJson(Lines instance) => <String, dynamic>{
  'party_id': instance.partyId,
  'label': instance.label,
  'amount': instance.amount,
  'reference': instance.reference,
};
