// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Action d'une demande d'approbation (`approval_request.action`, liste fermée du schéma). Correspondance :.
/// `WAIVE_SEQ_GAP` → `waiveSeqGap` ; `DEVICE_JOURNAL_IMPORT` → `importDeviceJournal` ; `KYC_REVOCATION` →.
/// `revokeKycVerification` ; `WALLET_REFUND` → `approveRefundRequest` ; `LATE_CLAIM` → `postLateClaim` ;.
/// `FORCE_CENTRAL_AUTHORITY` → `requestDebitAuthorityChange` (`force = true`). `ADJUSTMENT`,.
/// `ANOMALY_RESOLUTION`, `REINSTATE_MEDIA`, `PAYOUT`, `PSP_CONFIGURATION`, `EVENT_PSP_SELECTION` : opérations.
/// du back-office à ajouter au contrat (SPECIFICATION §10.4), qui suivent le même flux.
/// Configuration (deux personnes du même rôle) : `EVENT_GO_LIVE` → `transitionEventStatus` (vers `LIVE`) ;.
/// `EVENT_SETTINGS_CHANGE` et `EVENT_OPERATOR_SETTINGS_CHANGE` → `updateEvent` (événement `LIVE`, réglages de.
/// l'organisateur ou du prestataire) ; `PARTICIPATION_CHANGE` → `createParticipation`, `updateParticipation`.
/// (événement `LIVE`) ; `FEE_RULE_CHANGE` → `createFeeRule`, `replaceFeeRule` (événement `LIVE`) ;.
/// `CONTRACT_VERSION` → `createOrganizerContractVersion`. Niveau plateforme (demande sans prestataire, décidée.
/// par un autre `PLATFORM_ADMIN`) : `PLATFORM_CONTRACT_VERSION` → `createPlatformContractVersion` ;.
/// `JURISDICTION_LIMITS_CHANGE` → `createJurisdictionProfileVersion` (plafond réglementaire modifié).
/// Bracelets : `TAG_KEY_CREATE` → `requestTagKey` ; `TAG_DEK_ROTATE` → `requestDekRotation` ; `TAG_KEY_RETIRE` →.
/// `requestTagKeyRetirement` ; `REINSTATE_MEDIA` → `requestMediaReinstatement`.
///
@JsonEnum()
enum ApprovalAction {
  @JsonValue('LATE_CLAIM')
  lateClaim('LATE_CLAIM'),
  @JsonValue('ADJUSTMENT')
  adjustment('ADJUSTMENT'),
  @JsonValue('ANOMALY_RESOLUTION')
  anomalyResolution('ANOMALY_RESOLUTION'),
  @JsonValue('WAIVE_SEQ_GAP')
  waiveSeqGap('WAIVE_SEQ_GAP'),
  @JsonValue('FORCE_CENTRAL_AUTHORITY')
  forceCentralAuthority('FORCE_CENTRAL_AUTHORITY'),
  @JsonValue('REINSTATE_MEDIA')
  reinstateMedia('REINSTATE_MEDIA'),
  @JsonValue('PAYOUT')
  payout('PAYOUT'),
  @JsonValue('DEVICE_JOURNAL_IMPORT')
  deviceJournalImport('DEVICE_JOURNAL_IMPORT'),
  @JsonValue('KYC_REVOCATION')
  kycRevocation('KYC_REVOCATION'),
  @JsonValue('PSP_CONFIGURATION')
  pspConfiguration('PSP_CONFIGURATION'),
  @JsonValue('EVENT_PSP_SELECTION')
  eventPspSelection('EVENT_PSP_SELECTION'),
  @JsonValue('WALLET_REFUND')
  walletRefund('WALLET_REFUND'),
  @JsonValue('LATE_CHARGEBACK')
  lateChargeback('LATE_CHARGEBACK'),
  @JsonValue('EVENT_GO_LIVE')
  eventGoLive('EVENT_GO_LIVE'),
  @JsonValue('EVENT_SETTINGS_CHANGE')
  eventSettingsChange('EVENT_SETTINGS_CHANGE'),
  @JsonValue('EVENT_OPERATOR_SETTINGS_CHANGE')
  eventOperatorSettingsChange('EVENT_OPERATOR_SETTINGS_CHANGE'),
  @JsonValue('PARTICIPATION_CHANGE')
  participationChange('PARTICIPATION_CHANGE'),
  @JsonValue('FEE_RULE_CHANGE')
  feeRuleChange('FEE_RULE_CHANGE'),
  @JsonValue('CONTRACT_VERSION')
  contractVersion('CONTRACT_VERSION'),
  @JsonValue('PLATFORM_CONTRACT_VERSION')
  platformContractVersion('PLATFORM_CONTRACT_VERSION'),
  @JsonValue('JURISDICTION_LIMITS_CHANGE')
  jurisdictionLimitsChange('JURISDICTION_LIMITS_CHANGE'),
  @JsonValue('TAG_KEY_CREATE')
  tagKeyCreate('TAG_KEY_CREATE'),
  @JsonValue('TAG_DEK_ROTATE')
  tagDekRotate('TAG_DEK_ROTATE'),
  @JsonValue('TAG_KEY_RETIRE')
  tagKeyRetire('TAG_KEY_RETIRE');

  const ApprovalAction(this.json);

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
