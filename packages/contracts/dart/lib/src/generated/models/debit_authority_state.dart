// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'debit_authority_authority.dart';
import 'handover.dart';

part 'debit_authority_state.g.dart';

@JsonSerializable()
class DebitAuthorityState {
  const DebitAuthorityState({
    required this.ledgerId,
    required this.authority,
    required this.epoch,
    required this.edgeGatewayId,
    required this.edgeBaseUrl,
    required this.handover,
  });

  factory DebitAuthorityState.fromJson(Map<String, Object?> json) =>
      _$DebitAuthorityStateFromJson(json);

  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  final DebitAuthorityAuthority authority;

  /// Époque d'autorité, incrémentée à chaque bascule (jeton d'exclusion).
  final int epoch;
  @JsonKey(name: 'edge_gateway_id')
  final String? edgeGatewayId;
  @JsonKey(name: 'edge_base_url')
  final String? edgeBaseUrl;
  final Handover? handover;

  Map<String, Object?> toJson() => _$DebitAuthorityStateToJson(this);
}
