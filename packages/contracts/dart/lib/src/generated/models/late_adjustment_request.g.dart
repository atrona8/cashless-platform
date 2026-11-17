// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'late_adjustment_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LateAdjustmentRequest _$LateAdjustmentRequestFromJson(
  Map<String, dynamic> json,
) => LateAdjustmentRequest(
  beneficiaryPartyId: json['beneficiary_party_id'] as String,
  amount: (json['amount'] as num).toInt(),
  currency: json['currency'] as String,
  reason: json['reason'] as String,
);

Map<String, dynamic> _$LateAdjustmentRequestToJson(
  LateAdjustmentRequest instance,
) => <String, dynamic>{
  'beneficiary_party_id': instance.beneficiaryPartyId,
  'amount': instance.amount,
  'currency': instance.currency,
  'reason': instance.reason,
};
