// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'tap_input.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TapInput _$TapInputFromJson(Map<String, dynamic> json) => TapInput(
  nfcUid: json['nfc_uid'] as String,
  tokenHash: json['token_hash'] as String,
  counter: (json['counter'] as num).toInt(),
  keyIndex: (json['key_index'] as num).toInt(),
  packVerified: json['pack_verified'] as bool,
  occurredAt: DateTime.parse(json['occurred_at'] as String),
  originalitySignature: json['originality_signature'] as String?,
  formatMajor: (json['format_major'] as num?)?.toInt() ?? 1,
  formatMinor: (json['format_minor'] as num?)?.toInt() ?? 0,
);

Map<String, dynamic> _$TapInputToJson(TapInput instance) => <String, dynamic>{
  'nfc_uid': instance.nfcUid,
  'token_hash': instance.tokenHash,
  'counter': instance.counter,
  'key_index': instance.keyIndex,
  'format_major': instance.formatMajor,
  'format_minor': instance.formatMinor,
  'pack_verified': instance.packVerified,
  'originality_signature': instance.originalitySignature,
  'occurred_at': instance.occurredAt.toIso8601String(),
};
