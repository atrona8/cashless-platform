// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_webhooks_provider_psp_config_id_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostWebhooksProviderPspConfigIdResponse
_$PostWebhooksProviderPspConfigIdResponseFromJson(Map<String, dynamic> json) =>
    PostWebhooksProviderPspConfigIdResponse(
      received: json['received'] as bool,
      duplicate: json['duplicate'] as bool,
    );

Map<String, dynamic> _$PostWebhooksProviderPspConfigIdResponseToJson(
  PostWebhooksProviderPspConfigIdResponse instance,
) => <String, dynamic>{
  'received': instance.received,
  'duplicate': instance.duplicate,
};
