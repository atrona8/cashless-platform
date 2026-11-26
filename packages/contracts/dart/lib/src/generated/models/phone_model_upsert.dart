// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'phone_model_upsert_nfc_level.dart';

part 'phone_model_upsert.g.dart';

@JsonSerializable()
class PhoneModelUpsert {
  const PhoneModelUpsert({required this.nfcLevel, required this.measuredAt});

  factory PhoneModelUpsert.fromJson(Map<String, Object?> json) =>
      _$PhoneModelUpsertFromJson(json);

  @JsonKey(name: 'nfc_level')
  final PhoneModelUpsertNfcLevel nfcLevel;
  @JsonKey(name: 'measured_at')
  final DateTime measuredAt;

  Map<String, Object?> toJson() => _$PhoneModelUpsertToJson(this);
}
