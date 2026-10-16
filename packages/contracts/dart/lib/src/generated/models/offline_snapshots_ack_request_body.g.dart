// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_snapshots_ack_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflineSnapshotsAckRequestBody _$OfflineSnapshotsAckRequestBodyFromJson(
  Map<String, dynamic> json,
) => OfflineSnapshotsAckRequestBody(
  version: (json['version'] as num).toInt(),
  contentSha256: json['content_sha256'] as String,
);

Map<String, dynamic> _$OfflineSnapshotsAckRequestBodyToJson(
  OfflineSnapshotsAckRequestBody instance,
) => <String, dynamic>{
  'version': instance.version,
  'content_sha256': instance.contentSha256,
};
