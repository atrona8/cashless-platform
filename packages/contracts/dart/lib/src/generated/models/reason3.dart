// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum Reason3 {
  @JsonValue('MALFORMED_LINE')
  malformedLine('MALFORMED_LINE'),
  @JsonValue('BAD_CLAIM_CODE')
  badClaimCode('BAD_CLAIM_CODE'),
  @JsonValue('BAD_UID')
  badUid('BAD_UID'),
  @JsonValue('MEDIA_UNKNOWN')
  mediaUnknown('MEDIA_UNKNOWN'),
  @JsonValue('CLAIM_CODE_UNKNOWN')
  claimCodeUnknown('CLAIM_CODE_UNKNOWN'),
  @JsonValue('CLAIM_CODE_OTHER_BATCH')
  claimCodeOtherBatch('CLAIM_CODE_OTHER_BATCH'),
  @JsonValue('CLAIM_CODE_ALREADY_ASSOCIATED')
  claimCodeAlreadyAssociated('CLAIM_CODE_ALREADY_ASSOCIATED'),
  @JsonValue('CLAIM_CODE_INVALIDATED')
  claimCodeInvalidated('CLAIM_CODE_INVALIDATED'),
  @JsonValue('MEDIA_ALREADY_HAS_CODE')
  mediaAlreadyHasCode('MEDIA_ALREADY_HAS_CODE');

  const Reason3(this.json);

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
