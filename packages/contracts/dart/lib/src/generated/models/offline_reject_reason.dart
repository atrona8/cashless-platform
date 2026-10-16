// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Raison de rejet d'une opération de lot (sync_protocol.md §7.1, §7.2, §7.3). `MEDIA_NOT_IN_SNAPSHOT` :.
/// bracelet absent du snapshot utilisé, ou inconnu / non activé au serveur (`MEDIA_UNKNOWN` est réservé au.
/// chemin en ligne). `INSUFFICIENT_FUNDS_RETRY` : 4ᵉ `CL007` consécutif (débits concurrents) ; rien.
/// n'est écrit, `retryable = true`, le terminal renvoie l'opération dans un lot ultérieur.
/// `SYNC_DEADLINE_PASSED` : synchronisation reçue alors que l'événement est en `SETTLING` ou au-delà (ADR-49) ;.
/// rien n'est écrit, `retryable = false` ; le commerçant reste garanti par une écriture du back-office.
/// `PERIOD_CLOSED` et `LEDGER_LOCKED` ne sont pas des fautes du terminal (traitement manuel).
/// `EDGE_REPLAY_FAILED` : lot de passerelle seulement ; rejeu impossible d'une `ACTIVATION` ou d'un.
/// `DEPOSIT_CASH` (`detail` donne le code de l'échec ; sync_protocol.md §9.6).
/// `SEQ_OUT_OF_RANGE` n'est pas une raison par opération : le lot entier est refusé (`409`).
///
@JsonEnum()
enum OfflineRejectReason {
  @JsonValue('IDEMPOTENCY_KEY_REUSED')
  idempotencyKeyReused('IDEMPOTENCY_KEY_REUSED'),
  @JsonValue('MALFORMED_OPERATION')
  malformedOperation('MALFORMED_OPERATION'),
  @JsonValue('CURRENCY_MISMATCH')
  currencyMismatch('CURRENCY_MISMATCH'),
  @JsonValue('OFFLINE_NOT_ALLOWED')
  offlineNotAllowed('OFFLINE_NOT_ALLOWED'),
  @JsonValue('POLICY_LIMIT_EXCEEDED')
  policyLimitExceeded('POLICY_LIMIT_EXCEEDED'),
  @JsonValue('SNAPSHOT_TOO_OLD')
  snapshotTooOld('SNAPSHOT_TOO_OLD'),
  @JsonValue('SNAPSHOT_VERSION_UNKNOWN')
  snapshotVersionUnknown('SNAPSHOT_VERSION_UNKNOWN'),
  @JsonValue('MEDIA_NOT_IN_SNAPSHOT')
  mediaNotInSnapshot('MEDIA_NOT_IN_SNAPSHOT'),
  @JsonValue('MEDIA_BLOCKED_IN_SNAPSHOT')
  mediaBlockedInSnapshot('MEDIA_BLOCKED_IN_SNAPSHOT'),
  @JsonValue('MEDIA_WRONG_EVENT')
  mediaWrongEvent('MEDIA_WRONG_EVENT'),
  @JsonValue('PACK_NOT_VERIFIED')
  packNotVerified('PACK_NOT_VERIFIED'),
  @JsonValue('REVERSAL_TARGET_NOT_FOUND')
  reversalTargetNotFound('REVERSAL_TARGET_NOT_FOUND'),
  @JsonValue('ALREADY_REVERSED')
  alreadyReversed('ALREADY_REVERSED'),
  @JsonValue('PERIOD_CLOSED')
  periodClosed('PERIOD_CLOSED'),
  @JsonValue('LEDGER_LOCKED')
  ledgerLocked('LEDGER_LOCKED'),
  @JsonValue('WALLET_LIMIT_EXCEEDED')
  walletLimitExceeded('WALLET_LIMIT_EXCEEDED'),
  @JsonValue('INSUFFICIENT_FUNDS_RETRY')
  insufficientFundsRetry('INSUFFICIENT_FUNDS_RETRY'),
  @JsonValue('SYNC_DEADLINE_PASSED')
  syncDeadlinePassed('SYNC_DEADLINE_PASSED'),
  @JsonValue('EDGE_REPLAY_FAILED')
  edgeReplayFailed('EDGE_REPLAY_FAILED');

  const OfflineRejectReason(this.json);

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError(
        'Cannot convert enum value with null JSON representation to String. '
        'This usually happens for \$unknown or @JsonValue(null) entries.',
      );
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
}
