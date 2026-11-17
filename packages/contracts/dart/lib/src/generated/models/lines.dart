// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'signed_amount.dart';

part 'lines.g.dart';

@JsonSerializable()
class Lines {
  const Lines({
    required this.partyId,
    required this.amount,
    this.label,
    this.reference,
  });

  factory Lines.fromJson(Map<String, Object?> json) => _$LinesFromJson(json);

  /// Bénéficiaire (ou partie débitée).
  @JsonKey(name: 'party_id')
  final String partyId;
  final String? label;
  final SignedAmount amount;

  /// Référence sans écriture (droit de place `PREPAID`).
  final String? reference;

  Map<String, Object?> toJson() => _$LinesToJson(this);
}
