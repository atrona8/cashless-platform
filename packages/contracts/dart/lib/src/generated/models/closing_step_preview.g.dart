// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'closing_step_preview.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ClosingStepPreview _$ClosingStepPreviewFromJson(Map<String, dynamic> json) =>
    ClosingStepPreview(
      eventId: json['event_id'] as String,
      step: $enumDecode(_$ClosingStepEnumMap, json['step']),
      currency: json['currency'] as String,
      applicable: json['applicable'] as bool,
      lines: (json['lines'] as List<dynamic>)
          .map((e) => Lines.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: (json['total'] as num).toInt(),
    );

Map<String, dynamic> _$ClosingStepPreviewToJson(ClosingStepPreview instance) =>
    <String, dynamic>{
      'event_id': instance.eventId,
      'step': instance.step,
      'currency': instance.currency,
      'applicable': instance.applicable,
      'lines': instance.lines,
      'total': instance.total,
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
