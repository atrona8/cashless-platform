// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'rejected.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Rejected _$RejectedFromJson(Map<String, dynamic> json) => Rejected(
  line: (json['line'] as num).toInt(),
  reason: $enumDecode(_$Reason3EnumMap, json['reason']),
);

Map<String, dynamic> _$RejectedToJson(Rejected instance) => <String, dynamic>{
  'line': instance.line,
  'reason': instance.reason,
};

const _$Reason3EnumMap = {
  Reason3.malformedLine: 'MALFORMED_LINE',
  Reason3.badClaimCode: 'BAD_CLAIM_CODE',
  Reason3.badUid: 'BAD_UID',
  Reason3.mediaUnknown: 'MEDIA_UNKNOWN',
  Reason3.claimCodeUnknown: 'CLAIM_CODE_UNKNOWN',
  Reason3.claimCodeOtherBatch: 'CLAIM_CODE_OTHER_BATCH',
  Reason3.claimCodeAlreadyAssociated: 'CLAIM_CODE_ALREADY_ASSOCIATED',
  Reason3.claimCodeInvalidated: 'CLAIM_CODE_INVALIDATED',
  Reason3.mediaAlreadyHasCode: 'MEDIA_ALREADY_HAS_CODE',
};
