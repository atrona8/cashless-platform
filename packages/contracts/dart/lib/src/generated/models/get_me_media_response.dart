// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'customer_media.dart';

part 'get_me_media_response.g.dart';

@JsonSerializable()
class GetMeMediaResponse {
  const GetMeMediaResponse({required this.data});

  factory GetMeMediaResponse.fromJson(Map<String, Object?> json) =>
      _$GetMeMediaResponseFromJson(json);

  final List<CustomerMedia> data;

  Map<String, Object?> toJson() => _$GetMeMediaResponseToJson(this);
}
