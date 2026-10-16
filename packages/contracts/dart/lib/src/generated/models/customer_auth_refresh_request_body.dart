// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'customer_auth_refresh_request_body.g.dart';

@JsonSerializable()
class CustomerAuthRefreshRequestBody {
  const CustomerAuthRefreshRequestBody({required this.refreshToken});

  factory CustomerAuthRefreshRequestBody.fromJson(Map<String, Object?> json) =>
      _$CustomerAuthRefreshRequestBodyFromJson(json);

  @JsonKey(name: 'refresh_token')
  final String refreshToken;

  Map<String, Object?> toJson() => _$CustomerAuthRefreshRequestBodyToJson(this);
}
