// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'customer_search_request.g.dart';

@JsonSerializable()
class CustomerSearchRequest {
  const CustomerSearchRequest({required this.phone});

  factory CustomerSearchRequest.fromJson(Map<String, Object?> json) =>
      _$CustomerSearchRequestFromJson(json);

  /// Numéro E.164 strict, exact (jamais partiel).
  final String phone;

  Map<String, Object?> toJson() => _$CustomerSearchRequestToJson(this);
}
