// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'currency.dart';
import 'hex32.dart';
import 'snapshot_header_kind.dart';
import 'timestamp.dart';

part 'snapshot_header.g.dart';

/// Partie signée. Signature (algorithme de la clé `key_id`, `ECDSA_P256_SHA256` par défaut) sur la.
/// sérialisation canonique JSON (RFC 8785, JCS) de cet objet entier (sync_protocol.md §4.1).
/// `content_sha256` = SHA-256 de la sérialisation JCS de `{entries, removed_token_hashes}` (sans les.
/// champs chiffrés `pwd_pack_enc`, propres à chaque terminal). Un snapshot produit par la passerelle est.
/// signé par une clé propre à la passerelle (hors KMS, stockage matériel), de `key_id` distinct.
///
@JsonSerializable()
class SnapshotHeader {
  const SnapshotHeader({
    required this.format,
    required this.kind,
    required this.operatorId,
    required this.ledgerId,
    required this.eventId,
    required this.currency,
    required this.version,
    required this.baseVersion,
    required this.generatedAt,
    required this.validUntil,
    required this.entries,
    required this.removed,
    required this.contentSha256,
    required this.authorityEpoch,
    required this.keyId,
  });

  factory SnapshotHeader.fromJson(Map<String, Object?> json) =>
      _$SnapshotHeaderFromJson(json);

  final String format;
  final SnapshotHeaderKind kind;
  @JsonKey(name: 'operator_id')
  final String operatorId;
  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  @JsonKey(name: 'event_id')
  final String eventId;
  final Currency currency;
  final int version;

  /// Pour un DELTA, version à laquelle il s'applique ; `null` pour un FULL.
  @JsonKey(name: 'base_version')
  final int? baseVersion;
  @JsonKey(name: 'generated_at')
  final Timestamp generatedAt;
  @JsonKey(name: 'valid_until')
  final Timestamp validUntil;

  /// Nombre d'entrées du contenu.
  final int entries;

  /// Nombre de retraits (`removed_token_hashes`) ; 0 pour un FULL.
  final int removed;
  @JsonKey(name: 'content_sha256')
  final Hex32 contentSha256;
  @JsonKey(name: 'authority_epoch')
  final int authorityEpoch;
  @JsonKey(name: 'key_id')
  final String keyId;

  Map<String, Object?> toJson() => _$SnapshotHeaderToJson(this);
}
