// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'account_mapping.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AccountMapping _$AccountMappingFromJson(Map<String, dynamic> json) =>
    AccountMapping(
      purpose: json['purpose'] as String,
      debitAccount: json['debit_account'] as String,
      creditAccount: json['credit_account'] as String,
      transactionType: json['transaction_type'] as String?,
    );

Map<String, dynamic> _$AccountMappingToJson(AccountMapping instance) =>
    <String, dynamic>{
      'purpose': instance.purpose,
      'transaction_type': instance.transactionType,
      'debit_account': instance.debitAccount,
      'credit_account': instance.creditAccount,
    };
