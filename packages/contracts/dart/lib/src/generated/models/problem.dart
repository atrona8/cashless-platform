// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'errors.dart';
import 'problem_code.dart';
import 'violations.dart';

part 'problem.g.dart';

/// RFC 9457 Problem Details, avec extensions stables.
@JsonSerializable()
class Problem {
  const Problem({
    required this.type,
    required this.title,
    required this.status,
    required this.code,
    required this.requestId,
    this.detail,
    this.instance,
    this.retryable,
    this.edgeBaseUrl,
    this.errors,
    this.violations,
    this.authorityEpoch,
  });

  factory Problem.fromJson(Map<String, Object?> json) =>
      _$ProblemFromJson(json);

  /// `https://docs.cashless.test/problems/<code>`
  final String type;
  final String title;
  final int status;
  final String? detail;
  final String? instance;
  final ProblemCode code;
  @JsonKey(name: 'request_id')
  final String requestId;

  /// `true` si réessayer à l'identique (même clé d'idempotence) peut réussir.
  final bool? retryable;

  /// `DEBIT_AUTHORITY_EDGE` seulement : adresse locale de la passerelle qui détient l'autorité de débit.
  /// (ajout facultatif, décision 35 du porteur).
  ///
  @JsonKey(name: 'edge_base_url')
  final String? edgeBaseUrl;
  final List<Errors>? errors;

  /// `VALIDATION_FAILED` sur un réglage hors bornes (§4.1) : une entrée par borne franchie. Le `detail`.
  /// cite la même règle, traduit selon `Accept-Language`.
  ///
  final List<Violations>? violations;

  /// `409 STALE_AUTHORITY_EPOCH` : époque d'autorité de débit COURANTE du grand livre de l'événement du.
  /// terminal (`ledger.authority_epoch`). Le terminal la reprend, relit sa configuration et rejoue avec une.
  /// nouvelle clé `<serial>:<seq>`. Absent des autres problèmes.
  ///
  @JsonKey(name: 'authority_epoch')
  final int? authorityEpoch;

  Map<String, Object?> toJson() => _$ProblemToJson(this);
}
