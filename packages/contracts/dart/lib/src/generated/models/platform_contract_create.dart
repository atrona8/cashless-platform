// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'platform_contract_create_platform_fee_mode.dart';
import 'timestamp.dart';

part 'platform_contract_create.g.dart';

@JsonSerializable()
class PlatformContractCreate {
  const PlatformContractCreate({
    required this.validFrom,
    required this.platformFeeMode,
  });

  factory PlatformContractCreate.fromJson(Map<String, Object?> json) =>
      _$PlatformContractCreateFromJson(json);

  @JsonKey(name: 'valid_from')
  final Timestamp validFrom;
  @JsonKey(name: 'platform_fee_mode')
  final PlatformContractCreatePlatformFeeMode platformFeeMode;

  Map<String, Object?> toJson() => _$PlatformContractCreateToJson(this);
}
