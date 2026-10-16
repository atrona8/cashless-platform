// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Issue de la tentative en ligne faite avec la même clé : jamais tentée, confirmée (réponse 2xx),.
/// inconnue (délai dépassé / coupure), refusée (réponse 4xx métier).
///
@JsonEnum()
enum OfflineOperationOnlineStatus {
  @JsonValue('NOT_ATTEMPTED')
  notAttempted('NOT_ATTEMPTED'),
  @JsonValue('CONFIRMED')
  confirmed('CONFIRMED'),
  @JsonValue('UNKNOWN')
  unknown('UNKNOWN'),
  @JsonValue('REJECTED')
  rejected('REJECTED');

  const OfflineOperationOnlineStatus(this.json);

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
