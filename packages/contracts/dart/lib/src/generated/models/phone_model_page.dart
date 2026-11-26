// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'phone_model.dart';

part 'phone_model_page.g.dart';

@JsonSerializable()
class PhoneModelPage {
  const PhoneModelPage({
    required this.data,
    required this.nextCursor,
    required this.hasMore,
  });

  factory PhoneModelPage.fromJson(Map<String, Object?> json) =>
      _$PhoneModelPageFromJson(json);

  final List<PhoneModel> data;
  @JsonKey(name: 'next_cursor')
  final String? nextCursor;
  @JsonKey(name: 'has_more')
  final bool hasMore;

  Map<String, Object?> toJson() => _$PhoneModelPageToJson(this);
}
