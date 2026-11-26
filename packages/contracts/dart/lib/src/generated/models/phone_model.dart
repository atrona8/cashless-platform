// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'phone_model_nfc_level.dart';
import 'timestamp.dart';

part 'phone_model.g.dart';

/// Modèle de téléphone testé (table de la plateforme).
@JsonSerializable()
class PhoneModel {
  const PhoneModel({
    required this.manufacturer,
    required this.model,
    required this.nfcLevel,
    required this.measuredAt,
    required this.updatedAt,
  });

  factory PhoneModel.fromJson(Map<String, Object?> json) =>
      _$PhoneModelFromJson(json);

  final String manufacturer;
  final String model;
  @JsonKey(name: 'nfc_level')
  final PhoneModelNfcLevel nfcLevel;
  @JsonKey(name: 'measured_at')
  final DateTime measuredAt;
  @JsonKey(name: 'updated_at')
  final Timestamp updatedAt;

  Map<String, Object?> toJson() => _$PhoneModelToJson(this);
}
