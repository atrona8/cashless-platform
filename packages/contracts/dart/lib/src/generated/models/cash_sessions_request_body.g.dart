// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cash_sessions_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CashSessionsRequestBody _$CashSessionsRequestBodyFromJson(
  Map<String, dynamic> json,
) => CashSessionsRequestBody(
  cashAccountId: json['cash_account_id'] as String,
  deviceId: json['device_id'] as String?,
);

Map<String, dynamic> _$CashSessionsRequestBodyToJson(
  CashSessionsRequestBody instance,
) => <String, dynamic>{
  'cash_account_id': instance.cashAccountId,
  'device_id': instance.deviceId,
};
