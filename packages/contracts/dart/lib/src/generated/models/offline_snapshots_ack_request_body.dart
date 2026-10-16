// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'hex32.dart';

part 'offline_snapshots_ack_request_body.g.dart';

@JsonSerializable()
class OfflineSnapshotsAckRequestBody {
  const OfflineSnapshotsAckRequestBody({
    required this.version,
    required this.contentSha256,
  });

  factory OfflineSnapshotsAckRequestBody.fromJson(Map<String, Object?> json) =>
      _$OfflineSnapshotsAckRequestBodyFromJson(json);

  final int version;
  @JsonKey(name: 'content_sha256')
  final Hex32 contentSha256;

  Map<String, Object?> toJson() => _$OfflineSnapshotsAckRequestBodyToJson(this);
}
