// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'offline_batch.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OfflineBatch _$OfflineBatchFromJson(Map<String, dynamic> json) => OfflineBatch(
  header: OfflineBatchHeader.fromJson(json['header'] as Map<String, dynamic>),
  operations: (json['operations'] as List<dynamic>)
      .map((e) => OfflineOperation.fromJson(e as Map<String, dynamic>))
      .toList(),
  signature: json['signature'] as String,
);

Map<String, dynamic> _$OfflineBatchToJson(OfflineBatch instance) =>
    <String, dynamic>{
      'header': instance.header,
      'operations': instance.operations,
      'signature': instance.signature,
    };
