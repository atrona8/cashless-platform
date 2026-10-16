// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'media_claim_request.g.dart';

@JsonSerializable()
class MediaClaimRequest {
  const MediaClaimRequest({required this.claimCode, this.walletId});

  factory MediaClaimRequest.fromJson(Map<String, Object?> json) =>
      _$MediaClaimRequestFromJson(json);

  /// Code imprimé (10 caractères de l'alphabet 23456789ABCDEFGHJKLMNPQRSTUVWXYZ) ; tirets, espaces et casse ignorés.
  @JsonKey(name: 'claim_code')
  final String claimCode;

  /// Portefeuille existant du client à utiliser (sinon créé).
  @JsonKey(name: 'wallet_id')
  final String? walletId;

  Map<String, Object?> toJson() => _$MediaClaimRequestToJson(this);
}
