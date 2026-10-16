// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'event_create.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EventCreate _$EventCreateFromJson(Map<String, dynamic> json) => EventCreate(
  organizerId: json['organizer_id'] as String,
  name: json['name'] as String,
  currency: json['currency'] as String,
  timezone: json['timezone'] as String,
  jurisdictionId: json['jurisdiction_id'] as String,
  fundsHolder: $enumDecode(_$FundsHolderEnumMap, json['funds_holder']),
  issuer:
      $enumDecodeNullable(_$EventCreateIssuerEnumMap, json['issuer']) ??
      EventCreateIssuer.organizer,
  startsAt: json['starts_at'] == null
      ? null
      : DateTime.parse(json['starts_at'] as String),
  endsAt: json['ends_at'] == null
      ? null
      : DateTime.parse(json['ends_at'] as String),
  refundDeadline: json['refund_deadline'] == null
      ? null
      : DateTime.parse(json['refund_deadline'] as String),
  contractId: json['contract_id'] as String?,
  fundsHolderPartyId: json['funds_holder_party_id'] as String?,
  identityMode: $enumDecodeNullable(
    _$EventCreateIdentityModeEnumMap,
    json['identity_mode'],
  ),
  activationModes: (json['activation_modes'] as List<dynamic>?)
      ?.map((e) => $enumDecode(_$EventCreateActivationModesEnumMap, e))
      .toList(),
  lostMediaPolicy: $enumDecodeNullable(
    _$EventCreateLostMediaPolicyEnumMap,
    json['lost_media_policy'],
  ),
  cashRefundSingleMax: (json['cash_refund_single_max'] as num?)?.toInt(),
  reversalWindowMinutes: (json['reversal_window_minutes'] as num?)?.toInt(),
);

Map<String, dynamic> _$EventCreateToJson(EventCreate instance) =>
    <String, dynamic>{
      'organizer_id': instance.organizerId,
      'name': instance.name,
      'currency': instance.currency,
      'timezone': instance.timezone,
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
    };

const _$FundsHolderEnumMap = {
  FundsHolder.organizer: 'ORGANIZER',
  FundsHolder.valueOperator: 'OPERATOR',
  FundsHolder.thirdParty: 'THIRD_PARTY',
};

const _$EventCreateIssuerEnumMap = {
  EventCreateIssuer.organizer: 'ORGANIZER',
  EventCreateIssuer.valueOperator: 'OPERATOR',
};

const _$EventCreateIdentityModeEnumMap = {
  EventCreateIdentityMode.anonymousAllowed: 'ANONYMOUS_ALLOWED',
  EventCreateIdentityMode.accountRequired: 'ACCOUNT_REQUIRED',
};

const _$EventCreateActivationModesEnumMap = {
  EventCreateActivationModes.desk: 'DESK',
  EventCreateActivationModes.selfApp: 'SELF_APP',
  EventCreateActivationModes.firstTopup: 'FIRST_TOPUP',
};

const _$EventCreateLostMediaPolicyEnumMap = {
  EventCreateLostMediaPolicy.endOfLife: 'END_OF_LIFE',
  EventCreateLostMediaPolicy.reactivate: 'REACTIVATE',
};
