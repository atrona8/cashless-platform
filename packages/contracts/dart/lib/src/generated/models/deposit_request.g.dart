// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'deposit_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DepositRequest _$DepositRequestFromJson(Map<String, dynamic> json) =>
    DepositRequest(
      tapId: (json['tap_id'] as num?)?.toInt(),
      tap: json['tap'] == null
          ? null
          : TapInput.fromJson(json['tap'] as Map<String, dynamic>),
      payment: json['payment'] == null
          ? null
          : MoneyMovement.fromJson(json['payment'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$DepositRequestToJson(DepositRequest instance) =>
    <String, dynamic>{
      'tap_id': instance.tapId,
      'tap': instance.tap,
      'payment': instance.payment,
    };
