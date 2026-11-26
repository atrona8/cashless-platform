// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'anomaly.dart';

part 'anomaly_page.g.dart';

@JsonSerializable()
class AnomalyPage {
  const AnomalyPage({
    required this.data,
    required this.nextCursor,
    required this.hasMore,
  });

  factory AnomalyPage.fromJson(Map<String, Object?> json) =>
      _$AnomalyPageFromJson(json);

  final List<Anomaly> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$AnomalyPageToJson(this);
}
