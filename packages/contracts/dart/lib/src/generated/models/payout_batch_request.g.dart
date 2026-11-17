// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payout_batch_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PayoutBatchRequest _$PayoutBatchRequestFromJson(Map<String, dynamic> json) =>
    PayoutBatchRequest(
      lines: (json['lines'] as List<dynamic>)
          .map((e) => PayoutLine.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$PayoutBatchRequestToJson(PayoutBatchRequest instance) =>
    <String, dynamic>{'lines': instance.lines};
