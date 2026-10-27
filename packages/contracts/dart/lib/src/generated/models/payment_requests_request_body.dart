// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'sale_line.dart';

part 'payment_requests_request_body.g.dart';

@JsonSerializable()
class PaymentRequestsRequestBody {
  const PaymentRequestsRequestBody({
    required this.amount,
    required this.currency,
    this.ttlSeconds = 60,
    this.vendorSessionId,
    this.lines,
  });

  factory PaymentRequestsRequestBody.fromJson(Map<String, Object?> json) =>
      _$PaymentRequestsRequestBodyFromJson(json);

  final Amount amount;
  final Currency currency;

  /// Session de vendeur ouverte sur ce terminal (`openVendorSession`). Requise : absente, close,.
  /// expirée ou autre que la session ouverte du terminal → `409 VENDOR_SESSION_INVALID`.
  ///
  @JsonKey(name: 'vendor_session_id')
  final String? vendorSessionId;
  @JsonKey(name: 'ttl_seconds')
  final int ttlSeconds;
  final List<SaleLine>? lines;

  Map<String, Object?> toJson() => _$PaymentRequestsRequestBodyToJson(this);
}
