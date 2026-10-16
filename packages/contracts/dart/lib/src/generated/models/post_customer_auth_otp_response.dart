// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'post_customer_auth_otp_response.g.dart';

@JsonSerializable()
class PostCustomerAuthOtpResponse {
  const PostCustomerAuthOtpResponse({
    required this.otpRequestId,
    required this.expiresIn,
  });

  factory PostCustomerAuthOtpResponse.fromJson(Map<String, Object?> json) =>
      _$PostCustomerAuthOtpResponseFromJson(json);

  @JsonKey(name: 'otp_request_id')
  final String otpRequestId;
  @JsonKey(name: 'expires_in')
  final int expiresIn;

  Map<String, Object?> toJson() => _$PostCustomerAuthOtpResponseToJson(this);
}
