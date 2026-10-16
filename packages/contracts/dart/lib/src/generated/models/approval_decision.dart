// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'approval_decision.g.dart';

@JsonSerializable()
class ApprovalDecision {
  const ApprovalDecision({this.note});

  factory ApprovalDecision.fromJson(Map<String, Object?> json) =>
      _$ApprovalDecisionFromJson(json);

  final String? note;

  Map<String, Object?> toJson() => _$ApprovalDecisionToJson(this);
}
