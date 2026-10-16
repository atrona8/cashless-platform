// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'customer_auth_token_request_body.g.dart';

@JsonSerializable()
class CustomerAuthTokenRequestBody {
  const CustomerAuthTokenRequestBody({
    required this.otpRequestId,
    required this.code,
  });

  factory CustomerAuthTokenRequestBody.fromJson(Map<String, Object?> json) =>
      _$CustomerAuthTokenRequestBodyFromJson(json);

  @JsonKey(name: 'otp_request_id')
  final String otpRequestId;
  final String code;

  Map<String, Object?> toJson() => _$CustomerAuthTokenRequestBodyToJson(this);
}
