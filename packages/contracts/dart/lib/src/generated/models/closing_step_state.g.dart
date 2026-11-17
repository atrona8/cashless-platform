// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'closing_step_state.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ClosingStepState _$ClosingStepStateFromJson(Map<String, dynamic> json) =>
    ClosingStepState(
      step: $enumDecode(_$ClosingStepEnumMap, json['step']),
      status: $enumDecode(_$ClosingStepStateStatusEnumMap, json['status']),
      doneBy: json['done_by'] as String?,
      doneAt: json['done_at'] == null
          ? null
          : DateTime.parse(json['done_at'] as String),
      transactionIds: (json['transaction_ids'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      summary: json['summary'],
    );

Map<String, dynamic> _$ClosingStepStateToJson(ClosingStepState instance) =>
    <String, dynamic>{
      'step': instance.step,
      'status': instance.status,
      'done_by': instance.doneBy,
      'done_at': instance.doneAt?.toIso8601String(),
      'transaction_ids': instance.transactionIds,
      'summary': instance.summary,
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

const _$ClosingStepStateStatusEnumMap = {
  ClosingStepStateStatus.todo: 'TODO',
  ClosingStepStateStatus.done: 'DONE',
  ClosingStepStateStatus.notApplicable: 'NOT_APPLICABLE',
};
