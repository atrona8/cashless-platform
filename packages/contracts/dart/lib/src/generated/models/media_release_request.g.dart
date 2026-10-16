// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_release_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaReleaseRequest _$MediaReleaseRequestFromJson(Map<String, dynamic> json) =>
    MediaReleaseRequest(
      tapId: (json['tap_id'] as num?)?.toInt(),
      tap: json['tap'] == null
          ? null
          : TapInput.fromJson(json['tap'] as Map<String, dynamic>),
      cashSessionId: json['cash_session_id'] as String?,
      refundDepositBy: json['refund_deposit_by'] == null
          ? null
          : CashMovement.fromJson(
              json['refund_deposit_by'] as Map<String, dynamic>,
            ),
      settleBalance: json['settle_balance'] == null
          ? null
          : CashMovement.fromJson(
              json['settle_balance'] as Map<String, dynamic>,
            ),
    );

Map<String, dynamic> _$MediaReleaseRequestToJson(
  MediaReleaseRequest instance,
) => <String, dynamic>{
  'tap_id': instance.tapId,
  'tap': instance.tap,
  'cash_session_id': instance.cashSessionId,
  'refund_deposit_by': instance.refundDepositBy,
  'settle_balance': instance.settleBalance,
};
