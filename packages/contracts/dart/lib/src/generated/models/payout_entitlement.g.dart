// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payout_entitlement.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PayoutEntitlement _$PayoutEntitlementFromJson(Map<String, dynamic> json) =>
    PayoutEntitlement(
      partyId: json['party_id'] as String,
      partyKind: $enumDecode(
        _$PayoutEntitlementPartyKindEnumMap,
        json['party_kind'],
      ),
      currency: json['currency'] as String,
      netClaim: (json['net_claim'] as num).toInt(),
      pendingPayouts: (json['pending_payouts'] as num).toInt(),
      available: (json['available'] as num).toInt(),
    );

Map<String, dynamic> _$PayoutEntitlementToJson(PayoutEntitlement instance) =>
    <String, dynamic>{
      'party_id': instance.partyId,
      'party_kind': instance.partyKind,
      'currency': instance.currency,
      'net_claim': instance.netClaim,
      'pending_payouts': instance.pendingPayouts,
      'available': instance.available,
    };

const _$PayoutEntitlementPartyKindEnumMap = {
  PayoutEntitlementPartyKind.platform: 'PLATFORM',
  PayoutEntitlementPartyKind.valueOperator: 'OPERATOR',
  PayoutEntitlementPartyKind.organizer: 'ORGANIZER',
  PayoutEntitlementPartyKind.merchant: 'MERCHANT',
  PayoutEntitlementPartyKind.customer: 'CUSTOMER',
  PayoutEntitlementPartyKind.thirdParty: 'THIRD_PARTY',
};
