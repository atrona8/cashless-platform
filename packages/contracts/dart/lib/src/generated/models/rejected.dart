// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'reason3.dart';

part 'rejected.g.dart';

@JsonSerializable()
class Rejected {
  const Rejected({required this.line, required this.reason});

  factory Rejected.fromJson(Map<String, Object?> json) =>
      _$RejectedFromJson(json);

  /// Numéro de la ligne dans le fichier (1 = première ligne).
  final int line;
  final Reason3 reason;

  Map<String, Object?> toJson() => _$RejectedToJson(this);
}
