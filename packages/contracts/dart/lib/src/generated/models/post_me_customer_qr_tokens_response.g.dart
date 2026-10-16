// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_me_customer_qr_tokens_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostMeCustomerQrTokensResponse _$PostMeCustomerQrTokensResponseFromJson(
  Map<String, dynamic> json,
) => PostMeCustomerQrTokensResponse(
  paymentRequestId: json['payment_request_id'] as String,
  token: json['token'] as String,
  qrPayload: json['qr_payload'] as String,
  expiresAt: DateTime.parse(json['expires_at'] as String),
);

Map<String, dynamic> _$PostMeCustomerQrTokensResponseToJson(
  PostMeCustomerQrTokensResponse instance,
) => <String, dynamic>{
  'payment_request_id': instance.paymentRequestId,
  'token': instance.token,
  'qr_payload': instance.qrPayload,
  'expires_at': instance.expiresAt.toIso8601String(),
};
