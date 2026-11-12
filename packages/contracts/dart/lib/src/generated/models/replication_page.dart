// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_device_seq_acked.dart';
import 'edge_reference.dart';
import 'edge_terms.dart';
import 'snapshot_entry.dart';
import 'wallets.dart';
import 'wrapped_key.dart';

part 'replication_page.g.dart';

@JsonSerializable()
class ReplicationPage {
  const ReplicationPage({
    required this.ledgerId,
    required this.epoch,
    required this.fromPostingId,
    required this.toPostingId,
    required this.wallets,
    required this.media,
    required this.hasMore,
    this.edgeSeqApplied,
    this.deviceSeqAcked,
    this.pwdPackKey,
    this.reference,
    this.edgeTerms,
  });

  factory ReplicationPage.fromJson(Map<String, Object?> json) =>
      _$ReplicationPageFromJson(json);

  @JsonKey(name: 'ledger_id')
  final String ledgerId;
  final int epoch;
  @JsonKey(name: 'from_posting_id')
  final int fromPostingId;
  @JsonKey(name: 'to_posting_id')
  final int toPostingId;
  final List<Wallets> wallets;
  final List<SnapshotEntry> media;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  /// `contiguous_edge_seq` de la passerelle (dernier `edge_seq` enregistré au registre du central), lu dans la.
  /// MÊME transaction `REPEATABLE READ` que les soldes de la page. Sert au calcul du solde effectif de la.
  /// passerelle : solde central répliqué plus les deltas locaux des opérations d'`edge_seq` supérieur à cette.
  /// valeur, ce qui évite le double comptage d'une vente déjà rejouée (A02, A26). Présent sur chaque page.
  ///
  @JsonKey(name: 'edge_seq_applied')
  final int? edgeSeqApplied;

  /// Accusé du central par terminal de l'événement, pour `getDeviceSeqStatus` (FR-026). Remplace tout champ.
  /// `seq_status` par terminal : il n'existe qu'ici. Après la bascule la passerelle ne l'avance que par les.
  /// résultats de `submitEdgeSyncBatch`, jamais provisoirement. Servi sur la dernière page d'une passe.
  /// (`has_more = false`) ; périmé plutôt que provisoire.
  ///
  @JsonKey(name: 'device_seq_acked')
  final List<EdgeDeviceSeqAcked>? deviceSeqAcked;

  /// Clé de contenu PAR PASSERELLE (et par clé d'accord), pas par page : elle est la même à chaque page tant que.
  /// la clé d'accord de la passerelle ne change pas (le central la génère une fois, la scelle pour.
  /// `edge_gateway.agreement_public_key`, jamais pour un terminal, et la dépose avec les colis). Elle ouvre les.
  /// `pwd_pack_enc` des entrées de `media` et de `reference.unassigned_media`. Absente (et colis non servis).
  /// pour une passerelle `STANDBY` non promue et pendant le délai suivant l'inscription ou la promotion (A16).
  /// Requise.
  /// par le contrat existant des entrées (`SnapshotEntry.pwd_pack_enc`) mais absente de la page.
  /// aujourd'hui : sans elle la passerelle ne peut pas ouvrir les mots de passe qu'on lui envoie.
  /// Usage : `getMediaAuthKey` (re-chiffrement pour le terminal) et `getOfflineSnapshot` (snapshot signé.
  /// par la passerelle). Le central l'émet dès qu'une entrée de la page porte un `pwd_pack_enc`.
  /// La construction de scellement et l'AAD (liaison à `ledger_id`, `edge_gateway_id` et à la page) sont.
  /// fixés par le plan ; le central ne scelle que pour la clé d'accord de la passerelle appelante.
  ///
  @JsonKey(name: 'pwd_pack_key')
  final WrappedKey? pwdPackKey;

  /// Données de référence que la passerelle ne peut pas déduire des écritures (sessions, terminaux,.
  /// personnes habilitées, catalogue, réglages de l'événement, bracelets non encore attachés).
  /// Servi seulement si la requête porte `after_change_seq`.
  ///
  final EdgeReference? reference;

  /// Conditions que la passerelle ne peut pas déduire des écritures, pour qu'elle serve la caution, les frais.
  /// d'activation et le plafond de recharge en espèces pendant `EDGE` (usage : `activateMedia`, `takeDeposit`,.
  /// `createCashTopup`). Servi sur la dernière page d'une passe (`has_more = false`), état courant du central,.
  /// limité à l'événement et au prestataire de la passerelle. Chaque clé est facultative : une clé absente.
  /// signifie « inconnu » et la passerelle garde son refus (échec fermé). Champ absent : même comportement.
  ///
  @JsonKey(name: 'edge_terms')
  final EdgeTerms? edgeTerms;

  Map<String, Object?> toJson() => _$ReplicationPageToJson(this);
}
