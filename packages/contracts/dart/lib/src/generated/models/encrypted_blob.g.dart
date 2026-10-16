// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'encrypted_blob.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EncryptedBlob _$EncryptedBlobFromJson(Map<String, dynamic> json) =>
    EncryptedBlob(
      nonce: json['nonce'] as String,
      ciphertext: json['ciphertext'] as String,
      tag: json['tag'] as String,
      alg: json['alg'] as String?,
      epk: json['epk'] as String?,
    );

Map<String, dynamic> _$EncryptedBlobToJson(EncryptedBlob instance) =>
    <String, dynamic>{
      'alg': instance.alg,
      'epk': instance.epk,
      'nonce': instance.nonce,
      'ciphertext': instance.ciphertext,
      'tag': instance.tag,
    };
