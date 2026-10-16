// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'debit_authority_authority.dart';

part 'debit_authority.g.dart';

@JsonSerializable()
class DebitAuthority {
  const DebitAuthority({
    required this.ledgerId,
    required this.authority,
    required this.epoch,
    required this.edgeGatewayId,
    required this.edgeBaseUrl,
  });

  factory DebitAuthority.fromJson(Map<String, Object?> json) =>
      _$DebitAuthorityFromJson(json);

  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  final DebitAuthorityAuthority authority;

  /// Époque d'autorité, incrémentée à chaque bascule (jeton d'exclusion).
  final int epoch;
  @JsonKey(name: 'edge_gateway_id')
  final String? edgeGatewayId;
  @JsonKey(name: 'edge_base_url')
  final String? edgeBaseUrl;

  Map<String, Object?> toJson() => _$DebitAuthorityToJson(this);
}
