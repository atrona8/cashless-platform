// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'provisional_fields.g.dart';

@JsonSerializable()
class ProvisionalFields {
  const ProvisionalFields({required this.field, required this.confirmBy});

  factory ProvisionalFields.fromJson(Map<String, Object?> json) =>
      _$ProvisionalFieldsFromJson(json);

  final String field;

  /// Personne qui doit confirmer la valeur (juriste, expert-comptable, porteur).
  @JsonKey(name: 'confirm_by')
  final String confirmBy;

  Map<String, Object?> toJson() => _$ProvisionalFieldsToJson(this);
}
