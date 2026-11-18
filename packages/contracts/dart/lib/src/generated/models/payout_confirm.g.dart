// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payout_confirm.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PayoutConfirm _$PayoutConfirmFromJson(Map<String, dynamic> json) =>
    PayoutConfirm(
      outcome: $enumDecode(_$PayoutConfirmOutcomeEnumMap, json['outcome']),
      externalReference: json['external_reference'] as String?,
      failureReason: json['failure_reason'] as String?,
    );

Map<String, dynamic> _$PayoutConfirmToJson(PayoutConfirm instance) =>
    <String, dynamic>{
      'outcome': instance.outcome,
      'external_reference': instance.externalReference,
      'failure_reason': instance.failureReason,
    };

const _$PayoutConfirmOutcomeEnumMap = {
  PayoutConfirmOutcome.confirmed: 'CONFIRMED',
  PayoutConfirmOutcome.failed: 'FAILED',
};
