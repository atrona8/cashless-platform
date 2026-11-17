// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'account_mapping.g.dart';

/// Correspondance entre un compte de l'application (objet et type de transaction) et deux comptes légaux.
@JsonSerializable()
class AccountMapping {
  const AccountMapping({
    required this.purpose,
    required this.debitAccount,
    required this.creditAccount,
    this.transactionType,
  });

  factory AccountMapping.fromJson(Map<String, Object?> json) =>
      _$AccountMappingFromJson(json);

  /// Objet du compte de l'application (`purpose`).
  final String purpose;

  /// Type de transaction ; nul = tous.
  @JsonKey(name: 'transaction_type')
  final String? transactionType;

  /// Compte légal débité.
  @JsonKey(name: 'debit_account')
  final String debitAccount;

  /// Compte légal crédité.
  @JsonKey(name: 'credit_account')
  final String creditAccount;

  Map<String, Object?> toJson() => _$AccountMappingToJson(this);
}
