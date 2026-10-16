// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'post_me_customer_qr_tokens_response.g.dart';

@JsonSerializable()
class PostMeCustomerQrTokensResponse {
  const PostMeCustomerQrTokensResponse({
    required this.paymentRequestId,
    required this.token,
    required this.qrPayload,
    required this.expiresAt,
  });

  factory PostMeCustomerQrTokensResponse.fromJson(Map<String, Object?> json) =>
      _$PostMeCustomerQrTokensResponseFromJson(json);

  @JsonKey(name: 'payment_request_id')
  final String paymentRequestId;
  final String token;
  @JsonKey(name: 'qr_payload')
  final String qrPayload;
  @JsonKey(name: 'expires_at')
  final DateTime expiresAt;

  Map<String, Object?> toJson() => _$PostMeCustomerQrTokensResponseToJson(this);
}
