// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_local_order_type.dart';
import 'hex32.dart';
import 'timestamp.dart';

part 'edge_local_order.g.dart';

/// Ordre local à deux personnes de la passerelle (décision 33 du porteur). Le central n'en vérifie pas la.
/// signature (les clés de site ne lui sont pas confiées) : il en garde la trace, `order_sha256` étant.
/// l'empreinte de l'ordre signé conservé sur le site.
///
@JsonSerializable()
class EdgeLocalOrder {
  const EdgeLocalOrder({
    required this.type,
    required this.gatewayId,
    required this.holders,
    required this.at,
    required this.orderSha256,
  });

  factory EdgeLocalOrder.fromJson(Map<String, Object?> json) =>
      _$EdgeLocalOrderFromJson(json);

  final EdgeLocalOrderType type;
  @JsonKey(name: 'gateway_id')
  final String gatewayId;

  /// Les deux détenteurs nominatifs des clés de site qui ont signé l'ordre.
  final List<String> holders;
  final Timestamp at;
  @JsonKey(name: 'order_sha256')
  final Hex32 orderSha256;

  Map<String, Object?> toJson() => _$EdgeLocalOrderToJson(this);
}
