// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'rejected.dart';

part 'claim_code_association_result.g.dart';

@JsonSerializable()
class ClaimCodeAssociationResult {
  const ClaimCodeAssociationResult({
    required this.accepted,
    required this.rejected,
  });

  factory ClaimCodeAssociationResult.fromJson(Map<String, Object?> json) =>
      _$ClaimCodeAssociationResultFromJson(json);

  final int accepted;
  final List<Rejected> rejected;

  Map<String, Object?> toJson() => _$ClaimCodeAssociationResultToJson(this);
}
