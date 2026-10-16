// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'encrypted_blob.dart';
import 'hex32.dart';
import 'media_status.dart';
import 'nfc_uid.dart';
import 'snapshot_entry_batch_status.dart';
import 'wallet_status.dart';

part 'snapshot_entry.g.dart';

/// Entrée du contenu (vue `offline_snapshot_rows`, sync_protocol.md §4.1) : une par rattachement ouvert.
/// Le terminal applique les mêmes règles que le serveur : statut du bracelet, du lot et du portefeuille,.
/// événement du lot, compteur strictement supérieur à `last_counter`. Environ 120 octets par entrée.
/// (≈ 6 Mo pour 50 000 bracelets).
///
@JsonSerializable()
class SnapshotEntry {
  const SnapshotEntry({
    required this.originalitySigSha256,
    required this.tokenHash,
    required this.nfcUid,
    required this.keyIndex,
    required this.status,
    required this.batchEventId,
    required this.batchStatus,
    required this.walletStatus,
    required this.spendable,
    required this.lastCounter,
    required this.pwdPackEnc,
  });

  factory SnapshotEntry.fromJson(Map<String, Object?> json) =>
      _$SnapshotEntryFromJson(json);

  /// SHA-256 de la signature d'originalité enregistrée à la personnalisation (`media.originality_sig_sha256`) ;.
  /// le terminal hors ligne compare la signature lue (ADR-59, sync_protocol.md §5.2-4). Null si aucune.
  /// signature n'est enregistrée.
  ///
  @JsonKey(name: 'originality_sig_sha256')
  final Hex32? originalitySigSha256;
  @JsonKey(name: 'token_hash')
  final Hex32 tokenHash;
  @JsonKey(name: 'nfc_uid')
  final NfcUid? nfcUid;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  final MediaStatus status;
  @JsonKey(name: 'batch_event_id')
  final String? batchEventId;
  @JsonKey(name: 'batch_status')
  final SnapshotEntryBatchStatus? batchStatus;

  /// Statut du portefeuille rattaché ; hors ligne, une vente n'est autorisée que si `ACTIVE`.
  @JsonKey(name: 'wallet_status')
  final WalletStatus walletStatus;
  final int spendable;
  @JsonKey(name: 'last_counter')
  final int? lastCounter;

  /// PWD||PACK chiffré (AES-256-GCM, clé de contenu `pwd_pack_key`) ; null si le bracelet n'est pas utilisable.
  @JsonKey(name: 'pwd_pack_enc')
  final EncryptedBlob? pwdPackEnc;

  Map<String, Object?> toJson() => _$SnapshotEntryToJson(this);
}
