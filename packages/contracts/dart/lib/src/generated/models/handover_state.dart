// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// TO_EDGE : GRANTED → ACTIVE. TO_CENTRAL : RELEASE_REQUESTED → RELEASING → COMPLETED.
/// `RELEASING` est posé par l'API à la réception de `POST /edge/handovers/{handover_id}/release`,.
/// avant toute vérification (sync_protocol.md §9.3, étape 5).
/// FORCED : reprise forcée par le central. FAILED : abandon.
///
@JsonEnum()
enum HandoverState {
  @JsonValue('GRANTED')
  granted('GRANTED'),
  @JsonValue('ACTIVE')
  active('ACTIVE'),
  @JsonValue('RELEASE_REQUESTED')
  releaseRequested('RELEASE_REQUESTED'),
  @JsonValue('RELEASING')
  releasing('RELEASING'),
  @JsonValue('COMPLETED')
  completed('COMPLETED'),
  @JsonValue('FORCED')
  forced('FORCED'),
  @JsonValue('FAILED')
  failed('FAILED');

  const HandoverState(this.json);

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
