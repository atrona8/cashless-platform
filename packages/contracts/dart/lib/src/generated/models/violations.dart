// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'violations.g.dart';

@JsonSerializable()
class Violations {
  const Violations({
    required this.field,
    required this.rule,
    required this.requested,
    required this.limit,
    required this.source,
  });

  factory Violations.fromJson(Map<String, Object?> json) =>
      _$ViolationsFromJson(json);

  /// Réglage refusé (`refund_deadline`, `cash_refund_single_max`…).
  final String field;

  /// Identifiant stable de la règle (`jurisdiction.min_refund_window_days`, `catalog.range`, `operator.cash_refund_single_max_cap`…).
  final String rule;

  /// Valeur demandée.
  final dynamic requested;

  /// Borne franchie.
  final dynamic limit;

  /// Origine de la borne — profil de législation (`SN v1`), niveau et version de configuration, ou `catalog`.
  final String source;

  Map<String, Object?> toJson() => _$ViolationsToJson(this);
}
