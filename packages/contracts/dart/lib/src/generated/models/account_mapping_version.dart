// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'account_mapping.dart';

part 'account_mapping_version.g.dart';

/// Version des correspondances d'une entité ; remplace la précédente à partir de `valid_from`.
@JsonSerializable()
class AccountMappingVersion {
  const AccountMappingVersion({
    required this.entityPartyId,
    required this.validFrom,
    required this.mappings,
    this.version,
    this.createdBy,
  });

  factory AccountMappingVersion.fromJson(Map<String, Object?> json) =>
      _$AccountMappingVersionFromJson(json);

  @JsonKey(name: 'entity_party_id')
  final String entityPartyId;

  /// Attribuée par le serveur (croissante).
  final int? version;
  @JsonKey(name: 'valid_from')
  final DateTime validFrom;
  @JsonKey(name: 'created_by')
  final String? createdBy;
  final List<AccountMapping> mappings;

  Map<String, Object?> toJson() => _$AccountMappingVersionToJson(this);
}
