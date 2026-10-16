// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'errors.g.dart';

@JsonSerializable()
class Errors {
  const Errors({required this.pointer, required this.message});

  factory Errors.fromJson(Map<String, Object?> json) => _$ErrorsFromJson(json);

  /// JSON Pointer (RFC 6901) vers le champ fautif.
  final String pointer;
  final String message;

  Map<String, Object?> toJson() => _$ErrorsToJson(this);
}
