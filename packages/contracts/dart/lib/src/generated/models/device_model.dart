// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'device_model.g.dart';

/// Modèle du terminal, déclaré par l'app (valeur informative).
@JsonSerializable()
class DeviceModel {
  const DeviceModel({required this.manufacturer, required this.model});

  factory DeviceModel.fromJson(Map<String, Object?> json) =>
      _$DeviceModelFromJson(json);

  final String manufacturer;
  final String model;

  Map<String, Object?> toJson() => _$DeviceModelToJson(this);
}
