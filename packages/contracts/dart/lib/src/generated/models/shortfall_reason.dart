// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum ShortfallReason {
  @JsonValue('INSUFFICIENT_FUNDS')
  insufficientFunds('INSUFFICIENT_FUNDS'),
  @JsonValue('MEDIA_BLOCKED_AFTER_SNAPSHOT')
  mediaBlockedAfterSnapshot('MEDIA_BLOCKED_AFTER_SNAPSHOT'),
  @JsonValue('MEDIA_CLONE_SUSPECTED')
  mediaCloneSuspected('MEDIA_CLONE_SUSPECTED'),
  @JsonValue('MEDIA_UID_MISMATCH')
  mediaUidMismatch('MEDIA_UID_MISMATCH'),
  @JsonValue('MEDIA_SIGNATURE_MISMATCH')
  mediaSignatureMismatch('MEDIA_SIGNATURE_MISMATCH'),
  @JsonValue('WALLET_BLOCKED')
  walletBlocked('WALLET_BLOCKED');

  const ShortfallReason(this.json);

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
