// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum AnomalyKind {
  @JsonValue('OFFLINE_SHORTFALL')
  offlineShortfall('OFFLINE_SHORTFALL'),
  @JsonValue('COUNTER_DUPLICATE')
  counterDuplicate('COUNTER_DUPLICATE'),
  @JsonValue('COUNTER_TIME_INVERSION')
  counterTimeInversion('COUNTER_TIME_INVERSION'),
  @JsonValue('UID_MISMATCH')
  uidMismatch('UID_MISMATCH'),
  @JsonValue('RETIRED_IDENTITY')
  retiredIdentity('RETIRED_IDENTITY'),
  @JsonValue('SEQ_GAP')
  seqGap('SEQ_GAP'),
  @JsonValue('CHAIN_BROKEN')
  chainBroken('CHAIN_BROKEN'),
  @JsonValue('CLOCK_SKEW')
  clockSkew('CLOCK_SKEW'),
  @JsonValue('VOID_CONFLICT')
  voidConflict('VOID_CONFLICT'),
  @JsonValue('ONLINE_CONFIRMED_MISSING')
  onlineConfirmedMissing('ONLINE_CONFIRMED_MISSING'),
  @JsonValue('IDEMPOTENCY_CONFLICT')
  idempotencyConflict('IDEMPOTENCY_CONFLICT'),
  @JsonValue('NON_COMPLIANT_OPERATION')
  nonCompliantOperation('NON_COMPLIANT_OPERATION'),
  @JsonValue('PERIOD_CLOSED_OPERATION')
  periodClosedOperation('PERIOD_CLOSED_OPERATION'),
  @JsonValue('LATE_OFFLINE_SYNC')
  lateOfflineSync('LATE_OFFLINE_SYNC'),
  @JsonValue('SIGNATURE_MISMATCH')
  signatureMismatch('SIGNATURE_MISMATCH'),
  @JsonValue('CASH_TOPUP_OVER_LIMIT')
  cashTopupOverLimit('CASH_TOPUP_OVER_LIMIT'),
  @JsonValue('CASH_DIFF')
  cashDiff('CASH_DIFF'),
  @JsonValue('PSP_MISMATCH')
  pspMismatch('PSP_MISMATCH'),
  @JsonValue('PSP_TOPUP_OVER_LIMIT')
  pspTopupOverLimit('PSP_TOPUP_OVER_LIMIT'),
  @JsonValue('EDGE_REPLAY_FAILED')
  edgeReplayFailed('EDGE_REPLAY_FAILED'),
  @JsonValue('LATE_CHARGEBACK')
  lateChargeback('LATE_CHARGEBACK'),
  @JsonValue('CARD_VELOCITY')
  cardVelocity('CARD_VELOCITY'),
  @JsonValue('PSP_TOPUP_NOT_CREDITED')
  pspTopupNotCredited('PSP_TOPUP_NOT_CREDITED');

  const AnomalyKind(this.json);

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
