// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'device_batches.dart';
import 'edge_local_order.dart';
import 'edge_staff_token_audit.dart';
import 'edge_sync_operation.dart';
import 'hex32.dart';

part 'edge_sync_batch.g.dart';

/// Lot EDGE_SYNC (sync_protocol.md §9.5). `batch_id` est la clé d'idempotence du lot. Les opérations.
/// relayées d'un lot hors ligne de terminal (`DEVICE_OFFLINE`) sont accompagnées de l'en-tête et de la.
/// signature d'ORIGINE de ce lot (`device_batches`) : le central vérifie la signature avec.
/// `device.public_key` (`BATCH_SIGNATURE_INVALID` sinon) et recalcule la chaîne du terminal jusqu'à.
/// `header.last_chain_hash` (`CHAIN_BROKEN` sinon).
///
@JsonSerializable()
class EdgeSyncBatch {
  const EdgeSyncBatch({
    required this.batchId,
    required this.edgeGatewayId,
    required this.ledgerId,
    required this.epoch,
    required this.edgeSeqFrom,
    required this.edgeSeqTo,
    required this.prevChainHash,
    required this.lastChainHash,
    required this.operations,
    required this.signature,
    this.staffTokenAudit,
    this.localOrders,
    this.deviceBatches,
  });

  factory EdgeSyncBatch.fromJson(Map<String, Object?> json) =>
      _$EdgeSyncBatchFromJson(json);

  @JsonKey(name: 'batch_id')
  final String batchId;
  @JsonKey(name: 'edge_gateway_id')
  final String edgeGatewayId;
  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  final int epoch;
  @JsonKey(name: 'edge_seq_from')
  final int edgeSeqFrom;
  @JsonKey(name: 'edge_seq_to')
  final int edgeSeqTo;
  @JsonKey(name: 'prev_chain_hash')
  final Hex32 prevChainHash;
  @JsonKey(name: 'last_chain_hash')
  final Hex32 lastChainHash;

  /// Audit des usages d'un jeton de personne EXPIRÉ toléré au guichet de la passerelle (tolérance de la.
  /// décision 3 du porteur), pour les opérations de ce lot : au plus une ligne par opération, donc 500. Les.
  /// lignes sont couvertes par la signature du lot (`signature` porte sur le lot entier sans elle). Le central.
  /// les range dans `edge_staff_token_audit` (immuable, par passerelle) et les recopie dans l'audit de la.
  /// plateforme. Absent ou vide : aucun usage toléré dans ce lot. Une ligne dont `edge_seq` n'est pas dans.
  /// l'intervalle du lot est refusée (`400`, lot non traité).
  ///
  @JsonKey(name: 'staff_token_audit')
  final List<EdgeStaffTokenAudit>? staffTokenAudit;

  /// Ordres locaux à deux personnes exécutés sur la passerelle (levée locale de `STALE`, purge manuelle),.
  /// versés à l'audit du central au retour du lien. Couverts par la signature du lot. Absent ou vide :.
  /// aucun ordre local à verser. Le central les range à son audit (`EDGE_LOCAL_ORDER_RECORDED`), sans.
  /// jamais en tirer d'effet comptable.
  ///
  @JsonKey(name: 'local_orders')
  final List<EdgeLocalOrder>? localOrders;

  /// Au plus 500 opérations et 1 Mio par lot, dans l'ordre des `edge_seq`.
  final List<EdgeSyncOperation> operations;

  /// En-têtes et signatures d'origine des lots de terminaux relayés (une entrée par `device_batch_id`.
  /// référencé par une opération `DEVICE_OFFLINE` du lot) ; absent ou vide s'il n'y en a pas.
  ///
  @JsonKey(name: 'device_batches')
  final List<DeviceBatches>? deviceBatches;
  final String signature;

  Map<String, Object?> toJson() => _$EdgeSyncBatchToJson(this);
}
