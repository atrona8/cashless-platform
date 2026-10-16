// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'money_movement.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MoneyMovement _$MoneyMovementFromJson(Map<String, dynamic> json) =>
    MoneyMovement(
      method: $enumDecode(_$MoneyMovementMethodEnumMap, json['method']),
      msisdn: json['msisdn'] as String?,
    );

Map<String, dynamic> _$MoneyMovementToJson(MoneyMovement instance) =>
    <String, dynamic>{'method': instance.method, 'msisdn': instance.msisdn};

const _$MoneyMovementMethodEnumMap = {
  MoneyMovementMethod.cash: 'CASH',
  MoneyMovementMethod.wave: 'WAVE',
  MoneyMovementMethod.orangeMoney: 'ORANGE_MONEY',
  MoneyMovementMethod.card: 'CARD',
};
