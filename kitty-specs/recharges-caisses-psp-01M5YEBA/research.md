# Research: Recharges, caisses et PSP

Décisions du plan, avec leur raison et les options écartées. **La section R-20 (corrections de la passe
contradictoire) fait foi sur les sections antérieures quand elles divergent.** « Renforcement » = plus strict que les sources : fait,
puis consigné (règle 1 de `CLAUDE.md`). « Porteur » = décision du porteur. Références de code relatives à la racine.

## R-01 — Compte de caisse : un par terminal, créé par la base à la première session

- **Decision** : la caisse est le terminal en mode `TOPUP_DESK`. `open_cash_session(device, personne)` (SECURITY
  DEFINER) crée `A-CAISSE-<série>` (`CASH_DESK`, grand livre de l'événement du terminal, ni chaud ni négatif) s'il
  n'existe pas, puis ouvre la session. `counter-access.ts` garde sa recherche par série (aucun autre code ne change de
  sens) et ajoute la session ouverte du terminal à `CounterActor`.
- **Rationale** : ADR-89 désigne ce code ; c'est la seule recherche de caisse du code ; une caisse = un tiroir physique
  = un poste. La caisse est inscrite dans `cash_desk` par la base ; un déclencheur interdit à `cashless_app` de créer
  un compte `CASH_DESK` ou `PSP` (R-20, A6).
- **Alternatives** : compte créé par le back-office et fourni (`cash_account_id` du contrat) — écarté : un compte mal
  rattaché permet de rendre des espèces sur la caisse d'un autre poste (`refund_cash_due` accepte tout `CASH_DESK` du
  grand livre). Le champ du contrat devient facultatif ; fourni, il doit être celui du terminal (sinon `409`).

## R-02 — Aucune espèce hors session : garde en base sur les écritures de caisse (renforcement)

- **Decision** : un déclencheur sur `posting` refuse toute écriture sur un compte `CASH_DESK` sans session `OPEN` de ce
  compte (sauf la transaction `CASH_CLOSE` de la session qui se ferme, posée par `close_cash_session`). Chaque
  transaction d'espèces est rattachée à sa session (`cash_session_tx`) par la même transaction, via la fonction qui
  l'accompagne (`attach_cash_tx`), appelée par l'API ; un contrôle pgTAP vérifie qu'aucune écriture de caisse n'est
  sans rattachement.
- **Rationale** : FR-004 ; ADR-89 (« aucun argent liquide n'entre sans session ») ; la garde vaut pour toutes les
  fonctions existantes (`take_deposit`, `refund_deposit`, `refund_cash_due`) sans les réécrire.
- **Alternatives** : contrôle dans l'API seule — écarté (une route oubliée suffit). Colonne `cash_session_id` dans
  `journal_transaction` — écartée : modifie une table du schéma de référence et sa contrainte d'immuabilité.
- **Conséquence** : les tests de la mission 4 qui posent un compte de caisse à la main ouvrent désormais une session.

## R-03 — Théorique, comptage à l'aveugle, fermeture par une autre personne (renforcement)

- **Decision** : théorique = solde du compte de caisse lu sous verrou à la fermeture. Le comptage (`count_cash_session`)
  n'expose jamais le théorique ; la lecture de la session par l'agent ne le renvoie pas tant qu'elle est `OPEN`.
  `close_cash_session` refuse si le fermeur est l'auteur du dernier comptage (`403`), écrit `CASH_CLOSE` par le moteur
  dans la même transaction, ouvre `CASH_DIFF` si l'écart est non nul et ramène la caisse à zéro.
- **Cas limites** : théorique et compté nuls → session fermée sans écriture ; théorique nul et compté positif → surplus
  seul (le constructeur `buildCashClose` accepte un théorique nul) ; compté nul et théorique positif → tout en manque.
- **Rationale** : contrôle de caisse (§12.2, NFR-007) ; un agent qui ferme seul sa caisse peut ajuster le compté au
  théorique.
- **Alternatives** : fermeture par le `SUPERVISOR` sans autre contrôle (contrat actuel) — écartée (une même personne
  pourrait compter et fermer).

## R-04 — Routes de session : terminal + personne (renforcement)

- **Decision** : ouverture et comptage exigent les trois preuves du terminal (`TOPUP_DESK`) et le jeton de la personne
  (`X-Staff-Authorization`, ADR-113), comme les autres routes du guichet. Fermeture : `SUPERVISOR` par le back-office
  (jeton de personne) ou au terminal (terminal + personne). Contrat corrigé (contracts/openapi-additions.md).
- **Rationale** : un jeton d'agent volé ne doit pas ouvrir une caisse depuis n'importe où. Contradiction signalée
  (contrat : jeton de personne seul).

## R-05 — Recharge espèces en ligne : refus au-delà du plafond ; découpage réservé au hors ligne

- **Decision** : dans `ledger-engine.service.ts` (`enrich`, cas `TOPUP_CASH`), la marge n'est lue et le découpage
  appliqué que pour les sources `OFFLINE_SYNC` et `EDGE_SYNC` ; en `ONLINE`, la base refuse au-delà du plafond
  (`CL008`/`CL009` → `422`). Pour le découpage, la même transaction ouvre l'anomalie `CASH_TOPUP_OVER_LIMIT` (bracelet,
  montant) par une fonction de la base (`open_cash_due_anomaly`).
- **Rationale** : SPECIFICATION §5.3, §5.7, ADR-63 ; le code actuel découpe pour toute source et n'ouvre aucune
  anomalie : des espèces dues non rendables par `refund_cash_due` (correction d'un défaut existant).

## R-06 — Caution due après chaque crédit payé

- **Decision** : après la validation de la transaction de `TOPUP_CASH` ou de `TOPUP`, l'API appelle
  `DepositService.takeDueDeposit` dans une transaction distincte, avec la caisse de la session pour une recharge au
  guichet (mode prélevé sur le solde seulement : la caution `SEPARATE` reste en espèces au guichet). Un échec est
  journalisé et laisse la caution `DUE`.
- **Rationale** : §7.9, contrat `media-lifecycle.md` règle 4.

## R-07 — Configurations PSP et choix par événement, contrôlés par la base

- **Decision** : tables `psp_configuration` (S26) et `event_psp_selection` (S26b) écrites par fonctions de la base
  seulement. Index unique partiel : au plus une configuration par défaut active par organisateur et par moyen. Le
  déclencheur de `event_psp_selection` vérifie organisateur, statut `ACTIVE` et titulaire = `ledger.funds_holder_id`.
  `resolve_psp_configuration(event, moyen)` applique le même contrôle au défaut au moment de la recharge
  (`PSP_NOT_CONFIGURED`). Activation : demande d'approbation `PSP_CONFIGURATION`, auteur et valideur
  `OPERATOR_ADMIN` distincts (le prestataire configure, §11.1). Choix : `ORGANIZER_ADMIN` seul hors `LIVE` ; pendant
  `LIVE`, demande `EVENT_PSP_SELECTION` à deux.
- **Rationale** : ADR-72, §3.2. La base garantit le titulaire quelle que soit l'API.

## R-08 — Secrets : port de coffre, faux refusé en production (porteur)

- **Decision** : la configuration ne garde qu'une référence opaque (`secret_ref`). Le port `PspSecretStore` rend, pour
  une configuration et son titulaire, les secrets de l'adaptateur et les deux secrets de notification (rotation). Seul
  le faux existe (mémoire du processus, valeurs posées par les tests) ; il porte `isFake` et le démarrage en
  production est refusé (`assertProcessIsSafe`). Aucun secret PSP dans `loadConfig` (ADR-125 respecté). Adaptateur AWS
  reporté avec les adaptateurs réels (décision du porteur du 27/10/2026).
- **Dette nommée** : OP-N81 / ADR-131 (voir R-17).

## R-09 — Interface commune d'adaptateur et faux par fournisseur (porteur)

- **Decision** : port `PspAdapter` : `initiate(topup) → action de paiement + référence + échéance`,
  `verifyNotification(corps brut, en-têtes, secrets) → notification normalisée`, `getStatus(référence)`,
  `readStatement(période)` (signature seulement, faux vide). Notification normalisée : identifiant de notification,
  type (`PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `PAYMENT_CANCELLED`, `DISPUTE`), référence de paiement, montant, devise,
  et pour la carte : empreinte de carte, `three_ds` (`SUCCEEDED`/`FAILED`/`NOT_PERFORMED`). Un faux par fournisseur
  (`WAVE`, `ORANGE_MONEY`, `PAYDUNYA`, `STRIPE`), tous au schéma de signature du contrat, `isFake = true`.
- **Rationale** : §11.1 ; les adaptateurs réels sont reportés (porteur) ; l'interface est figée maintenant pour que la
  mission suivante n'ait qu'à les brancher.

## R-10 — Réception des notifications : vérifier, puis conserver, puis traiter

- **Decision** : route publique `POST /webhooks/{provider}/{psp_config_id}` dans le processus public, corps brut
  conservé par Nest (`rawBody`), taille maximale 64 Kio vérifiée avant toute lecture. Ordre : configuration
  `ACTIVE` et du bon fournisseur (sinon `404` neutre) → signature à temps constant sur les deux secrets
  (`timingSafeEqual`) → horodatage à ±300 s → une transaction : `record_psp_event` (unique `(config, id de
  notification)` ; doublon → `200 duplicate`) puis traitement (R-11). Un refus n'écrit rien en base : signalement par
  un journal de sécurité structuré (`psp.webhook.rejected`, motif, fournisseur, configuration, taille, empreinte
  SHA-256 du corps, adresse) et un compteur d'alerte d'exploitation borné (au plus une alerte par minute et par
  motif).
- **Rationale** : contradiction §11.1 / contrat tranchée sans silence et sans stocker le corps d'un appelant non
  authentifié (déni de service par volume). Renforcement : taille bornée, temps constant.
- **Alternatives** : stocker brut tout corps reçu — écarté (volume non borné, données non authentifiées).

## R-11 — Traitement d'un paiement notifié

Dans la transaction de la notification, après `record_psp_event` :

1. Recharge retrouvée par `(configuration, référence de paiement)` ; absente → anomalie `PSP_MISMATCH` (rien d'écrit
   au grand livre).
2. Configuration, montant ou devise différents → `PSP_MISMATCH`.
3. Carte : `three_ds ≠ SUCCEEDED` → non créditée (`PSP_TOPUP_NOT_CREDITED`, motif `THREE_DS`) ; empreinte qui
   dépasserait `card_topup_daily_max_per_card` sur le jour (jour civil de l'événement, recharges `SUCCEEDED` de la
   même empreinte dans le grand livre) → `PSP_TOPUP_OVER_LIMIT`, motif `CARD_DAILY_LIMIT`.
4. Grand livre qui n'accepte plus `TOPUP` (au-delà de `CLOSING`) → `PSP_TOPUP_NOT_CREDITED`, motif `LEDGER_STATUS`.
5. Plafond de solde ou mensuel : marge lue par `wallet_topup_headroom` ; montant net au-delà → `PSP_TOPUP_OVER_LIMIT`.
6. Sinon `TOPUP` par le moteur (source `PSP_WEBHOOK`, clé du contrat, `occurred_at` = heure de réception), frais par
   la règle de la configuration (R-13), recharge `SUCCEEDED` (`complete_psp_topup`, qui vérifie la transaction).
7. Carte : `CARD_VELOCITY` si le nombre d'empreintes distinctes ayant rechargé ce portefeuille atteint
   `card_alert_cards_per_wallet` (anomalie ouverte une fois par portefeuille et par empreinte nouvelle).

Les cas 3 à 5 passent la recharge à `FAILED` avec l'anomalie, dont le montant est l'argent à rendre au payeur.
Après validation : caution due (R-06). Un succès découvert par interrogation suit le même chemin, avec la même clé
d'écriture.

- **Nouveau type d'anomalie** `PSP_TOPUP_NOT_CREDITED` : extension de la liste fermée (migration), car
  `PSP_TOPUP_OVER_LIMIT` désigne un plafond et `PSP_MISMATCH` une notification non conforme. Signalé comme
  complément de la spécification.
- **`CARD_DAILY_LIMIT` à l'initiation** (contrat) : impossible (empreinte inconnue avant saisie chez le PSP) ;
  contrôlé à la notification ; contrat corrigé.

## R-12 — Interrogation planifiée et expiration

- **Decision** : travailleur `PspTopupPoller` (`ProcessWorker`, lancé par l'ordonnanceur externe avec `--once`) :
  recharges `PENDING` de plus de 2 minutes → `getStatus` ; succès → traitement R-11 (clé identique) ; échec PSP →
  `FAILED` ; échéance dépassée (`expires_at`, 15 minutes pour les faux, valeur de l'adaptateur) → `EXPIRED`. Code de
  sortie d'alerte en cas d'échec (§12.2).
- **Rationale** : modèle existant (`daily-check.worker.ts`) ; pas de dépendance d'ordonnancement (document 08).

## R-13 — Frais PSP : règle de frais par configuration

- **Decision** : `fee_rule.scope_type` accepte `PSP_CONFIGURATION` (migration) ; le résolveur lit la règle de la
  configuration de la recharge (`basis = TOPUP_AMOUNT`). La convention provisoire d'ADR-82 §3 (`EVENT` + `PSP:<canal>`)
  est retirée (ADR-133). Sans règle, frais nuls. Payeur : `psp_fee_bearer` de l'événement.

## R-14 — Contestations

- **Decision** : notification `DISPUTE` → `record_chargeback(recharge, id de contestation, montant)` : unique
  `(configuration, id de contestation)`, montant ≤ montant de la recharge − contestations déjà écrites (base).
  `CHARGEBACK` par le moteur (constructeur existant), puis, dans la même transaction, `block_wallet_after_chargeback`
  si le solde payé ne couvrait pas le montant. Grand livre verrouillé → anomalie `LATE_CHARGEBACK` et demande
  d'approbation `LATE_CHARGEBACK` ; l'exécution écrit en source `BACKOFFICE` dans les bornes de `check_late_claim`.
  Contestation sans recharge connue → `PSP_MISMATCH`.
- **Déblocage** : action d'approbation `WALLET_UNBLOCK` (nouvelle valeur de la liste fermée), `ORGANIZER_ADMIN`, deux
  personnes. **`A-PSP-*` négatif permis** (ADR-77 contre §5.2) : contradiction signalée, ADR-77 appliqué.

## R-15 — Dépôt en banque

- **Decision** : demande d'approbation `CASH_DEPOSIT` (nouvelle valeur), `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` de
  l'événement, auteur et valideur distincts ; l'exécution écrit `CASH_DEPOSIT` (source `BACKOFFICE`) ; la base refuse
  au-delà du solde de `A-TRANSIT` (compte non négatif).

## R-16 — Recharge PSP : qui la demande

- **Decision** : guichet — terminal `TOPUP_DESK` + `CASHIER` (trois preuves et jeton de personne) ; festivalier —
  route derrière `CustomerAuth()` (port d'identité de la 5b, faux refusé en production, OP-N43). Contrat corrigé
  (`humanBearer` seul → deux schémas explicites).

## R-17 — Dette nommée (décisions du porteur du 27/10/2026)

- **OP-N81 / ADR-131** : adaptateurs PSP réels et coffre AWS reportés ; faux par fournisseur et faux coffre refusés au
  démarrage en production ; conséquence : aucune recharge en ligne en production avant la mission des adaptateurs.
  Test de borne : `production-guard.spec.ts` (chaque faux PSP et le faux coffre refusés). Reports : nouvelle mission
  « Adaptateurs PSP réels » dans `PROMPTS-A-ENVOYER.md` et `PRD.md`.
- **OP-N82** : remboursement au payeur d'un paiement non crédité fait hors de la plateforme (tableau de bord du PSP),
  clôturé par résolution d'anomalie à deux ; canal intégré reporté (mission des adaptateurs réels).

## R-18 — Pile et dépendances

- Aucune nouvelle dépendance : HMAC-SHA256 et `timingSafeEqual` de `node:crypto` ; `axios` (cible PSP du document 08)
  n'est pas ajouté tant que les adaptateurs réels sont reportés. Rien à examiner au titre de la chaîne
  d'approvisionnement.

## R-19 — Passe contradictoire

Faite après la rédaction (agent distinct) ; constats et suites consignés dans
`kitty-specs/recharges-caisses-psp-01M5YEBA/research-adversarial.md`.

## R-20 — Corrections issues de la passe contradictoire (font foi)

**Caisses**
- Registre `cash_desk(account_id, device_id, ledger_id)` rempli par `open_cash_session` ; la garde de `posting` ne vaut
  que pour les comptes inscrits (les suites de référence générées, qui posent `A-CAISSE-C1` sans session, restent
  vertes ; C-002 respecté). Déclencheur `BEFORE INSERT ON account` : `current_user = 'cashless_app'` et
  `purpose IN ('CASH_DESK','PSP')` → refus (A1, A6).
- Fermeture : `begin_cash_close` verrouille le solde de la caisse, puis passe la session à `CLOSING` (état de ligne) ;
  la garde admet sur une caisse `CLOSING` la seule transaction `CASH_CLOSE` de clé `cash-close:<session>` ;
  `finish_cash_close` passe à `CLOSED`. Aucune variable de session n'ouvre la garde (A7). La garde lit sans verrou
  (A21) ; test de concurrence fermeture/recharge.
- La garde compare le terminal de la transaction (`journal_transaction.device_id`) à celui de la session quand il est
  posé ; variantes `take_deposit_for_session`, `refund_deposit_for_session`, `refund_cash_due_for_session` qui dérivent
  la caisse de la session ; l'API ne passe plus de compte de caisse (A8).
- La garde vaut pour toutes les sources ; la mission 7 définira la session d'une recharge hors ligne (report, A17).
- Ouverture refusée hors `LIVE`/`CLOSING` ; contrôle « aucune session `OPEN` » avant `RECONCILING` reporté à la
  mission 9 (A32). Le fermeur ne doit avoir fait aucun comptage de la session ; au plus 10 comptages (A26).
  Aucune route accessible à un `CASHIER` ne rend le solde d'un compte `CASH_DESK` (inventaire et test, A27).

**Notifications et recharges**
- Référence marchande = `psp_topup_id`, transmise à `initiate` et rendue par la notification normalisée ; corrélation
  par elle d'abord, puis par la référence du PSP (A2).
- Réception : vérification (R-10) puis **transaction 1** : `record_psp_event` (conservé, `RECEIVED`) → `200`.
  **Transaction 2** (même requête, puis travailleur en reprise) : traitement sous `FOR UPDATE` de la recharge (A13).
  Issues de l'événement : `PROCESSED`, `UNMATCHED` (recharge introuvable : retraité par le travailleur pendant 24 h,
  puis `PSP_MISMATCH`), `RETRY` (erreur inattendue : retraité, alerte au-delà de 5 essais). Contrat appliqué
  (« persistance puis traitement »), contradiction du premier plan levée (A4, A19).
- Refus définitifs du moteur (`PERIOD_CLOSED`, `DEBIT_AUTHORITY_EDGE`, portefeuille bloqué ou fermé, compte inactif,
  frais ≥ montant, `CL002`) → recharge `FAILED` + `PSP_TOPUP_NOT_CREDITED` (motif nommé) ; jamais de `500` en boucle (A4).
- États : `PAYMENT_FAILED` ne finalise pas ; `FAILED` seulement par refus de crédit ou échec confirmé par
  l'interrogation ; `initiate` en échec → reste `PENDING` ; expiration par le travailleur après relecture du statut,
  sous verrou de ligne ; un succès authentifié sur `FAILED`/`EXPIRED`/`CANCELLED` est crédité s'il est recevable
  (mêmes contrôles), sinon `PSP_TOPUP_NOT_CREDITED` ; plus d'issue « ignorée » (A3). Tableau dans data-model.md.
- `CHECK ((status = 'SUCCEEDED') = (topup_tx_id IS NOT NULL))` ; anomalie à rendre exclusive d'un crédit (A13).
- Carte : `getStatus` et `verifyNotification` rendent le même type normalisé ; sans empreinte ou sans 3-D Secure
  `SUCCEEDED` (absent compris) → non créditée (`THREE_DS`, `NO_FINGERPRINT`) (A11) ; plafond par carte sous
  `pg_advisory_xact_lock(ledger, empreinte)` dans `complete_card_topup`, jour civil UTC (A12).
- Portefeuille `BLOCKED`/`CLOSED` : refus à l'initiation (`409 WALLET_BLOCKED`) et non crédité à la notification (A20).
- Au plus 3 recharges `PENDING` par portefeuille et 20 par terminal ; `Idempotency-Key` obligatoire (A25).
- Caution due aussi sur le chemin doublon et par le travailleur (A33).
- Clés d'écriture qualifiées par la configuration pour tous les moyens : `wave:<config>:<paiement>`,
  `om:<config>:<paiement>`, `psp:<config>:<paiement>` (contradiction avec le contrat signalée, plus sûre, A31).

**Configurations, secrets, frais**
- Fonctions `psp_webhook_context(config)` et `psp_poll_candidates(limit)` (lecture neutre, droits nommés, A9).
- `CHECK (secret_ref LIKE 'psp/' || holder_party_id || '/%')`, titulaire partie du prestataire ; le port refuse un
  segment différent (A10). Le port rend l'échéance du secret précédent ; refus au-delà (A23).
- `resolve_psp_configuration` revérifie toujours statut, validité, organisateur, titulaire et moyen ; configuration
  suspendue : notifications refusées et signalées, recharges `PENDING` suivies par interrogation ; transitions
  `DRAFT → ACTIVE → SUSPENDED → ACTIVE` (réactivation à deux) ; modification = nouvelle version (nouvelle ligne,
  ancienne `SUSPENDED` à l'activation), approbation liée à la version (A15, A30).
- Activation refusée sans règle de frais explicite (même 0 %) ; aucune règle `PSP:<canal>` existante (migration qui le
  vérifie) (A18). `compliance_ref` obligatoire dans la demande `PSP_CONFIGURATION` (A34).
- Production : aucun faux construit ; fournisseur « indisponible » (réel) → `503 PSP_UNAVAILABLE`, notifications
  `404`, travailleur inactif ; le processus public démarre avec les routes espèces ; test des deux comportements (A5).
- Refus de notification : compteur durable agrégé `psp_webhook_rejection(config, motif, minute, nombre)` sans corps ;
  alerte à la première occurrence et au seuil (A22). Corps brut purgé après 400 jours, lecture auditée (A24).

**Contestations et argent non crédité**
- `record_chargeback` exige `SUCCEEDED`, `topup_tx_id`, `CARD`, même devise ; plafond = montant net crédité (A14).
- Argent encaissé non crédité : aucune écriture d'attente en V1 ; OP-N82 complété (écart attendu au contrôle
  « grand livre = relevé », anomalies à exclure du rapprochement) ; report à la mission 9 (A16).
