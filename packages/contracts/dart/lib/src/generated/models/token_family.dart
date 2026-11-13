// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'status5.dart';
import 'hex32.dart';

part 'token_family.g.dart';

@JsonSerializable()
class TokenFamily {
  const TokenFamily({
    required this.fid,
    required this.status,
    required this.refreshTokenSha256Current,
  });

  factory TokenFamily.fromJson(Map<String, Object?> json) =>
      _$TokenFamilyFromJson(json);

  final String fid;
  final Status5 status;
  @JsonKey(name: 'refresh_token_sha256_current')
  final Hex32 refreshTokenSha256Current;

  Map<String, Object?> toJson() => _$TokenFamilyToJson(this);
}
