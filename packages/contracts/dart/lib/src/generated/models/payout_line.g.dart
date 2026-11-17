// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payout_line.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PayoutLine _$PayoutLineFromJson(Map<String, dynamic> json) => PayoutLine(
  beneficiaryPartyId: json['beneficiary_party_id'] as String,
  amount: (json['amount'] as num).toInt(),
  currency: json['currency'] as String,
  method: $enumDecode(_$PayoutLineMethodEnumMap, json['method']),
  msisdn: json['msisdn'] as String?,
  iban: json['iban'] as String?,
);

Map<String, dynamic> _$PayoutLineToJson(PayoutLine instance) =>
    <String, dynamic>{
      'beneficiary_party_id': instance.beneficiaryPartyId,
      'amount': instance.amount,
      'currency': instance.currency,
      'method': instance.method,
      'msisdn': instance.msisdn,
      'iban': instance.iban,
    };

const _$PayoutLineMethodEnumMap = {
  PayoutLineMethod.bankTransfer: 'BANK_TRANSFER',
  PayoutLineMethod.wave: 'WAVE',
  PayoutLineMethod.orangeMoney: 'ORANGE_MONEY',
  PayoutLineMethod.cash: 'CASH',
};
