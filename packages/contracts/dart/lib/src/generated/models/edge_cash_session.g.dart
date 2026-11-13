// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_cash_session.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeCashSession _$EdgeCashSessionFromJson(Map<String, dynamic> json) =>
    EdgeCashSession(
      cashSessionId: json['cash_session_id'] as String,
      deviceId: json['device_id'] as String,
      status: $enumDecode(_$EdgeCashSessionStatusEnumMap, json['status']),
      openedBy: json['opened_by'] as String,
      openedAt: DateTime.parse(json['opened_at'] as String),
      closedAt: json['closed_at'] == null
          ? null
          : DateTime.parse(json['closed_at'] as String),
    );

Map<String, dynamic> _$EdgeCashSessionToJson(EdgeCashSession instance) =>
    <String, dynamic>{
      'cash_session_id': instance.cashSessionId,
      'device_id': instance.deviceId,
      'status': instance.status,
      'opened_by': instance.openedBy,
      'opened_at': instance.openedAt.toIso8601String(),
      'closed_at': instance.closedAt?.toIso8601String(),
    };

const _$EdgeCashSessionStatusEnumMap = {
  EdgeCashSessionStatus.open: 'OPEN',
  EdgeCashSessionStatus.closing: 'CLOSING',
  EdgeCashSessionStatus.closed: 'CLOSED',
};
