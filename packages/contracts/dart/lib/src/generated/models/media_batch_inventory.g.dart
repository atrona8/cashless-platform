// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_batch_inventory.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MediaBatchInventory _$MediaBatchInventoryFromJson(Map<String, dynamic> json) =>
    MediaBatchInventory(
      batchId: json['batch_id'] as String,
      ordered: (json['ordered'] as num).toInt(),
      registered: (json['registered'] as num).toInt(),
      inStock: (json['in_stock'] as num).toInt(),
      issued: (json['issued'] as num).toInt(),
      active: (json['active'] as num).toInt(),
      suspended: (json['suspended'] as num).toInt(),
      blacklisted: (json['blacklisted'] as num).toInt(),
      replaced: (json['replaced'] as num).toInt(),
      released: (json['released'] as num).toInt(),
      retired: (json['retired'] as num).toInt(),
      missing: (json['missing'] as num).toInt(),
    );

Map<String, dynamic> _$MediaBatchInventoryToJson(
  MediaBatchInventory instance,
) => <String, dynamic>{
  'batch_id': instance.batchId,
  'ordered': instance.ordered,
  'registered': instance.registered,
  'in_stock': instance.inStock,
  'issued': instance.issued,
  'active': instance.active,
  'suspended': instance.suspended,
  'blacklisted': instance.blacklisted,
  'replaced': instance.replaced,
  'released': instance.released,
  'retired': instance.retired,
  'missing': instance.missing,
};
