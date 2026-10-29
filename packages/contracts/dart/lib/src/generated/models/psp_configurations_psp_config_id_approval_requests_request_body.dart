// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'status3.dart';

part 'psp_configurations_psp_config_id_approval_requests_request_body.g.dart';

@JsonSerializable()
class PspConfigurationsPspConfigIdApprovalRequestsRequestBody {
  const PspConfigurationsPspConfigIdApprovalRequestsRequestBody({
    required this.status,
    this.complianceRef,
  });

  factory PspConfigurationsPspConfigIdApprovalRequestsRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$PspConfigurationsPspConfigIdApprovalRequestsRequestBodyFromJson(json);

  final Status3 status;

  /// Référence de conformité ; obligatoire pour `ACTIVE`.
  @JsonKey(name: 'compliance_ref')
  final String? complianceRef;

  Map<String, Object?> toJson() =>
      _$PspConfigurationsPspConfigIdApprovalRequestsRequestBodyToJson(this);
}
