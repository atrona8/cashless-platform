// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_claim_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaClaimRequest _$MediaClaimRequestFromJson(Map<String, dynamic> json) =>
    MediaClaimRequest(
      claimCode: json['claim_code'] as String,
      walletId: json['wallet_id'] as String?,
    );

Map<String, dynamic> _$MediaClaimRequestToJson(MediaClaimRequest instance) =>
    <String, dynamic>{
      'claim_code': instance.claimCode,
      'wallet_id': instance.walletId,
    };
