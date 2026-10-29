// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'cash_sessions_request_body.g.dart';

@JsonSerializable()
class CashSessionsRequestBody {
  const CashSessionsRequestBody({this.cashAccountId});

  factory CashSessionsRequestBody.fromJson(Map<String, Object?> json) =>
      _$CashSessionsRequestBodyFromJson(json);

  /// Facultatif. S'il est fourni, DOIT être la caisse (`A-CAISSE-<série>`) du terminal.
  @JsonKey(name: 'cash_account_id')
  final String? cashAccountId;

  Map<String, Object?> toJson() => _$CashSessionsRequestBodyToJson(this);
}
