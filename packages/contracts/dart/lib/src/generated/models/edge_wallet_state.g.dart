// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_wallet_state.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeWalletState _$EdgeWalletStateFromJson(Map<String, dynamic> json) =>
    EdgeWalletState(
      walletId: json['wallet_id'] as String,
      status: json['status'] as String,
      kycVerified: json['kyc_verified'] as bool,
    );

Map<String, dynamic> _$EdgeWalletStateToJson(EdgeWalletState instance) =>
    <String, dynamic>{
      'wallet_id': instance.walletId,
      'status': instance.status,
      'kyc_verified': instance.kycVerified,
    };
