// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'post_webhooks_provider_psp_config_id_response.g.dart';

@JsonSerializable()
class PostWebhooksProviderPspConfigIdResponse {
  const PostWebhooksProviderPspConfigIdResponse({
    required this.received,
    required this.duplicate,
  });

  factory PostWebhooksProviderPspConfigIdResponse.fromJson(
    Map<String, Object?> json,
  ) => _$PostWebhooksProviderPspConfigIdResponseFromJson(json);

  final bool received;
  final bool duplicate;

  Map<String, Object?> toJson() =>
      _$PostWebhooksProviderPspConfigIdResponseToJson(this);
}
