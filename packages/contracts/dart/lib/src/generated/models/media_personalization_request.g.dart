// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_personalization_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaPersonalizationRequest _$MediaPersonalizationRequestFromJson(
  Map<String, dynamic> json,
) => MediaPersonalizationRequest(
  batchId: json['batch_id'] as String,
  tokenHash: json['token_hash'] as String,
  nfcUid: json['nfc_uid'] as String,
  originalitySignature: json['originality_signature'] as String,
  signatureOk: json['signature_ok'] as bool,
  stationPublicKey: json['station_public_key'] as String,
);

Map<String, dynamic> _$MediaPersonalizationRequestToJson(
  MediaPersonalizationRequest instance,
) => <String, dynamic>{
  'batch_id': instance.batchId,
  'token_hash': instance.tokenHash,
  'nfc_uid': instance.nfcUid,
  'originality_signature': instance.originalitySignature,
  'signature_ok': instance.signatureOk,
  'station_public_key': instance.stationPublicKey,
};
