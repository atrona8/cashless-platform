// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'payment_intent.dart';

part 'get_device_payment_intents_response.g.dart';

@JsonSerializable()
class GetDevicePaymentIntentsResponse {
  const GetDevicePaymentIntentsResponse({required this.data});

  factory GetDevicePaymentIntentsResponse.fromJson(Map<String, Object?> json) =>
      _$GetDevicePaymentIntentsResponseFromJson(json);

  final List<PaymentIntent> data;

  Map<String, Object?> toJson() =>
      _$GetDevicePaymentIntentsResponseToJson(this);
}
