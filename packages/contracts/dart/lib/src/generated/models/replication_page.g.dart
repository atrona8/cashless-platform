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
      edgeSeqApplied: (json['edge_seq_applied'] as num?)?.toInt(),
      deviceSeqAcked: (json['device_seq_acked'] as List<dynamic>?)
          ?.map((e) => EdgeDeviceSeqAcked.fromJson(e as Map<String, dynamic>))
          .toList(),
      pwdPackKey: json['pwd_pack_key'] == null
          ? null
          : WrappedKey.fromJson(json['pwd_pack_key'] as Map<String, dynamic>),
      reference: json['reference'] == null
          ? null
          : EdgeReference.fromJson(json['reference'] as Map<String, dynamic>),
      edgeTerms: json['edge_terms'] == null
          ? null
          : EdgeTerms.fromJson(json['edge_terms'] as Map<String, dynamic>),
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
      'edge_seq_applied': instance.edgeSeqApplied,
      'device_seq_acked': instance.deviceSeqAcked,
      'pwd_pack_key': instance.pwdPackKey,
      'reference': instance.reference,
      'edge_terms': instance.edgeTerms,
    };
