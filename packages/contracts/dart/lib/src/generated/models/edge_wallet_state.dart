// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'edge_wallet_state.g.dart';

/// État d'un portefeuille changé SANS écriture comptable : blocage ou déblocage (statut), palier.
/// d'identification. Un blocage n'écrit aucun `posting` : le curseur de soldes ne le livrerait pas (A03).
/// Prime sur `wallets[].status` et `wallets[].kyc_verified` pour la même valeur de `change_seq` ultérieure.
///
@JsonSerializable()
class EdgeWalletState {
  const EdgeWalletState({
    required this.walletId,
    required this.status,
    required this.kycVerified,
  });

  factory EdgeWalletState.fromJson(Map<String, Object?> json) =>
      _$EdgeWalletStateFromJson(json);

  @JsonKey(name: 'wallet_id')
  final String walletId;

  /// Statut du portefeuille (même énumération que `wallets[].status`).
  final String status;
  @JsonKey(name: 'kyc_verified')
  final bool kycVerified;

  Map<String, Object?> toJson() => _$EdgeWalletStateToJson(this);
}
