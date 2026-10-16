// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'event_update_activation_modes.dart';
import 'event_update_identity_mode.dart';
import 'event_update_issuer.dart';
import 'event_update_lost_media_policy.dart';
import 'funds_holder.dart';

part 'event_update.g.dart';

/// Modification d'un événement ; au moins une clé. Clés de l'`ORGANIZER_ADMIN` : `name`, `starts_at`, `ends_at`,.
/// `refund_deadline`, `jurisdiction_id`, `contract_id`, `funds_holder`, `funds_holder_party_id`, `issuer`,.
/// `identity_mode`, `activation_modes`, `lost_media_policy`, `cash_refund_single_max`,.
/// `reversal_window_minutes`. Clés de l'`OPERATOR_ADMIN` : toutes les autres. Devise, fuseau et organisateur ne.
/// changent pas ; `funds_holder` et `issuer` seulement en `DRAFT`.
///
@JsonSerializable()
class EventUpdate {
  const EventUpdate({
    this.name,
    this.startsAt,
    this.endsAt,
    this.refundDeadline,
    this.jurisdictionId,
    this.contractId,
    this.fundsHolder,
    this.fundsHolderPartyId,
    this.issuer,
    this.identityMode,
    this.activationModes,
    this.lostMediaPolicy,
    this.cashRefundSingleMax,
    this.reversalWindowMinutes,
    this.tapReplayWindowSeconds,
    this.syncDeadlineHours,
    this.refundNewNumberMax,
    this.refundNewNumberHoldHours,
    this.cardTopupDailyMaxPerCard,
    this.cardAlertCardsPerWallet,
    this.onlineConnectTimeoutMs,
    this.onlineTotalTimeoutMs,
    this.onlineRetries,
    this.pendingSyncSeconds,
    this.reconcileSyncSeconds,
    this.heartbeatSeconds,
    this.localRetentionDays,
  });

  factory EventUpdate.fromJson(Map<String, Object?> json) =>
      _$EventUpdateFromJson(json);

  final String? name;
  @JsonKey(name: 'starts_at')
  final DateTime? startsAt;
  @JsonKey(name: 'ends_at')
  final DateTime? endsAt;
  @JsonKey(name: 'refund_deadline')
  final DateTime? refundDeadline;
  @JsonKey(name: 'jurisdiction_id')
  final String? jurisdictionId;
  @JsonKey(name: 'contract_id')
  final String? contractId;
  @JsonKey(name: 'funds_holder')
  final FundsHolder? fundsHolder;
  @JsonKey(name: 'funds_holder_party_id')
  final String? fundsHolderPartyId;
  final EventUpdateIssuer? issuer;
  @JsonKey(name: 'identity_mode')
  final EventUpdateIdentityMode? identityMode;
  @JsonKey(name: 'activation_modes')
  final List<EventUpdateActivationModes>? activationModes;
  @JsonKey(name: 'lost_media_policy')
  final EventUpdateLostMediaPolicy? lostMediaPolicy;
  @JsonKey(name: 'cash_refund_single_max')
  final int? cashRefundSingleMax;
  @JsonKey(name: 'reversal_window_minutes')
  final int? reversalWindowMinutes;
  @JsonKey(name: 'tap_replay_window_seconds')
  final int? tapReplayWindowSeconds;
  @JsonKey(name: 'sync_deadline_hours')
  final int? syncDeadlineHours;
  @JsonKey(name: 'refund_new_number_max')
  final int? refundNewNumberMax;
  @JsonKey(name: 'refund_new_number_hold_hours')
  final int? refundNewNumberHoldHours;
  @JsonKey(name: 'card_topup_daily_max_per_card')
  final int? cardTopupDailyMaxPerCard;
  @JsonKey(name: 'card_alert_cards_per_wallet')
  final int? cardAlertCardsPerWallet;
  @JsonKey(name: 'online_connect_timeout_ms')
  final int? onlineConnectTimeoutMs;
  @JsonKey(name: 'online_total_timeout_ms')
  final int? onlineTotalTimeoutMs;
  @JsonKey(name: 'online_retries')
  final int? onlineRetries;
  @JsonKey(name: 'pending_sync_seconds')
  final int? pendingSyncSeconds;
  @JsonKey(name: 'reconcile_sync_seconds')
  final int? reconcileSyncSeconds;
  @JsonKey(name: 'heartbeat_seconds')
  final int? heartbeatSeconds;
  @JsonKey(name: 'local_retention_days')
  final int? localRetentionDays;

  Map<String, Object?> toJson() => _$EventUpdateToJson(this);
}
