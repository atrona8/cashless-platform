// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_reference.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeReference _$EdgeReferenceFromJson(Map<String, dynamic> json) =>
    EdgeReference(
      fromChangeSeq: (json['from_change_seq'] as num).toInt(),
      toChangeSeq: (json['to_change_seq'] as num).toInt(),
      hasMore: json['has_more'] as bool,
      gateway: json['gateway'] == null
          ? null
          : EdgeGatewaySelf.fromJson(json['gateway'] as Map<String, dynamic>),
      event: json['event'] == null
          ? null
          : EdgeEventSettings.fromJson(json['event'] as Map<String, dynamic>),
      walletStates: (json['wallet_states'] as List<dynamic>?)
          ?.map((e) => EdgeWalletState.fromJson(e as Map<String, dynamic>))
          .toList(),
      devices: (json['devices'] as List<dynamic>?)
          ?.map((e) => EdgeDevice.fromJson(e as Map<String, dynamic>))
          .toList(),
      deviceConfigs: (json['device_configs'] as List<dynamic>?)
          ?.map((e) => EdgeDeviceConfig.fromJson(e as Map<String, dynamic>))
          .toList(),
      cashSessions: (json['cash_sessions'] as List<dynamic>?)
          ?.map((e) => EdgeCashSession.fromJson(e as Map<String, dynamic>))
          .toList(),
      vendors: (json['vendors'] as List<dynamic>?)
          ?.map((e) => EdgeVendor.fromJson(e as Map<String, dynamic>))
          .toList(),
      vendorSessions: (json['vendor_sessions'] as List<dynamic>?)
          ?.map((e) => EdgeVendorSession.fromJson(e as Map<String, dynamic>))
          .toList(),
      staff: (json['staff'] as List<dynamic>?)
          ?.map((e) => EdgeStaff.fromJson(e as Map<String, dynamic>))
          .toList(),
      catalogs: (json['catalogs'] as List<dynamic>?)
          ?.map((e) => EdgeCatalog.fromJson(e as Map<String, dynamic>))
          .toList(),
      mediaRefs: (json['media_refs'] as List<dynamic>?)
          ?.map((e) => EdgeMediaRef.fromJson(e as Map<String, dynamic>))
          .toList(),
      unassignedMedia: (json['unassigned_media'] as List<dynamic>?)
          ?.map((e) => EdgeUnassignedMedia.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$EdgeReferenceToJson(EdgeReference instance) =>
    <String, dynamic>{
      'from_change_seq': instance.fromChangeSeq,
      'to_change_seq': instance.toChangeSeq,
      'has_more': instance.hasMore,
      'gateway': instance.gateway,
      'event': instance.event,
      'wallet_states': instance.walletStates,
      'devices': instance.devices,
      'device_configs': instance.deviceConfigs,
      'cash_sessions': instance.cashSessions,
      'vendors': instance.vendors,
      'vendor_sessions': instance.vendorSessions,
      'staff': instance.staff,
      'catalogs': instance.catalogs,
      'media_refs': instance.mediaRefs,
      'unassigned_media': instance.unassignedMedia,
    };
