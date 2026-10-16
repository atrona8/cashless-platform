// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'party_update.g.dart';

/// Données descriptives d'une partie ; au moins une.
@JsonSerializable()
class PartyUpdate {
  const PartyUpdate({this.legalName, this.countryCode, this.taxId});

  factory PartyUpdate.fromJson(Map<String, Object?> json) =>
      _$PartyUpdateFromJson(json);

  @JsonKey(name: 'legal_name')
  final String? legalName;
  @JsonKey(name: 'country_code')
  final String? countryCode;
  @JsonKey(name: 'tax_id')
  final String? taxId;

  Map<String, Object?> toJson() => _$PartyUpdateToJson(this);
}
