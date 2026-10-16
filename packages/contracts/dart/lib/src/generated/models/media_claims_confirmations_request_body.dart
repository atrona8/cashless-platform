// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'media_claims_confirmations_request_body.g.dart';

@JsonSerializable()
class MediaClaimsConfirmationsRequestBody {
  const MediaClaimsConfirmationsRequestBody({
    required this.tapId,
    required this.claimCode,
    required this.confirmationCode,
  });

  factory MediaClaimsConfirmationsRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$MediaClaimsConfirmationsRequestBodyFromJson(json);

  /// Lecture du bracelet par le terminal du guichet (`POST /taps`).
  @JsonKey(name: 'tap_id')
  final int tapId;

  /// Code imprimé sur le bracelet ; tirets, espaces et casse ignorés.
  @JsonKey(name: 'claim_code')
  final String claimCode;
  @JsonKey(name: 'confirmation_code')
  final String confirmationCode;

  Map<String, Object?> toJson() =>
      _$MediaClaimsConfirmationsRequestBodyToJson(this);
}
