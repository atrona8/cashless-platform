# Mission Specification: Recharges, caisses et PSP

**Mission Branch**: `feat/recharges-caisses-psp`
**Created**: 2026-10-27
**Status**: Draft
**Input**: User description: "Encaissement de l'argent réel (SPECIFICATION §8.5, §11.1, §11.2, §5.3, §14.2 S14, S20, S26, S26b, ADR-63, ADR-70, ADR-72, ADR-77). Sessions de caisse (ouverture, comptage, fermeture `CASH_CLOSE` avec écart au payeur du contrat, anomalie `CASH_DIFF`, dépôt `CASH_DEPOSIT`). Recharge en espèces (`TOPUP_CASH`, marge de recharge, découpage vers `L-ESP-A-RENDRE` hors ligne). Prise de caution due après chaque crédit. Configurations PSP par organisateur et par moyen, choix par événement. Interface commune d'adaptateur PSP, faux PSP tant que les accès de test manquent. Demande de recharge, webhook signé stocké brut puis traité de façon idempotente, interrogation planifiée puis `EXPIRED`, anomalies `PSP_MISMATCH` et `PSP_TOPUP_OVER_LIMIT`. Carte : 3-D Secure, plafond par carte et par jour, `CARD_VELOCITY`, contestations. Hérité de la mission 4 : compte de caisse à l'ouverture d'une session (OP-N49, ADR-89), `cash_session_id` servi, prise de caution due après chaque crédit payé."

**Sources normatives** : `docs/SPECIFICATION.md` (§3.2, §4.2, §4.3, §5.2, §5.3, §5.7, §7.9, §8.5, §9.3, §10.3, §10.4, §11.1, §11.2, §12.1, §12.2, §13.2, §14.2 S14, S20, S26, S26b), `docs/DECISIONS_ADR.md` (ADR-12, ADR-27, ADR-53, ADR-63, ADR-70, ADR-71, ADR-72, ADR-74, ADR-77, ADR-82 §3, ADR-89, ADR-113, ADR-116, ADR-124, ADR-125), `docs/POINTS_OUVERTS.md` (OP-N49, OP-N43, OP-N11, OP-N77, action 11), `packages/ledger-sql/schema_grand_livre_cashless.sql` (`post_transaction`, `wallet_topup_headroom`, `take_deposit`, `refund_cash_due`, `anomaly`, `fee_rule`, `contract`, `external_statement_line`), `packages/contracts/openapi.yaml` (`createCashTopup`, `initiatePspTopup`, `getPspTopup`, `openCashSession`, `countCashSession`, `closeCashSession`, `receivePspWebhook`, `takeDeposit`, `refundCashDue`, `releaseMedia`). En cas de contradiction, la règle de priorité de SPECIFICATION §0.3 s'applique et la contradiction est signalée (section « Contradictions de sources »).

**Dépend de** : missions `fondations-grand-livre-01M4AY8M` (moteur d'écritures, constructeurs `TOPUP`, `TOPUP_CASH`, `CASH_CLOSE`, `CASH_DEPOSIT`, `CHARGEBACK`), `identite-roles-double-validation-01M4DNDN` (rôles, demandes d'approbation, jeton sur place), `configuration-parties-evenements-01M4GCJ9` (événements, contrats, détenteur des fonds, réglages, règles de frais), `bracelets-nfc-01M4TD3W` (caution, espèces dues, guichet des bracelets, OP-N49), `identite-enrolement-terminaux-01M52R6H` (identité du terminal, mode `TOPUP_DESK`) et `terminaux-paiement-en-ligne-01M52QB9` (port d'identité du festivalier refusé en production, idempotence par terminal et par personne).

## Contexte

Jusqu'ici, la plateforme sait dépenser un solde mais pas le constituer avec de l'argent réel. Les recharges se faisaient par des écritures de test. Cette mission fait entrer l'argent : en espèces au guichet, sous le contrôle d'une session de caisse, et en ligne par mobile money (Wave, Orange Money) ou par carte, via le prestataire de paiement (PSP) que l'organisateur a configuré. Elle lève aussi OP-N49, hérité de la mission 4 : sans compte de caisse, la caution en espèces et le rendu des espèces dues répondent aujourd'hui `409` en usage réel.

L'argent réel apporte trois exigences qui structurent la mission :
- **aucune espèce sans caisse contrôlée** : toute espèce qui entre ou sort passe par une session de caisse ouverte, et la fermeture compare le compté au théorique ;
- **aucun crédit sans preuve du PSP** : une recharge en ligne n'est créditée qu'à la réception d'une notification authentifiée du PSP (ou d'une interrogation de son statut), une seule fois, et jamais au-delà d'un plafond réglementaire ;
- **aucun faux en production** : le PSP et le coffre à secrets sont derrière des ports ; leurs faux font refuser le démarrage en configuration de production.

Le rapprochement des relevés et les versements (`PSP_SETTLEMENT`) relèvent de la mission 9 ; l'identification au guichet, de la mission 10 (tous les portefeuilles restent au niveau non identifié pendant cette mission) ; la recharge espèces hors ligne et la passerelle, des missions 7 et 8.

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Caisse | Compte d'argent liquide d'un poste de guichet (`A-CAISSE-<n° de série du terminal>`, `CASH_DESK`) | « tiroir », « fond » |
| Session de caisse | Période d'exploitation d'une caisse par un agent : ouverture, mouvements, comptages, fermeture | « shift » |
| Théorique | Solde du compte de caisse calculé par le grand livre à la fermeture | « attendu » (en dehors des messages) |
| Compté | Montant compté physiquement à la fermeture, saisi à l'aveugle | « déclaré » |
| Écart | Compté − théorique ; manque si négatif, surplus si positif | |
| Moyen | Ce que choisit le festivalier : `WAVE`, `ORANGE_MONEY`, `CARD` | « canal » dans les textes au festivalier |
| Fournisseur | Adaptateur technique : `WAVE`, `ORANGE_MONEY`, `PAYDUNYA`, `STRIPE` | « provider » dans les textes |
| Configuration PSP | Paramétrage d'un fournisseur pour un organisateur et un moyen, au nom d'un titulaire | « compte PSP » (réservé au compte comptable `A-PSP-*`) |
| Recharge PSP | Demande de recharge en ligne, suivie jusqu'à `SUCCEEDED`, `FAILED`, `EXPIRED` ou `CANCELLED` | « paiement » |
| Notification PSP | Message entrant du PSP (webhook), conservé brut s'il est authentifié | « callback » |
| Contestation | Rejet a posteriori d'un paiement carte par le porteur de la carte (`CHARGEBACK`) | « litige » |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - L'agent du guichet ouvre, compte et fait fermer sa caisse (Priority: P1)

Un agent `CASHIER`, connecté sur un terminal en mode `TOPUP_DESK` de l'événement, ouvre une session de caisse. Le compte de caisse du terminal est créé s'il n'existe pas encore. Pendant la session, toutes les espèces reçues ou rendues sur ce terminal sont rattachées à la session. En fin de service, l'agent compte sa caisse à l'aveugle (le théorique ne lui est pas montré), puis un `SUPERVISOR`, autre personne que l'agent qui a compté, ferme la session : le compté passe en transit, l'écart va au payeur fixé par le contrat, et un écart non nul ouvre une anomalie `CASH_DIFF`.

**Why this priority**: lève OP-N49 (bloque la production) ; sans session, aucune espèce ne peut entrer ni sortir.

**Independent Test**: ouvrir une session, enregistrer des mouvements d'espèces, compter avec un manque puis fermer ; vérifier l'écriture `CASH_CLOSE`, le payeur de l'écart et l'anomalie `CASH_DIFF`.

**Acceptance Scenarios**:

1. **Given** un terminal `TOPUP_DESK` actif et un agent `CASHIER` de l'événement, **When** l'agent ouvre une session, **Then** la session est `OPEN`, le compte `A-CAISSE-<série>` existe (créé si besoin), et aucune écriture comptable n'est passée.
2. **Given** une session déjà ouverte sur ce terminal, **When** un agent tente d'en ouvrir une seconde, **Then** la demande est refusée (`409 CONFLICT_STATE`).
3. **Given** une session ouverte avec 30 000 XOF de recharges espèces, **When** l'agent compte 29 000 puis un `SUPERVISOR` ferme la session, **Then** `CASH_CLOSE` débite `A-TRANSIT` de 29 000 et le compte de pertes du payeur `cash_diff_bearer` de 1 000, crédite la caisse de 30 000, ouvre `CASH_DIFF` de 1 000, et la session est `CLOSED`.
4. **Given** un comptage supérieur au théorique, **When** la session est fermée, **Then** le surplus s'écrit en sens inverse et ouvre `CASH_DIFF`.
5. **Given** une session sans comptage, **When** un `SUPERVISOR` tente de la fermer, **Then** la fermeture est refusée (`409`).
6. **Given** un `SUPERVISOR` qui a lui-même fait le dernier comptage, **When** il tente de fermer la session, **Then** la fermeture est refusée (`403`).
7. **Given** un agent qui compte sa caisse, **When** il consulte la session avant la fermeture, **Then** le théorique ne lui est pas renvoyé.

---

### User Story 2 - L'agent recharge un bracelet en espèces (Priority: P1)

Le festivalier remet des espèces au guichet. L'agent lit le bracelet et saisit le montant ; le portefeuille payé est crédité (`TOPUP_CASH`), l'espèce entre dans la caisse de la session ouverte. Si la caution du bracelet est due, elle est prélevée juste après, dans une transaction distincte.

**Why this priority**: premier moyen d'entrée d'argent, utilisable dès le premier événement réel.

**Independent Test**: recharger un bracelet dont la caution est `DUE` ; vérifier `TOPUP_CASH` sur la caisse de la session, puis `DEPOSIT_TAKEN` dans une seconde transaction.

**Acceptance Scenarios**:

1. **Given** une session ouverte sur le terminal, **When** l'agent recharge 5 000 XOF, **Then** `TOPUP_CASH` débite la caisse de la session et crédite le portefeuille payé, rattaché à la session.
2. **Given** aucune session ouverte sur le terminal, **When** l'agent tente une recharge espèces, **Then** la recharge est refusée (`409 CONFLICT_STATE`) et rien n'est écrit.
3. **Given** une session ouverte d'un autre terminal citée dans la requête, **When** l'agent recharge, **Then** la recharge est refusée (`409`).
4. **Given** une recharge en ligne qui ferait dépasser le plafond de solde ou le plafond mensuel, **When** l'agent recharge, **Then** la recharge est refusée (`422 WALLET_LIMIT_EXCEEDED` ou `MONTHLY_TOPUP_LIMIT_EXCEEDED`) et rien n'est écrit.
5. **Given** un bracelet dont la caution est `DUE` en mode prélevé sur le solde, **When** la recharge réussit, **Then** la caution est prise dans une transaction distincte ; si elle échoue, la recharge reste acquise et la caution reste `DUE`.
6. **Given** la même requête rejouée avec la même clé, **When** elle arrive une seconde fois, **Then** la réponse d'origine est rendue et rien n'est écrit deux fois.

---

### User Story 3 - Les espèces de caution et d'espèces dues passent par la caisse (Priority: P1)

Une caution payée en espèces, sa restitution, le rendu des espèces dues et le rendu d'espèces à la libération d'un bracelet passent par la session de caisse ouverte du terminal (héritage de la mission 4).

**Why this priority**: lève le `409` d'OP-N49 sur les routes livrées par la mission 4.

**Independent Test**: prendre une caution en espèces, rendre des espèces dues, sur un terminal avec et sans session ouverte.

**Acceptance Scenarios**:

1. **Given** une session ouverte, **When** l'agent prend une caution en espèces, **Then** l'espèce entre dans la caisse de la session.
2. **Given** une session ouverte, **When** l'agent rend des espèces dues, **Then** `refund_cash_due` débite `L-ESP-A-RENDRE` sur la caisse de la session, et `cash_session_id` est servi dans la réponse.
3. **Given** aucune session ouverte, **When** l'agent tente une de ces opérations en espèces, **Then** elle est refusée (`409`), comme aujourd'hui.

---

### User Story 4 - Le prestataire configure les PSP d'un organisateur, l'organisateur choisit pour son événement (Priority: P1)

Un `OPERATOR_ADMIN` crée pour un organisateur une configuration PSP (moyen, fournisseur, titulaire = détenteur des fonds, référence des secrets) ; une seconde personne l'active. L'organisateur peut en avoir plusieurs par moyen, dont au plus une par défaut. Un `ORGANIZER_ADMIN` choisit, pour son événement, la configuration à utiliser par moyen ; le titulaire doit être le détenteur des fonds de l'événement.

**Why this priority**: sans configuration valide, aucune recharge en ligne n'est possible.

**Independent Test**: créer et activer une configuration, la choisir pour un événement dont le détenteur des fonds est différent du titulaire, constater le refus.

**Acceptance Scenarios**:

1. **Given** une configuration `DRAFT`, **When** son auteur tente de l'activer seul, **Then** l'activation est refusée ; **When** une seconde personne approuve, **Then** elle devient `ACTIVE`.
2. **Given** une configuration par défaut existante pour ce moyen, **When** une seconde est marquée par défaut, **Then** la base refuse.
3. **Given** une configuration dont le titulaire n'est pas le détenteur des fonds de l'événement, **When** l'organisateur la choisit, **Then** la base refuse.
4. **Given** un événement `LIVE`, **When** l'organisateur change sa configuration, **Then** une seconde personne doit approuver, et le changement ne vaut que pour les recharges suivantes.
5. **Given** aucun choix et une configuration par défaut d'un autre titulaire, **When** une recharge est demandée, **Then** elle est refusée (`409 PSP_NOT_CONFIGURED`).
6. **Given** un organisateur A, **When** une personne de l'organisateur B lit ou modifie ses configurations, **Then** elle ne les voit pas.

---

### User Story 5 - Le festivalier ou l'agent recharge en ligne par mobile money ou carte (Priority: P1)

Une recharge PSP est d'abord une demande : la plateforme enregistre la recharge `PENDING` avec la configuration retenue et renvoie au payeur l'action à mener chez le PSP. Le portefeuille n'est crédité qu'à la réception de la notification authentifiée du PSP, une seule fois, avec les frais PSP au payeur configuré. La caution due est prise ensuite, dans une transaction distincte.

**Why this priority**: deuxième moyen d'entrée d'argent ; cœur de la mission.

**Independent Test**: avec le faux PSP, demander une recharge, envoyer la notification de succès deux fois, vérifier un seul `TOPUP` avec ses frais.

**Acceptance Scenarios**:

1. **Given** une configuration valide, **When** une recharge de 10 000 XOF est demandée, **Then** une recharge `PENDING` est enregistrée avec sa configuration, et rien n'est écrit au grand livre.
2. **Given** une notification de succès authentifiée et conforme, **When** elle est reçue, **Then** elle est conservée brute, `TOPUP` débite `A-PSP-<moyen>` et crédite le portefeuille, la ligne de frais va au payeur `psp_fee_bearer`, la recharge passe `SUCCEEDED`.
3. **Given** la même notification reçue deux fois, ou deux notifications du même paiement, **When** elles sont traitées, **Then** un seul `TOPUP` existe.
4. **Given** une notification dont la configuration, le montant ou la devise diffère de la recharge, **When** elle est reçue, **Then** rien n'est écrit au grand livre et une anomalie `PSP_MISMATCH` est ouverte.
5. **Given** une notification qui ferait dépasser un plafond réglementaire, **When** elle est reçue, **Then** le portefeuille n'est pas crédité, la recharge passe `FAILED` et une anomalie `PSP_TOPUP_OVER_LIMIT` porte le montant à rendre au payeur.
6. **Given** une recharge sans notification, **When** la tâche planifiée interroge le PSP, **Then** un succès découvert s'écrit avec la même clé qu'une notification ; au-delà du délai du PSP, la recharge passe `EXPIRED`.
7. **Given** un festivalier (route festivalier), **When** la plateforme démarre en configuration de production avec l'identité festivalier encore en faux, **Then** le démarrage est refusé (comme pour la mission 5b).

---

### User Story 6 - La plateforme refuse les notifications non authentifiées sans les ignorer (Priority: P1)

Toute notification entrante est vérifiée avant tout traitement. Une notification dont la signature est invalide, l'horodatage hors tolérance ou la configuration inconnue n'écrit rien au grand livre ni dans le registre des notifications brutes, mais elle est signalée (journal de sécurité et alerte d'exploitation à débit borné).

**Why this priority**: la notification est la seule preuve d'un crédit ; la falsifier, c'est créer de l'argent.

**Independent Test**: envoyer une notification à signature fausse, une à horodatage ancien, une à configuration inconnue ; vérifier qu'aucune écriture n'existe et qu'un signalement l'est.

**Acceptance Scenarios**:

1. **Given** une signature invalide, **When** la notification est reçue, **Then** réponse `401 WEBHOOK_SIGNATURE_INVALID`, aucune écriture, un signalement de sécurité.
2. **Given** un horodatage hors de la tolérance de 300 s, **When** la notification est reçue, **Then** réponse `401 WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE`, aucune écriture, un signalement.
3. **Given** une configuration inconnue, inactive ou d'un autre fournisseur, **When** la notification est reçue, **Then** réponse `404` neutre, aucune écriture, un signalement.
4. **Given** une rotation de secret en cours, **When** une notification signée avec l'ancien ou le nouveau secret arrive, **Then** elle est acceptée.
5. **Given** un corps au-delà de la taille maximale, **When** il est reçu, **Then** il est refusé avant toute vérification coûteuse.

---

### User Story 7 - La carte est protégée : 3-D Secure, plafonds, contestations (Priority: P2)

Une recharge carte n'est créditée que si le PSP atteste un 3-D Secure réussi. Une même carte ne recharge pas plus que le plafond journalier de l'événement. Dès que trop de cartes différentes rechargent un même portefeuille, une anomalie `CARD_VELOCITY` est ouverte. Une contestation débite le portefeuille jusqu'à son solde payé, le bloque si le solde ne suffit pas, et porte le reste au compte de pertes du payeur du contrat.

**Why this priority**: indispensable dès qu'un organisateur active la carte (ADR-70), mais la carte n'est pas le premier moyen au lancement.

**Independent Test**: avec le faux PSP, envoyer une notification de succès sans attestation 3-D Secure, une sixième recharge d'une même carte au-delà du plafond, puis une contestation supérieure au solde.

**Acceptance Scenarios**:

1. **Given** une notification carte sans attestation 3-D Secure réussie, **When** elle est reçue, **Then** le portefeuille n'est pas crédité, la recharge passe `FAILED`, et une anomalie porte le montant à rendre.
2. **Given** une carte qui a déjà rechargé `card_topup_daily_max_per_card` ce jour, **When** une nouvelle recharge de cette carte est notifiée, **Then** elle n'est pas créditée (`CARD_DAILY_LIMIT`), recharge `FAILED`, anomalie avec le montant à rendre.
3. **Given** un portefeuille rechargé par `card_alert_cards_per_wallet` cartes différentes, **When** une nouvelle carte le recharge, **Then** une anomalie `CARD_VELOCITY` est ouverte (la recharge reste créditée si elle est conforme).
4. **Given** une contestation de 8 000 XOF sur un portefeuille de solde payé 5 000, **When** elle est reçue, **Then** `CHARGEBACK` débite 5 000 du portefeuille et 3 000 du compte de pertes du payeur `chargeback_bearer`, crédite `A-PSP-CARTE` de 8 000, et le portefeuille est bloqué.
5. **Given** une contestation reçue deux fois, ou supérieure au montant restant de la recharge d'origine, **When** elle est traitée, **Then** elle n'est écrite qu'une fois et jamais au-delà de ce montant.
6. **Given** une contestation reçue après le verrouillage du grand livre, **When** elle arrive, **Then** une anomalie `LATE_CHARGEBACK` et une demande d'approbation sont créées ; l'écriture n'est passée qu'après approbation, dans les bornes de `check_late_claim`.

---

### User Story 8 - Les espèces de la caisse sont déposées en banque (Priority: P3)

Après fermeture des sessions, les espèces en transit sont déposées en banque : une personne du back-office saisit le dépôt, une seconde l'approuve, et `CASH_DEPOSIT` débite `A-BANQUE` et crédite `A-TRANSIT`.

**Why this priority**: nécessaire avant la clôture (mission 9), pas pendant l'événement.

**Independent Test**: déposer un montant supérieur au transit (refus), puis un montant conforme approuvé par une seconde personne.

**Acceptance Scenarios**:

1. **Given** 29 000 XOF en transit, **When** un dépôt de 29 000 est saisi puis approuvé par une autre personne, **Then** `CASH_DEPOSIT` est écrit (source back-office, auteur et valideur).
2. **Given** un dépôt supérieur au transit, **When** il est approuvé, **Then** la base le refuse et rien n'est écrit.

### Edge Cases

- Notification de succès reçue alors que le grand livre n'accepte plus de `TOPUP` (après `CLOSING`) : rien n'est crédité, la recharge passe `FAILED`, une anomalie porte le montant à rendre au payeur.
- Notification arrivée avant la fin de la transaction de création de la recharge : traitée ou rejouée sans double écriture.
- Contestation sans recharge d'origine connue : aucune écriture, anomalie à traiter par le back-office.
- Session de caisse ouverte quand le terminal est suspendu ou révoqué : plus aucun mouvement d'espèces possible ; la session reste fermable par un `SUPERVISOR`.
- Fermeture d'une caisse au théorique nul (aucun mouvement) : écriture d'écart seulement si le compté est non nul ; sinon session fermée sans écriture.
- Changement de configuration PSP d'un événement pendant qu'une recharge est en attente : la recharge garde sa configuration d'origine.
- Portefeuille bloqué par une contestation : toute dépense est refusée (`WALLET_BLOCKED`) ; le déblocage relève d'une action à deux personnes.
- Grand livre en mode `EDGE` : la recharge espèces au central reste un crédit accepté ; la caution due en mode prélevé reste `DUE` (`DEBIT_AUTHORITY_EDGE`).

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status |
|----|-------|------------|----------|--------|
| FR-001 | Ouverture de session de caisse | En tant que `CASHIER` ou `SUPERVISOR` sur un terminal `TOPUP_DESK` actif de l'événement, je veux ouvrir une session de caisse, le compte `A-CAISSE-<série du terminal>` étant créé s'il n'existe pas, une seule session ouverte par caisse, sans écriture comptable. | High | Open |
| FR-002 | Comptage à l'aveugle | En tant qu'agent, je veux enregistrer un ou plusieurs comptages de ma caisse sans que le théorique me soit montré ; la fermeture retient le dernier comptage. | High | Open |
| FR-003 | Fermeture et écart | En tant que `SUPERVISOR`, autre personne que l'auteur du dernier comptage, je veux fermer une session comptée : `CASH_CLOSE` met le compté en transit, l'écart au payeur `cash_diff_bearer`, ouvre `CASH_DIFF` si l'écart est non nul, et la session devient `CLOSED`. | High | Open |
| FR-004 | Espèces rattachées à une session | En tant que plateforme, je veux que toute écriture d'espèces (recharge, caution, restitution de caution, rendu des espèces dues, rendu à la libération) exige une session `OPEN` du terminal, du même grand livre, et y soit rattachée ; sinon refus `409`. | High | Open |
| FR-005 | Recharge en espèces en ligne | En tant que `CASHIER`, je veux recharger un portefeuille en espèces (`TOPUP_CASH`, source en ligne) ; au-delà d'un plafond de solde ou mensuel, la recharge est refusée et rien n'est écrit. | High | Open |
| FR-006 | Découpage hors ligne | En tant que plateforme, je veux que le découpage vers `L-ESP-A-RENDRE` ne s'applique qu'aux recharges espèces synchronisées hors ligne ou par la passerelle, et ouvre dans la même transaction l'anomalie `CASH_TOPUP_OVER_LIMIT` portant le bracelet et le montant. | High | Open |
| FR-007 | Caution due après chaque crédit payé | En tant que plateforme, je veux prendre la caution `DUE` d'un bracelet après chaque crédit payé (`TOPUP_CASH`, `TOPUP`), dans une transaction distincte, sans annuler le crédit si elle échoue. | High | Open |
| FR-008 | Session servie aux routes du guichet | En tant qu'agent, je veux que `cash_session_id` soit accepté et renvoyé par les routes de caution, d'espèces dues et de libération, et que la caisse soit celle de la session. | High | Open |
| FR-009 | Configuration PSP | En tant qu'`OPERATOR_ADMIN`, je veux créer pour un organisateur une configuration par moyen et par fournisseur, au nom du détenteur des fonds, avec une référence de secrets (jamais le secret lui-même), versionnée, et l'activer avec une seconde personne (`PSP_CONFIGURATION`). | High | Open |
| FR-010 | Configuration par défaut unique | En tant que plateforme, je veux au plus une configuration par défaut par organisateur et par moyen, garantie par la base. | High | Open |
| FR-011 | Choix par événement | En tant qu'`ORGANIZER_ADMIN`, je veux choisir par moyen la configuration de mon événement ; la base refuse une configuration d'un autre organisateur, non `ACTIVE`, ou dont le titulaire n'est pas le détenteur des fonds ; pendant `LIVE`, le changement exige une seconde personne (`EVENT_PSP_SELECTION`) et ne vaut que pour les recharges suivantes. | High | Open |
| FR-012 | Demande de recharge PSP | En tant que festivalier (app) ou agent (terminal `TOPUP_DESK`), je veux demander une recharge par moyen ; la plateforme résout la configuration (choix de l'événement, sinon défaut contrôlé, sinon `409 PSP_NOT_CONFIGURED`), enregistre la recharge `PENDING` avec sa configuration et son échéance, et renvoie l'action de paiement ; rien n'est écrit au grand livre. | High | Open |
| FR-013 | Consultation d'une recharge | En tant que demandeur, je veux consulter l'état de ma recharge (`PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED`) ; une autre personne ou un autre organisateur ne la voit pas. | Medium | Open |
| FR-014 | Réception authentifiée des notifications | En tant que plateforme, je veux vérifier chaque notification (signature à temps constant, horodatage à 300 s, deux secrets en rotation, taille bornée) avant tout traitement, conserver brute toute notification authentifiée, puis la traiter de façon idempotente. | High | Open |
| FR-015 | Notifications refusées signalées | En tant qu'exploitant, je veux que toute notification refusée (signature, horodatage, configuration inconnue) n'écrive rien au grand livre ni au registre brut, mais produise un signalement de sécurité et une alerte d'exploitation à débit borné. | High | Open |
| FR-016 | Crédit `TOPUP` | En tant que plateforme, je veux écrire `TOPUP` (source `PSP_WEBHOOK`) à la notification de succès conforme, avec la ligne de frais au payeur `psp_fee_bearer`, une seule fois par paiement (clés de `openapi.yaml`), puis passer la recharge à `SUCCEEDED`. | High | Open |
| FR-017 | Notification non conforme | En tant que plateforme, je veux qu'une notification dont la configuration, le montant ou la devise diffère de la recharge n'écrive rien au grand livre et ouvre `PSP_MISMATCH`. | High | Open |
| FR-018 | Recharge refusée après paiement | En tant que plateforme, je veux qu'un paiement réussi chez le PSP mais non créditable (plafond réglementaire, 3-D Secure absent, plafond carte du jour, grand livre qui n'accepte plus de `TOPUP`) ne crédite rien, passe la recharge à `FAILED` et ouvre une anomalie portant le montant à rendre au payeur. | High | Open |
| FR-019 | Interrogation planifiée et expiration | En tant que plateforme, je veux une tâche planifiée qui interroge le PSP pour les recharges `PENDING`, écrit un succès découvert avec la même clé qu'une notification, et passe à `EXPIRED` au-delà de l'échéance ; tout échec de la tâche alerte l'exploitation. | High | Open |
| FR-020 | Interface commune d'adaptateur | En tant que plateforme, je veux une interface commune (initier, vérifier une notification, interroger un statut, lire un relevé) avec un faux PSP par fournisseur, refusé au démarrage en production. | High | Open |
| FR-021 | Adaptateurs PSP réels | Reportés (décision du porteur du 27/10/2026) : les adaptateurs Wave, Orange Money, PayDunya et Stripe viennent dans une mission dédiée dès les accès de test obtenus (action 11). Cette mission livre l'interface commune et un faux par fournisseur, refusé au démarrage en production ; dette nommée (point ouvert, ADR, test de borne, reports). | High | Deferred (mission des adaptateurs PSP réels) |
| FR-022 | Coffre des secrets PSP | En tant que prestataire, je veux que les secrets PSP et de notification soient lus dans un coffre rattaché au détenteur des fonds, jamais en base, en variable d'environnement ni dans un journal, derrière un port avec un faux refusé en production. L'adaptateur AWS Secrets Manager est reporté avec les adaptateurs PSP réels (décision du porteur du 27/10/2026). | High | Open |
| FR-023 | Frais PSP par configuration | En tant que prestataire, je veux que les taux de chaque PSP soient des règles de frais rattachées à la configuration, appliquées à la recharge selon sa configuration. | Medium | Open |
| FR-024 | 3-D Secure obligatoire | En tant que plateforme, je veux ne créditer une recharge carte que sur attestation explicite d'un 3-D Secure réussi fournie par l'adaptateur. | High | Open |
| FR-025 | Plafond par carte et par jour | En tant que plateforme, je veux refuser le crédit d'une carte au-delà de `card_topup_daily_max_per_card` sur le jour (empreinte de carte fournie par le PSP). | High | Open |
| FR-026 | Vélocité des cartes | En tant qu'organisateur, je veux une anomalie `CARD_VELOCITY` dès que `card_alert_cards_per_wallet` cartes différentes ont rechargé un même portefeuille. | Medium | Open |
| FR-027 | Contestations | En tant que plateforme, je veux écrire `CHARGEBACK` rattaché à la recharge d'origine (débit du solde payé, puis du compte de pertes du payeur `chargeback_bearer`, crédit `A-PSP-<moyen>`), une seule fois par contestation, jamais au-delà du montant restant de la recharge, et bloquer le portefeuille si le solde payé ne suffit pas ; après verrouillage, `LATE_CHARGEBACK` et approbation. | High | Open |
| FR-028 | Déblocage d'un portefeuille | En tant qu'`ORGANIZER_ADMIN`, je veux débloquer un portefeuille bloqué par une contestation, avec une seconde personne. | Medium | Open |
| FR-029 | Dépôt en banque | En tant que personne du back-office, je veux saisir un dépôt en banque des espèces en transit, approuvé par une seconde personne, écrit en `CASH_DEPOSIT`, jamais au-delà du transit. | Medium | Open |
| FR-030 | Contrat et types | En tant que développeur des apps, je veux que le contrat d'API couvre les nouvelles opérations (configurations, choix par événement, sessions de caisse, dépôt, déblocage, actions d'approbation) et que les types TypeScript et Dart soient régénérés. | High | Open |
| FR-031 | Audit | En tant qu'auditeur, je veux une trace de chaque action sur les sessions, configurations, choix d'événement, recharges, notifications refusées, contestations, déblocages et dépôts (auteur, terminal, date). | Medium | Open |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Aucun double crédit | 0 double écriture sur 100 rejeux concurrents d'une même notification ou d'un même succès découvert par interrogation. | Reliability | High | Open |
| NFR-002 | Aucun crédit non authentifié | 0 écriture et 0 ligne au registre brut pour 100 % des notifications à signature invalide, horodatage hors tolérance ou configuration inconnue ; chaque refus produit un signalement. | Security | High | Open |
| NFR-003 | Secrets jamais exposés | 0 secret PSP ou de notification en clair dans la base, les journaux, les réponses ou les variables d'environnement de l'API, vérifié par un balayage avec canari. | Security | High | Open |
| NFR-004 | Aucun faux en production | Le démarrage en configuration de production est refusé pour 100 % des faux (chaque faux PSP, faux coffre, identité festivalier), prouvé par test. | Security | High | Open |
| NFR-005 | Cloisonnement | 0 lecture ou écriture d'une configuration, d'une recharge, d'une session ou d'une notification d'un autre prestataire ou organisateur, sur toutes les nouvelles opérations. | Security | High | Open |
| NFR-006 | Réponse aux notifications | Accusé de réception d'une notification authentifiée en 500 ms au plus pour 95 % des notifications, mesuré côté serveur (les PSP réessaient sur délai dépassé). | Performance | Medium | Open |
| NFR-007 | Contrôle de caisse | 100 % des sessions fermées ont une écriture `CASH_CLOSE` égale au théorique, et 100 % des écarts non nuls une anomalie `CASH_DIFF`. | Reliability | High | Open |
| NFR-008 | Tout ou rien | 0 écriture partielle sur 100 % des refus (recharge, fermeture, contestation, dépôt) : aucune écriture du grand livre ni changement d'état sans l'autre. | Reliability | High | Open |
| NFR-009 | Latence de la recharge espèces | Recharge espèces acceptée en 200 ms au plus pour 95 % des recharges, mesuré côté serveur. | Performance | Medium | Open |
| NFR-010 | Non-régression | 100 % des tests existants (pgTAP, Jest) restent verts. | Reliability | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Priorité des sources | SPECIFICATION §0.3 ; toute contradiction est signalée, jamais tranchée en silence. | Regulatory | High | Open |
| C-002 | Fichiers générés | Les `.sql` générés de `packages/ledger-sql/` ne se modifient pas à la main : migrations, générateurs ou `scenario_reference.json`. | Technical | High | Open |
| C-003 | Pile | `docs/08-pile-logicielle.md` (ADR-78) ; toute nouvelle dépendance vérifiée et épinglée. | Technical | High | Open |
| C-004 | Écritures par la base | Les écritures du grand livre et les changements d'état contrôlés passent par des fonctions de la base ; `cashless_app` n'a pas d'écriture directe sur les tables de contrôle (sessions, configurations, choix d'événement, registre des notifications, recharges). | Technical | High | Open |
| C-005 | Secrets | Aucun nouveau secret dans `loadConfig` sans ADR (ADR-125). | Technical | High | Open |
| C-006 | Faux | Aucun faux en production (règle 2 de CLAUDE.md), démarrage refusé et test. | Regulatory | High | Open |
| C-007 | Dette nommée | Tout écart accepté qui affaiblit la sécurité : point ouvert, ADR, test de borne, reports PROMPTS/PRD (règle 3 de CLAUDE.md). | Regulatory | High | Open |
| C-008 | Hors périmètre | Rapprochement des relevés, `PSP_SETTLEMENT` et versements (mission 9) ; identification au guichet (mission 10) ; recharge espèces hors ligne et passerelle (missions 7 et 8) ; écrans (missions 11 et 12) ; caution payée par mobile money ou carte (voir Assumptions). | Business | High | Open |
| C-009 | Idempotence | Clés de `openapi.yaml` : réception `psp:<config>:<id de la notification>`, écriture `wave:<paiement>`, `om:<paiement>`, `psp:<config>:<paiement>` (carte) ; contestation `psp:<config>:<id de la contestation>`. | Technical | High | Open |
| C-010 | Toujours en ligne | Recharge PSP, caution et restitution jamais hors ligne (SPECIFICATION §9.3). | Business | High | Open |

### Key Entities

- **Session de caisse** : caisse (compte `A-CAISSE-*`), terminal, agent d'ouverture, ouverture, comptages (montant, auteur, date), fermeture (auteur), compté, théorique, transaction `CASH_CLOSE`, anomalie `CASH_DIFF`, statut `OPEN`/`CLOSED`.
- **Configuration PSP** : organisateur, moyen, fournisseur, titulaire (détenteur des fonds), référence des secrets, statut `DRAFT`/`ACTIVE`/`SUSPENDED`, validité, par défaut, version, auteur, valideur.
- **Choix PSP d'un événement** : événement, moyen, configuration retenue, auteur, valideur pendant `LIVE`.
- **Recharge PSP** : portefeuille, configuration utilisée, moyen, montant, devise, frais, statut, référence de paiement du PSP, échéance, transaction `TOPUP`, motif d'échec, empreinte de carte et attestation 3-D Secure pour la carte.
- **Notification PSP** : configuration, identifiant de notification, corps brut, date de réception, signature valide, traitée, résultat.
- **Contestation** : recharge d'origine, identifiant de contestation du PSP, montant, transaction `CHARGEBACK`, portefeuille bloqué.
- **Dépôt en banque** : montant, auteur, valideur, transaction `CASH_DEPOSIT`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : un parcours complet (configuration activée à deux, choix d'événement, session de caisse, recharge espèces, recharge mobile money et carte par le faux PSP, notification, caution due prise, contestation, fermeture de caisse, dépôt) se déroule par l'API, sans intervention en base.
- **SC-002** : OP-N49 est levé : caution en espèces et rendu des espèces dues réussissent sur un terminal à session ouverte, et sont refusés sans session ; test nommé.
- **SC-003** : aucune recharge n'est créditée deux fois, ni sans notification authentifiée ou statut confirmé par le PSP, sur l'ensemble des tests de concurrence et de rejeu.
- **SC-004** : aucun portefeuille ne dépasse un plafond réglementaire par une recharge en ligne ; tout paiement non créditable a une anomalie portant son montant.
- **SC-005** : chaque session fermée a son écriture de fermeture et, si l'écart est non nul, son anomalie ; le théorique n'est jamais montré à l'agent avant la fermeture.
- **SC-006** : aucun secret PSP ou de notification n'apparaît dans la base, les journaux ou les réponses (balayage avec canari).
- **SC-007** : aucune fuite entre prestataires ou organisateurs sur les nouvelles opérations (balayage d'isolation).
- **SC-008** : le démarrage en configuration de production est refusé pour chaque faux de la mission (faux PSP par fournisseur, faux coffre, identité festivalier) ; les recharges en ligne ne sont donc pas servies en production avant la mission des adaptateurs réels.

## Assumptions

- **Compte de caisse par terminal** (ADR-89, `counter-access.ts`) : `A-CAISSE-<série>`, créé par une fonction de la base à la première ouverture de session ; le `cash_account_id` du contrat devient facultatif et, s'il est fourni, doit être celui du terminal.
- **Sessions tenues sur le terminal** : ouverture et comptage exigent l'identité du terminal et le jeton de la personne (comme les autres routes du guichet, ADR-113) ; la fermeture se fait par un `SUPERVISOR` (back-office ou terminal). Renforcement par rapport au contrat (jeton de personne seul) : consigné en ADR au plan.
- **Théorique** = solde du compte de caisse à la fermeture ; la fermeture le ramène à zéro.
- **Recharge espèces en ligne au-delà d'un plafond : refus** (SPECIFICATION §5.3, §5.7) ; le moteur actuel découpe pour toute source : corrigé.
- **Paiement réussi mais non créditable** : une anomalie porte le montant ; le remboursement effectif au payeur se fait hors de la plateforme (tableau de bord du PSP) et se clôt par une résolution d'anomalie à deux personnes ; un canal de remboursement intégré est reporté (point ouvert au plan).
- **Notification tardive** (grand livre au-delà de `CLOSING`) : traitée comme un paiement non créditable ; le type d'anomalie (nouveau type ou `PSP_MISMATCH` avec motif) est arrêté au plan.
- **`occurred_at` d'un `TOPUP`** = date de réception par la plateforme (jamais une date fournie par le PSP pour les plafonds mensuels).
- **Compte `A-PSP-*` négatif permis** (ADR-77) malgré SPECIFICATION §5.2 : contradiction signalée.
- **Caution payée par mobile money ou carte** : hors périmètre (la restitution exigerait un remboursement PSP, absent en V1) ; PRD l.74 à mettre à jour.
- **Identité festivalier** : routes festivalier derrière le port de la mission 5b, faux refusé en production (OP-N43) ; en production avant la mission 10, seule la recharge au guichet est servie.
- **Niveau d'identification** : tous les portefeuilles restent non identifiés (mission 10) ; les plafonds appliqués sont ceux du niveau calculé par la base.
- **Interrogation planifiée** : processus planifié sur le modèle `ProcessWorker` existant ; fréquence et échéance par fournisseur fixées au plan.
- **Lecture d'un relevé** : seule la signature de l'interface et le faux sont livrés ; import et rapprochement en mission 9.

## Contradictions de sources

1. Notification invalide : SPECIFICATION §11.1 « conservée et signalée, jamais ignorée » ; `openapi.yaml` « rien n'est écrit ». Appliqué : rien au grand livre ni au registre brut (contrat), signalement de sécurité et alerte (spécification) ; pas de stockage du corps d'un appelant non authentifié.
2. Clé d'idempotence : SPECIFICATION §8.5 et PROMPTS (`<psp>:<id>`) ; `openapi.yaml` plus précis. Appliqué : le contrat (C-009).
3. Statut `CANCELLED` : absent de S14, présent au contrat. Appliqué : le contrat.
4. `A-PSP-*` négatif : SPECIFICATION §5.2 « Non » ; ADR-77 « peut devenir négatif ». Appliqué : ADR-77.
5. `CARD_DAILY_LIMIT` « à l'initiation » au contrat : l'empreinte de carte n'est connue qu'après saisie chez le PSP. Appliqué : contrôle à la notification (FR-025), le contrat est corrigé au plan.
6. Sessions de caisse au contrat en jeton de personne seul ; les autres opérations du guichet exigent le terminal. Appliqué : terminal + personne (renforcement).

## Decisions

| Décision | Statut |
|---|---|
| Adaptateurs PSP réels (DM `01M5YF39MKBNF9VHJ7JM49B0SE`) | Résolue le 27/10/2026 par le porteur : reportés à une mission dédiée (accès de test) ; faux refusé en production |
| Coffre des secrets PSP (DM `01M5YF3D9YZZPHP1FGEWH3E4ME`) | Résolue le 27/10/2026 par le porteur : adaptateur AWS reporté avec les adaptateurs PSP ; port + faux refusé en production |
| Autres choix ci-dessus (Assumptions, Contradictions) | Propositions de l'agent, toutes égales ou plus strictes que les sources ; à confirmer par le porteur |
