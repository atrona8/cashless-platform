// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'claim_code_association.g.dart';

@JsonSerializable()
class ClaimCodeAssociation {
  const ClaimCodeAssociation({required this.claimCode});

  factory ClaimCodeAssociation.fromJson(Map<String, Object?> json) =>
      _$ClaimCodeAssociationFromJson(json);

  /// Code lu sur le QR ou saisi ; tirets, espaces et casse ignorés.
  @JsonKey(name: 'claim_code')
  final String claimCode;

  Map<String, Object?> toJson() => _$ClaimCodeAssociationToJson(this);
}
