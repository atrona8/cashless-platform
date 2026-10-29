// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'currency.dart';
import 'psp_provider.dart';

part 'psp_topup_request.g.dart';

@JsonSerializable()
class PspTopupRequest {
  const PspTopupRequest({
    required this.amount,
    required this.currency,
    required this.provider,
    this.walletId,
    this.tapId,
    this.payerMsisdn,
    this.returnUrl,
  });

  factory PspTopupRequest.fromJson(Map<String, Object?> json) =>
      _$PspTopupRequestFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String? walletId;

  /// Au guichet (TOPUP_DESK) à la place de wallet_id.
  @JsonKey(name: 'tap_id')
  final int? tapId;
  final Amount amount;
  final Currency currency;

  /// Moyen de paiement (valeur = méthode, `method` du modèle de données) ; le fournisseur est résolu par.
  /// la configuration PSP. Le nom du champ est conservé pour ne pas rompre les applications.
  ///
  final PspProvider provider;
  @JsonKey(name: 'payer_msisdn')
  final String? payerMsisdn;
  @JsonKey(name: 'return_url')
  final String? returnUrl;

  Map<String, Object?> toJson() => _$PspTopupRequestToJson(this);
}
