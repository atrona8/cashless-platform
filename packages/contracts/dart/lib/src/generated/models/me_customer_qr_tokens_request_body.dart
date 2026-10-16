// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'me_customer_qr_tokens_request_body.g.dart';

@JsonSerializable()
class MeCustomerQrTokensRequestBody {
  const MeCustomerQrTokensRequestBody({required this.walletId});

  factory MeCustomerQrTokensRequestBody.fromJson(Map<String, Object?> json) =>
      _$MeCustomerQrTokensRequestBodyFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;

  Map<String, Object?> toJson() => _$MeCustomerQrTokensRequestBodyToJson(this);
}
