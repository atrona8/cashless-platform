// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'kyc_verifications_kyc_verification_id_revoke_request_body.g.dart';

@JsonSerializable()
class KycVerificationsKycVerificationIdRevokeRequestBody {
  const KycVerificationsKycVerificationIdRevokeRequestBody({
    required this.reason,
  });

  factory KycVerificationsKycVerificationIdRevokeRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$KycVerificationsKycVerificationIdRevokeRequestBodyFromJson(json);

  final String reason;

  Map<String, Object?> toJson() =>
      _$KycVerificationsKycVerificationIdRevokeRequestBodyToJson(this);
}
