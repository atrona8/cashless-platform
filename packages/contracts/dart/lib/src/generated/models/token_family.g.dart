// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'token_family.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TokenFamily _$TokenFamilyFromJson(Map<String, dynamic> json) => TokenFamily(
  fid: json['fid'] as String,
  status: $enumDecode(_$Status5EnumMap, json['status']),
  refreshTokenSha256Current: json['refresh_token_sha256_current'] as String,
);

Map<String, dynamic> _$TokenFamilyToJson(TokenFamily instance) =>
    <String, dynamic>{
      'fid': instance.fid,
      'status': instance.status,
      'refresh_token_sha256_current': instance.refreshTokenSha256Current,
    };

const _$Status5EnumMap = {Status5.active: 'ACTIVE', Status5.revoked: 'REVOKED'};
