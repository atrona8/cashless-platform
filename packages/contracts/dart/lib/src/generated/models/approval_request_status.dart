// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// `PENDING` → `APPROVED` | `REJECTED` | `EXPIRED` ; `APPROVED` → `EXECUTED` | `FAILED` (garde de la base).
/// `APPROVED` est un état de passage : `approveApprovalRequest` exécute l'action dans la foulée.
///
@JsonEnum()
enum ApprovalRequestStatus {
  @JsonValue('PENDING')
  pending('PENDING'),
  @JsonValue('APPROVED')
  approved('APPROVED'),
  @JsonValue('REJECTED')
  rejected('REJECTED'),
  @JsonValue('EXPIRED')
  expired('EXPIRED'),
  @JsonValue('EXECUTED')
  executed('EXECUTED'),
  @JsonValue('FAILED')
  failed('FAILED');

  const ApprovalRequestStatus(this.json);

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError(
        'Cannot convert enum value with null JSON representation to String. '
        'This usually happens for \$unknown or @JsonValue(null) entries.',
      );
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
}
