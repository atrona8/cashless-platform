// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tap_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TapResponse _$TapResponseFromJson(Map<String, dynamic> json) => TapResponse(
  tapId: (json['tap_id'] as num?)?.toInt(),
  result: $enumDecode(_$TapResultCodeEnumMap, json['result']),
  tapExpiresAt: json['tap_expires_at'] == null
      ? null
      : DateTime.parse(json['tap_expires_at'] as String),
  media: json['media'] == null
      ? null
      : Media.fromJson(json['media'] as Map<String, dynamic>),
  wallet: json['wallet'] == null
      ? null
      : WalletSummary.fromJson(json['wallet'] as Map<String, dynamic>),
);

Map<String, dynamic> _$TapResponseToJson(TapResponse instance) =>
    <String, dynamic>{
      'tap_id': instance.tapId,
      'result': instance.result,
      'tap_expires_at': instance.tapExpiresAt?.toIso8601String(),
      'media': instance.media,
      'wallet': instance.wallet,
    };

const _$TapResultCodeEnumMap = {
  TapResultCode.ok: 'OK',
  TapResultCode.unknown: 'UNKNOWN',
  TapResultCode.blocked: 'BLOCKED',
  TapResultCode.uidMismatch: 'UID_MISMATCH',
  TapResultCode.signatureMismatch: 'SIGNATURE_MISMATCH',
  TapResultCode.signatureMissing: 'SIGNATURE_MISSING',
  TapResultCode.cloneSuspected: 'CLONE_SUSPECTED',
  TapResultCode.retired: 'RETIRED',
  TapResultCode.replaced: 'REPLACED',
  TapResultCode.notActivated: 'NOT_ACTIVATED',
  TapResultCode.released: 'RELEASED',
  TapResultCode.batchInactive: 'BATCH_INACTIVE',
  TapResultCode.wrongEvent: 'WRONG_EVENT',
};
