// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'closing_step_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ClosingStepResult _$ClosingStepResultFromJson(Map<String, dynamic> json) =>
    ClosingStepResult(
      eventId: json['event_id'] as String,
      step: $enumDecode(_$ClosingStepEnumMap, json['step']),
      status: $enumDecode(_$ClosingStepResultStatusEnumMap, json['status']),
      transactionIds: (json['transaction_ids'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      summary: json['summary'],
      doneBy: json['done_by'] as String?,
      doneAt: json['done_at'] == null
          ? null
          : DateTime.parse(json['done_at'] as String),
    );

Map<String, dynamic> _$ClosingStepResultToJson(ClosingStepResult instance) =>
    <String, dynamic>{
      'event_id': instance.eventId,
      'step': instance.step,
      'status': instance.status,
      'transaction_ids': instance.transactionIds,
      'summary': instance.summary,
      'done_by': instance.doneBy,
      'done_at': instance.doneAt?.toIso8601String(),
    };

const _$ClosingStepEnumMap = {
  ClosingStep.pitchFees: 'PITCH_FEES',
  ClosingStep.operatorFee: 'OPERATOR_FEE',
  ClosingStep.platformFee: 'PLATFORM_FEE',
  ClosingStep.operatorFeeRegularization: 'OPERATOR_FEE_REGULARIZATION',
  ClosingStep.breakage: 'BREAKAGE',
  ClosingStep.depositForfeit: 'DEPOSIT_FORFEIT',
  ClosingStep.promoExpiry: 'PROMO_EXPIRY',
};

const _$ClosingStepResultStatusEnumMap = {
  ClosingStepResultStatus.done: 'DONE',
  ClosingStepResultStatus.notApplicable: 'NOT_APPLICABLE',
};
