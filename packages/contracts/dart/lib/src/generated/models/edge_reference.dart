// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'edge_cash_session.dart';
import 'edge_catalog.dart';
import 'edge_device.dart';
import 'edge_device_config.dart';
import 'edge_event_settings.dart';
import 'edge_gateway_self.dart';
import 'edge_media_ref.dart';
import 'edge_staff.dart';
import 'edge_unassigned_media.dart';
import 'edge_vendor.dart';
import 'edge_vendor_session.dart';
import 'edge_wallet_state.dart';

part 'edge_reference.g.dart';

/// Changements de données de référence de l'événement de la passerelle, par ordre de `change_seq`. Chaque.
/// entité modifiée est renvoyée en entier (état courant, pas de différence). Une fermeture ou une.
/// révocation est un changement d'état de l'entité (`status`, `closed_at`), jamais une suppression : la.
/// passerelle n'a donc besoin d'aucun marqueur de suppression. Tout est limité à l'événement, au grand.
/// livre et au prestataire de la passerelle authentifiée (NFR-011).
///
@JsonSerializable()
class EdgeReference {
  const EdgeReference({
    required this.fromChangeSeq,
    required this.toChangeSeq,
    required this.hasMore,
    this.gateway,
    this.event,
    this.walletStates,
    this.devices,
    this.deviceConfigs,
    this.cashSessions,
    this.vendors,
    this.vendorSessions,
    this.staff,
    this.catalogs,
    this.mediaRefs,
    this.unassignedMedia,
  });

  factory EdgeReference.fromJson(Map<String, Object?> json) =>
      _$EdgeReferenceFromJson(json);

  /// Curseur reçu.
  @JsonKey(name: 'from_change_seq')
  final int fromChangeSeq;

  /// Dernier changement inclus ; à renvoyer comme `after_change_seq`.
  @JsonKey(name: 'to_change_seq')
  final int toChangeSeq;

  /// D'autres changements attendent. Indépendant de `ReplicationPage.has_more` : la passerelle boucle.
  /// tant que l'un des deux est vrai. Les deux curseurs avancent séparément.
  ///
  @JsonKey(name: 'has_more')
  final bool hasMore;
  final EdgeGatewaySelf? gateway;
  final EdgeEventSettings? event;
  @JsonKey(name: 'wallet_states')
  final List<EdgeWalletState>? walletStates;
  final List<EdgeDevice>? devices;
  @JsonKey(name: 'device_configs')
  final List<EdgeDeviceConfig>? deviceConfigs;
  @JsonKey(name: 'cash_sessions')
  final List<EdgeCashSession>? cashSessions;
  final List<EdgeVendor>? vendors;
  @JsonKey(name: 'vendor_sessions')
  final List<EdgeVendorSession>? vendorSessions;
  final List<EdgeStaff>? staff;
  final List<EdgeCatalog>? catalogs;
  @JsonKey(name: 'media_refs')
  final List<EdgeMediaRef>? mediaRefs;
  @JsonKey(name: 'unassigned_media')
  final List<EdgeUnassignedMedia>? unassignedMedia;

  Map<String, Object?> toJson() => _$EdgeReferenceToJson(this);
}
