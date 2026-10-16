// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'snapshot_entry.dart';
import 'wallets.dart';

part 'replication_page.g.dart';

@JsonSerializable()
class ReplicationPage {
  const ReplicationPage({
    required this.ledgerId,
    required this.epoch,
    required this.fromPostingId,
    required this.toPostingId,
    required this.wallets,
    required this.media,
    required this.hasMore,
  });

  factory ReplicationPage.fromJson(Map<String, Object?> json) =>
      _$ReplicationPageFromJson(json);

  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  final int epoch;
  @JsonKey(name: 'from_posting_id')
  final int fromPostingId;
  @JsonKey(name: 'to_posting_id')
  final int toPostingId;
  final List<Wallets> wallets;
  final List<SnapshotEntry> media;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$ReplicationPageToJson(this);
}
