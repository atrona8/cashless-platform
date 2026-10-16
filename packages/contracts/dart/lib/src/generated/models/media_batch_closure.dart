// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_batch_status.dart';

part 'media_batch_closure.g.dart';

@JsonSerializable()
class MediaBatchClosure {
  const MediaBatchClosure({
    required this.status,
    required this.remainingDeposits,
    required this.retiredMedia,
    required this.invalidatedClaimCodes,
  });

  factory MediaBatchClosure.fromJson(Map<String, Object?> json) =>
      _$MediaBatchClosureFromJson(json);

  final MediaBatchStatus status;

  /// Cautions encore détenues ; tant que > 0, le lot n'est pas clos et l'appelant relance.
  @JsonKey(name: 'remaining_deposits')
  final int remainingDeposits;
  @JsonKey(name: 'retired_media')
  final int retiredMedia;
  @JsonKey(name: 'invalidated_claim_codes')
  final int invalidatedClaimCodes;

  Map<String, Object?> toJson() => _$MediaBatchClosureToJson(this);
}
