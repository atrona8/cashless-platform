// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'cash_sessions_cash_session_id_counts_request_body.g.dart';

@JsonSerializable()
class CashSessionsCashSessionIdCountsRequestBody {
  const CashSessionsCashSessionIdCountsRequestBody({
    required this.countedAmount,
    required this.countedAt,
    this.note,
  });

  factory CashSessionsCashSessionIdCountsRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$CashSessionsCashSessionIdCountsRequestBodyFromJson(json);

  @JsonKey(name: 'counted_amount')
  final int countedAmount;
  @JsonKey(name: 'counted_at')
  final Timestamp countedAt;
  final String? note;

  Map<String, Object?> toJson() =>
      _$CashSessionsCashSessionIdCountsRequestBodyToJson(this);
}
