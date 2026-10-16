// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edge_sync_operation.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EdgeSyncOperation _$EdgeSyncOperationFromJson(Map<String, dynamic> json) =>
    EdgeSyncOperation(
      seq: (json['seq'] as num).toInt(),
      type: $enumDecode(_$OfflineOperationTypeEnumMap, json['type']),
      occurredAt: DateTime.parse(json['occurred_at'] as String),
      chainHash: json['chain_hash'] as String,
      edgeSeq: (json['edge_seq'] as num).toInt(),
      deviceSerial: json['device_serial'] as String,
      authorizedMode: $enumDecode(
        _$EdgeSyncOperationAuthorizedModeEnumMap,
        json['authorized_mode'],
      ),
      amount: (json['amount'] as num?)?.toInt(),
      currency: json['currency'] as String?,
      tap: json['tap'] == null
          ? null
          : TapInput.fromJson(json['tap'] as Map<String, dynamic>),
      snapshotVersion: (json['snapshot_version'] as num?)?.toInt(),
      configId: (json['config_id'] as num?)?.toInt(),
      localAvailableBefore: (json['local_available_before'] as num?)?.toInt(),
      onlineStatus: $enumDecodeNullable(
        _$OfflineOperationOnlineStatusEnumMap,
        json['online_status'],
      ),
      onlineTapId: (json['online_tap_id'] as num?)?.toInt(),
      onlineTransactionId: json['online_transaction_id'] as String?,
      onlineOperation: json['online_operation'] as String?,
      contentSha256: json['content_sha256'] as String?,
      reversesSeq: (json['reverses_seq'] as num?)?.toInt(),
      reversesTransactionId: json['reverses_transaction_id'] as String?,
      reason: json['reason'] as String?,
      voidReason: $enumDecodeNullable(
        _$OfflineOperationVoidReasonEnumMap,
        json['void_reason'],
      ),
      lines: (json['lines'] as List<dynamic>?)
          ?.map((e) => SaleLine.fromJson(e as Map<String, dynamic>))
          .toList(),
      clock: json['clock'] == null
          ? null
          : Clock.fromJson(json['clock'] as Map<String, dynamic>),
      deviceBatchId: json['device_batch_id'] as String?,
      edgeGuichet: json['edge_guichet'] == null
          ? null
          : EdgeGuichet.fromJson(json['edge_guichet'] as Map<String, dynamic>),
      edgeDecision: json['edge_decision'] == null
          ? null
          : EdgeDecision.fromJson(
              json['edge_decision'] as Map<String, dynamic>,
            ),
    );

Map<String, dynamic> _$EdgeSyncOperationToJson(EdgeSyncOperation instance) =>
    <String, dynamic>{
      'seq': instance.seq,
      'type': instance.type,
      'occurred_at': instance.occurredAt.toIso8601String(),
      'amount': instance.amount,
      'currency': instance.currency,
      'tap': instance.tap,
      'snapshot_version': instance.snapshotVersion,
      'config_id': instance.configId,
      'local_available_before': instance.localAvailableBefore,
      'online_status': instance.onlineStatus,
      'online_tap_id': instance.onlineTapId,
      'online_transaction_id': instance.onlineTransactionId,
      'online_operation': instance.onlineOperation,
      'content_sha256': instance.contentSha256,
      'reverses_seq': instance.reversesSeq,
      'reverses_transaction_id': instance.reversesTransactionId,
      'reason': instance.reason,
      'void_reason': instance.voidReason,
      'lines': instance.lines,
      'clock': instance.clock,
      'chain_hash': instance.chainHash,
      'edge_seq': instance.edgeSeq,
      'device_serial': instance.deviceSerial,
      'authorized_mode': instance.authorizedMode,
      'device_batch_id': instance.deviceBatchId,
      'edge_guichet': instance.edgeGuichet,
      'edge_decision': instance.edgeDecision,
    };

const _$OfflineOperationTypeEnumMap = {
  OfflineOperationType.purchase: 'PURCHASE',
  OfflineOperationType.reversal: 'REVERSAL',
  OfflineOperationType.topupCash: 'TOPUP_CASH',
  OfflineOperationType.valueVoid: 'VOID',
  OfflineOperationType.onlineRef: 'ONLINE_REF',
  OfflineOperationType.activation: 'ACTIVATION',
  OfflineOperationType.depositCash: 'DEPOSIT_CASH',
};

const _$EdgeSyncOperationAuthorizedModeEnumMap = {
  EdgeSyncOperationAuthorizedMode.edgeOnline: 'EDGE_ONLINE',
  EdgeSyncOperationAuthorizedMode.deviceOffline: 'DEVICE_OFFLINE',
};

const _$OfflineOperationOnlineStatusEnumMap = {
  OfflineOperationOnlineStatus.notAttempted: 'NOT_ATTEMPTED',
  OfflineOperationOnlineStatus.confirmed: 'CONFIRMED',
  OfflineOperationOnlineStatus.unknown: 'UNKNOWN',
  OfflineOperationOnlineStatus.rejected: 'REJECTED',
};

const _$OfflineOperationVoidReasonEnumMap = {
  OfflineOperationVoidReason.abortedByOperator: 'ABORTED_BY_OPERATOR',
  OfflineOperationVoidReason.onlineRejected: 'ONLINE_REJECTED',
  OfflineOperationVoidReason.nfcReadFailed: 'NFC_READ_FAILED',
  OfflineOperationVoidReason.appCrashRecovery: 'APP_CRASH_RECOVERY',
};
