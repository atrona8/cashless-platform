# Research: Remboursements des festivaliers (mission 9a)

Recherche en lecture seule du 13/11/2026 sur `feat/remboursements` (main + spec). Chemins relatifs à la racine ;
`SQL` = `packages/ledger-sql`, `API` = `apps/api/src`.

## État des lieux

- **Écriture.**
  - `buildWalletRefund` (`API/ledger/builders/festival/refund.ts:23-45`) écrit le `WALLET_REFUND` :
    - débit du portefeuille payé ;
    - crédit du compte d'argent ;
    - frais crédités à `ORG_FFEST` et `ORG_TAX`, étiquetés `fee_rule_id`.
  - Il est enregistré en `mixed` (`registry.ts:85-89`).
  - Il refuse des frais supérieurs ou égaux au montant (`refund.ts:33-37`).
  - `L-VERS-ENCOURS` n'intervient pas (SPEC §5.4).
- **Comptes d'argent mobile.** `A-PSP-WAVE` et `A-PSP-OM` (`SQL/migrations/0037_psp_configurations.sql:560-566`).
- **Frais.** Règle `fee_rule` `PER_REFUND` (`API/configuration/sql-config-resolver.ts:150-154`). Une règle absente
  donne aujourd'hui un `422` (l. 367-380). Le calcul se fait par `fee()` (`packages/shared-rules/src/money/fee.ts:14`).
- **`post_transaction`** (dernière version `SQL/migrations/0060_edge_sync_registry.sql:319`) :
  - garde `LOCKED` (seulement `BACKOFFICE` avant `late_claims_until`, `check_late_claim` ASSET seulement) ;
  - garde `CLOSING` (refus de `TOPUP`, `TOPUP_CASH` et `PURCHASE` en `ONLINE`) ;
  - garde `EDGE` (CL006 sur tout débit de portefeuille hors `EDGE_SYNC`) ;
  - aucune lecture de `wallet.status` ni de `media.status`.
- **Matrice des statuts** (`API/ledger/status-matrix.ts:73-156`, SPEC §12.1) : `WALLET_REFUND` est permis de `LIVE`
  à `CLOSED`/`CLOSING`. `REVERSAL` ne l'est qu'en `LIVE`, en `CLOSING`, et en `RECONCILING` pour les sources de
  synchronisation seulement.
- **`refund_request`.** La table n'existe nulle part. `approval_request.action` admet déjà `WALLET_REFUND`
  (`schema_grand_livre_cashless.sql:2911`).
- **Double validation** (`API/approval/action-registry.ts:37-115`, `approval.service.ts:70-174`) :
  - le modèle à suivre est `API/reversals/sale-reversal-action.ts` ;
  - un refus métier à l'exécution passe l'`approval_request` en `FAILED` sous SAVEPOINT ;
  - la demande de remboursement reste alors `REQUESTED`.
- **Jeton d'approbation sur place** (`API/approval/onsite/onsite-approval.ts`) : il est lié à `operationId` et à
  l'empreinte du corps (`act-hash.ts`). Exemple d'usage : `media/lifecycle/cash-due.controller.ts:45-70`.
- **Codes à usage unique** (`SQL/migrations/0080_customer_auth.sql:37-71`, `API/customer-auth/customer-auth.service.ts`) :
  - le défi est générique : il n'a ni usage ni objet ;
  - un seul code vit à la fois par numéro (l. 117-122) ;
  - quotas et blocage sont partagés ;
  - aucune méthode ne vérifie un code sans émettre de jetons ;
  - `exchangeIn` crée même le compte (l. 273-289).
- **Fenêtre de remboursement.**
  - Colonnes de l'événement : `refund_deadline`, `ends_at`, `cash_refund_single_max`, `refund_new_number_max`,
    `refund_new_number_hold_hours`.
  - Date limite effective : `effectiveRefundDeadline` (`API/configuration/provisional-defaults.ts:128-138`).
  - `GET /me/wallets` sert `refund.eligible` en dur à `false`, et la colonne brute comme date limite
    (`me.service.ts:105, 134-135`).
- **Guichet.**
  - `release.controller.ts:48-50` refuse toute demande d'enchaînement (`release.no_chaining`).
  - `release.service.ts:41-119` n'écrit rien, puis appelle `release_media`.
  - Les étapes existent : `DepositService.refund`, le constructeur `PROMO_EXPIRY`, `CashDueService.refund`.
  - Il n'existe aucune écriture du solde payé en espèces.
  - `posting_cash_desk_guard` (`0036:507-533`) exige une session ouverte et le même terminal.
- **Autorité de débit** (`API/debit-authority/debit-paths.ts`) :
  - `confirmRefundRequest` est classée `ABSENT`, et `debit-paths-refused.spec.ts` attend `404` ;
  - les autres routes de remboursement ne sont pas classées.
- **Codes d'erreur.** Tous ceux dont les routes ont besoin sont déjà au catalogue (`problem-codes.ts:85-94`,
  `messages.*.json`).

## Décisions

### R-01 — Paiement manuel, aucun port de versement

- **Decision**: l'API ne verse rien. L'approbation écrit `WALLET_REFUND`, le paiement se fait hors système, puis
  `confirmRefundRequest` enregistre `PAID` (avec référence) ou `FAILED` (avec motif, suivi d'un `REVERSAL`).
- **Rationale**: SPEC §8.5 et §11.4, ADR-53, description du contrat ; décision du porteur du 13/11/2026.
- **Alternatives considered**: port de versement avec faux jusqu'à la 12b (texte initial de `PROMPTS-A-ENVOYER.md`).
  Écarté : contraire à la spec, et il demande un faux de plus.

### R-02 — Table `refund_request`, identifiant `uuid`

- **Decision**: l'identifiant est un `uuid`, rendu comme chaîne (le contrat déclare `string`). Il sert de `target_id`
  à l'`approval_request`, elle-même en `uuid`. Isolation par prestataire : RLS `tenant_isolation` sur `operator_id`,
  ENABLE + FORCE (modèle `0080`). Index unique partiel : un portefeuille a au plus une demande `AWAITING_HOLDER`,
  `REQUESTED` ou `PROCESSING`. Les colonnes du demandeur et de la confirmation (auteur, date) sont gardées en base
  sans être exposées.
- **Rationale**: S16 ; le contrat accepte toute chaîne ; FR-003 et NFR-002 sont garantis par la base.
- **Alternatives considered**: identifiant d'affichage `RF-0001` (exemple du contrat). Écarté : séquence par
  prestataire et un second identifiant sans besoin. `CANCELLED` reste dans l'énumération sans route qui le produise
  (contrat inchangé).

### R-03 — `REVERSAL` d'un `WALLET_REFUND` après `RECONCILING` (contradiction SPEC §11.4 / §12.1)

- **Decision**: la garde de statut de la base et `status-matrix.ts` acceptent un `REVERSAL` de source `BACKOFFICE` dont
  la transaction contre-passée est un `WALLET_REFUND`, dans tout statut où `WALLET_REFUND` est permis. Tout autre
  `REVERSAL` reste soumis à la matrice. Test négatif : un `REVERSAL` d'un `PURCHASE` en `SETTLING` est refusé.
  Contradiction consignée en ADR-189.
- **Rationale**: décision du porteur du 13/11/2026 ; un paiement échoué doit recréditer le festivalier (§11.4, contrat
  `confirmRefundRequest`). L'élargissement crédite un portefeuille et ne crée aucun débit. L'index
  `journal_transaction_reverses_once` (`0033:104`) empêche une double contre-passation.
- **Alternatives considered**: refuser `FAILED` après `RECONCILING` et renvoyer à la réclamation tardive (9b). Écarté
  par le porteur.
- **Hors périmètre**: un grand livre `LOCKED` refuse les lignes de frais (`check_late_claim`, ASSET seulement). Les
  remboursements après verrouillage relèvent des réclamations tardives (9b).

### R-04 — Portefeuille bloqué, bracelet suspendu

- **Decision**: remboursable seulement si le seul blocage vient d'un bracelet déclaré perdu (`SUSPENDED`). Refus
  `422 REFUND_NOT_ALLOWED` dans les cas suivants :
  - `wallet.status = BLOCKED` pour une contestation ou une autre cause (`other_block`, `0042`) ;
  - un bracelet du portefeuille est `BLACKLISTED` ;
  - le portefeuille est `CLOSED`.

  Le contrôle se fait à la création et de nouveau à l'exécution de l'approbation.
- **Rationale**: décision du porteur du 13/11/2026 ; la base ne le contrôle pas, donc l'API le fait (SPEC §5).
  Empêche de vider un portefeuille bloqué pour contestation.
- **Alternatives considered**: toujours remboursable (affaiblit la sécurité) ; jamais si bloqué (pénalise la perte).

### R-05 — Codes à usage unique : vérification réutilisable, défi du titulaire lié à la demande

- **Decision**:
  1. **Méthode `verifyChallenge`.** Elle est extraite de `exchangeIn` et réutilise le même verrou par numéro, la
     comparaison en temps constant, le comptage des essais et le blocage. Elle n'émet aucun jeton et ne crée aucun
     compte. Elle vérifie aussi que le numéro du défi est le numéro attendu, puis consomme le défi.
  2. **Code du nouveau numéro.** Il est obtenu par `requestCustomerOtp` (contrat). À la création de la demande, il est
     vérifié contre `destination.msisdn`, puis consommé : il ne peut plus servir.
  3. **Défi du titulaire.** Le serveur le crée avec `purpose = REFUND_HOLDER` et `subject_id = refund_request_id`.
     `decideRefundRequestAsHolder` n'accepte qu'un défi de ce type, lié à cette demande.
  4. **Isolation des codes.** La règle « un seul code vivant » s'applique par numéro **et** par usage. Un code de
     titulaire n'invalide donc pas une connexion en cours. Les quotas d'envoi restent communs : ils limitent le
     harcèlement par SMS.
  5. **Colonnes nouvelles d'`otp_challenge`.** `purpose`, qui vaut `LOGIN` par défaut, et `subject_id`, nullable.
     Les défis de connexion restent inchangés.
- **Rationale**: le défi générique permettait de présenter un code obtenu pour un autre usage. C'est un renforcement :
  il se fait, puis se consigne (règle du porteur).
- **Alternatives considered**: défi générique tel quel (réemploi possible) ; nouvelle route pour demander le code du
  nouveau numéro (contrat modifié, C-002).
- **Envoi du code au titulaire.** Il passe par le port `OtpSender` existant, avec un faux refusé en production
  (OP-N120). Le code est rendu dans `X-Test-Otp-Code` sur la réponse de création, en développement seulement,
  comme pour la connexion. À confirmer à l'implémentation : le contrat déclare-t-il cet en-tête sur cette réponse ?
  S'il ne le déclare pas, les tests lisent le code par le faux, sans en-tête.

### R-06 — Échéance de l'attente du titulaire

- **Decision**: `hold_until` = création + `refund_new_number_hold_hours`. Une demande `AWAITING_HOLDER` échue passe
  `REQUESTED` de deux façons :
  - à la lecture et à l'approbation, par une fonction idempotente `promote_due_refund_requests()` ;
  - chaque minute, par le processus `maintenance`, qui appelle cette même fonction en SECURITY DEFINER, avec
    `EXECUTE` accordé à `cashless_maint` ; elle couvre tous les prestataires.

  Après `hold_until`, la décision du titulaire est refusée (`409 CONFLICT_STATE`).
- **Rationale**: NFR-005 (5 min) tenu largement, sans dépendre d'une lecture.
- **Alternatives considered**: évaluation à la lecture seulement (la liste du back-office resterait fausse sans
  lecture) ; travailleur dédié (un processus de plus).

### R-07 — Action d'approbation `WALLET_REFUND`

- **Decision**: l'action suit le modèle `sale-reversal-action.ts`.
  - **Rôle requis.** `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN` sur la portée de l'événement (décision du porteur).
  - **Payload.** Il porte `refund_request_id`, la portée figée et la clé `bo:<Idempotency-Key>` de l'appel
    `approveRefundRequest` (contrat).
  - **Préconditions de l'exécution.** Demande `REQUESTED` (après promotion), éligibilité (R-04, fenêtre, autorité),
    note de vérification d'identité présente si `extra_check_required`.
  - **Écriture.** `WALLET_REFUND` par `buildWalletRefund` : montant = solde payé au moment de l'exécution, frais selon
    la règle (refus `422` sans règle, décision du porteur) ; compte d'argent `A-PSP-WAVE` ou `A-PSP-OM` selon la
    destination.
  - **Effets.** La demande passe `PROCESSING` et reçoit `transaction_id` et `approved_by`.
  - **Refus métier.** Il laisse l'`approval_request` en `FAILED` et la demande en `REQUESTED`.
  - **Valideurs.** Valideur ≠ auteur : garanti par la base (CHECK). Valideur ≠ demandeur : contrôlé quand le demandeur
    est une personne du back-office (cas du virement, reporté).
- **Rationale**: réutilise le mécanisme éprouvé ; le montant au moment de l'exécution évite de rembourser un solde déjà
  dépensé.

### R-08 — Guichet de retour enchaîné, tout ou rien

- **Decision**: `releaseMedia` avec `settle_balance` exécute, dans la même transaction (`tx.run` existant) et dans
  l'ordre §7.9 :
  1. `refund_deposit`, si la caution est `HELD` (`FROM_BALANCE` : recrédit au portefeuille ; `SEPARATE` en espèces :
     caisse de la session) ;
  2. `PROMO_EXPIRY`, clé `promo-expiry:<wallet>:<n° de rattachement>` ;
  3. `WALLET_REFUND` du solde payé en espèces sur le compte de caisse de la session, avec les frais ;
  4. `refund_cash_due_for_session`, s'il y a des espèces dues ;
  5. `release_media`.

  Contrôles autour de l'enchaînement :
  - Au-delà de `cash_refund_single_max` pour le solde payé rendu en espèces, le jeton `X-Approval-Token`
    (`operationId: releaseMedia`, rôle `SUPERVISOR`) est exigé. Sans jeton, `403 APPROVAL_REQUIRED` ; le refus est
    contrôlé côté API, la base ne le faisant que pour les espèces dues.
  - Tout refus annule toute la transaction.
  - `@Idempotent` rejoue la réponse.
  - `cash_to_hand_back` = caution en espèces + solde payé + espèces dues.
  - Le moteur passe la session de caisse et le terminal à un `WALLET_REFUND` en espèces, comme pour les fonctions
    déléguées.
  - Sans `settle_balance`, le comportement reste inchangé.
- **Rationale**: le contrat dit « la requête est idempotente dans son ensemble » ; tout ou rien évite un bracelet à
  moitié soldé. FR-017 est reformulé en conséquence.

### R-09 — Espèces dues d'un bracelet remplacé (OP-N55)

- **Decision**: nouvelle version de `replace_media` : elle réattribue au bracelet neuf (`media_id`) les anomalies
  `CASH_TOPUP_OVER_LIMIT` ouvertes de l'ancien, dans la même transaction.
  - Les espèces dues se rendent par `refundCashDue` sur le bracelet neuf, une fois et une seule, puisque
    `refund_cash_due` somme les anomalies ouvertes par `media_id`.
  - Le bracelet remplacé n'en porte plus.
  - Tests pgTAP et Jest.
  - OP-N55 et ADR-100 sont levés.
- **Rationale**: le contrat n'a pas de route de rendu au back-office ; c'est la seule des deux options d'ADR-100 qui
  tienne sans route nouvelle.

### R-10 — Autorité de débit

- **Decision**: les routes sont classées dans `debit-paths.ts`.
  - L'exécution d'une approbation `WALLET_REFUND` est un `DEBIT` (CL006, la base refuse).
  - `confirmRefundRequest` avec `FAILED` est un `CREDIT`, protégé côté API par une garde `EDGE` qui renvoie
    `409 DEBIT_AUTHORITY_EDGE`, comme l'exige le contrat.
  - `releaseMedia` reste un `DEBIT`.
  - La création, la liste, le refus et la décision du titulaire sont `NEUTRAL`.
  - `debit-paths-refused.spec.ts` est mis à jour.

### R-11 — Numéro de migration

- **Decision**: `0081_refund_requests.sql`, puis des numéros croissants au besoin.
- **Rationale**: on reste monotone après `0080`. La plage `0073`–`0079` est laissée libre, pour éviter d'insérer une
  migration avant une migration déjà appliquée sur les bases partagées.

### R-12 — Dépendances (DIRECTIVE_051)

- **Decision**: aucune dépendance ajoutée, mise à jour ou retirée. Les contrôles de la directive sont donc sans objet ;
  aucune passe contradictoire de chaîne d'approvisionnement n'est requise.

## Fichiers à faire relire par une personne (règle 4 de `CLAUDE.md`)

- `0081_refund_requests.sql` : RLS, fonctions SECURITY DEFINER, nouvelle garde de statut de `post_transaction`,
  `replace_media`.
- `post-roles.sql`, section 11.
- `customer-auth.service.ts` : vérification extraite.
- `wallet-refund-action.ts`.
- Jeton sur place de `releaseMedia`.
