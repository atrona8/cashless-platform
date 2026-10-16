// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'debit_authority_state.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DebitAuthorityState _$DebitAuthorityStateFromJson(Map<String, dynamic> json) =>
    DebitAuthorityState(
      ledgerId: json['ledger_id'] as String,
      authority: $enumDecode(
        _$DebitAuthorityAuthorityEnumMap,
        json['authority'],
      ),
      epoch: (json['epoch'] as num).toInt(),
      edgeGatewayId: json['edge_gateway_id'] as String?,
      edgeBaseUrl: json['edge_base_url'] as String?,
      handover: json['handover'] == null
          ? null
          : Handover.fromJson(json['handover'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$DebitAuthorityStateToJson(
  DebitAuthorityState instance,
) => <String, dynamic>{
  'ledger_id': instance.ledgerId,
  'authority': instance.authority,
  'epoch': instance.epoch,
  'edge_gateway_id': instance.edgeGatewayId,
  'edge_base_url': instance.edgeBaseUrl,
  'handover': instance.handover,
};

const _$DebitAuthorityAuthorityEnumMap = {
  DebitAuthorityAuthority.central: 'CENTRAL',
  DebitAuthorityAuthority.edge: 'EDGE',
};
