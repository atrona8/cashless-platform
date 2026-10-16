// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'event_update.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EventUpdate _$EventUpdateFromJson(Map<String, dynamic> json) => EventUpdate(
  name: json['name'] as String?,
  startsAt: json['starts_at'] == null
      ? null
      : DateTime.parse(json['starts_at'] as String),
  endsAt: json['ends_at'] == null
      ? null
      : DateTime.parse(json['ends_at'] as String),
  refundDeadline: json['refund_deadline'] == null
      ? null
      : DateTime.parse(json['refund_deadline'] as String),
  jurisdictionId: json['jurisdiction_id'] as String?,
  contractId: json['contract_id'] as String?,
  fundsHolder: $enumDecodeNullable(_$FundsHolderEnumMap, json['funds_holder']),
  fundsHolderPartyId: json['funds_holder_party_id'] as String?,
  issuer: $enumDecodeNullable(_$EventUpdateIssuerEnumMap, json['issuer']),
  identityMode: $enumDecodeNullable(
    _$EventUpdateIdentityModeEnumMap,
    json['identity_mode'],
  ),
  activationModes: (json['activation_modes'] as List<dynamic>?)
      ?.map((e) => $enumDecode(_$EventUpdateActivationModesEnumMap, e))
      .toList(),
  lostMediaPolicy: $enumDecodeNullable(
    _$EventUpdateLostMediaPolicyEnumMap,
    json['lost_media_policy'],
  ),
  cashRefundSingleMax: (json['cash_refund_single_max'] as num?)?.toInt(),
  reversalWindowMinutes: (json['reversal_window_minutes'] as num?)?.toInt(),
  tapReplayWindowSeconds: (json['tap_replay_window_seconds'] as num?)?.toInt(),
  syncDeadlineHours: (json['sync_deadline_hours'] as num?)?.toInt(),
  refundNewNumberMax: (json['refund_new_number_max'] as num?)?.toInt(),
  refundNewNumberHoldHours: (json['refund_new_number_hold_hours'] as num?)
      ?.toInt(),
  cardTopupDailyMaxPerCard: (json['card_topup_daily_max_per_card'] as num?)
      ?.toInt(),
  cardAlertCardsPerWallet: (json['card_alert_cards_per_wallet'] as num?)
      ?.toInt(),
  onlineConnectTimeoutMs: (json['online_connect_timeout_ms'] as num?)?.toInt(),
  onlineTotalTimeoutMs: (json['online_total_timeout_ms'] as num?)?.toInt(),
  onlineRetries: (json['online_retries'] as num?)?.toInt(),
  pendingSyncSeconds: (json['pending_sync_seconds'] as num?)?.toInt(),
  reconcileSyncSeconds: (json['reconcile_sync_seconds'] as num?)?.toInt(),
  heartbeatSeconds: (json['heartbeat_seconds'] as num?)?.toInt(),
  localRetentionDays: (json['local_retention_days'] as num?)?.toInt(),
);

Map<String, dynamic> _$EventUpdateToJson(EventUpdate instance) =>
    <String, dynamic>{
      'name': instance.name,
      'starts_at': instance.startsAt?.toIso8601String(),
      'ends_at': instance.endsAt?.toIso8601String(),
      'refund_deadline': instance.refundDeadline?.toIso8601String(),
      'jurisdiction_id': instance.jurisdictionId,
      'contract_id': instance.contractId,
      'funds_holder': instance.fundsHolder,
      'funds_holder_party_id': instance.fundsHolderPartyId,
      'issuer': instance.issuer,
      'identity_mode': instance.identityMode,
      'activation_modes': instance.activationModes,
      'lost_media_policy': instance.lostMediaPolicy,
      'cash_refund_single_max': instance.cashRefundSingleMax,
      'reversal_window_minutes': instance.reversalWindowMinutes,
      'tap_replay_window_seconds': instance.tapReplayWindowSeconds,
      'sync_deadline_hours': instance.syncDeadlineHours,
      'refund_new_number_max': instance.refundNewNumberMax,
      'refund_new_number_hold_hours': instance.refundNewNumberHoldHours,
      'card_topup_daily_max_per_card': instance.cardTopupDailyMaxPerCard,
      'card_alert_cards_per_wallet': instance.cardAlertCardsPerWallet,
      'online_connect_timeout_ms': instance.onlineConnectTimeoutMs,
      'online_total_timeout_ms': instance.onlineTotalTimeoutMs,
      'online_retries': instance.onlineRetries,
      'pending_sync_seconds': instance.pendingSyncSeconds,
      'reconcile_sync_seconds': instance.reconcileSyncSeconds,
      'heartbeat_seconds': instance.heartbeatSeconds,
      'local_retention_days': instance.localRetentionDays,
    };

const _$FundsHolderEnumMap = {
  FundsHolder.organizer: 'ORGANIZER',
  FundsHolder.valueOperator: 'OPERATOR',
  FundsHolder.thirdParty: 'THIRD_PARTY',
};

const _$EventUpdateIssuerEnumMap = {
  EventUpdateIssuer.organizer: 'ORGANIZER',
  EventUpdateIssuer.valueOperator: 'OPERATOR',
};

const _$EventUpdateIdentityModeEnumMap = {
  EventUpdateIdentityMode.anonymousAllowed: 'ANONYMOUS_ALLOWED',
  EventUpdateIdentityMode.accountRequired: 'ACCOUNT_REQUIRED',
};

const _$EventUpdateActivationModesEnumMap = {
  EventUpdateActivationModes.desk: 'DESK',
  EventUpdateActivationModes.selfApp: 'SELF_APP',
  EventUpdateActivationModes.firstTopup: 'FIRST_TOPUP',
};

const _$EventUpdateLostMediaPolicyEnumMap = {
  EventUpdateLostMediaPolicy.endOfLife: 'END_OF_LIFE',
  EventUpdateLostMediaPolicy.reactivate: 'REACTIVATE',
};
