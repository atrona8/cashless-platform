// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_gateway_self.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeGatewaySelf _$EdgeGatewaySelfFromJson(Map<String, dynamic> json) =>
    EdgeGatewaySelf(
      gatewayId: json['gateway_id'] as String,
      role: $enumDecode(_$EdgeGatewaySelfRoleEnumMap, json['role']),
      status: $enumDecode(_$EdgeGatewaySelfStatusEnumMap, json['status']),
      roleChangedAt: json['role_changed_at'] == null
          ? null
          : DateTime.parse(json['role_changed_at'] as String),
    );

Map<String, dynamic> _$EdgeGatewaySelfToJson(EdgeGatewaySelf instance) =>
    <String, dynamic>{
      'gateway_id': instance.gatewayId,
      'role': instance.role,
      'status': instance.status,
      'role_changed_at': instance.roleChangedAt?.toIso8601String(),
    };

const _$EdgeGatewaySelfRoleEnumMap = {
  EdgeGatewaySelfRole.primary: 'PRIMARY',
  EdgeGatewaySelfRole.standby: 'STANDBY',
};

const _$EdgeGatewaySelfStatusEnumMap = {
  EdgeGatewaySelfStatus.active: 'ACTIVE',
  EdgeGatewaySelfStatus.isolated: 'ISOLATED',
  EdgeGatewaySelfStatus.catchingUp: 'CATCHING_UP',
  EdgeGatewaySelfStatus.revoked: 'REVOKED',
};
