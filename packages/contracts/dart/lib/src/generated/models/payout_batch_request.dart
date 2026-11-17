// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'payout_line.dart';

part 'payout_batch_request.g.dart';

/// Lot de versements à faire approuver. La charge est figée à la création de la demande.
@JsonSerializable()
class PayoutBatchRequest {
  const PayoutBatchRequest({required this.lines});

  factory PayoutBatchRequest.fromJson(Map<String, Object?> json) =>
      _$PayoutBatchRequestFromJson(json);

  final List<PayoutLine> lines;

  Map<String, Object?> toJson() => _$PayoutBatchRequestToJson(this);
}
