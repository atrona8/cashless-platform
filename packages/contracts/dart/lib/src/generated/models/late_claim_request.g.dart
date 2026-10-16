// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'late_claim_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LateClaimRequest _$LateClaimRequestFromJson(Map<String, dynamic> json) =>
    LateClaimRequest(
      walletId: json['wallet_id'] as String,
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      proof: Proof.fromJson(json['proof'] as Map<String, dynamic>),
      destination: Destination.fromJson(
        json['destination'] as Map<String, dynamic>,
      ),
      reason: json['reason'] as String,
    );

Map<String, dynamic> _$LateClaimRequestToJson(LateClaimRequest instance) =>
    <String, dynamic>{
      'wallet_id': instance.walletId,
      'amount': instance.amount,
      'currency': instance.currency,
      'proof': instance.proof,
      'destination': instance.destination,
      'reason': instance.reason,
    };
