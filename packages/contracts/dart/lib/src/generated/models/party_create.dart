// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'party_create.g.dart';

/// Création d'un organisateur ou d'un commerçant. Le prestataire est celui du chemin, jamais du corps.
@JsonSerializable()
class PartyCreate {
  const PartyCreate({required this.legalName, this.countryCode, this.taxId});

  factory PartyCreate.fromJson(Map<String, Object?> json) =>
      _$PartyCreateFromJson(json);

  @JsonKey(name: 'legal_name')
  final String legalName;
  @JsonKey(name: 'country_code')
  final String? countryCode;
  @JsonKey(name: 'tax_id')
  final String? taxId;

  Map<String, Object?> toJson() => _$PartyCreateToJson(this);
}
