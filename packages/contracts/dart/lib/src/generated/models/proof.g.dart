// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'proof.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Proof _$ProofFromJson(Map<String, dynamic> json) => Proof(
  kind: $enumDecode(_$KindEnumMap, json['kind']),
  tapId: (json['tap_id'] as num?)?.toInt(),
);

Map<String, dynamic> _$ProofToJson(Proof instance) => <String, dynamic>{
  'kind': instance.kind,
  'tap_id': instance.tapId,
};

const _$KindEnumMap = {
  Kind.mediaTap: 'MEDIA_TAP',
  Kind.customerAccount: 'CUSTOMER_ACCOUNT',
};
