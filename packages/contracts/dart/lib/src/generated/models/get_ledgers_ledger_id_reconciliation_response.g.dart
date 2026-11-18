// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_ledgers_ledger_id_reconciliation_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetLedgersLedgerIdReconciliationResponse
_$GetLedgersLedgerIdReconciliationResponseFromJson(Map<String, dynamic> json) =>
    GetLedgersLedgerIdReconciliationResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => AccountReconciliation.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetLedgersLedgerIdReconciliationResponseToJson(
  GetLedgersLedgerIdReconciliationResponse instance,
) => <String, dynamic>{'data': instance.data};
