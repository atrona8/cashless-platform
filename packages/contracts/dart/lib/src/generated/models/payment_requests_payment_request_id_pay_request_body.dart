// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'payment_requests_payment_request_id_pay_request_body.g.dart';

@JsonSerializable()
class PaymentRequestsPaymentRequestIdPayRequestBody {
  const PaymentRequestsPaymentRequestIdPayRequestBody({
    required this.token,
    required this.walletId,
  });

  factory PaymentRequestsPaymentRequestIdPayRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$PaymentRequestsPaymentRequestIdPayRequestBodyFromJson(json);

  final String token;
  @JsonKey(name: 'wallet_id')
  final String walletId;

  Map<String, Object?> toJson() =>
      _$PaymentRequestsPaymentRequestIdPayRequestBodyToJson(this);
}
