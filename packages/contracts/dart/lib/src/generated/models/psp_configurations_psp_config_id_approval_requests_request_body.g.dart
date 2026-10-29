// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'psp_configurations_psp_config_id_approval_requests_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PspConfigurationsPspConfigIdApprovalRequestsRequestBody
_$PspConfigurationsPspConfigIdApprovalRequestsRequestBodyFromJson(
  Map<String, dynamic> json,
) => PspConfigurationsPspConfigIdApprovalRequestsRequestBody(
  status: $enumDecode(_$Status3EnumMap, json['status']),
  complianceRef: json['compliance_ref'] as String?,
);

Map<String, dynamic>
_$PspConfigurationsPspConfigIdApprovalRequestsRequestBodyToJson(
  PspConfigurationsPspConfigIdApprovalRequestsRequestBody instance,
) => <String, dynamic>{
  'status': instance.status,
  'compliance_ref': instance.complianceRef,
};

const _$Status3EnumMap = {
  Status3.active: 'ACTIVE',
  Status3.suspended: 'SUSPENDED',
};
