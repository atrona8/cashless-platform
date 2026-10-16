// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Codes métier stables (ne jamais renommer ; en ajouter est une évolution compatible). La traduction.
/// SQLSTATE → code suit SPECIFICATION §5.7 (jamais le texte du message SQL). Sens de chaque code :.
/// - `VALIDATION_FAILED` (400, ou 422 pour une valeur bien formée mais non prise en charge) : requête ou donnée invalide, y compris tout refus `CL001` de la base.
/// - `UNAUTHENTICATED` (401) : jeton ou certificat absent, expiré ou invalide.
/// - `FORBIDDEN` (403) : rôle insuffisant (y compris le valideur d'une demande d'approbation), ou refus de la.
///   base faute de seconde personne distincte de l'auteur (`23514`).
/// - `APPROVAL_REQUIRED` (403) : opération de guichet qui exige une seconde personne, sans en-tête.
///   `X-Approval-Token` (ADR-74).
/// - `APPROVAL_INVALID` : seconde validation refusée (ADR-74). Règle : `403` pour un jeton d'approbation sur.
///   place (invalide, expiré, déjà utilisé, d'une autre action ou de la même personne que l'appelant, rôle.
///   du valideur insuffisant) ; `409` (`CL023`) pour une demande d'approbation du back-office (expirée, déjà.
///   décidée, ou décidée par son auteur). 403 = la preuve jointe à la requête ne vaut rien ; 409 = l'état.
///   de la demande enregistrée ne permet plus la décision.
/// - `NOT_FOUND` (404) : objet inexistant ou d'un autre prestataire (réponse neutre).
/// - `RATE_LIMITED` (429) : trop de requêtes ou d'essais ; voir `Retry-After`.
/// - `INTERNAL_ERROR` (500) : erreur interne ; réessayer avec la même clé d'idempotence.
/// - `SERVICE_UNAVAILABLE` (503) : service momentanément indisponible ; réessayer avec la même clé.
/// - `IDEMPOTENCY_KEY_REQUIRED` (400) : écriture sans en-tête `Idempotency-Key`.
/// - `IDEMPOTENCY_KEY_REUSED` (409, `CL002`) : même clé, contenu différent.
/// - `IDEMPOTENCY_KEY_IN_PROGRESS` (409) : requête concurrente avec la même clé encore en cours.
/// - `ENROLLMENT_CODE_INVALID` (422) : code d'enrôlement inconnu ou déjà utilisé.
/// - `ENROLLMENT_CODE_EXPIRED` (422) : code d'enrôlement expiré.
/// - `ATTESTATION_FAILED` (422) : attestation de clé Android non conforme (clé hors du matériel sécurisé,.
///   bootloader déverrouillé, application non signée ou modifiée). Pas de MDM (ADR-69).
/// - `REFRESH_TOKEN_INVALID` (401) : jeton de rafraîchissement inconnu, déjà consommé (la famille est.
///   révoquée) ou preuve de possession invalide.
/// - `DEVICE_SUSPENDED` (403) : terminal suspendu.
/// - `DEVICE_REVOKED` (403) : terminal révoqué (SQLSTATE `42501`).
/// - `DEVICE_NOT_ASSIGNED` (409) : terminal sans affectation (événement, point de vente) pour cette action.
/// - `DEVICE_MODE_NOT_ALLOWED` (422) : mode d'application non permis ; en V1, tout usage de `PAIRED_TPE`.
///   ou de `payment_intent_id` (V2, ADR-43).
/// - `CLOCK_SKEW_TOO_LARGE` (400) : horloge du terminal hors de la tolérance (`clock_tolerance_seconds`).
/// - `CURRENCY_MISMATCH` (422) : devise différente de celle de l'événement.
/// - `AMOUNT_OUT_OF_RANGE` (422) : montant hors des bornes permises pour l'opération.
/// - `INSUFFICIENT_FUNDS` (422, `CL007`) : solde disponible insuffisant (refus en ligne définitif).
/// - `WALLET_BLOCKED` (422) : portefeuille bloqué ou clos.
/// - `WALLET_LIMIT_EXCEEDED` (422, `CL008`) : plafond de solde dépassé.
/// - `MONTHLY_TOPUP_LIMIT_EXCEEDED` (422, `CL009`) : plafond mensuel de recharge dépassé.
/// - `MEDIA_UNKNOWN` (404) : UID ou bracelet inconnu (chemin en ligne ; dans un lot :.
///   `MEDIA_NOT_IN_SNAPSHOT`).
/// - `MEDIA_BLOCKED` (422) : bracelet `SUSPENDED` ou `BLACKLISTED`.
/// - `MEDIA_NOT_ACTIVATED` (422) : bracelet `PERSONALIZED` ou `ISSUED`, pas encore rattaché.
/// - `MEDIA_RETIRED` (422) : bracelet `RETIRED` ou `DESTROYED`.
/// - `MEDIA_REPLACED` (422) : bracelet remplacé par un autre.
/// - `MEDIA_RELEASED` (422) : bracelet restitué.
/// - `MEDIA_UID_MISMATCH` (422) : identité lue incohérente avec l'UID enregistré.
/// - `MEDIA_CLONE_SUSPECTED` (422) : compteur déjà vu ou identité retirée ; bracelet mis en liste noire.
/// - `MEDIA_SIGNATURE_MISMATCH` (422) : signature d'originalité différente de celle de la personnalisation.
///   (résultat `SIGNATURE_MISMATCH`) ; bracelet mis en liste noire (ADR-59).
/// - `MEDIA_SIGNATURE_MISSING` (422) : signature d'originalité absente alors que la puce en a une enregistrée.
///   (résultat `SIGNATURE_MISSING`) ; relire le bracelet. Pas de liste noire.
/// - `MEDIA_STATE_INVALID` (409, `CL020`) : bracelet ou lot dans un état qui ne permet pas l'action.
///   (remplacement, restitution avec espèces dues, rendu d'espèces sans somme due, lot, caution).
/// - `MEDIA_WRONG_EVENT` (422) : bracelet d'un lot d'un autre événement.
/// - `MEDIA_BATCH_INACTIVE` (422) : lot du bracelet non `ACTIVE`.
/// - `MEDIA_CLAIM_INVALID` (422) : code de rattachement inconnu ou déjà utilisé (réponse identique).
/// - `TAP_EXPIRED` (422) : `tap_id` au-delà de `tap_replay_window_seconds` (défaut 120 s), contrôle de l'API.
///   avant écriture ; relire le bracelet.
/// - `TAP_ALREADY_USED` (409) : `tap_id` déjà consommé par une autre opération, ou présenté par un autre.
///   terminal (contrôle de l'API avant écriture).
/// - `TAP_UNUSABLE` (409, `CL022`) : refus de `consume_tap` : passage déjà utilisé par une autre écriture, ou.
///   écriture en ligne plus de `tap_replay_window_seconds` après la lecture ; relire le bracelet.
/// - `ACTIVATION_MODE_NOT_ALLOWED` (422) : mode d'activation absent de `event.activation_modes`.
/// - `ACCOUNT_REQUIRED` (422) : `identity_mode = ACCOUNT_REQUIRED` et aucun compte client fourni.
/// - `DEPOSIT_OUTSTANDING` (409) : caution encore `HELD` ; la rendre avant la restitution.
/// - `BALANCE_OUTSTANDING` (409) : portefeuille non soldé ; restitution impossible.
/// - `DEPOSIT_PAYMENT_REQUIRED` (422) : caution `SEPARATE` sans moyen de paiement (`deposit_payment`).
/// - `EVENT_CLOSING` (409, `CL004`) : grand livre en clôture ; recharges et ventes en ligne refusées.
/// - `LEDGER_LOCKED` (409, `CL003`) : grand livre verrouillé.
/// - `PERIOD_CLOSED` (409, `CL005`) : date dans une période close.
/// - `DEBIT_AUTHORITY_EDGE` (409, `CL006`) : débits autorisés par la passerelle ; rejouer la même requête.
///   (même clé) vers `edge_base_url`. Pas un refus.
/// - `DEBIT_AUTHORITY_MOVING` (409) : bascule d'autorité en cours (passerelle en `RELEASING`). Pas un.
///   refus définitif : garder la même clé, passer hors ligne si la politique le permet, puis rejouer vers.
///   la nouvelle autorité (sync_protocol.md §5.1, §9.3).
/// - `STALE_AUTHORITY_EPOCH` (409, `CL015`) : époque d'autorité périmée ; l'émetteur cesse de débiter.
/// - `HANDOVER_INVALID_STATE` (409, `CL013`) : action de bascule impossible dans l'état du handover.
/// - `EDGE_NOT_CAUGHT_UP` (409, `CL014`) : passerelle en retard (filigrane non atteint, `edge_seq` manquants).
/// - `REVERSAL_NOT_ALLOWED` (422) : transaction non annulable (type, auteur ou terminal différent).
/// - `REVERSAL_WINDOW_EXPIRED` (409) : délai d'annulation dépassé.
/// - `ALREADY_REVERSED` (409) : transaction déjà annulée.
/// - `OFFLINE_NOT_ALLOWED` (403) : hors ligne désactivé pour ce terminal (seul nom de ce refus).
/// - `SNAPSHOT_VERSION_UNKNOWN` (409) : version de snapshot inconnue pour ce grand livre ; demander un FULL.
/// - `BATCH_IN_PROGRESS` (409, `CL010`) : un lot est déjà en cours pour ce terminal ; attendre son résultat.
/// - `BATCH_TOO_LARGE` (413, `CL011`) : lot vide ou de plus de 500 opérations ou 1 Mio.
/// - `BATCH_SIGNATURE_INVALID` (400) : signature de l'en-tête du lot invalide ; lot non traité.
/// - `CHAIN_BROKEN` (409, `CL017`) : chaîne de hachage rompue (terminal ou passerelle) ; alerte, examen manuel.
/// - `SEQ_OUT_OF_ORDER` (400 pour un lot de terminal non continu ; 409, `CL016`, pour un `edge_seq`.
///   qui n'est pas le suivant attendu).
/// - `SEQ_GAP_NOT_FOUND` (409, `CL012`) : le numéro à lever n'est pas un trou connu.
/// - `SEQ_OUT_OF_RANGE` (409, `CL021`) : numéro ou lot au-delà de `contiguous_acked_seq + 10 000`.
///   (`max_seq_jump`) ; refusé sans anomalie.
/// - `PAYMENT_REQUEST_EXPIRED` (409) : demande de paiement QR expirée.
/// - `PAYMENT_REQUEST_NOT_PENDING` (409) : demande de paiement QR déjà payée, annulée ou expirée.
/// - `QR_TOKEN_INVALID` (422) : jeton de QR client inconnu, expiré ou déjà utilisé.
/// - `PAYMENT_INTENT_INVALID_STATE` (409, V2) : intention dans un état qui ne permet pas l'action.
/// - `PAYMENT_INTENT_EXPIRED` (409, V2) : intention expirée.
/// - `PSP_UNAVAILABLE` (503) : PSP injoignable ; réessayer avec la même clé.
/// - `PSP_NOT_CONFIGURED` (409) : aucune configuration PSP valide pour ce moyen et cet événement (S26b ou défaut de l'organisateur, titulaire = détenteur des fonds, ADR-72).
/// - `PSP_REJECTED` (422) : paiement refusé par le PSP.
/// - `WEBHOOK_SIGNATURE_INVALID` (401) : signature HMAC du webhook entrant invalide.
/// - `WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE` (401) : horodatage du webhook hors tolérance (rejeu suspect).
/// - `REFUND_NOT_ALLOWED` (422) : remboursement impossible (solde payé nul, destination non vérifiée…).
/// - `REFUND_WINDOW_CLOSED` (422) : fenêtre de remboursement close.
/// - `REFUND_ALREADY_OPEN` (409) : une demande de remboursement est déjà ouverte pour ce portefeuille.
/// - `OTP_INVALID` (422) : code à usage unique faux, expiré ou déjà utilisé.
/// - `CARD_DAILY_LIMIT` (422) : plafond de recharge par carte et par jour atteint (ADR-77).
/// - `OTP_RATE_LIMITED` (429) : trop de demandes ou d'essais de code à usage unique (défauts : 3 envois par.
///   numéro sur 15 min, 10 demandes par IP et par heure, 5 essais par code puis blocage du numéro 30 min).
/// - `CONFLICT_STATE` (409) : objet dans un état qui ne permet pas l'action (ex. demande de.
///   remboursement qui n'est pas `REQUESTED` à l'approbation).
/// - `EVENT_TRANSITION_INVALID` (409, `CL018`) : passage de statut d'événement non prévu (ADR-51).
/// - `CLOSING_CONDITION_NOT_MET` (409, `CL019`) : condition de clôture calculable non remplie ; le détail nomme la condition (ADR-51).
///
@JsonEnum()
enum ProblemCode {
  @JsonValue('VALIDATION_FAILED')
  validationFailed('VALIDATION_FAILED'),
  @JsonValue('UNAUTHENTICATED')
  unauthenticated('UNAUTHENTICATED'),
  @JsonValue('FORBIDDEN')
  forbidden('FORBIDDEN'),
  @JsonValue('NOT_FOUND')
  notFound('NOT_FOUND'),
  @JsonValue('RATE_LIMITED')
  rateLimited('RATE_LIMITED'),
  @JsonValue('INTERNAL_ERROR')
  internalError('INTERNAL_ERROR'),
  @JsonValue('SERVICE_UNAVAILABLE')
  serviceUnavailable('SERVICE_UNAVAILABLE'),
  @JsonValue('IDEMPOTENCY_KEY_REQUIRED')
  idempotencyKeyRequired('IDEMPOTENCY_KEY_REQUIRED'),
  @JsonValue('IDEMPOTENCY_KEY_REUSED')
  idempotencyKeyReused('IDEMPOTENCY_KEY_REUSED'),
  @JsonValue('IDEMPOTENCY_KEY_IN_PROGRESS')
  idempotencyKeyInProgress('IDEMPOTENCY_KEY_IN_PROGRESS'),
  @JsonValue('ENROLLMENT_CODE_INVALID')
  enrollmentCodeInvalid('ENROLLMENT_CODE_INVALID'),
  @JsonValue('ENROLLMENT_CODE_EXPIRED')
  enrollmentCodeExpired('ENROLLMENT_CODE_EXPIRED'),
  @JsonValue('ATTESTATION_FAILED')
  attestationFailed('ATTESTATION_FAILED'),
  @JsonValue('REFRESH_TOKEN_INVALID')
  refreshTokenInvalid('REFRESH_TOKEN_INVALID'),
  @JsonValue('DEVICE_SUSPENDED')
  deviceSuspended('DEVICE_SUSPENDED'),
  @JsonValue('DEVICE_REVOKED')
  deviceRevoked('DEVICE_REVOKED'),
  @JsonValue('DEVICE_NOT_ASSIGNED')
  deviceNotAssigned('DEVICE_NOT_ASSIGNED'),
  @JsonValue('DEVICE_MODE_NOT_ALLOWED')
  deviceModeNotAllowed('DEVICE_MODE_NOT_ALLOWED'),
  @JsonValue('CLOCK_SKEW_TOO_LARGE')
  clockSkewTooLarge('CLOCK_SKEW_TOO_LARGE'),
  @JsonValue('CURRENCY_MISMATCH')
  currencyMismatch('CURRENCY_MISMATCH'),
  @JsonValue('AMOUNT_OUT_OF_RANGE')
  amountOutOfRange('AMOUNT_OUT_OF_RANGE'),
  @JsonValue('INSUFFICIENT_FUNDS')
  insufficientFunds('INSUFFICIENT_FUNDS'),
  @JsonValue('WALLET_BLOCKED')
  walletBlocked('WALLET_BLOCKED'),
  @JsonValue('WALLET_LIMIT_EXCEEDED')
  walletLimitExceeded('WALLET_LIMIT_EXCEEDED'),
  @JsonValue('MONTHLY_TOPUP_LIMIT_EXCEEDED')
  monthlyTopupLimitExceeded('MONTHLY_TOPUP_LIMIT_EXCEEDED'),
  @JsonValue('MEDIA_UNKNOWN')
  mediaUnknown('MEDIA_UNKNOWN'),
  @JsonValue('MEDIA_BLOCKED')
  mediaBlocked('MEDIA_BLOCKED'),
  @JsonValue('MEDIA_NOT_ACTIVATED')
  mediaNotActivated('MEDIA_NOT_ACTIVATED'),
  @JsonValue('MEDIA_RETIRED')
  mediaRetired('MEDIA_RETIRED'),
  @JsonValue('MEDIA_REPLACED')
  mediaReplaced('MEDIA_REPLACED'),
  @JsonValue('MEDIA_RELEASED')
  mediaReleased('MEDIA_RELEASED'),
  @JsonValue('MEDIA_UID_MISMATCH')
  mediaUidMismatch('MEDIA_UID_MISMATCH'),
  @JsonValue('MEDIA_CLONE_SUSPECTED')
  mediaCloneSuspected('MEDIA_CLONE_SUSPECTED'),
  @JsonValue('MEDIA_SIGNATURE_MISMATCH')
  mediaSignatureMismatch('MEDIA_SIGNATURE_MISMATCH'),
  @JsonValue('MEDIA_SIGNATURE_MISSING')
  mediaSignatureMissing('MEDIA_SIGNATURE_MISSING'),
  @JsonValue('MEDIA_STATE_INVALID')
  mediaStateInvalid('MEDIA_STATE_INVALID'),
  @JsonValue('MEDIA_WRONG_EVENT')
  mediaWrongEvent('MEDIA_WRONG_EVENT'),
  @JsonValue('MEDIA_BATCH_INACTIVE')
  mediaBatchInactive('MEDIA_BATCH_INACTIVE'),
  @JsonValue('MEDIA_CLAIM_INVALID')
  mediaClaimInvalid('MEDIA_CLAIM_INVALID'),
  @JsonValue('TAP_EXPIRED')
  tapExpired('TAP_EXPIRED'),
  @JsonValue('TAP_ALREADY_USED')
  tapAlreadyUsed('TAP_ALREADY_USED'),
  @JsonValue('TAP_UNUSABLE')
  tapUnusable('TAP_UNUSABLE'),
  @JsonValue('ACTIVATION_MODE_NOT_ALLOWED')
  activationModeNotAllowed('ACTIVATION_MODE_NOT_ALLOWED'),
  @JsonValue('ACCOUNT_REQUIRED')
  accountRequired('ACCOUNT_REQUIRED'),
  @JsonValue('DEPOSIT_OUTSTANDING')
  depositOutstanding('DEPOSIT_OUTSTANDING'),
  @JsonValue('BALANCE_OUTSTANDING')
  balanceOutstanding('BALANCE_OUTSTANDING'),
  @JsonValue('DEPOSIT_PAYMENT_REQUIRED')
  depositPaymentRequired('DEPOSIT_PAYMENT_REQUIRED'),
  @JsonValue('EVENT_CLOSING')
  eventClosing('EVENT_CLOSING'),
  @JsonValue('LEDGER_LOCKED')
  ledgerLocked('LEDGER_LOCKED'),
  @JsonValue('PERIOD_CLOSED')
  periodClosed('PERIOD_CLOSED'),
  @JsonValue('DEBIT_AUTHORITY_EDGE')
  debitAuthorityEdge('DEBIT_AUTHORITY_EDGE'),
  @JsonValue('DEBIT_AUTHORITY_MOVING')
  debitAuthorityMoving('DEBIT_AUTHORITY_MOVING'),
  @JsonValue('STALE_AUTHORITY_EPOCH')
  staleAuthorityEpoch('STALE_AUTHORITY_EPOCH'),
  @JsonValue('HANDOVER_INVALID_STATE')
  handoverInvalidState('HANDOVER_INVALID_STATE'),
  @JsonValue('EDGE_NOT_CAUGHT_UP')
  edgeNotCaughtUp('EDGE_NOT_CAUGHT_UP'),
  @JsonValue('REVERSAL_NOT_ALLOWED')
  reversalNotAllowed('REVERSAL_NOT_ALLOWED'),
  @JsonValue('REVERSAL_WINDOW_EXPIRED')
  reversalWindowExpired('REVERSAL_WINDOW_EXPIRED'),
  @JsonValue('ALREADY_REVERSED')
  alreadyReversed('ALREADY_REVERSED'),
  @JsonValue('OFFLINE_NOT_ALLOWED')
  offlineNotAllowed('OFFLINE_NOT_ALLOWED'),
  @JsonValue('SNAPSHOT_VERSION_UNKNOWN')
  snapshotVersionUnknown('SNAPSHOT_VERSION_UNKNOWN'),
  @JsonValue('BATCH_IN_PROGRESS')
  batchInProgress('BATCH_IN_PROGRESS'),
  @JsonValue('BATCH_TOO_LARGE')
  batchTooLarge('BATCH_TOO_LARGE'),
  @JsonValue('BATCH_SIGNATURE_INVALID')
  batchSignatureInvalid('BATCH_SIGNATURE_INVALID'),
  @JsonValue('CHAIN_BROKEN')
  chainBroken('CHAIN_BROKEN'),
  @JsonValue('SEQ_OUT_OF_ORDER')
  seqOutOfOrder('SEQ_OUT_OF_ORDER'),
  @JsonValue('SEQ_GAP_NOT_FOUND')
  seqGapNotFound('SEQ_GAP_NOT_FOUND'),
  @JsonValue('SEQ_OUT_OF_RANGE')
  seqOutOfRange('SEQ_OUT_OF_RANGE'),
  @JsonValue('PAYMENT_REQUEST_EXPIRED')
  paymentRequestExpired('PAYMENT_REQUEST_EXPIRED'),
  @JsonValue('PAYMENT_REQUEST_NOT_PENDING')
  paymentRequestNotPending('PAYMENT_REQUEST_NOT_PENDING'),
  @JsonValue('QR_TOKEN_INVALID')
  qrTokenInvalid('QR_TOKEN_INVALID'),
  @JsonValue('PAYMENT_INTENT_INVALID_STATE')
  paymentIntentInvalidState('PAYMENT_INTENT_INVALID_STATE'),
  @JsonValue('PAYMENT_INTENT_EXPIRED')
  paymentIntentExpired('PAYMENT_INTENT_EXPIRED'),
  @JsonValue('PSP_UNAVAILABLE')
  pspUnavailable('PSP_UNAVAILABLE'),
  @JsonValue('PSP_NOT_CONFIGURED')
  pspNotConfigured('PSP_NOT_CONFIGURED'),
  @JsonValue('PSP_REJECTED')
  pspRejected('PSP_REJECTED'),
  @JsonValue('WEBHOOK_SIGNATURE_INVALID')
  webhookSignatureInvalid('WEBHOOK_SIGNATURE_INVALID'),
  @JsonValue('WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE')
  webhookTimestampOutOfTolerance('WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE'),
  @JsonValue('REFUND_NOT_ALLOWED')
  refundNotAllowed('REFUND_NOT_ALLOWED'),
  @JsonValue('REFUND_WINDOW_CLOSED')
  refundWindowClosed('REFUND_WINDOW_CLOSED'),
  @JsonValue('REFUND_ALREADY_OPEN')
  refundAlreadyOpen('REFUND_ALREADY_OPEN'),
  @JsonValue('OTP_INVALID')
  otpInvalid('OTP_INVALID'),
  @JsonValue('OTP_RATE_LIMITED')
  otpRateLimited('OTP_RATE_LIMITED'),
  @JsonValue('CONFLICT_STATE')
  conflictState('CONFLICT_STATE'),
  @JsonValue('EVENT_TRANSITION_INVALID')
  eventTransitionInvalid('EVENT_TRANSITION_INVALID'),
  @JsonValue('CLOSING_CONDITION_NOT_MET')
  closingConditionNotMet('CLOSING_CONDITION_NOT_MET'),
  @JsonValue('APPROVAL_REQUIRED')
  approvalRequired('APPROVAL_REQUIRED'),
  @JsonValue('APPROVAL_INVALID')
  approvalInvalid('APPROVAL_INVALID'),
  @JsonValue('LATE_CLAIM_INVALID')
  lateClaimInvalid('LATE_CLAIM_INVALID'),
  @JsonValue('CARD_DAILY_LIMIT')
  cardDailyLimit('CARD_DAILY_LIMIT');

  const ProblemCode(this.json);

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
