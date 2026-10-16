// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'devices_device_id_seq_gaps_seq_waive_request_body.g.dart';

@JsonSerializable()
class DevicesDeviceIdSeqGapsSeqWaiveRequestBody {
  const DevicesDeviceIdSeqGapsSeqWaiveRequestBody({required this.reason});

  factory DevicesDeviceIdSeqGapsSeqWaiveRequestBody.fromJson(
    Map<String, Object?> json,
  ) => _$DevicesDeviceIdSeqGapsSeqWaiveRequestBodyFromJson(json);

  final String reason;

  Map<String, Object?> toJson() =>
      _$DevicesDeviceIdSeqGapsSeqWaiveRequestBodyToJson(this);
}
