// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'anomaly_classification_create.g.dart';

@JsonSerializable()
class AnomalyClassificationCreate {
  const AnomalyClassificationCreate({required this.reason});

  factory AnomalyClassificationCreate.fromJson(Map<String, Object?> json) =>
      _$AnomalyClassificationCreateFromJson(json);

  /// Motif du classement.
  final String reason;

  Map<String, Object?> toJson() => _$AnomalyClassificationCreateToJson(this);
}
