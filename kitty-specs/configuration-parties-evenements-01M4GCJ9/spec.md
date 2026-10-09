# Mission Specification: Configuration, parties et événements

**Mission Branch**: `feat/configuration-parties-evenements`
**Created**: 2026-10-09
**Status**: Draft
**Input**: User description: "Configuration et organisation des parties (SPECIFICATION §3.1, §4, §5.6, §12.1, §10.4). Gestion des prestataires (plateforme), organisateurs, commerçants et participations (`INTERNAL`/`EXTERNAL`, commission, droit de place et `pitch_fee_mode`), points de vente, événements (devise, `funds_holder` obligatoire, `issuer`, `identity_mode`, `activation_modes`, réglages des terminaux bornés §9.8, `cash_refund_single_max`, `refund_deadline`, `sync_deadline_hours`, plafonds carte, remboursement vers un autre numéro). Cascade de configuration versionnée plateforme → prestataire → organisateur → événement → participation, bornée par le profil de législation (refus à l'enregistrement avec un message qui cite la règle). Contrats versionnés `PLATFORM_OPERATOR` et `OPERATOR_ORGANIZER`. Règles de frais `fee_rule` pour les quatre flux. Création des grands livres et des comptes à la demande (§5.2). Passage des statuts d'événement par `set_event_status` uniquement, avec affichage des conditions et de leur état. Ajouter au contrat `openapi.yaml` les endpoints back-office correspondants (§10.4), puis régénérer les types."

**Sources normatives** : `docs/SPECIFICATION.md` (§2.2, §3.1, §3.2, §4.1 à §4.4, §5.2, §5.5, §5.6, §9.8, §10.1, §10.2, §10.4, §12.1, §13.1, §13.3, §17.1, §17.2), `docs/DECISIONS_ADR.md` (ADR-40, ADR-48, ADR-51, ADR-53, ADR-61, ADR-62, ADR-67, ADR-68, ADR-71, ADR-73, ADR-74, ADR-76, ADR-77), `packages/ledger-sql/schema_grand_livre_cashless.sql` (`party`, `jurisdiction_profile`, `event`, `contract`, `config_version`, `merchant_participation`, `point_of_sale`, `fee_rule`, `ledger`, `account`, `set_event_status`, `event_status_history`, `approval_request`), `packages/contracts/openapi.yaml`. Règle de priorité : SPECIFICATION §0.3. Toute contradiction constatée est signalée, jamais tranchée en silence.

**Dépend de** : missions `fondations-grand-livre-01M4AY8M` (transaction cloisonnée par prestataire, idempotence, erreurs normalisées, moteur d'écritures) et `identite-roles-double-validation-01M4DNDN` (personnes, rôles par portée, journal d'audit, demande puis approbation au back-office avec exécution générique des actions), toutes deux mergées sur `main`.

## Contexte

Les missions 1 et 2 ont posé le grand livre, l'API, l'identité, les rôles et la double validation. Mais aucune partie ni aucun événement ne peut encore être créé : le moteur d'écritures n'a aucun grand livre sur lequel écrire, et aucune mission suivante (bracelets, terminaux, recharges, paiements, clôture) ne peut démarrer.

Cette mission permet à chaque niveau de la hiérarchie (§3.1) de créer et configurer ce qui lui revient : la plateforme crée les prestataires et les profils de législation ; le prestataire crée ses organisateurs et fixe les contrats et les plafonds ; l'organisateur crée ses événements, ses commerçants, leurs participations et leurs points de vente. La configuration se résout en cascade, est versionnée, et ne peut jamais franchir les bornes du profil de législation. Un événement porte son grand livre et ses comptes dès sa création, et ne change de statut que par la fonction de la base qui contrôle les conditions, dont l'état est consultable avant chaque passage.

Hors périmètre : écrans du back-office (mission « Back-office web ») ; configurations PSP et choix par événement (S26, S26b : mission « Recharges, caisses et PSP ») ; catalogues (S18) ; politiques hors ligne (mission « Hors ligne ») ; terminaux et vendeurs (mission « Terminaux ») ; grand livre partagé par organisateur (`wallet_scope = ORGANIZER`, lieu permanent) ; écritures de clôture elles-mêmes (droits de place, frais, versements : mission « Remboursements, versements et clôture »).

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Partie | Toute personne morale du système : plateforme, prestataire, organisateur, commerçant, tiers détenteur (`party`) | « entité », « compte » (réservé au grand livre) |
| Prestataire | Partie `OPERATOR`, unité d'isolation (tenant) | « opérateur » dans les textes visibles, « client » |
| Organisateur | Partie `ORGANIZER` rattachée à un prestataire, qui organise des événements | « promoteur » |
| Commerçant | Partie `MERCHANT` rattachée à un prestataire | « marchand », « vendeur » (le vendeur est une personne qui encaisse) |
| Participation | Présence d'un commerçant à un événement, `INTERNAL` ou `EXTERNAL`, qui porte ses conditions (commission, droit de place, mode du droit de place) | « inscription », « contrat commerçant » |
| Point de vente | Lieu d'encaissement d'une participation (`point_of_sale`), qui portera les terminaux | « stand » seul, « caisse » (réservé aux caisses d'espèces) |
| Profil de législation | Règles d'un pays, versionnées, qui bornent la configuration (`jurisdiction_profile`) | « pays », « réglementation » seul |
| Cascade | Résolution d'un réglage du niveau le plus général au plus précis ; la valeur la plus précise l'emporte | « héritage », « surcharge » |
| Version de configuration | État figé d'un niveau de la cascade à partir d'une date (`config_version`) | « révision » |
| Contrat | Conditions versionnées `PLATFORM_OPERATOR` ou `OPERATOR_ORGANIZER` ; jamais modifié, remplacé par une nouvelle version | « accord », « avenant » |
| Règle de frais | Calcul d'un frais pour un flux, versionné, jamais modifié (`fee_rule`) | « tarif » |
| Détenteur des fonds | Titulaire des comptes d'argent d'un événement (`event.funds_holder`) | « bénéficiaire », « banque » |
| Valeur provisoire | Défaut de §17.2 codé et paramétrable, présenté comme « à confirmer » | « valeur par défaut validée » |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - La plateforme ouvre un prestataire dans un pays (Priority: P1)

Un administrateur de la plateforme crée un profil de législation pour un pays (pré-rempli avec les valeurs provisoires de §17.2 pour le Sénégal, marquées « à confirmer »), crée un prestataire, puis son contrat `PLATFORM_OPERATOR`. Il nomme ensuite le premier administrateur du prestataire (route de la mission 2).

**Why this priority**: Sans prestataire ni profil de législation, rien d'autre ne peut être créé ; c'est la racine de toute la hiérarchie.

**Independent Test**: Avec un administrateur de la plateforme amorcé, créer un profil `SN`, un prestataire et son contrat, puis vérifier qu'un administrateur de prestataire ne voit que son prestataire et peut lire, sans modifier, les profils de législation.

**Acceptance Scenarios**:

1. **Given** un `PLATFORM_ADMIN` connecté, **When** il crée un profil de législation `SN` version 1, **Then** le profil est enregistré avec ses bornes, ses valeurs provisoires sont signalées « à confirmer », et une ligne d'audit est écrite.
2. **Given** un profil existant, **When** un `PLATFORM_ADMIN` en change un plafond réglementaire, **Then** l'appel répond `202` avec une demande d'approbation ; une nouvelle version du profil n'existe qu'après l'approbation d'un second `PLATFORM_ADMIN`.
3. **Given** un `PLATFORM_ADMIN`, **When** il crée un prestataire puis son contrat `PLATFORM_OPERATOR` (`platform_fee_mode`), **Then** les deux sont enregistrés et audités ; une nouvelle version du contrat passe par une demande d'approbation.
4. **Given** un `OPERATOR_ADMIN`, **When** il tente de créer un prestataire ou un profil de législation, **Then** la requête est refusée `403 FORBIDDEN`.

---

### User Story 2 - Le prestataire ouvre un organisateur et fixe ses conditions (Priority: P1)

Un administrateur de prestataire crée un organisateur, son contrat `OPERATOR_ORGANIZER` (porteur des pertes hors ligne et des écarts de caisse, part de casse, assiette des frais, porteur des contestations), la configuration de niveau prestataire (dont les plafonds maximaux, par exemple le maximum de `cash_refund_single_max`) et les règles de frais du flux prestataire → organisateur.

**Why this priority**: Un événement exige un organisateur, un contrat et un profil de législation pour passer `LIVE`.

**Independent Test**: Créer un organisateur, son contrat et une règle de frais `ORG_FPREST → OPE_FRAIS` sur `TOPUP_AMOUNT`, puis vérifier qu'un second prestataire ne voit rien de tout cela.

**Acceptance Scenarios**:

1. **Given** un `OPERATOR_ADMIN`, **When** il crée un organisateur, **Then** l'organisateur est rattaché au prestataire de la personne connectée (jamais à un prestataire lu dans la requête).
2. **Given** un organisateur, **When** l'`OPERATOR_ADMIN` crée son premier contrat `OPERATOR_ORGANIZER` sans `offline_loss_bearer`, **Then** la requête est refusée `422` en nommant le champ manquant.
3. **Given** un contrat en vigueur, **When** l'`OPERATOR_ADMIN` en publie une nouvelle version, **Then** une demande d'approbation est créée ; à l'approbation, la version n+1 existe avec sa date d'effet et la version n reste lisible, inchangée.
4. **Given** une règle de frais en vigueur, **When** un utilisateur tente de la modifier, **Then** aucune modification n'est possible : seul un remplacement (nouvelle version, ancienne close par `valid_to`) est offert.

---

### User Story 3 - L'organisateur crée et règle un événement (Priority: P1)

Un administrateur d'organisateur crée un événement : nom, devise, fuseau horaire, dates, profil de législation, contrat, détenteur des fonds (choix obligatoire), émetteur, mode d'identité, modes d'activation, réglages des terminaux et réglages de remboursement. Le grand livre de l'événement et ses comptes sont créés dans la même opération.

**Why this priority**: L'événement porte la devise, le grand livre et la configuration dont dépendent toutes les missions suivantes.

**Independent Test**: Créer un événement en XOF, vérifier qu'il est `DRAFT`, que son grand livre est `OPEN` avec les comptes de §5.2 créés à la demande, et qu'un réglage hors bornes est refusé avec un message qui cite la règle.

**Acceptance Scenarios**:

1. **Given** un `ORGANIZER_ADMIN`, **When** il crée un événement sans détenteur des fonds, **Then** la requête est refusée `422` : le détenteur des fonds n'a pas de valeur par défaut.
2. **Given** un `ORGANIZER_ADMIN`, **When** il crée un événement complet, **Then** l'événement est `DRAFT`, un grand livre `EVENT` dans sa devise est créé avec ses comptes, son titulaire des fonds et son émetteur, et une version 1 de configuration de niveau événement est enregistrée.
3. **Given** un profil de législation imposant 90 jours minimum de remboursement, **When** l'organisateur règle `refund_deadline` à 30 jours après la fin, **Then** l'enregistrement est refusé avec un message qui cite la règle et le profil (pays, version).
4. **Given** un événement, **When** on règle `heartbeat_seconds = 10`, **Then** le réglage est refusé (bornes 30 à 300 s, §9.8).
5. **Given** un prestataire qui a fixé un maximum de 100 000 pour `cash_refund_single_max`, **When** l'organisateur règle 150 000, **Then** le réglage est refusé en citant le maximum du prestataire.
6. **Given** un réglage terminal réservé au prestataire (par exemple `online_retries`), **When** un `ORGANIZER_ADMIN` le modifie, **Then** la requête est refusée `403 FORBIDDEN` ; seul `reversal_window_minutes` est réglé par l'organisateur.

---

### User Story 4 - L'organisateur accueille des commerçants (Priority: P1)

L'administrateur d'organisateur crée (ou retrouve) un commerçant de son prestataire, l'inscrit à un événement par une participation `INTERNAL` ou `EXTERNAL` avec sa commission (règle de frais `PARTICIPATION`), son droit de place et son mode (`DEDUCT_OR_DEBT` par défaut, `DEDUCT_CAPPED`, `PREPAID`), puis crée un ou plusieurs points de vente. Le compte du commerçant dans le grand livre est créé à la création de la participation.

**Why this priority**: Sans participation ni point de vente, aucune vente ne pourra être encaissée ni versée.

**Independent Test**: Inscrire un commerçant externe à un événement, vérifier la création de son compte `L-MCH-<id>` (chaud, négatif permis) et de son point de vente, et le refus d'une seconde participation du même commerçant au même événement.

**Acceptance Scenarios**:

1. **Given** un événement `DRAFT`, **When** l'organisateur crée une participation `EXTERNAL`, **Then** la participation est créée avec `pitch_fee_mode = DEDUCT_OR_DEBT` par défaut, son compte commerçant existe dans le grand livre de l'événement, et le bénéficiaire des versements est le commerçant.
2. **Given** une participation `INTERNAL`, **When** elle est créée, **Then** le bénéficiaire des versements est l'organisateur.
3. **Given** un commerçant déjà inscrit à l'événement, **When** une seconde participation est créée pour lui, **Then** la requête est refusée `409 CONFLICT_STATE`.
4. **Given** une participation, **When** l'organisateur règle la commission, **Then** une règle de frais `PARTICIPATION` est créée (`MERCHANT → ORG_COM`, `SALE_AMOUNT`) ; les conditions sont portées par la participation, jamais par le commerçant.

---

### User Story 5 - L'événement avance dans ses statuts, conditions visibles (Priority: P1)

Avant chaque passage de statut, un administrateur consulte la liste des conditions et leur état (remplie ou non, avec la raison). Le passage `DRAFT → LIVE` passe par une demande d'approbation ; les passages suivants sont demandés par l'organisateur et appliqués par la seule fonction de la base `set_event_status`, qui refuse tout passage non prévu ou dont une condition n'est pas remplie.

**Why this priority**: C'est le seul chemin légal de changement de statut (ADR-51), et le statut conditionne les types d'écritures acceptés par le moteur.

**Independent Test**: Sur un événement `DRAFT` incomplet, lire les conditions (détenteur des fonds, contrat, profil de législation), compléter la configuration, demander `LIVE`, faire approuver par une seconde personne, et vérifier le statut, l'historique et le statut du grand livre.

**Acceptance Scenarios**:

1. **Given** un événement `DRAFT` sans contrat, **When** on lit ses conditions de passage à `LIVE`, **Then** la condition « contrat applicable » est indiquée non remplie, avec sa raison.
2. **Given** un événement `DRAFT` complet, **When** l'organisateur demande `LIVE`, **Then** la réponse est `202` avec une demande `PENDING` ; à l'approbation par une seconde personne habilitée, `set_event_status` passe l'événement en `LIVE` et l'historique enregistre l'auteur.
3. **Given** un événement `LIVE`, **When** on demande `DRAFT`, **Then** le passage est refusé (aucun retour en arrière, `CL018`, traduit en `409`).
4. **Given** un événement `CLOSING`, **When** on demande `SETTLING` alors qu'une condition de la base n'est pas remplie, **Then** le passage est refusé et le message nomme la condition (`CL019`).
5. **Given** une tentative de changer le statut par une modification ordinaire de l'événement, **When** elle est envoyée, **Then** elle est refusée : seule la route de passage de statut change le statut.

---

### User Story 6 - Modifier la configuration d'un événement en cours (Priority: P2)

Pendant que l'événement est `LIVE`, l'organisateur (ou le prestataire pour ses réglages) modifie un réglage ou une règle de frais. La modification devient une demande d'approbation ; une fois approuvée, une nouvelle version est créée, qui ne vaut que pour les opérations suivantes. Les transactions déjà écrites gardent la version de configuration et la règle de frais qui ont servi à les calculer.

**Why this priority**: Indispensable à l'exploitation, mais un événement peut vivre sans modification.

**Independent Test**: Modifier un réglage d'un événement `LIVE`, faire approuver, vérifier la nouvelle version et sa date d'effet, et vérifier que la résolution de la cascade à une date antérieure rend l'ancienne valeur.

**Acceptance Scenarios**:

1. **Given** un événement `DRAFT`, **When** l'organisateur modifie un réglage, **Then** une nouvelle version est créée immédiatement (une seule personne), et une ligne d'audit est écrite.
2. **Given** un événement `LIVE`, **When** l'organisateur modifie un réglage ou une règle de frais, **Then** la réponse est `202` avec une demande d'approbation ; rien ne change avant l'approbation.
3. **Given** une configuration versionnée, **When** on demande la configuration résolue d'un événement (ou d'une participation) à une date, **Then** chaque valeur indique le niveau de la cascade dont elle vient et la version utilisée.

### Edge Cases

- Création d'un événement dans une devise inconnue d'ISO 4217 ou sans exposant défini : refus.
- Événement dont `ends_at` précède `starts_at` : refus.
- `refund_deadline` absente : la valeur retenue est `ends_at` + 30 jours (valeur provisoire, §17.2), jamais moins que `ends_at` + `min_refund_window_days` ; présentée comme provisoire.
- Profil de législation remplacé par une nouvelle version pendant qu'un événement `LIVE` y est rattaché : l'événement garde sa version tant qu'il n'est pas explicitement rattaché à la nouvelle (opération soumise à double validation pendant `LIVE`) ; une configuration existante devenue hors bornes est signalée, pas modifiée en silence.
- `funds_holder = THIRD_PARTY` sans partie tierce détentrice désignée : refus.
- Commerçant d'un autre prestataire inscrit à un événement : refus (inexistant pour la personne connectée).
- Point de vente créé sur une participation d'un événement d'un autre organisateur que celui de la personne connectée : `403 FORBIDDEN`.
- Deux nouvelles versions concurrentes d'un même niveau de configuration : une seule réussit, l'autre reçoit `409 CONFLICT_STATE`.
- Demande d'approbation de passage `LIVE` approuvée alors que la configuration a changé depuis la demande : l'exécution échoue proprement (`FAILED`, raison), rien n'est appliqué.
- Rejeu d'une création avec la même clé d'idempotence : même réponse, aucune seconde partie ni aucun second grand livre.
- Participation créée sur un événement `CLOSED` : refus.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status |
|----|-------|------------|----------|--------|
| FR-001 | Accès de niveau plateforme par un rôle distinct | En tant que plateforme, je veux que les écritures de niveau plateforme (prestataires, profils de législation, contrats `PLATFORM_OPERATOR`) passent par un rôle de base distinct, réservé à ces tables et à leur journal d'audit, utilisé seulement par les routes réservées à `PLATFORM_ADMIN`, afin que la connexion ordinaire de l'application ne puisse jamais créer un prestataire ni modifier une loi (§2.2). | High | Open |
| FR-002 | Profils de législation versionnés | En tant que `PLATFORM_ADMIN`, je veux créer, lister et consulter des profils de législation par pays (délai minimal de remboursement, destination de la casse, plafonds de solde et de recharge, seuils d'identification, années de réclamation tardive, taxes et arrondis), chaque modification créant une nouvelle version, afin de borner toute configuration. Les prestataires les lisent sans pouvoir les modifier. | High | Open |
| FR-003 | Valeurs provisoires signalées | En tant que porteur du projet, je veux que les valeurs de §17.2 (plafonds Sénégal 200 000 / 2 000 000 XOF par mois, TVA 18 % TTC, `refund_deadline` = fin + 30 jours) soient codées, paramétrables et renvoyées avec un indicateur « à confirmer » et la personne qui doit confirmer, jamais présentées comme validées. | High | Open |
| FR-004 | Prestataires | En tant que `PLATFORM_ADMIN`, je veux créer, lister, consulter et modifier les données descriptives des prestataires (raison sociale, pays, identifiant fiscal), afin d'ouvrir un nouveau tenant. | High | Open |
| FR-005 | Organisateurs | En tant qu'`OPERATOR_ADMIN`, je veux créer, lister, consulter et modifier les organisateurs de mon prestataire, rattachés au prestataire déduit de mon identité. | High | Open |
| FR-006 | Commerçants | En tant qu'`ORGANIZER_ADMIN` (ou `OPERATOR_ADMIN`), je veux créer, lister, consulter et modifier les commerçants de mon prestataire, sans aucune condition commerciale sur le commerçant lui-même. | High | Open |
| FR-007 | Contrats versionnés | En tant que `PLATFORM_ADMIN` (`PLATFORM_OPERATOR`) ou `OPERATOR_ADMIN` (`OPERATOR_ORGANIZER`), je veux créer la première version d'un contrat avec ses champs obligatoires (§4.3), et publier une nouvelle version avec sa date d'effet ; aucune version n'est jamais modifiée ; toute version après la première passe par une demande d'approbation. | High | Open |
| FR-008 | Règles de frais des quatre flux | En tant qu'administrateur du niveau concerné, je veux créer, lister et remplacer les règles de frais des quatre flux (plateforme → prestataire, prestataire → organisateur, organisateur → commerçant, frais festivalier) avec leur portée, comptes payeur et bénéficiaire, assiette, taux, montants fixes, minimum, maximum, code de taxe du profil de législation et déclencheur ; une règle n'est jamais modifiée, elle est remplacée (fin de validité de l'ancienne, nouvelle version). | High | Open |
| FR-009 | Événements | En tant qu'`ORGANIZER_ADMIN`, je veux créer, lister, consulter et modifier mes événements : nom, devise, fuseau, dates, profil de législation, contrat applicable, détenteur des fonds (obligatoire, sans défaut, et partie tierce désignée si `THIRD_PARTY`), émetteur (`ORGANIZER` par défaut), mode d'identité, modes d'activation, sort d'un bracelet perdu, réglages de remboursement, de synchronisation, de carte et de remboursement vers un autre numéro (§4.2). | High | Open |
| FR-010 | Réglages par qui de droit | En tant que plateforme, je veux que chaque réglage d'événement ne soit modifiable que par le rôle qui le règle (§4.2, §9.8) : réglages des terminaux, `sync_deadline_hours`, plafonds carte et réglages de remboursement vers un autre numéro par l'`OPERATOR_ADMIN` ; `reversal_window_minutes`, `cash_refund_single_max` (dans la limite du maximum du prestataire) et `refund_deadline` par l'`ORGANIZER_ADMIN` ; tout autre rôle reçoit `403 FORBIDDEN`. | High | Open |
| FR-011 | Grand livre et comptes à la création de l'événement | En tant que moteur d'écritures, je veux qu'à la création d'un événement soient créés, dans la même transaction, son grand livre (`wallet_scope = EVENT`, devise, émetteur, titulaire des fonds, statut `OPEN`) et les comptes de §5.2 qui ne dépendent ni d'un portefeuille, ni d'une participation, ni d'une caisse, ni d'un canal PSP ; ces derniers sont créés à la demande par les missions qui les introduisent. | High | Open |
| FR-012 | Participations | En tant qu'`ORGANIZER_ADMIN`, je veux inscrire un commerçant de mon prestataire à un de mes événements (`INTERNAL` : versements à l'organisateur ; `EXTERNAL` : versements au commerçant), avec son droit de place et son mode (`DEDUCT_OR_DEBT` par défaut, `DEDUCT_CAPPED`, `PREPAID` avec référence de paiement), au plus une participation par commerçant et par événement, et que son compte commerçant soit créé dans le grand livre de l'événement dans la même transaction. | High | Open |
| FR-013 | Points de vente | En tant qu'`ORGANIZER_ADMIN`, je veux créer, lister, consulter et renommer les points de vente d'une participation. | Medium | Open |
| FR-014 | Cascade versionnée | En tant que plateforme, je veux que chaque niveau (plateforme, prestataire, organisateur, événement, participation) ait des versions de configuration (version croissante, date d'effet, réglages), qu'une modification crée toujours une nouvelle version, et qu'une lecture rende la configuration résolue d'un événement ou d'une participation à une date, valeur par valeur, avec le niveau et la version d'origine. | High | Open |
| FR-015 | Bornes de la législation à l'enregistrement | En tant que plateforme, je veux que toute version de configuration, tout réglage d'événement et tout contrat qui franchit une borne du profil de législation de l'événement (ou un maximum fixé par le prestataire) soit refusé à l'enregistrement en `422`, avec un message qui cite la règle, la valeur demandée, la borne, et le profil (pays, version) ou le niveau qui l'impose. | High | Open |
| FR-016 | Version de configuration pour les écritures | En tant que moteur d'écritures, je veux obtenir, pour un événement à un instant donné, l'identifiant de la version de configuration en vigueur et les règles de frais applicables, afin que chaque transaction enregistre `config_version_id` et chaque ligne de frais `fee_rule_id` (§4.1). | High | Open |
| FR-017 | Conditions de passage visibles | En tant qu'administrateur, je veux lire, pour un événement, les conditions du passage au statut suivant et l'état de chacune (remplie / non remplie, raison) : conditions calculées par la base (§12.1) et conditions de configuration de `DRAFT → LIVE` (détenteur des fonds, contrat applicable, profil de législation). Les conditions qui dépendent de missions futures (caisses, PSP, terminaux) sont listées comme « à contrôler par la mission concernée », jamais présentées comme remplies. | High | Open |
| FR-018 | Passage de statut par la seule fonction de la base | En tant qu'organisateur, je veux demander le passage au statut suivant ; l'API appelle `set_event_status` avec l'auteur authentifié, traduit ses refus (`CL018` passage non prévu, `CL019` condition non remplie, avec la condition nommée) en problème normalisé, et aucune autre route ne modifie le statut. | High | Open |
| FR-019 | Double validation des actions de configuration | En tant que plateforme, je veux que passent par une demande d'approbation (mécanisme de la mission 2, `202 Accepted`, exécution unique après approbation par une seconde personne du rôle exigé sur la même portée) : le passage `DRAFT → LIVE`, toute nouvelle version de contrat, toute modification de configuration ou de règle de frais d'un événement `LIVE` (et de ses participations), et tout changement de plafond réglementaire d'un profil de législation ; les noms d'action correspondants sont ajoutés à la liste fermée par migration et au contrat. | High | Open |
| FR-020 | Audit | En tant que contrôleur, je veux qu'une ligne du journal d'audit (avant, après, auteur, valideur s'il y en a un, origine) soit écrite dans la même transaction que chaque création ou modification de cette mission, y compris les écritures de niveau plateforme. | High | Open |
| FR-021 | Contrat d'API et types générés | En tant que développeur des applications, je veux que toutes les routes de cette mission figurent dans `openapi.yaml` (mêmes conventions : problem+json, `Idempotency-Key` sur toute écriture, `X-Request-Id`, `Accept-Language`, pagination des listes) et que les types TypeScript soient régénérés, jamais écrits à la main. | High | Open |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Isolation | 0 partie, événement, contrat, configuration, règle de frais, participation ou point de vente d'un autre prestataire lisible ou modifiable via la connexion de l'application ; vérifié par un test à deux prestataires sur chaque nouvelle route et par pgTAP sur chaque nouvelle table ou politique. | Security | High | Open |
| NFR-002 | Cloisonnement du rôle plateforme | La connexion ordinaire de l'application ne peut ni insérer un prestataire ni écrire un profil de législation (0 succès sur un test pgTAP dédié par table) ; le rôle plateforme n'a aucun droit sur le grand livre (`journal_transaction`, `posting`, `account_balance`). | Security | High | Open |
| NFR-003 | Latence | Lectures et écritures de configuration : p95 ≤ 200 ms côté serveur (§15), mesuré sur la base de test avec 100 événements et 1 000 participations ; création d'un événement avec son grand livre et ses comptes : p95 ≤ 500 ms. | Performance | Medium | Open |
| NFR-004 | Atomicité | Une création d'événement ou de participation ne laisse jamais un grand livre ou un compte orphelin : 0 grand livre sans événement et 0 participation sans compte commerçant après injection d'une erreur à chaque étape (test d'intégration). | Reliability | High | Open |
| NFR-005 | Messages de refus | 100 % des refus de bornes testés citent la règle, la valeur demandée et la borne, en français et en anglais selon `Accept-Language`, sans aucun message SQL brut. | Usability | Medium | Open |
| NFR-006 | Tests verts | Les 400 + 64 assertions pgTAP existantes, les tests des missions 1 et 2 et le rejeu du scénario de référence restent verts en CI à chaque commit. | Reliability | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Statut par `set_event_status` seulement | Le statut d'un événement ne change que par `set_event_status` ; le déclencheur de garde et les conditions de la base ne sont ni affaiblis ni contournés (ADR-51, ADR-71). | Technical | High | Open |
| C-002 | Rien ne se modifie, tout se versionne | Contrats, règles de frais, versions de configuration et profils de législation ne sont jamais mis à jour en place ; on crée une nouvelle version (§4.1, §4.3, §5.6). | Business | High | Open |
| C-003 | Détenteur des fonds hors cascade | `event.funds_holder` est obligatoire, sans valeur par défaut, et fait foi ; aucun réglage de la cascade ne le remplace (§4.4). | Business | High | Open |
| C-004 | Migrations et pgTAP | Toute évolution de schéma passe par une migration, avec RLS forcée, `operator_id` sur toute ligne métier et des tests pgTAP par contrainte (§14.2) ; les `.sql` générés ne sont jamais modifiés à la main ; les contraintes existantes du schéma de référence (bornes des colonnes de `event`, contrôles de `contract`) ne sont pas affaiblies. | Technical | High | Open |
| C-005 | Prestataire déduit de l'identité | Le prestataire d'une écriture est toujours celui de la personne connectée (`set_config('app.operator_id', …, true)` en début de transaction) ; un `operator_id` reçu dans une requête est ignoré. | Security | High | Open |
| C-006 | Valeurs provisoires non validées | Aucune valeur de §17.2 n'est présentée comme validée ; elles restent paramétrables. | Regulatory | High | Open |
| C-007 | Périmètre | Pas d'écran, pas de configuration PSP (S26, S26b), pas de catalogue (S18), pas de politique hors ligne, pas de `wallet_scope = ORGANIZER`, pas d'écriture de clôture dans cette mission. | Business | High | Open |
| C-008 | Contrat d'abord | Toute route est d'abord décrite dans `openapi.yaml` ; les types sont générés. | Technical | High | Open |

### Key Entities

- **Partie** : plateforme, prestataire, organisateur, commerçant ou tiers détenteur ; raison sociale, pays, identifiant fiscal ; rattachée à son prestataire (sauf plateforme et prestataire).
- **Profil de législation** : pays, version, date d'effet, bornes (délai minimal de remboursement, plafonds, seuils, destination de la casse, années de réclamation tardive), taxes et arrondis ; global à la plateforme.
- **Contrat** : type (`PLATFORM_OPERATOR`, `OPERATOR_ORGANIZER`), parties, version, date d'effet, champs obligatoires de §4.3.
- **Version de configuration** : niveau de la cascade, objet, version, date d'effet, réglages.
- **Règle de frais** : portée, comptes payeur et bénéficiaire, assiette, calcul, taxe, déclencheur, validité, version.
- **Événement** : organisateur, devise, fuseau, dates, statut, profil de législation, contrat, détenteur des fonds, émetteur, réglages (§4.2, §9.8) ; historique de ses statuts.
- **Participation** : événement, commerçant, type, bénéficiaire des versements, droit de place et son mode ; un compte commerçant dans le grand livre.
- **Point de vente** : participation, nom ; portera les terminaux.
- **Grand livre** : un par événement et par devise ; ses comptes créés à la demande.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : À partir d'une base vide avec un seul administrateur de la plateforme, la hiérarchie complète (profil de législation, prestataire, organisateur, contrats, événement, deux participations, deux points de vente) se construit entièrement par l'API et l'événement passe `LIVE` après une seule approbation par une seconde personne.
- **SC-002** : 100 % des réglages hors bornes du jeu de tests (bornes §9.8, bornes de la législation, maximums du prestataire) sont refusés à l'enregistrement, chacun avec un message qui cite la règle.
- **SC-003** : 0 donnée d'un prestataire visible par un autre dans le test d'isolation à deux prestataires, sur toutes les routes de la mission.
- **SC-004** : Pour toute transaction écrite après la mission, la version de configuration et la règle de frais qui l'ont calculée sont retrouvables, et la configuration résolue à cette date redonne les mêmes valeurs.
- **SC-005** : 0 passage de statut possible hors de la route dédiée ; 100 % des refus de passage nomment la condition non remplie.

## Assumptions

- Le contrat applicable à un événement est le contrat `OPERATOR_ORGANIZER` en vigueur de son organisateur, désigné à la création de l'événement (`event.contract_id`) ; une nouvelle version de contrat s'applique aux événements créés ensuite et, pour un événement existant, seulement s'il y est explicitement rattaché.
- L'émetteur (`issuer`) d'un événement est porté par son grand livre (`ledger.issuer_id`), résolu en partie organisateur ou prestataire.
- Les maximums fixés par le prestataire (par exemple pour `cash_refund_single_max`) sont des réglages de sa configuration de niveau prestataire.
- La commission d'un commerçant est une règle de frais de portée `PARTICIPATION` ; le droit de place est porté par la participation.
- Les conditions de passage qui dépendent de domaines non encore livrés (caisses comptées, PSP rapprochés, terminaux remontés) sont listées comme à contrôler par la mission concernée ; seul `DRAFT → LIVE` est pleinement exerçable de bout en bout dans cette mission.
- Le deuxième rôle de base (plateforme) est créé par `roles.sql`/`post-roles.sql`, en CI comme en production, avec ses propres paramètres de connexion.

## Decisions

Décisions de cadrage confirmées par le porteur du projet (2026-10-09), consignées en Decision Moments :

| Sujet | Décision |
|---|---|
| Périmètre | API back-office seule ; hors PSP (S26, S26b), catalogues (S18) et politiques hors ligne |
| Écritures de niveau plateforme | Rôle de base distinct, conformément à la lettre de §2.2 ; la mission 2 avait choisi une fonction `SECURITY DEFINER` (`create_platform_admin`) : écart de méthode à consigner, sans réécrire la mission 2 dans ce périmètre |
| Grand livre | Créé avec ses comptes à la création de l'événement (`DRAFT`) ; `wallet_scope = EVENT` seul, `ORGANIZER` reporté |
| Double validation | Passage `DRAFT → LIVE`, nouvelle version de contrat, toute modification de frais ou de configuration d'un événement `LIVE` ; plus le changement de plafond réglementaire exigé par §3.2 |
| Profils de législation (contradiction signalée) | §3.2 donne la gestion des profils de législation à `OPERATOR_ADMIN`, alors que §2.2 et le schéma (`jurisdiction_profile` sans `operator_id`) en font une donnée de niveau plateforme. Retenu : gérés par `PLATFORM_ADMIN`, lus par les prestataires. À consigner dans `docs/DECISIONS_ADR.md` |
