// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'cash_sessions_request_body.g.dart';

@JsonSerializable()
class CashSessionsRequestBody {
  const CashSessionsRequestBody({required this.cashAccountId, this.deviceId});

  factory CashSessionsRequestBody.fromJson(Map<String, Object?> json) =>
      _$CashSessionsRequestBodyFromJson(json);

  /// Compte `CASH_DESK` de la caisse (même grand livre que l'événement).
  @JsonKey(name: 'cash_account_id')
  final String cashAccountId;

  /// Terminal `TOPUP_DESK` de la caisse, s'il y en a un.
  @JsonKey(name: 'device_id')
  final String? deviceId;

  Map<String, Object?> toJson() => _$CashSessionsRequestBodyToJson(this);
}
