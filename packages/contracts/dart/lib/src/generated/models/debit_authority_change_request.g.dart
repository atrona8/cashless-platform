// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'debit_authority_change_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DebitAuthorityChangeRequest _$DebitAuthorityChangeRequestFromJson(
  Map<String, dynamic> json,
) => DebitAuthorityChangeRequest(
  target: $enumDecode(
    _$DebitAuthorityChangeRequestTargetEnumMap,
    json['target'],
  ),
  reason: json['reason'] as String,
  force: json['force'] as bool? ?? false,
  edgeGatewayId: json['edge_gateway_id'] as String?,
  gatewayConfirmedOffline: json['gateway_confirmed_offline'] as bool?,
);

Map<String, dynamic> _$DebitAuthorityChangeRequestToJson(
  DebitAuthorityChangeRequest instance,
) => <String, dynamic>{
  'target': instance.target,
  'edge_gateway_id': instance.edgeGatewayId,
  'reason': instance.reason,
  'force': instance.force,
  'gateway_confirmed_offline': instance.gatewayConfirmedOffline,
};

const _$DebitAuthorityChangeRequestTargetEnumMap = {
  DebitAuthorityChangeRequestTarget.edge: 'EDGE',
  DebitAuthorityChangeRequestTarget.central: 'CENTRAL',
};
