// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'debit_authority.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DebitAuthority _$DebitAuthorityFromJson(Map<String, dynamic> json) =>
    DebitAuthority(
      ledgerId: json['ledger_id'] as String,
      authority: $enumDecode(
        _$DebitAuthorityAuthorityEnumMap,
        json['authority'],
      ),
      epoch: (json['epoch'] as num).toInt(),
      edgeGatewayId: json['edge_gateway_id'] as String?,
      edgeBaseUrl: json['edge_base_url'] as String?,
    );

Map<String, dynamic> _$DebitAuthorityToJson(DebitAuthority instance) =>
    <String, dynamic>{
      'ledger_id': instance.ledgerId,
      'authority': instance.authority,
      'epoch': instance.epoch,
      'edge_gateway_id': instance.edgeGatewayId,
      'edge_base_url': instance.edgeBaseUrl,
    };

const _$DebitAuthorityAuthorityEnumMap = {
  DebitAuthorityAuthority.central: 'CENTRAL',
  DebitAuthorityAuthority.edge: 'EDGE',
};
