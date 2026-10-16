// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'new_number_otp.g.dart';

@JsonSerializable()
class NewNumberOtp {
  const NewNumberOtp({required this.otpRequestId, required this.code});

  factory NewNumberOtp.fromJson(Map<String, Object?> json) =>
      _$NewNumberOtpFromJson(json);

  @JsonKey(name: 'otp_request_id')
  final String otpRequestId;
  final String code;

  Map<String, Object?> toJson() => _$NewNumberOtpToJson(this);
}
