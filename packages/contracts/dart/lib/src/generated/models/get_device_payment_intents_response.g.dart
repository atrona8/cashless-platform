// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_device_payment_intents_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetDevicePaymentIntentsResponse _$GetDevicePaymentIntentsResponseFromJson(
  Map<String, dynamic> json,
) => GetDevicePaymentIntentsResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => PaymentIntent.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetDevicePaymentIntentsResponseToJson(
  GetDevicePaymentIntentsResponse instance,
) => <String, dynamic>{'data': instance.data};
