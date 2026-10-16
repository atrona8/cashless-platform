// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'clock.g.dart';

@JsonSerializable()
class Clock {
  const Clock({this.monotonicMs, this.bootId, this.offsetMs});

  factory Clock.fromJson(Map<String, Object?> json) => _$ClockFromJson(json);

  /// Horloge monotone depuis le démarrage.
  @JsonKey(name: 'monotonic_ms')
  final int? monotonicMs;
  @JsonKey(name: 'boot_id')
  final String? bootId;

  /// Décalage estimé (heure serveur − heure terminal) lors du dernier contact.
  @JsonKey(name: 'offset_ms')
  final int? offsetMs;

  Map<String, Object?> toJson() => _$ClockToJson(this);
}
