// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'wrapped_key.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

WrappedKey _$WrappedKeyFromJson(Map<String, dynamic> json) => WrappedKey(
  alg: json['alg'] as String,
  epk: json['epk'] as String,
  iv: json['iv'] as String,
  wrappedKey: json['wrapped_key'] as String,
);

Map<String, dynamic> _$WrappedKeyToJson(WrappedKey instance) =>
    <String, dynamic>{
      'alg': instance.alg,
      'epk': instance.epk,
      'iv': instance.iv,
      'wrapped_key': instance.wrappedKey,
    };
