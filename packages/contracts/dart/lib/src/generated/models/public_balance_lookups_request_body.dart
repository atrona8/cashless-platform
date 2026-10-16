// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'public_balance_lookups_request_body.g.dart';

@JsonSerializable()
class PublicBalanceLookupsRequestBody {
  const PublicBalanceLookupsRequestBody({required this.claimCode});

  factory PublicBalanceLookupsRequestBody.fromJson(Map<String, Object?> json) =>
      _$PublicBalanceLookupsRequestBodyFromJson(json);

  @JsonKey(name: 'claim_code')
  final String claimCode;

  Map<String, Object?> toJson() =>
      _$PublicBalanceLookupsRequestBodyToJson(this);
}
