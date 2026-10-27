// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'reversal_request_reason.dart';
import 'timestamp.dart';

part 'reversal_request.g.dart';

/// `vendor_session_id` est requis depuis un terminal (annulation par le vendeur de la vente ou avec un.
/// `SUPERVISOR`) ; il est sans objet au back-office (`humanBearer`), d'où son absence de `required`.
///
@JsonSerializable()
class ReversalRequest {
  const ReversalRequest({
    required this.reason,
    required this.occurredAt,
    this.comment,
    this.vendorSessionId,
    this.supervisorPinProof,
  });

  factory ReversalRequest.fromJson(Map<String, Object?> json) =>
      _$ReversalRequestFromJson(json);

  final ReversalRequestReason reason;
  final String? comment;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;

  /// Session de vendeur ouverte sur ce terminal ; requise depuis un terminal (sinon.
  /// `409 VENDOR_SESSION_INVALID`).
  ///
  @JsonKey(name: 'vendor_session_id')
  final String? vendorSessionId;

  /// Refusé : présent → `422 VALIDATION_FAILED`, rien n'est écrit. La preuve du `SUPERVISOR` passe par.
  /// l'en-tête `X-Approval-Token` seulement (paramètre `ApprovalToken`) : dans le corps, elle rendrait.
  /// l'empreinte de la requête (`act_hash`) circulaire.
  ///
  @JsonKey(name: 'supervisor_pin_proof')
  final String? supervisorPinProof;

  Map<String, Object?> toJson() => _$ReversalRequestToJson(this);
}
