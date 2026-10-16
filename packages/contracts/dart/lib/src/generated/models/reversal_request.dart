// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'reversal_request_reason.dart';
import 'timestamp.dart';

part 'reversal_request.g.dart';

@JsonSerializable()
class ReversalRequest {
  const ReversalRequest({
    required this.reason,
    required this.occurredAt,
    this.comment,
    this.supervisorPinProof,
  });

  factory ReversalRequest.fromJson(Map<String, Object?> json) =>
      _$ReversalRequestFromJson(json);

  final ReversalRequestReason reason;
  final String? comment;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;

  /// Preuve de validation superviseur au-delà de la fenêtre (jeton court signé).
  @JsonKey(name: 'supervisor_pin_proof')
  final String? supervisorPinProof;

  Map<String, Object?> toJson() => _$ReversalRequestToJson(this);
}
