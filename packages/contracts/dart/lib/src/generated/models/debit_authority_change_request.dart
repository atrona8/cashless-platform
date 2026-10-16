// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'debit_authority_change_request_target.dart';

part 'debit_authority_change_request.g.dart';

@JsonSerializable()
class DebitAuthorityChangeRequest {
  const DebitAuthorityChangeRequest({
    required this.target,
    required this.reason,
    this.force = false,
    this.edgeGatewayId,
    this.gatewayConfirmedOffline,
  });

  factory DebitAuthorityChangeRequest.fromJson(Map<String, Object?> json) =>
      _$DebitAuthorityChangeRequestFromJson(json);

  final DebitAuthorityChangeRequestTarget target;
  @JsonKey(name: 'edge_gateway_id')
  final String? edgeGatewayId;
  final String reason;

  /// `true` : reprise forcée, à deux personnes ; crée une demande d'approbation `FORCE_CENTRAL_AUTHORITY` (ADR-74).
  final bool force;

  /// Obligatoire (true) si force = true.
  @JsonKey(name: 'gateway_confirmed_offline')
  final bool? gatewayConfirmedOffline;

  Map<String, Object?> toJson() => _$DebitAuthorityChangeRequestToJson(this);
}
