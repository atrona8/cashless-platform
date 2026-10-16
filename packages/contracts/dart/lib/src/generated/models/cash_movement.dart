// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'cash_movement.g.dart';

/// Rendu en espèces depuis la caisse de la session de caisse indiquée par la requête.
@JsonSerializable()
class CashMovement {
  const CashMovement({required this.method});

  factory CashMovement.fromJson(Map<String, Object?> json) =>
      _$CashMovementFromJson(json);

  final String method;

  Map<String, Object?> toJson() => _$CashMovementToJson(this);
}
