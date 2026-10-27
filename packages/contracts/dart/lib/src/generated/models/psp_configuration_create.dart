// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'psp_configuration_provider.dart';
import 'psp_provider.dart';
import 'timestamp.dart';

part 'psp_configuration_create.g.dart';

@JsonSerializable()
class PspConfigurationCreate {
  const PspConfigurationCreate({
    required this.method,
    required this.provider,
    required this.holderPartyId,
    required this.secretRef,
    this.validFrom,
    this.validUntil,
    this.isDefault = false,
  });

  factory PspConfigurationCreate.fromJson(Map<String, Object?> json) =>
      _$PspConfigurationCreateFromJson(json);

  final PspProvider method;
  final PspConfigurationProvider provider;

  /// Titulaire des fonds reçus par cette configuration (doit être le détenteur des fonds du grand livre).
  @JsonKey(name: 'holder_party_id')
  final String holderPartyId;

  /// RÉFÉRENCE du secret dans le coffre (`psp/<uuid>/<nom>`), jamais le secret lui-même : une valeur qui.
  /// ressemble à un secret est refusée `422 VALIDATION_FAILED`.
  ///
  @JsonKey(name: 'secret_ref')
  final String secretRef;

  /// Configuration par défaut de l'organisateur pour ce moyen (une seule `ACTIVE`).
  @JsonKey(name: 'is_default')
  final bool isDefault;
  @JsonKey(name: 'valid_from')
  final Timestamp? validFrom;
  @JsonKey(name: 'valid_until')
  final DateTime? validUntil;

  Map<String, Object?> toJson() => _$PspConfigurationCreateToJson(this);
}
