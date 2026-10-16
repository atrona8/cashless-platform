// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_claims_confirmations_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaClaimsConfirmationsRequestBody
_$MediaClaimsConfirmationsRequestBodyFromJson(Map<String, dynamic> json) =>
    MediaClaimsConfirmationsRequestBody(
      tapId: (json['tap_id'] as num).toInt(),
      claimCode: json['claim_code'] as String,
      confirmationCode: json['confirmation_code'] as String,
    );

Map<String, dynamic> _$MediaClaimsConfirmationsRequestBodyToJson(
  MediaClaimsConfirmationsRequestBody instance,
) => <String, dynamic>{
  'tap_id': instance.tapId,
  'claim_code': instance.claimCode,
  'confirmation_code': instance.confirmationCode,
};
