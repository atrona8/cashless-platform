// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'hex32.dart';
import 'snapshot_entry.dart';
import 'snapshot_header.dart';
import 'wrapped_key.dart';

part 'offline_snapshot.g.dart';

@JsonSerializable()
class OfflineSnapshot {
  const OfflineSnapshot({
    required this.header,
    required this.signature,
    required this.entries,
    this.pwdPackKey,
    this.removedTokenHashes,
  });

  factory OfflineSnapshot.fromJson(Map<String, Object?> json) =>
      _$OfflineSnapshotFromJson(json);

  final SnapshotHeader header;
  final String signature;
  @JsonKey(name: 'pwd_pack_key')
  final WrappedKey? pwdPackKey;
  final List<SnapshotEntry> entries;
  @JsonKey(name: 'removed_token_hashes')
  final List<Hex32>? removedTokenHashes;

  Map<String, Object?> toJson() => _$OfflineSnapshotToJson(this);
}
