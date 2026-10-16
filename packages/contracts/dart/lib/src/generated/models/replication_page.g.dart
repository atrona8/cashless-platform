// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'replication_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ReplicationPage _$ReplicationPageFromJson(Map<String, dynamic> json) =>
    ReplicationPage(
      ledgerId: json['ledger_id'] as String,
      epoch: (json['epoch'] as num).toInt(),
      fromPostingId: (json['from_posting_id'] as num).toInt(),
      toPostingId: (json['to_posting_id'] as num).toInt(),
      wallets: (json['wallets'] as List<dynamic>)
          .map((e) => Wallets.fromJson(e as Map<String, dynamic>))
          .toList(),
      media: (json['media'] as List<dynamic>)
          .map((e) => SnapshotEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
      hasMore: json['has_more'] as bool,
    );

Map<String, dynamic> _$ReplicationPageToJson(ReplicationPage instance) =>
    <String, dynamic>{
      'ledger_id': instance.ledgerId,
      'epoch': instance.epoch,
      'from_posting_id': instance.fromPostingId,
      'to_posting_id': instance.toPostingId,
      'wallets': instance.wallets,
      'media': instance.media,
      'has_more': instance.hasMore,
    };
