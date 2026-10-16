// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'claim_code_association_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ClaimCodeAssociationResult _$ClaimCodeAssociationResultFromJson(
  Map<String, dynamic> json,
) => ClaimCodeAssociationResult(
  accepted: (json['accepted'] as num).toInt(),
  rejected: (json['rejected'] as List<dynamic>)
      .map((e) => Rejected.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$ClaimCodeAssociationResultToJson(
  ClaimCodeAssociationResult instance,
) => <String, dynamic>{
  'accepted': instance.accepted,
  'rejected': instance.rejected,
};
