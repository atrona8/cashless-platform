// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// PURCHASE (vente), REVERSAL (annulation d'une vente), TOPUP_CASH (si `cash_topup_offline`),.
/// VOID (numéro consommé sans effet comptable : abandon, refus en ligne), ONLINE_REF (référence à une.
/// opération exclusivement en ligne — activation, caution, restitution, QR… — identifiée par son.
/// `online_operation` et son `content_sha256`). Le lot couvre TOUS les numéros, y compris ceux déjà.
/// confirmés en ligne (sync_protocol.md §6.1 et §3.4).
/// ACTIVATION et DEPOSIT_CASH : uniquement dans un lot de la passerelle (`EdgeSyncOperation`, `authorized_mode =.
/// EDGE_ONLINE`), pour une activation ou une caution en espèces faite au guichet pendant `EDGE` (ADR-52) ;.
/// détail dans `edge_guichet`. Un terminal NE DOIT PAS les utiliser dans ses propres lots.
///
@JsonEnum()
enum OfflineOperationType {
  @JsonValue('PURCHASE')
  purchase('PURCHASE'),
  @JsonValue('REVERSAL')
  reversal('REVERSAL'),
  @JsonValue('TOPUP_CASH')
  topupCash('TOPUP_CASH'),

  /// The name has been replaced because it contains a keyword. Original name: `VOID`.
  @JsonValue('VOID')
  valueVoid('VOID'),
  @JsonValue('ONLINE_REF')
  onlineRef('ONLINE_REF'),
  @JsonValue('ACTIVATION')
  activation('ACTIVATION'),
  @JsonValue('DEPOSIT_CASH')
  depositCash('DEPOSIT_CASH');

  const OfflineOperationType(this.json);

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError(
        'Cannot convert enum value with null JSON representation to String. '
        'This usually happens for \$unknown or @JsonValue(null) entries.',
      );
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
}
