// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'money_movement_method.dart';

part 'money_movement.g.dart';

/// Moyen d'encaissement / de restitution hors portefeuille. Pour un remboursement : jamais `CARD` en V1 ;.
/// mobile money vers un numéro autre que le numéro vérifié du titulaire : conditions d'ADR-76.
///
@JsonSerializable()
class MoneyMovement {
  const MoneyMovement({required this.method, this.msisdn});

  factory MoneyMovement.fromJson(Map<String, Object?> json) =>
      _$MoneyMovementFromJson(json);

  final MoneyMovementMethod method;
  final String? msisdn;

  Map<String, Object?> toJson() => _$MoneyMovementToJson(this);
}
