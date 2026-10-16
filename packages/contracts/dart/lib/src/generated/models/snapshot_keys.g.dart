// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'snapshot_keys.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SnapshotKeys _$SnapshotKeysFromJson(Map<String, dynamic> json) => SnapshotKeys(
  keyId: json['key_id'] as String,
  algorithm: $enumDecode(_$AlgorithmEnumMap, json['algorithm']),
  publicKey: json['public_key'] as String,
  notAfter: json['not_after'] == null
      ? null
      : DateTime.parse(json['not_after'] as String),
);

Map<String, dynamic> _$SnapshotKeysToJson(SnapshotKeys instance) =>
    <String, dynamic>{
      'key_id': instance.keyId,
      'algorithm': instance.algorithm,
      'public_key': instance.publicKey,
      'not_after': instance.notAfter?.toIso8601String(),
    };

const _$AlgorithmEnumMap = {
  Algorithm.ecdsaP256Sha256: 'ECDSA_P256_SHA256',
  Algorithm.ed25519: 'Ed25519',
};
