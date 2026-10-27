// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'terminal_vendor.dart';

part 'terminal_vendor_list.g.dart';

@JsonSerializable()
class TerminalVendorList {
  const TerminalVendorList({required this.data});

  factory TerminalVendorList.fromJson(Map<String, Object?> json) =>
      _$TerminalVendorListFromJson(json);

  final List<TerminalVendor> data;

  Map<String, Object?> toJson() => _$TerminalVendorListToJson(this);
}
