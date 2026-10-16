// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'timestamp.dart';

part 'last_count.g.dart';

@JsonSerializable()
class LastCount {
  const LastCount({
    required this.countedAmount,
    required this.countedAt,
    required this.countedBy,
  });

  factory LastCount.fromJson(Map<String, Object?> json) =>
      _$LastCountFromJson(json);

  @JsonKey(name: 'counted_amount')
  final int countedAmount;
  @JsonKey(name: 'counted_at')
  final Timestamp countedAt;
  @JsonKey(name: 'counted_by')
  final String countedBy;

  Map<String, Object?> toJson() => _$LastCountToJson(this);
}
