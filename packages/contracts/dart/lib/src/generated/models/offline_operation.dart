// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'amount.dart';
import 'clock.dart';
import 'currency.dart';
import 'hex32.dart';
import 'offline_operation_online_status.dart';
import 'offline_operation_type.dart';
import 'offline_operation_void_reason.dart';
import 'sale_line.dart';
import 'tap_input.dart';
import 'timestamp.dart';

part 'offline_operation.g.dart';

@JsonSerializable()
class OfflineOperation {
  const OfflineOperation({
    required this.seq,
    required this.type,
    required this.occurredAt,
    required this.chainHash,
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
  });

  factory OfflineOperation.fromJson(Map<String, Object?> json) =>
      _$OfflineOperationFromJson(json);

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

  Map<String, Object?> toJson() => _$OfflineOperationToJson(this);
}
