# Contrat — Identification au guichet (KYC)

Routes déclarées par `packages/contracts/openapi.yaml` depuis la mission 5b, servies telles quelles (aucun changement).

## `POST /kyc-verifications` (`createKycVerification`)

- Rôle : `CASHIER` ou `ORGANIZER_ADMIN` sur la portée de l'événement du portefeuille. `Idempotency-Key` exigée.
- Corps `KycVerificationCreate` : `wallet_id`, `id_type`, `id_country`, `id_last4`, `id_expires_on`.
- `201` `KycVerification` ; `422 ACCOUNT_REQUIRED` (portefeuille sans client ou sans numéro vérifié) ; `403 FORBIDDEN`
  (agent titulaire : numéro vérifié du compte = téléphone de l'agent ; mauvais rôle) ; `422 VALIDATION_FAILED` (pièce
  expirée, champs invalides) ; `404` (portefeuille d'un autre prestataire ou inconnu).
- Effet : une ligne `kyc_verification` `DESK`, `VERIFIED` ; niveau des portefeuilles du client recalculé à l'usage.

## `POST /kyc-verifications/{id}/revoke` (`revokeKycVerification`)

- Rôle : `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`. Corps `{ reason }` (≥ 10 caractères).
- `202` demande d'approbation `KYC_REVOCATION` `PENDING` ; `409 CONFLICT_STATE` si déjà révoquée.
- Exécution à `approveApprovalRequest` par une autre personne habilitée : `REVOKED`, `revoked_by` = auteur, valideur au
  journal d'audit ; déjà révoquée à l'exécution → demande `FAILED`.

## Contradiction signalée

SPECIFICATION §6.3 point 5 (« un administrateur ») ; le contrat prime (§0.3).
