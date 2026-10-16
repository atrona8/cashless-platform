// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'approval_rejection.g.dart';

@JsonSerializable()
class ApprovalRejection {
  const ApprovalRejection({required this.note});

  factory ApprovalRejection.fromJson(Map<String, Object?> json) =>
      _$ApprovalRejectionFromJson(json);

  final String note;

  Map<String, Object?> toJson() => _$ApprovalRejectionToJson(this);
}
