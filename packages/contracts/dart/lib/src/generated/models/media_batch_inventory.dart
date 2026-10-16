// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'media_batch_inventory.g.dart';

/// Compteurs de la vue `batch_inventory` (§7.7).
@JsonSerializable()
class MediaBatchInventory {
  const MediaBatchInventory({
    required this.batchId,
    required this.ordered,
    required this.registered,
    required this.inStock,
    required this.issued,
    required this.active,
    required this.suspended,
    required this.blacklisted,
    required this.replaced,
    required this.released,
    required this.retired,
    required this.missing,
  });

  factory MediaBatchInventory.fromJson(Map<String, Object?> json) =>
      _$MediaBatchInventoryFromJson(json);

  @JsonKey(name: 'batch_id')
  final String batchId;
  final int ordered;
  final int registered;
  @JsonKey(name: 'in_stock')
  final int inStock;
  final int issued;
  final int active;
  final int suspended;
  final int blacklisted;
  final int replaced;
  final int released;
  final int retired;

  /// Commandés et jamais enregistrés.
  final int missing;

  Map<String, Object?> toJson() => _$MediaBatchInventoryToJson(this);
}
