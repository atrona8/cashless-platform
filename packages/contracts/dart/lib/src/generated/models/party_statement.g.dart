// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'party_statement.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PartyStatement _$PartyStatementFromJson(Map<String, dynamic> json) =>
    PartyStatement(
      partyKind: $enumDecode(
        _$PartyStatementPartyKindEnumMap,
        json['party_kind'],
      ),
      eventId: json['event_id'] as String,
      currency: json['currency'] as String,
      data: (json['data'] as List<dynamic>)
          .map((e) => Data.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: json['next_cursor'] as String?,
      hasMore: json['has_more'] as bool,
      partyId: json['party_id'] as String?,
      closingBalance: (json['closing_balance'] as num?)?.toInt(),
    );

Map<String, dynamic> _$PartyStatementToJson(PartyStatement instance) =>
    <String, dynamic>{
      'party_kind': instance.partyKind,
      'party_id': instance.partyId,
      'event_id': instance.eventId,
      'currency': instance.currency,
      'closing_balance': instance.closingBalance,
      'data': instance.data,
      'next_cursor': instance.nextCursor,
      'has_more': instance.hasMore,
    };

const _$PartyStatementPartyKindEnumMap = {
  PartyStatementPartyKind.merchant: 'MERCHANT',
  PartyStatementPartyKind.organizer: 'ORGANIZER',
  PartyStatementPartyKind.valueOperator: 'OPERATOR',
  PartyStatementPartyKind.platform: 'PLATFORM',
};
