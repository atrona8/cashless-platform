// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'psp_webhook_event.g.dart';

/// Corps natif du PSP (non normalisé) ; seuls `id` et `type` sont exigés ici.
@JsonSerializable()
class PspWebhookEvent {
  const PspWebhookEvent({required this.id, required this.type, this.data});

  factory PspWebhookEvent.fromJson(Map<String, Object?> json) =>
      _$PspWebhookEventFromJson(json);

  final String id;
  final String type;
  final dynamic data;

  Map<String, Object?> toJson() => _$PspWebhookEventToJson(this);
}
