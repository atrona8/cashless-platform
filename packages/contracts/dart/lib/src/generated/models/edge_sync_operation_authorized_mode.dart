// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Autorisée en direct par la passerelle, ou relayée d'un lot hors ligne de terminal.
@JsonEnum()
enum EdgeSyncOperationAuthorizedMode {
  @JsonValue('EDGE_ONLINE')
  edgeOnline('EDGE_ONLINE'),
  @JsonValue('DEVICE_OFFLINE')
  deviceOffline('DEVICE_OFFLINE');

  const EdgeSyncOperationAuthorizedMode(this.json);

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
