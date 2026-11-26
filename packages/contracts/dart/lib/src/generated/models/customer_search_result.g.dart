// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'customer_search_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CustomerSearchResult _$CustomerSearchResultFromJson(
  Map<String, dynamic> json,
) => CustomerSearchResult(
  maskedPhone: json['masked_phone'] as String,
  wallets: (json['wallets'] as List<dynamic>)
      .map((e) => WalletOverview.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$CustomerSearchResultToJson(
  CustomerSearchResult instance,
) => <String, dynamic>{
  'masked_phone': instance.maskedPhone,
  'wallets': instance.wallets,
};
