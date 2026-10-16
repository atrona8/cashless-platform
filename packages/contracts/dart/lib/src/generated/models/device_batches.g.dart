// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'device_batches.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DeviceBatches _$DeviceBatchesFromJson(Map<String, dynamic> json) =>
    DeviceBatches(
      header: OfflineBatchHeader.fromJson(
        json['header'] as Map<String, dynamic>,
      ),
      signature: json['signature'] as String,
    );

Map<String, dynamic> _$DeviceBatchesToJson(DeviceBatches instance) =>
    <String, dynamic>{
      'header': instance.header,
      'signature': instance.signature,
    };
