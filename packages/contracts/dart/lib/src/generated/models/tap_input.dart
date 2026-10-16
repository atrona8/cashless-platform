// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'hex32.dart';
import 'nfc_uid.dart';
import 'timestamp.dart';

part 'tap_input.g.dart';

/// Lecture d'un bracelet MIFARE Ultralight EV1 (format B).
@JsonSerializable()
class TapInput {
  const TapInput({
    required this.nfcUid,
    required this.tokenHash,
    required this.counter,
    required this.keyIndex,
    required this.packVerified,
    required this.occurredAt,
    this.originalitySignature,
    this.formatMajor = 1,
    this.formatMinor = 0,
  });

  factory TapInput.fromJson(Map<String, Object?> json) =>
      _$TapInputFromJson(json);

  @JsonKey(name: 'nfc_uid')
  final NfcUid nfcUid;
  @JsonKey(name: 'token_hash')
  final Hex32 tokenHash;

  /// Valeur du compteur 24 bits lue par READ_CNT après INCR_CNT.
  final int counter;
  @JsonKey(name: 'key_index')
  final int keyIndex;
  @JsonKey(name: 'format_major')
  final int formatMajor;
  @JsonKey(name: 'format_minor')
  final int formatMinor;

  /// Le PACK renvoyé par le tag après PWD_AUTH correspond au PACK attendu. DOIT être true.
  @JsonKey(name: 'pack_verified')
  final bool packVerified;

  /// Signature d'originalité NXP (READ_SIG, 32 octets), lue à chaque passage et vérifiée par le terminal.
  /// (ADR-59). Le terminal DOIT l'envoyer. Le serveur la compare à celle de la personnalisation : différente.
  /// → `SIGNATURE_MISMATCH` ; absente alors que la puce en a une → `SIGNATURE_MISSING` en ligne, anomalie.
  /// `SIGNATURE_MISMATCH` hors ligne (opération gardée).
  ///
  @JsonKey(name: 'originality_signature')
  final String? originalitySignature;
  @JsonKey(name: 'occurred_at')
  final Timestamp occurredAt;

  Map<String, Object?> toJson() => _$TapInputToJson(this);
}
