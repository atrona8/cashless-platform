// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'psp_configuration_provider.dart';
import 'psp_configuration_status.dart';
import 'psp_provider.dart';
import 'timestamp.dart';

part 'psp_configuration.g.dart';

@JsonSerializable()
class PspConfiguration {
  const PspConfiguration({
    required this.pspConfigId,
    required this.organizerId,
    required this.method,
    required this.provider,
    required this.holderPartyId,
    required this.status,
    required this.isDefault,
    required this.version,
    required this.createdBy,
    required this.createdAt,
    this.secretRef,
    this.complianceRef,
    this.validFrom,
    this.validUntil,
    this.approvedBy,
  });

  factory PspConfiguration.fromJson(Map<String, Object?> json) =>
      _$PspConfigurationFromJson(json);

  @JsonKey(name: 'psp_config_id')
  final String pspConfigId;
  @JsonKey(name: 'organizer_id')
  final String organizerId;
  final PspProvider method;
  final PspConfigurationProvider provider;
  @JsonKey(name: 'holder_party_id')
  final String holderPartyId;

  /// Référence du secret (jamais le secret). Rendue au seul `OPERATOR_ADMIN` du prestataire ; `null` ou.
  /// absente pour tout autre rôle (`ORGANIZER_ADMIN` compris).
  ///
  @JsonKey(name: 'secret_ref')
  final String? secretRef;

  /// Référence de conformité fournie à l'activation ; null avant.
  @JsonKey(name: 'compliance_ref')
  final String? complianceRef;
  final PspConfigurationStatus status;
  @JsonKey(name: 'is_default')
  final bool isDefault;
  @JsonKey(name: 'valid_from')
  final Timestamp? validFrom;
  @JsonKey(name: 'valid_until')
  final DateTime? validUntil;
  final int version;
  @JsonKey(name: 'created_by')
  final String createdBy;
  @JsonKey(name: 'approved_by')
  final String? approvedBy;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;

  Map<String, Object?> toJson() => _$PspConfigurationToJson(this);
}
