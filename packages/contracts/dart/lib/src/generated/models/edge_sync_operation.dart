// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'clock.dart';
import 'currency.dart';
import 'edge_decision.dart';
import 'edge_guichet.dart';
import 'edge_sync_operation_authorized_mode.dart';
import 'hex32.dart';
import 'offline_operation_online_status.dart';
import 'offline_operation_type.dart';
import 'offline_operation_void_reason.dart';
import 'sale_line.dart';
import 'tap_input.dart';
import 'timestamp.dart';

part 'edge_sync_operation.g.dart';

@JsonSerializable()
class EdgeSyncOperation {
  const EdgeSyncOperation({
    required this.seq,
    required this.type,
    required this.occurredAt,
    required this.chainHash,
    required this.edgeSeq,
    required this.deviceSerial,
    required this.authorizedMode,
    this.amount,
    this.currency,
    this.tap,
    this.snapshotVersion,
    this.configId,
    this.localAvailableBefore,
    this.onlineStatus,
    this.onlineTapId,
    this.onlineTransactionId,
    this.onlineOperation,
    this.contentSha256,
    this.reversesSeq,
    this.reversesTransactionId,
    this.reason,
    this.voidReason,
    this.lines,
    this.clock,
    this.deviceBatchId,
    this.edgeGuichet,
    this.edgeDecision,
  });

  factory EdgeSyncOperation.fromJson(Map<String, Object?> json) =>
      _$EdgeSyncOperationFromJson(json);

  final int seq;
  final OfflineOperationType type;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;
  final Amount? amount;
  final Currency? currency;
  final TapInput? tap;

  /// Version du snapshot utilisé pour autoriser (champ d'état, hors `content_sha256`).
  @JsonKey(name: 'snapshot_version')
  final int? snapshotVersion;

  /// `DeviceConfig.config_id` de la configuration détenue au moment de l'autorisation. Champ d'ÉTAT.
  /// (comme `snapshot_version`), non chaîné : il n'entre pas dans `content_sha256`, car il est posé au.
  /// passage hors ligne d'une entrée créée en ligne (sync_protocol.md §3.3). Obligatoire pour une.
  /// opération autorisée hors ligne ; absent sinon. Une opération `online_status = CONFIRMED` sans.
  /// `config_id` est exemptée des contrôles de conformité (sync_protocol.md §7.2, §7.3).
  ///
  @JsonKey(name: 'config_id')
  final int? configId;

  /// Solde disponible calculé localement avant l'opération (contrôle).
  @JsonKey(name: 'local_available_before')
  final int? localAvailableBefore;

  /// Issue de la tentative en ligne faite avec la même clé : jamais tentée, confirmée (réponse 2xx),.
  /// inconnue (délai dépassé / coupure), refusée (réponse 4xx métier).
  ///
  @JsonKey(name: 'online_status')
  final OfflineOperationOnlineStatus? onlineStatus;

  /// `tap_id` reçu de `POST /taps` pour la lecture embarquée dans `tap`, s'il a été reçu. Champ d'état (non.
  /// chaîné). Le serveur réutilise cette lecture si elle est du même terminal, du même bracelet, du même.
  /// compteur et n'a servi à aucune écriture : pas de fausse copie quand le lot arrive après le délai de.
  /// renvoi (ADR-50).
  ///
  @JsonKey(name: 'online_tap_id')
  final int? onlineTapId;

  /// transaction_id reçu en ligne (si CONFIRMED).
  @JsonKey(name: 'online_transaction_id')
  final String? onlineTransactionId;

  /// Pour ONLINE_REF, operationId de l'appel en ligne (ex. activateMedia).
  @JsonKey(name: 'online_operation')
  final String? onlineOperation;
  @JsonKey(name: 'content_sha256')
  final Hex32? contentSha256;

  /// Pour REVERSAL, seq de la vente annulée (du même terminal).
  @JsonKey(name: 'reverses_seq')
  final int? reversesSeq;

  /// Pour REVERSAL d'une vente écrite en ligne.
  @JsonKey(name: 'reverses_transaction_id')
  final String? reversesTransactionId;
  final String? reason;
  @JsonKey(name: 'void_reason')
  final OfflineOperationVoidReason? voidReason;
  final List<SaleLine>? lines;
  final Clock? clock;
  @JsonKey(name: 'chain_hash')
  final Hex32 chainHash;
  @JsonKey(name: 'edge_seq')
  final int edgeSeq;
  @JsonKey(name: 'device_serial')
  final String deviceSerial;

  /// Autorisée en direct par la passerelle, ou relayée d'un lot hors ligne de terminal.
  @JsonKey(name: 'authorized_mode')
  final EdgeSyncOperationAuthorizedMode authorizedMode;

  /// Obligatoire si `authorized_mode = DEVICE_OFFLINE` : `header.batch_id` du lot d'origine du.
  /// terminal, dont l'en-tête et la signature sont relayés dans `EdgeSyncBatch.device_batches`.
  /// Il n'y a pas de signature par opération : le terminal signe l'en-tête de son lot.
  ///
  @JsonKey(name: 'device_batch_id')
  final String? deviceBatchId;

  /// Obligatoire pour `type = ACTIVATION` ou `DEPOSIT_CASH` (ADR-52). Le central rejoue `activate_media`.
  /// (avec `event_id`) ou `take_deposit` (mode `SEPARATE`, espèces de la station `cash_desk_account_id`).
  /// Rejeu impossible : `REJECTED` / `EDGE_REPLAY_FAILED` et espèces au compte d'attente (sync_protocol.md §9.6).
  ///
  @JsonKey(name: 'edge_guichet')
  final EdgeGuichet? edgeGuichet;

  /// Décision de la passerelle (autorité) : le central écrit ces montants tels quels.
  /// (répartition portefeuille / compte d'attente) et recalcule seulement frais et commissions.
  ///
  @JsonKey(name: 'edge_decision')
  final EdgeDecision? edgeDecision;

  Map<String, Object?> toJson() => _$EdgeSyncOperationToJson(this);
}
