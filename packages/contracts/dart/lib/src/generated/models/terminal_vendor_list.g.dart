// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'terminal_vendor_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

TerminalVendorList _$TerminalVendorListFromJson(Map<String, dynamic> json) =>
    TerminalVendorList(
      data: (json['data'] as List<dynamic>)
          .map((e) => TerminalVendor.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$TerminalVendorListToJson(TerminalVendorList instance) =>
    <String, dynamic>{'data': instance.data};
