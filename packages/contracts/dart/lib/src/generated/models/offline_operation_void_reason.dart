// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum OfflineOperationVoidReason {
  @JsonValue('ABORTED_BY_OPERATOR')
  abortedByOperator('ABORTED_BY_OPERATOR'),
  @JsonValue('ONLINE_REJECTED')
  onlineRejected('ONLINE_REJECTED'),
  @JsonValue('NFC_READ_FAILED')
  nfcReadFailed('NFC_READ_FAILED'),
  @JsonValue('APP_CRASH_RECOVERY')
  appCrashRecovery('APP_CRASH_RECOVERY');

  const OfflineOperationVoidReason(this.json);

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
