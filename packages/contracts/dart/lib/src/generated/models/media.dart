// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'media_status.dart';
import 'batch_kind.dart';
import 'deposit_status.dart';

part 'media.g.dart';

@JsonSerializable()
class Media {
  const Media({
    required this.mediaId,
    required this.status,
    required this.depositStatus,
    this.batchKind,
    this.depositHeld,
  });

  factory Media.fromJson(Map<String, Object?> json) => _$MediaFromJson(json);

  @JsonKey(name: 'media_id')
  final String mediaId;
  final MediaStatus status;
  @JsonKey(name: 'batch_kind')
  final BatchKind? batchKind;
  @JsonKey(name: 'deposit_status')
  final DepositStatus depositStatus;
  @JsonKey(name: 'deposit_held')
  final int? depositHeld;

  Map<String, Object?> toJson() => _$MediaToJson(this);
}
