// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_claim_pending.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaClaimPending _$MediaClaimPendingFromJson(Map<String, dynamic> json) =>
    MediaClaimPending(
      claimId: json['claim_id'] as String,
      status: $enumDecode(_$MediaClaimPendingStatusEnumMap, json['status']),
      confirmationCode: json['confirmation_code'] as String,
      expiresAt: DateTime.parse(json['expires_at'] as String),
    );

Map<String, dynamic> _$MediaClaimPendingToJson(MediaClaimPending instance) =>
    <String, dynamic>{
      'claim_id': instance.claimId,
      'status': instance.status,
      'confirmation_code': instance.confirmationCode,
      'expires_at': instance.expiresAt.toIso8601String(),
    };

const _$MediaClaimPendingStatusEnumMap = {
  MediaClaimPendingStatus.pendingDeskConfirmation: 'PENDING_DESK_CONFIRMATION',
};
