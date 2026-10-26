// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'vendor_status.dart';

part 'vendor_status_change.g.dart';

@JsonSerializable()
class VendorStatusChange {
  const VendorStatusChange({required this.status});

  factory VendorStatusChange.fromJson(Map<String, Object?> json) =>
      _$VendorStatusChangeFromJson(json);

  final VendorStatus status;

  Map<String, Object?> toJson() => _$VendorStatusChangeToJson(this);
}
