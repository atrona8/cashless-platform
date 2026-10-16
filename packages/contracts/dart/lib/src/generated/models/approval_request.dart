// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'approval_action.dart';
import 'approval_request_status.dart';
import 'problem_code.dart';

part 'approval_request.g.dart';

/// Demande d'approbation du back-office (`approval_request`, schéma section 18h). Le contenu (`action`,.
/// `target_id`, `payload`, auteur, dates) est figé à la création. `payload` contient les paramètres exacts de.
/// l'opération (chemin et corps), et la clé d'idempotence de l'appel qui a créé la demande, réutilisée pour.
/// les écritures de l'exécution : l'action n'est écrite qu'une fois.
///
@JsonSerializable()
class ApprovalRequest {
  const ApprovalRequest({
    required this.approvalRequestId,
    required this.action,
    required this.payload,
    required this.requestedBy,
    required this.requestedAt,
    required this.expiresAt,
    required this.status,
    this.targetId,
    this.decidedBy,
    this.decidedAt,
    this.decisionNote,
    this.executedTxId,
    this.result,
    this.failureCode,
    this.failureReason,
  });

  factory ApprovalRequest.fromJson(Map<String, Object?> json) =>
      _$ApprovalRequestFromJson(json);

  @JsonKey(name: 'approval_request_id')
  final String approvalRequestId;
  final ApprovalAction action;

  /// Objet visé (terminal, identification, grand livre, demande de remboursement…).
  @JsonKey(name: 'target_id')
  final String? targetId;

  /// Paramètres exacts de l'action, figés.
  final dynamic payload;

  /// Auteur (`sub` de la session qui a créé la demande).
  @JsonKey(name: 'requested_by')
  final String requestedBy;
  @JsonKey(name: 'requested_at')
  final DateTime requestedAt;

  /// `requested_at` + 24 h.
  @JsonKey(name: 'expires_at')
  final DateTime expiresAt;
  final ApprovalRequestStatus status;

  /// Valideur (`sub` de la session de la seconde personne), toujours ≠ `requested_by`.
  @JsonKey(name: 'decided_by')
  final String? decidedBy;
  @JsonKey(name: 'decided_at')
  final DateTime? decidedAt;
  @JsonKey(name: 'decision_note')
  final String? decisionNote;

  /// Transaction écrite par l'exécution, s'il y en a une.
  @JsonKey(name: 'executed_tx_id')
  final String? executedTxId;

  /// Si `EXECUTED` : réponse de l'opération exécutée (`SeqStatus`, `DeviceJournalImportResult`,.
  /// `KycVerification`, `RefundRequest`, `LateClaimResult`, `DebitAuthorityState` selon l'action).
  ///
  final dynamic result;

  /// Si `FAILED` : code du refus à l'exécution.
  @JsonKey(name: 'failure_code')
  final ProblemCode? failureCode;

  /// Si `FAILED` : raison lisible.
  @JsonKey(name: 'failure_reason')
  final String? failureReason;

  Map<String, Object?> toJson() => _$ApprovalRequestToJson(this);
}
