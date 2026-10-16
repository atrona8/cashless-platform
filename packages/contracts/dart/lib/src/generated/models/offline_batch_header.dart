// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'hex32.dart';
import 'timestamp.dart';

part 'offline_batch_header.g.dart';

@JsonSerializable()
class OfflineBatchHeader {
  const OfflineBatchHeader({
    required this.batchId,
    required this.deviceSerial,
    required this.ledgerId,
    required this.authorityEpoch,
    required this.seqFrom,
    required this.seqTo,
    required this.count,
    required this.createdAt,
    required this.prevChainHash,
    required this.lastChainHash,
    this.deviceTimeAtSend,
  });

  factory OfflineBatchHeader.fromJson(Map<String, Object?> json) =>
      _$OfflineBatchHeaderFromJson(json);

  @JsonKey(name: 'batch_id')
  final String batchId;
  @JsonKey(name: 'device_serial')
  final String deviceSerial;
  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  @JsonKey(name: 'authority_epoch')
  final int authorityEpoch;
  @JsonKey(name: 'seq_from')
  final int seqFrom;
  @JsonKey(name: 'seq_to')
  final int seqTo;
  final int count;
  @JsonKey(name: 'created_at')
  final Timestamp createdAt;
  @JsonKey(name: 'device_time_at_send')
  final Timestamp? deviceTimeAtSend;
  @JsonKey(name: 'prev_chain_hash')
  final Hex32 prevChainHash;
  @JsonKey(name: 'last_chain_hash')
  final Hex32 lastChainHash;

  Map<String, Object?> toJson() => _$OfflineBatchHeaderToJson(this);
}
