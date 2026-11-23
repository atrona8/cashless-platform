# Research — Serveur de l'app festivalier (mission 10a)

Sources lues le 20/11/2026 : `schema_grand_livre_cashless.sql` (S24 `kyc_verification`, `wallet_kyc_level`,
`check_wallet_limits`), `post-roles.sql` (retrait de `INSERT, UPDATE ON kyc_verification` à `cashless_app`, mission 5b),
`0010_media_claims.sql`, `0080_customer_auth.sql`, `apps/api/src/kms/claim-hash.ts`,
`apps/api/src/customer-auth/otp-sender.ts` et `customer-auth.service.ts`, `apps/api/src/customer-app/me.service.ts`,
`apps/api/src/media/batches/claim-codes.service.ts`, `openapi.yaml` (`createKycVerification`, `revokeKycVerification`,
`issueClaimCodeOrder`, `importClaimCodeAssociations`, `CustomerMedia`, `CustomerWallet`), SPECIFICATION §6.3 et §8.5.

## R-01 — Écriture d'une identification

- **Decision**: fonction `create_kyc_verification(p_wallet, p_id_type, p_id_country, p_id_last4, p_id_expires_on,
  p_agent)` en `SECURITY DEFINER`, seule à insérer dans `kyc_verification`. Elle verrouille le portefeuille, exige un
  client (`ACCOUNT_REQUIRED`), un `customer_identity` du même prestataire, refuse l'agent dont `app_user.phone` est
  égal à `customer_identity.phone` (`FORBIDDEN`), refuse une pièce expirée à la date du jour (`422`).
  `revoke_kyc_verification(p_id, p_by, p_reason)` passe `VERIFIED` → `REVOKED` (seule mise à jour admise par le
  déclencheur d'ajout seul existant) ; déjà révoquée → `CONFLICT_STATE`.
- **Rationale**: `cashless_app` n'a plus d'écriture directe (5b) ; une connexion de l'API compromise ne doit pas
  contourner les règles 2 et 4 de §6.3.
- **Alternatives considered**: contrôles dans l'API seulement (contournables par une API compromise) ; table de lien
  agent ↔ compte (écartée par le porteur au specify).

## R-02 — Rôle de l'agent et portée

- **Decision**: rôle `CASHIER` ou `ORGANIZER_ADMIN` sur la portée de l'événement du grand livre du portefeuille,
  contrôlé par l'API (chaîne de portées existante) ; la fonction reçoit l'agent et le prestataire courant (RLS).
- **Rationale**: même modèle que les autres actions de guichet ; le contrat nomme ces deux rôles.

## R-03 — Révocation

- **Decision**: action d'approbation `KYC_REVOCATION` (déjà dans l'énumération `approval_request.action`), rôles
  `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` (liste de rôles, déjà supportée par le registre depuis `SALE_REVERSAL`) ;
  `guardDecision` vérifie l'état avant décision ; `execute` appelle `revoke_kyc_verification` avec l'auteur comme
  `revoked_by`, le valideur au journal d'audit.
- **Contradiction** : §6.3 point 5 (« un administrateur ») contre le contrat (deux personnes) ; le contrat prime (§0.3).

## R-04 — Version du secret des codes de rattachement

- **Decision**: `CLAIM_CODE_HMAC_KEY_VERSION` (entier ≥ 1, défaut 1) en configuration ; colonnes `claim_key_version
  smallint NOT NULL DEFAULT 1` sur `media` (code associé), `claim_code`, `media_claim` (code de confirmation). Toute
  recherche d'empreinte filtre la version courante ; une empreinte d'une ancienne version compte comme absente
  (rattachement, confirmation, consultation anonyme : réponse d'un code inconnu ; import : le bracelet accepte un code).
- **Rationale**: décision du porteur ; pas d'opération de masse, historique lisible, aucun état ambigu.
- **Alternatives considered**: commande de purge (écartée : étape manuelle oubliable) ; double empreinte bornée
  (écartée au specify : rotation immédiate).
- **Note**: la référence d'adresse des limites de consultation anonyme utilise le même secret ; les compteurs repartent
  à zéro à la rotation (sans effet de sécurité : les codes sont invalidés en même temps).

## R-05 — Réémission

- **Decision**: commande `apps/api/src/cli/reissue-claim-codes.ts --batch <id> --out <fichier>` ; tire un code par
  bracelet du lot dont le code est absent, d'ancienne version ou non utilisé d'ancienne version, appelle
  `reissue_claim_codes(p_batch, p_media[], p_hashes[], p_version)` exécutable par le seul rôle `cashless_claimadmin`,
  écrit le fichier (`rank,code,url`, même forme que `issueClaimCodeOrder`) en mode 0600, ne journalise que le nombre.
  Lots clos compris ; lots `STAFF` et `VIP` refusés.
- **Rationale**: décision du porteur (commande d'exploitation, contrat inchangé). Le rôle dédié empêche une API
  compromise de remplacer les codes de bracelets non rattachés (renforcement).

## R-06 — Numéro imprimé

- **Decision**: colonne `media.printed_number text` (1 à 32 caractères `[A-Z0-9-]`), unique par prestataire quand
  présente, posée par l'import du fichier de l'imprimeur quand la troisième colonne est fournie ; deux colonnes restent
  valides. Motif nouveau de ligne refusée `BAD_PRINTED_NUMBER` et `PRINTED_NUMBER_TAKEN` (liste fermée du service, sans
  changement de la forme de la réponse).
- **Rationale**: décision du porteur ; ajout rétrocompatible (description du corps `text/csv`), inscrit dans
  `contract-baseline.json` avant la PR.

## R-07 — Avis de solde provisoire

- **Decision**: fonction `wallet_pending_offline_notice(p_wallet) RETURNS boolean` (`STABLE`, `SECURITY INVOKER`) :
  vrai si l'événement du grand livre n'est pas `CLOSED` et qu'un terminal non révoqué a un `offline_snapshot_ack` sur ce
  grand livre postérieur à son dernier `offline_batch` reçu (ou sans lot reçu). Index sur
  `offline_snapshot_ack (ledger_id, device_id, acked_at)` et `offline_batch (device_id, received_at)` si absents.
- **Rationale**: le snapshot hors ligne d'un grand livre porte tous ses bracelets ; un terminal qui l'a reçu peut encore
  remonter des achats tant qu'il n'a rien envoyé depuis.
- **Alternatives considered**: par bracelet (lecture de `offline_snapshot_entry`, plus coûteuse, même résultat en V1).

## R-08 — Chaîne d'envoi

- **Decision**: `ChainedOtpSender` implémente `OtpSender` : WhatsApp ; sans confirmation au délai `OTP_WHATSAPP_TIMEOUT_MS`
  (défaut 10 000) ou numéro sans WhatsApp, SMS principal ; sans confirmation à `OTP_SMS_PRIMARY_TIMEOUT_MS` (défaut
  20 000), SMS de repli. Canal `SMS` : WhatsApp sauté. Le code n'est gardé que dans la fermeture de la chaîne en cours
  (mémoire du processus), effacé à la confirmation, dès le dernier envoi (35 s au plus, délais bornés à 15 s et 20 s) ou à l'arrêt ; jamais écrit.
  Chaque canal essayé est noté (`otp_channel_attempt` : défi, canal, fournisseur, envoyé, confirmé, sans code). Les
  bascules ne créent pas de défi : les limites (`otp_challenge` par numéro et par adresse) ne bougent pas.
- **Rationale**: décision du porteur (« le plus secure ») ; ADR-66.
- **Faux** : `FakeWhatsAppProvider`, `FakeSmsPrimaryProvider`, `FakeSmsFallbackProvider` (comportement réglable en
  test : confirme, ne confirme pas, pas de WhatsApp) ; refus en production par `FakeInProductionError`, recensés dans
  `production-refusals.spec.ts`. `X-Test-Otp-Code` inchangé (OP-N120).

## R-09 — Dépendances

- **Decision**: aucune dépendance nouvelle (minuteries `node:timers`, HMAC `node:crypto`). DIRECTIVE_051 sans objet ;
  aucune passe adversariale de dépendance requise.
