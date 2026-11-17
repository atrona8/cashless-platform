// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'data.dart';
import 'party_statement_party_kind.dart';

part 'party_statement.g.dart';

/// Relevé d'une partie pour un événement, paginé.
@JsonSerializable()
class PartyStatement {
  const PartyStatement({
    required this.partyKind,
    required this.eventId,
    required this.currency,
    required this.data,
    required this.nextCursor,
    required this.hasMore,
    this.partyId,
    this.closingBalance,
  });

  factory PartyStatement.fromJson(Map<String, Object?> json) =>
      _$PartyStatementFromJson(json);

  @JsonKey(name: 'party_kind')
  final PartyStatementPartyKind partyKind;
  @JsonKey(name: 'party_id')
  final String? partyId;
  @JsonKey(name: 'event_id')
  final String eventId;
  final Currency currency;

  /// Solde à la date de la requête.
  @JsonKey(name: 'closing_balance')
  final int? closingBalance;
  final List<Data> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$PartyStatementToJson(this);
}
