# Research: Versements, rapprochements et clôture (mission 9b)

Recherche faite le 17/11/2026 par trois agents en lecture seule (clôture ; versements, rapprochements et dettes de la
9a ; scellement, contrôles et contrat), consolidée ici. Chemins relatifs à la racine du dépôt ;
`S` = `packages/ledger-sql/schema_grand_livre_cashless.sql`.

## Constat d'ensemble

- **Déjà en base** :
  - le passage de statut : `set_event_status` (S:3093, jamais redéfinie) et sa copie en lecture
    `event_transition_conditions` (0008) ;
  - le verrouillage (`lock_settled_ledger`, S:3037) ;
  - les réclamations tardives (`check_late_claim`, S:639) ;
  - le scellement du grand livre (`seal_ledger`, `verify_ledger_seals`, `ledgers_to_seal`) et du journal d'audit
    (`seal_audit`, `verify_audit_chain`, 0004) ;
  - les tables `payout` et `external_statement_line` ;
  - les vues de contrôle (`ledger_invariant`, `party_position`, `balance_drift`, `hot_account_side_check`).
- **Déjà en TypeScript** :
  - les constructeurs d'écritures `PITCH_FEE`, `MERCHANT_DEBT_TRANSFER`, `OPERATOR_FEE` (avec inversion),
    `PLATFORM_FEE`, `BREAKAGE`, `BREAKAGE_REVERSAL`, `ADJUSTMENT`, `PAYOUT_*` (`apps/api/src/ledger/builders/closing/`) ;
    **aucun n'a d'appelant** hors du registre ;
  - le circuit à deux (`apps/api/src/approval/`) ;
  - la route de passage de statut (`apps/api/src/events/status/`) ;
  - le cadre des travailleurs (`apps/api/src/processes/`).
- **Absent** :
  - les services et routes d'étape, de versement, de rapprochement, de relevé et d'export ;
  - les travailleurs de scellement et de contrôle ;
  - la table `account_mapping` ;
  - tout chemin d'alerte vers l'exploitation.

## R-01 — État des étapes de clôture

- **Decision** : table `closing_step` (événement, étape, statut `DONE`, auteur, date, transactions écrites), clé unique
  (événement, étape). L'exécution prend un verrou consultatif par (événement, étape), relit l'état, et ne fait rien si
  l'étape est déjà faite (réponse identique). Les clés de transaction sont déterministes :
  `closing:<event_id>:<step>[:<id>]`, comme le scénario de référence.
- **Rationale** : le moteur rejoue une clé seulement si le contenu est identique. Or une étape recalculée après
  exécution a d'autres soldes, donc renverrait `IDEMPOTENCY_KEY_REUSED` (CL002). L'état doit donc être lu avant tout
  calcul. Le verrou tient NFR-001 (50 exécutions concurrentes).
- **Alternatives** : relire la transaction par clé avant calcul (une étape écrit plusieurs transactions, donc fragile) ;
  clé d'en-tête seule (choisie par l'appelant, deux clés = deux exécutions).

## R-02 — Ordre et liste des étapes

- **Decision** : sept étapes, dans l'ordre §12.1 :
  1. `PITCH_FEES` (avec `MERCHANT_DEBT_TRANSFER` si un commerçant passe en négatif) ;
  2. `OPERATOR_FEE` ;
  3. `PLATFORM_FEE` ;
  4. `OPERATOR_FEE_REGULARIZATION` (seulement si `operator_fee_basis = NET_OF_REFUNDS`) ;
  5. `BREAKAGE` ;
  6. `DEPOSIT_FORFEIT` ;
  7. `PROMO_EXPIRY`.

  Les étapes 1 à 3 se font en `SETTLING`, les étapes 4 à 7 en `REFUND_WINDOW` après `refund_deadline` ; c'est la
  matrice existante (`status-matrix.ts`). Une étape est refusée (`409 CLOSING_CONDITION_NOT_MET`) si une étape
  précédente n'est ni faite ni sans objet. Les versements, la caisse et les remboursements ne sont pas des étapes : ils
  ont leurs propres routes.
- **Rationale** : le scénario de référence suit cet ordre (tx 30-32, 43-45). Réutiliser le code d'erreur existant évite
  un ajout au contrat.
- **Alternatives** : une seule route « tout clôturer » (aucun aperçu par étape, écartée par le porteur) ; des étapes
  automatiques au changement de statut (écartées par le porteur).

## R-03 — Calcul des montants (aperçu = exécution sans écriture)

- **Decision** : un service de calcul par étape, partagé par l'aperçu et l'exécution. L'aperçu n'écrit rien et n'ouvre
  aucune transaction d'écriture.
  - **Droits de place** : `merchant_participation.pitch_fee`, `pitch_fee_mode`. `PREPAID` donne une ligne sans
    écriture, avec sa référence.
  - **Frais du prestataire** : règles `fee_rule` du contrat. Les assiettes sont calculées par la mission :
    - `TOPUP_AMOUNT` = recharges payées (`TOPUP`, `TOPUP_CASH`, `PSP_WEBHOOK` crédités) de l'événement ;
    - `PER_MEDIA` = supports activés.
  - **Redevance** : 20 % des frais HT (règle `PLATFORM_CONTRACT`).
  - **Casse** : portefeuilles à solde payé ou espèces dues non nuls à `refund_deadline`, partagés selon
    `breakage_destination` et `breakage_organizer_bps`.
  - **Cautions acquises** : supports `deposit_status = HELD` (fonction `forfeit_deposit` existante, une par support).
  - **Crédits offerts** : portefeuilles à solde offert non nul.
- **Rationale** : les montants viennent entièrement de la configuration (hypothèse de la spec) ; un seul calcul rend
  l'aperçu fidèle.
- **Contrôle** : le scénario de référence (`scenario_reference.json`, `expected.after_closing`) fixe les valeurs. Le test
  de bout en bout (SC-001) les retrouve : droits de place 25 000, frais 6 000, redevance 1 017, casse 20 000
  (16 000 / 4 000), caution acquise 2 000, crédits offerts 1 000, versement final 39 225 + 4 000.

## R-04 — Régularisation `NET_OF_REFUNDS`

- **Decision** : delta = frais calculés sur l'assiette brute écrite en `SETTLING` − frais recalculés sur l'assiette nette
  des `WALLET_REFUND` faits depuis. Le calcul applique la même règle (min, max, fixe compris) aux deux assiettes et
  écrit la différence en `OPERATOR_FEE` inversé. Le droit prestataire négatif qui en résulte se solde au versement final
  (montant net) avant `CLOSED`.
- **Rationale** : `fee()` n'est pas linéaire (min, max, fixe), donc seul un double calcul est exact. §12.1 place la
  régularisation avant le versement final.
- **Alternatives** : appliquer le taux aux remboursements (faux dès qu'il y a un min ou un max).

## R-05 — Conditions de passage ajoutées (renforcements)

- **Decision** : une migration redéfinit `set_event_status` ET `event_transition_conditions` (deux copies, avec un test
  pgTAP d'égalité). Elle ajoute trois conditions :
  - `NO_OPEN_CASH_SESSION` vers `RECONCILING` : aucune `cash_session` `OPEN` ou `CLOSING` de l'événement (FR-002,
    héritage A32) ;
  - `REFUND_DEADLINE_REACHED` vers `CLOSED` : `refund_deadline` atteinte. C'est un renforcement : aujourd'hui la base
    laisse passer avant l'échéance ;
  - `CLOSING_STEPS_DONE` vers `REFUND_WINDOW` et vers `CLOSED` : étapes de la phase faites ou sans objet.

  `PSP_RECONCILED` devient calculée (R-08). Textes fr/en dans `status-messages.ts`. Ce sont trois nouvelles valeurs de
  `StatusCondition.code` au contrat (ajouts).
- **Rationale** : sans ces conditions, une étape peut être sautée (PREPAID et DEDUCT_CAPPED laissent un net nul sans
  écriture). Les renforcements se font, puis se consignent (ADR).

## R-06 — Lot de versements

- **Decision** : préparer un lot = demander l'approbation `PAYOUT` (action déjà au contrat). La charge est figée :
  lignes, bénéficiaires, montants, moyens, destinations. À l'exécution (validation par une seconde personne) :
  1. le droit net de chaque bénéficiaire est relu sous verrou ;
  2. une transaction `PAYOUT_INITIATED` est écrite pour le lot ;
  3. une ligne `payout` est créée par bénéficiaire, avec `approval_request_id` (identifiant du lot), destination,
     `initiated_by` = auteur et `approved_by` = valideur.

  Une migration ajoute à `payout` les colonnes `approval_request_id`, `msisdn`, `iban`, `failure_reason`,
  `confirmed_by`. Le résultat d'une ligne passe par une route propre, sans approbation (comme `confirmRefundRequest`) :
  une transaction `PAYOUT_CONFIRMED` ou `PAYOUT_FAILED` par ligne.
- **Rationale** : c'est le circuit à deux existant (`approval_request`, expiration 24 h, `onClosed`) ; le lot préparé se
  lit par les demandes d'approbation déjà servies. `payout.approved_by` est NOT NULL : la ligne n'existe qu'une fois
  validée, ce qui est conforme.
- **Alternatives** : table `payout_batch` avec état `PREPARED` (états et routes en plus pour un lot immuable).

## R-07 — Borne « montant ≤ droit net » en base (renforcement)

- **Decision** : fonction `create_payout_batch(...)` SECURITY DEFINER, appelée par l'action `PAYOUT`. Elle :
  - verrouille les comptes de droits de chaque bénéficiaire (ordre des identifiants) ;
  - relit `party_position` ;
  - refuse `montant + versements INITIATED non réglés > droit net` (nouveau `CL055` → `409 PAYOUT_EXCEEDS_ENTITLEMENT`) ;
  - écrit `PAYOUT_INITIATED` par `post_transaction` et insère les lignes `payout`.

  Les droits de `cashless_app` sur `payout` et `external_statement_line` sont réduits : `SELECT` seulement, écritures par
  fonctions. Un déclencheur de transitions de `payout` n'autorise que `INITIATED` → `CONFIRMED` ou `FAILED`, une fois.
- **Rationale** : la SPEC exige que le montant NE DOIVE PAS dépasser le droit net ; une borne en API seule affaiblirait
  ce contrôle. Aujourd'hui `cashless_app` peut tout modifier sur ces deux tables, comme le défaut d'OP-N130 : on ne le
  reproduit pas.
- **À faire relire par une personne** : la fonction, le déclencheur et les droits.

## R-08 — Import et rapprochement des relevés

- **Decision** :
  - Table `statement_import` : compte, source, fichier (empreinte SHA-256), date de relevé, solde de clôture, devise,
    auteur, nombre de lignes. Colonnes ajoutées à `external_statement_line` : `statement_import_id`, `currency`,
    `matched_by`, `matched_at`. Unicité portée à (compte, source, référence). Garde de portée à l'insertion : grand livre
    et compte du prestataire, compte de famille `ASSET`.
  - **Import** : CSV commun `external_ref;value_date;amount;currency` ; refus d'une devise ou d'un compte étrangers ; un
    réimport ne crée aucune ligne en double.
  - **Rapprochement automatique**, par table source, jamais en analysant `idempotency_key` :
    - `psp_topup.provider_payment_ref` → `topup_tx_id` ;
    - `psp_chargeback.provider_dispute_id` → `chargeback_tx_id` ;
    - `refund_request.external_reference` → `transaction_id` ;
    - `payout.external_ref` → `settled_tx_id`.
  - **Rapprochement manuel** : même prestataire, même grand livre, une transaction qui mouvemente ce compte.
  - **Compte rapproché** : toutes ses lignes rapprochées, et solde de clôture du dernier relevé = solde du compte à cette
    date (`trial_balance_at`).
  - **Anomalies** : `PSP_TOPUP_OVER_LIMIT`, `PSP_TOPUP_NOT_CREDITED` et `PSP_MISMATCH` ouvertes expliquent l'écart (ligne
    rapprochée à l'anomalie : colonne `matched_anomaly_id`) (FR-015, OP-N82).
  - **Condition** : `PSP_RECONCILED` = tous les `A-PSP-*` rapprochés.
- **Rationale** : `journal_transaction` n'a pas de référence externe ; les tables sources en ont une, fiable. La
  condition du §11.3 exige les soldes concordants.
- **Alternatives** : stocker la référence sur `journal_transaction` (changement du schéma de référence).

## R-09 — Réclamations tardives

- **Decision** :
  - Action `LATE_CLAIM` et route `postLateClaim` telles qu'au contrat : copie du modèle `LATE_CHARGEBACK` (verrou
    consultatif, relecture sous verrou, source `BACKOFFICE`, `approval_request_id` en métadonnée). Deux écritures sous le
    même point de sauvegarde : `BREAKAGE_REVERSAL` (clé `:reversal`) puis `WALLET_REFUND` (clé `:refund`).
    `moneyAccountFor` est étendu : `BANK_TRANSFER` → `A-BANQUE`. `CASH` → caisse ouverte de la personne, refusé sans
    caisse.
  - Action `ADJUSTMENT` (déjà dans l'enum `ApprovalAction`) et nouvelle route `postLateAdjustment` : apport d'un
    bénéficiaire, borné par `check_late_claim`.
  - La preuve du droit (`tap_id` ou compte rattaché) est contrôlée par l'API.
- **Rationale** : décision du porteur du 17/11/2026.

## R-10 — Dettes de la 9a

- **OP-N123** :
  - nouvelle route `createRefundRequest` (back-office), `BANK_TRANSFER` avec IBAN validé (ISO 13616, modulo 97, sans
    dépendance, normalisé, masqué dans l'audit et les journaux) ;
  - `requested_by` écrit à l'insertion ;
  - la création par l'app (`createMyRefundRequest`) garde son refus de `BANK_TRANSFER`.
- **OP-N124** : la vérification du code est scindée. Les essais faux sont comptés dans une transaction propre, qui
  survit au refus. La consommation (`consumed_at`) se fait dans la transaction qui écrit la décision : un refus de la
  décision laisse le code utilisable. Test `journey-limits.spec.ts` inversé.
- **OP-N126** : le recrédit d'un `FAILED` exige l'un ou l'autre :
  - l'absence de ligne de relevé rapprochée à ce remboursement ;
  - une demande d'approbation par une seconde personne (action `WALLET_REFUND` réutilisée, variante d'échec).
- **OP-N128** :
  - migration : `refund_deposit_for_session(..., p_actor, p_approver)` transmet le valideur à `post_transaction` ;
  - `release.service.ts` le passe ;
  - cumul lu après verrouillage des portefeuilles (`lockWalletPaidBalance`), dans l'ordre bracelet puis portefeuilles.
- **OP-N130** :
  - déclencheur de transitions sur `refund_request`, graphe de `remboursements-01M7AG5V/data-model.md` plus création
    directe en `REQUESTED` par le back-office ;
  - montant et frais modifiables seulement au passage `REQUESTED` → `PROCESSING`, puis figés ;
  - `promote_due_refund_requests` reste permise ;
  - test pgTAP par transition interdite.
- **Chaque levée** : entrée `POINTS_OUVERTS.md` et ADR mises à jour, test de borne inversé, report dans PRD et PROMPTS.

## R-11 — Scellement et copie externe simulée

- **Decision** :
  - Des fonctions `ops_*` SECURITY DEFINER sans `assert_tenant`, avec EXECUTE nominatif à `cashless_maint` seul, sur le
    modèle de `mark_edge_gateways_silent` :
    - `ops_ledgers_to_seal()` ;
    - `ops_seal_ledger(uuid)` ;
    - `ops_audit_chains_to_seal()` ;
    - `ops_seal_audit(uuid)` ;
    - `ops_record_seal_copy(kind, id, seal_no, external_ref)` ;
    - `ops_seals_since(interval)` ;
    - `ops_verify_ledger_seals(uuid, int)`.

    Le rôle n'obtient aucune lecture de table.
  - Port `SealExternalCopy` et faux `FakeSealCopy` (`isFake`, référence préfixée `fake:`, refus en production à la
    fabrique et dans `assertProcessIsSafe`, test). La vérification quotidienne rend l'état « copie simulée », jamais
    « conforme », tant que le faux est en place.
  - Dette : OP + ADR + test, levée en 12b (C-006).
  - Travailleurs `ledger-seal` (5 min), `audit-seal` (5 min) et `seal-verify` (quotidien, 24 h, deux chaînes).
- **Rationale** : `cashless_maint` ne lit aucune table aujourd'hui ; lui donner `SELECT posting` ouvrirait tout le grand
  livre. Des fonctions étroites gardent ce rôle minimal.
- **À faire relire par une personne** : les fonctions `ops_*` et leurs GRANT.

## R-12 — Contrôles permanents et alertes

- **Decision** :
  - **Alerte** (C-010) : fonction `ops_raise_alert(code, detail jsonb)` DEFINER qui écrit une ligne `audit_log`
    (`OPS_ALERT`, plateforme) et un `pg_notify('ops_alert', …)`, plus un journal structuré `ALERT` (`Logger.error` JSON).
    La boucle continue lit `alarm()` après chaque passage et journalise tout code non nul : modification de
    `bootstrap.ts`.
  - **Un travailleur par contrôle**, chacun lisant par une fonction `ops_*` agrégée qui ne rend que les écarts :
    - sommes nulles et droits = argent : 5 min, grands livres `OPEN` et `CLOSING` ;
    - cache et comptes chauds : horaire ;
    - relevés non rapprochés : quotidien ;
    - versements `INITIATED` depuis plus de 48 h : quotidien ;
    - anomalies ouvertes : continu, 5 min, alerte sur une anomalie nouvelle seulement.
  - **Codes d'alarme** : 7 et suivants dans le processus `maintenance` (5 et 6 sont pris).
- **Rationale** : aucun chemin d'alerte n'existe ; décision du porteur (envoi réel en 12b).

## R-13 — Transactions de plus de 60 s

- **Decision** : fonction `ops_long_transactions(p_max interval)` SECURITY DEFINER.
  - Son propriétaire est membre de `pg_read_all_stats`. Elle ne rend que `pid`, `usename`, `application_name`, la
    durée, jamais `query`.
  - EXECUTE à `cashless_maint` seul. Travailleur toutes les 10 s : il signale et lève une alerte.
  - L'arrêt des sessions (`pg_terminate_backend`) n'est pas fait : `transaction_timeout = 60s` du rôle applicatif coupe
    déjà côté base. Le travailleur est un filet de détection.
- **Rationale** : décision du porteur (C-011) ; aucun droit `pg_signal_backend` nouveau.
- **À vérifier au déploiement** : l'appartenance du propriétaire à `pg_read_all_stats` sur l'hébergeur ; sinon la
  fonction rend une liste vide et lève une alerte de configuration.

## R-14 — Relevés et export comptable

- **Decision** :
  - Relevés par une route par partie, `format=json` par défaut ou `text/csv` (paramètre `format`), paginés en JSON :
    - commerçant (`MERCHANT_ADMIN` de ce commerçant, ou back-office) ;
    - organisateur ;
    - prestataire ;
    - plateforme ;
    - festivalier, par une nouvelle route `/me/wallets/{wallet_id}/statement` en CSV, la route JSON existante étant
      inchangée.
  - CSV écrit sans bibliothèque (RFC 4180, UTF-8, protection contre l'injection de formules), dans un utilitaire commun.
  - Table `account_mapping` versionnée (prestataire, entité, `purpose`, type de transaction, compte légal, version,
    validité), écrite par fonction. Routes de lecture et de nouvelle version (`OPERATOR_ADMIN`). L'export signale les
    couples non mappés au lieu de les omettre. Aucun jeu SYSCOHADA livré comme définitif (OP-N3) : un exemple de
    configuration dans `quickstart.md` seulement.
- **Rationale** : décision du porteur (API + CSV) ; ADR-78 (aucune dépendance nouvelle).

## R-15 — Dépendances et chaîne d'approvisionnement

- **Decision** : aucune dépendance nouvelle (DIRECTIVE_051 sans objet) ; CSV, IBAN et copie simulée sans bibliothèque ;
  l'adaptateur S3 réel viendra en 12b avec sa propre vérification (ADR-78).

## R-16 — Numéros

- **Migrations** : `0083` et suivantes. Prochain SQLSTATE libre : `CL055`. Codes d'alarme du processus
  `maintenance` : 7 et suivants.

## Contradictions de sources signalées

1. **Rôle du versement** : SPECIFICATION §3.2 réserve `PAYOUT` à `ORGANIZER_ADMIN`. Le porteur a tranché le 17/11/2026 :
   le rôle dépend du bénéficiaire. SPECIFICATION à amender (ADR).
2. **Réclamations tardives** : le contrat n'écrit que l'annulation de casse et le remboursement. Le porteur a tranché le
   17/11/2026 : `ADJUSTMENT` ajouté.
3. **Figeage du montant** : « figés après `REQUESTED` » (OP-N130) est faux pour le code actuel, qui recalcule à
   l'approbation. Spec amendée : figés après `PROCESSING`.
4. **Destination de la casse** : `breakage_destination` accepte `OPERATOR` dans le schéma (S:28), mais le type TS ne le
   connaît pas (`ledger/types.ts:73`). À traiter dans l'étape `BREAKAGE` (partage 100 % prestataire) ou à refuser
   explicitement : à vérifier contre §12.1 et ADR-67 au lot concerné, et à signaler.
5. **Codes externes de condition** : `CASH_DESKS_COUNTED` est placé sous `SETTLING` alors que FR-002 bloque dès
   `RECONCILING`. `NO_OPEN_CASH_SESSION` le complète ; `CASH_DESKS_COUNTED` reste comme il est.
