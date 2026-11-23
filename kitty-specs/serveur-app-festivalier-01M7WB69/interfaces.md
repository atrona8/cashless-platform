# Interfaces partagées entre lots (mission 10a)

Fichier de référence pour les lots : noms, signatures, propriétaires, codes. Un lot ne change pas une interface qu'il
ne possède pas ; il signale le besoin à l'orchestrateur. Les signatures SQL exactes sont fixées par le lot
propriétaire ; une fois fusionnées, **les signatures réelles font foi** sur ce fichier. Fiche commune :
`docs/passation-10a/fiche-implementation.md`.

## Lots et propriétaires

| Lot | Objet | Dépend de |
|---|---|---|
| WP01 | Migration `0096` : fonctions KYC (identification, révocation) | — |
| WP02 | Migration `0097` : version du secret des codes, signatures versionnées, `reissue_claim_codes`, `media.printed_number` | — |
| WP03 | Migrations `0098` (`wallet_pending_offline_notice`) et `0099` (`otp_channel_attempt`) | — |
| WP04 | `roles.sql`, `post-roles.sql` §14 (rôle `cashless_claimadmin`, droits KYC, codes, avis, canaux), suites de droits, rôle dans les environnements de test et de CI | WP01, WP02, WP03 |
| WP05 | Module `kyc/` : `createKycVerification` | WP04 |
| WP06 | Révocation : action `KYC_REVOCATION`, `revokeKycVerification` | WP05 |
| WP07 | Configuration (version du secret, délais de la chaîne) et appels versionnés côté API (codes, personnalisation, consultation anonyme, import à trois colonnes) | WP04 |
| WP08 | Commande d'exploitation `reissue-claim-codes` et procédure de rotation | WP07 |
| WP09 | `/me` : `printed_number`, `pending_offline_notice` ; description du contrat et `contract-baseline.json` | WP04, WP07 |
| WP10 | Chaîne d'envoi des codes (expéditeur composite, trois faux, canaux notés) | WP04, WP07 |
| WP11 | Preuves, consignation, documentation | tous |

## Base de données

| Objet | Signature ou forme | Propriétaire |
|---|---|---|
| `create_kyc_verification(p_wallet uuid, p_customer uuid, p_id_type text, p_id_country text, p_id_last4 text, p_id_expires_on date, p_agent uuid) RETURNS kyc_verification` | `DEFINER` ; prestataire de session ; **un et un seul** de `p_wallet`, `p_customer` (contrat : `oneOf`), sinon `CL062` ; avec `p_wallet` : verrou du portefeuille, client du portefeuille ; avec `p_customer` : `wallet_id` NULL dans la ligne ; sans client ou sans `customer_identity` : `CL060` ; `app_user.phone` de l'agent = `customer_identity.phone` : `CL061` ; pièce expirée (`id_expires_on < current_date`) : `CL062` ; `id_last4` normalisé en majuscules, `^[0-9A-Z]{1,4}$` sinon `CL062` ; méthode `DESK` | WP01 |
| `revoke_kyc_verification(p_id uuid, p_by uuid, p_reason text) RETURNS kyc_verification` | `DEFINER` ; `VERIFIED` → `REVOKED` ; déjà révoquée : `CL063` ; motif < 10 caractères : `CL062` ; introuvable ou autre prestataire : `no_data_found` | WP01 |
| Colonnes de version | `media.claim_key_version smallint NOT NULL DEFAULT 1` (sans `CHECK` de cohérence : les fixtures qui posent `claim_code_hash` restent valides), `claim_code.key_version smallint NOT NULL DEFAULT 1`, `media_claim.key_version smallint NOT NULL DEFAULT 1` ; existant : 1 | WP02 |
| Fonctions versionnées | `issue_claim_codes`, `associate_claim_code`, `claim_media`, `confirm_media_claim`, `public_balance_lookup` : mêmes arguments **plus** `p_key_version smallint` en dernier ; l'ancienne signature est **retirée** dans `0097` ; une empreinte d'une autre version que `p_key_version` compte comme absente (même erreur qu'un code inconnu) ; `associate_claim_code(p_hash bytea, p_media uuid, p_printed_number text, p_key_version smallint)` (`p_printed_number` sans défaut, NULL permis) accepte un bracelet dont le code est d'une autre version jamais utilisé et **libère** l'ancienne ligne `claim_code` (`media_id`, `associated_at` à NULL, `invalidated_at` posé) ; un bracelet au code déjà utilisé reste refusé. `register_personalized_media` n'écrit aucune empreinte (0019) : **inchangée** | WP02 |
| `claim_key_version_max() RETURNS smallint` | `STABLE`, `DEFINER` (lit trois tables, tous prestataires), plus haute version présente (`media`, `claim_code`, `media_claim`), 0 si aucune ; sert au refus de démarrage (WP07) | WP02 |
| `claim_media_reissuable(uuid, uuid, uuid, smallint)` | ajoutée par WP02 (`fe8e2c20`) : `DEFINER`, prédicat « réémissible » unique partagé par `reissuable_media` et `reissue_claim_codes` ; `REVOKE ALL … FROM PUBLIC` ; **exécutable par aucun rôle** (WP04 l'ajoute aux listes « non exécutable » de `cashless_app` et des autres rôles) | WP02 |
| `reissuable_media(p_operator uuid, p_batch uuid, p_key_version smallint) RETURNS TABLE (media_id uuid, rank int, nfc_uid bytea, printed_number text)` (colonnes `nfc_uid` et `printed_number` ajoutées par décision du porteur du 20/11/2026 soir, faites dans la lane de WP08) | `STABLE`, `DEFINER` ; bracelets du lot réémissibles au sens de `reissue_claim_codes`, ordonnés par rang ; lot non `PUBLIC` : `CL020` | WP02 |
| `reissue_claim_codes(p_operator uuid, p_batch uuid, p_media uuid[], p_hashes bytea[], p_key_version smallint) RETURNS int` | `DEFINER` ; lot `PUBLIC` sinon `CL020` ; chaque bracelet du lot, sans code ou au code d'une version < `p_key_version` jamais utilisé (`claim_code_used_at IS NULL`) ; sinon `CL064` ; lots clos admis ; les anciennes lignes `claim_code` des bracelets réémis sont libérées (`media_id`, `associated_at` à NULL, `invalidated_at` posé) et les non associées d'ancienne version passent `invalidated_at` ; audit (nombre) | WP02 |
| `media.printed_number` | `text`, `CHECK (printed_number ~ '^[A-Z0-9-]{1,32}$')`, unique `(operator_id, printed_number)` si non NULL ; doublon : `CL065` | WP02 |
| `wallet_pending_offline_notice(p_wallet uuid) RETURNS boolean` | `STABLE`, `SECURITY INVOKER` ; vrai si événement du grand livre non `CLOSED` et au moins un terminal non révoqué avec un `offline_snapshot_ack` sur ce grand livre plus récent que son dernier `offline_batch` (ou sans lot) ; index si besoin | WP03 |
| `otp_channel_attempt` | `id uuid PK`, `operator_id`, `challenge_id → otp_challenge`, `channel ∈ {WHATSAPP, SMS_PRIMARY, SMS_FALLBACK}`, `provider text`, `sent_at`, `confirmed_at NULL`, `failed_reason NULL` ; **aucun code ni empreinte** ; RLS forcée | WP03 |
| Rôle `cashless_claimadmin` | connexion ; `EXECUTE` de `reissue_claim_codes`, `reissuable_media` et `claim_key_version_max` seulement ; aucun droit de table (rôle créé en `post-roles.sql` §14, comme `cashless_pin` en §8b) | WP04 |
| `post-roles.sql` : signatures | les lignes existantes qui nomment les signatures retirées (cinq fonctions de codes) passent aux signatures versionnées : **retouche commitée de WP02**, hors carte et déclarée, pour que `reset-db.sh` passe ; WP04 (qui dépend de WP02) écrit tout le reste du §14 | WP02 |
| Codes `SQLSTATE` | `CL060` compte exigé ; `CL061` agent titulaire ; `CL062` donnée de pièce ou motif invalide ; `CL063` identification déjà révoquée ; `CL064` bracelet non réémissible ; `CL065` numéro imprimé déjà pris | WP01, WP02 (mappage HTTP dans `errors/sqlstate-map.ts` : `CL060` → `422 ACCOUNT_REQUIRED`, `CL061` → `403 FORBIDDEN`, `CL062` → `422 VALIDATION_FAILED`, `CL063` → `409 CONFLICT_STATE` : WP05 ; `CL064` traduit par la commande (WP08) ; `CL065` devient un motif de ligne refusée `PRINTED_NUMBER_TAKEN` (WP07), jamais une erreur HTTP) |

`EXECUTE` de `cashless_app` après la mission : liste d'avant, signatures versionnées à la place des anciennes,
**plus** `create_kyc_verification`, `revoke_kyc_verification`, `wallet_pending_offline_notice`,
`claim_key_version_max` ; **jamais** `reissue_claim_codes`, `reissuable_media` ni `claim_media_reissuable`. Table `otp_channel_attempt` : `INSERT`, `UPDATE (confirmed_at, failed_reason)`, `SELECT`. Le
processus public garde l'`EXECUTE` de `public_balance_lookup` (nouvelle signature). Le processus de personnalisation
garde celui de `register_personalized_media` (signature inchangée).

## Configuration (WP07)

| Variable | Règle |
|---|---|
| `CLAIM_CODE_HMAC_KEY_VERSION` | entier 1 à 32767, défaut 1 ; au démarrage de l'API, inférieure à `claim_key_version_max()` : démarrage refusé |
| `OTP_WHATSAPP_TIMEOUT_MS` | défaut 10 000, 1 000 à 15 000 |
| `OTP_SMS_PRIMARY_TIMEOUT_MS` | défaut 20 000, 1 000 à 20 000 (code en mémoire 35 s au plus) |
| `DATABASE_URL_CLAIMADMIN` | commande `reissue-claim-codes` seulement (WP08) ; valeur locale `cashless_claimadmin_local` |

Champs d'`AppConfig` : `claimCodeKeyVersion: number`, `otpWhatsappTimeoutMs`, `otpSmsPrimaryTimeoutMs`.
`claimAdminSettings(env)` (WP07, modèle `vendorPinSettings`) : `{ production, claimCodeHmacKey, claimCodeKeyVersion,
claimCodeDomain, claimAdminDatabaseUrl }` (`claimCodeDomain` : colonne `url` du fichier), seule configuration lue par la commande `reissue-claim-codes` (jamais `loadConfig`).
Le refus de démarrage sur version se fait dans `ClaimsService.onModuleInit` (WP07).
`ClaimHasher.keyVersion` (lecture seule) renvoie `claimCodeKeyVersion` ; toute écriture ou lecture d'empreinte passe
cette version à la base.

## API

| Objet | Forme | Propriétaire |
|---|---|---|
| `KycModule` (`apps/api/src/kyc/`) | `KycController` (`POST /kyc-verifications`), `KycService.create(client, actor, body)` → `KycVerification` du contrat (`wallet_id` **ou** `customer_id` ; avec `customer_id`, l'agent doit tenir son rôle sur la portée d'au moins un portefeuille du client, sinon `403`) | WP05 |
| Actions d'audit | `KYC_VERIFIED` et `KYC_REVOKED` ajoutées toutes deux par WP05 à l'union `AuditAction` (`audit/audit.service.ts`, hors carte) ; WP06 ne touche pas ce fichier | WP05 |
| Portée de la révocation | identification avec `wallet_id` : portée `EVENT` du grand livre (`OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`) ; posée par `customer_id` seul (`wallet_id` NULL) : portée `OPERATOR`, donc `OPERATOR_ADMIN` seulement | WP06 |
| Révocation | `KycRevocationController` (`POST /kyc-verifications/:id/revoke`) ; `kyc-revocation-action.ts` enregistre `KYC_REVOCATION` (rôles `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`) dans le registre des actions | WP06 |
| Motifs de ligne d'import | `ASSOCIATION_REASONS` + `BAD_PRINTED_NUMBER`, `PRINTED_NUMBER_TAKEN` |WP07 ; ajout des deux valeurs à l'énumération `ClaimCodeAssociationResult.reason` d'`openapi.yaml`, entrées `enum-value` de `contract-baseline.json`, régénération des types (TS, Dart) et ADR-225 : WP09 (décision du porteur du 20/11/2026) |
| `MeService` | `printed_number` de `CustomerMedia` lu en base ; `pending_offline_notice` par portefeuille via `wallet_pending_offline_notice` | WP09 |
| `OtpProvider` | `{ readonly name: string; readonly isFake?: boolean; send(phone: string, code: string, link?: HolderLink): Promise<{ accepted: boolean; noWhatsApp?: boolean; deliveryRef?: string }>; onDelivery(listener: (deliveryRef: string) => void): void }` | WP10 |
| `OtpSender.send` | signature existante **plus** un 5e argument facultatif `context?: { challengeId: string; operatorId: string }` (pour `otp_channel_attempt`) ; `customer-auth.service.ts` le passe | WP10 |
| `ChainedOtpSender` | implémente `OtpSender` ; providers WhatsApp, SMS principal, SMS de repli ; minuteries `OTP_*_TIMEOUT_MS` ; code effacé à la confirmation ou **dès le dernier envoi** (35 s au plus) ; `close()` efface tout à l'arrêt | WP10 |
| Faux | `FakeWhatsAppProvider`, `FakeSmsPrimaryProvider`, `FakeSmsFallbackProvider` ; libellés de refus en production (bootstrap) : « l'envoi des codes par WhatsApp », « l'envoi des codes par SMS (principal) », « l'envoi des codes par SMS (repli) » | WP10 |
| Commande | `apps/api/src/cli/reissue-claim-codes.ts` : `--operator`, `--batch`, `--out` ; codes de sortie 0, 1, 2, 3 (`contracts/claim-code-rotation.md`) | WP08 |

## Audit et journaux

`id_last4` peut figurer dans l'audit (ligne `KYC_VERIFIED`, résultat `KycVerification` d'`APPROVAL_EXECUTED`) : même
donnée que la table, exigée dans `result` par le contrat ; **jamais** dans les journaux applicatifs. Aucun code (OTP,
rattachement) nulle part hors mémoire.
