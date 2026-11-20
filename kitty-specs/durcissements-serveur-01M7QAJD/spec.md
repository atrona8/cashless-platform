# Mission Specification: Durcissements serveur hérités

**Mission Branch**: `feat/durcissements-serveur`
**Created**: 2026-11-18
**Status**: Draft
**Input**: Mission 11a de `PROMPTS-A-ENVOYER.md` (dettes serveur héritées des missions 4, 5a, 5b, 8 et 9b) ; Decision
Moments du porteur du 18/11/2026 (OP-N64, OP-N140, OP-N116) et résumé d'intention confirmé le même jour.

## Contexte

Plusieurs missions ont accepté des limites de sécurité côté serveur, chacune consignée par un point ouvert, un ADR et un
test de borne. Cette mission les lève avant la mise en production. Le scénario commun est une **connexion de l'API
compromise** (rôle `cashless_app`) : elle ne doit plus pouvoir faire ce que seules des fonctions contrôlées ou un
processus dédié doivent faire. Aucune route ne change de comportement pour les applications (back-office, terminal,
app festivalier) ; seuls les chemins internes et les droits de la base changent.

Points traités : OP-N60 (ADR-97), OP-N79 (ADR-127), OP-N76 (ADR-121), OP-N64 côté serveur (ADR-106), OP-N116,
OP-N137 (ADR-204), OP-N140 (ADR-203), OP-N141 (ADR-205), OP-N145 (ADR-201).

Hors périmètre : OP-N56 (preuve de la personne qui décide une approbation, avec le serveur d'identité réel) et OP-N46
(signature NXP vérifiée par le serveur), en mission 12b ; tout écran ; les adaptateurs réels (KMS, PSP, OTP).

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Connexion de l'API compromise | Session SQL du rôle `cashless_app` aux mains d'un attaquant : elle a tous les droits de ce rôle, pas plus | « hacker », « accès admin » |
| Fonction contrôlée | Fonction de la base qui impose les règles d'un passage (état, motif, quantités) ; seul chemin d'écriture admis | « procédure », « RPC » |
| Processus de vérification du PIN | Processus séparé de l'API, seul détenteur du secret des PIN et d'un rôle de base propre | « microservice PIN » |
| Assertion App Attest | Preuve signée par la clé App Attest d'un iPhone, liée à une requête et à un compteur croissant | « attestation » (réservé à l'enrôlement) |
| Levée d'un point | Le point ouvert passe « levé » avec son test de levée ; le test de borne d'avant est inversé | « résolu », « fermé » |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Les bracelets ne changent que par les fonctions contrôlées (Priority: P1)

Une connexion de l'API compromise essaie de créer un lot de bracelets directement en `ACTIVE` ou `CLOSED`, de changer
la quantité, l'index de clé ou l'événement d'un lot, de clore un lot sans `close_batch`, ou de changer le statut d'un
bracelet sans motif. Tout est refusé. Les routes du back-office (créer un lot, le faire avancer, le clore, changer le
statut d'un bracelet) marchent comme avant, par les fonctions contrôlées.

**Why this priority**: OP-N60 bloque la production ; un lot clos sans `close_batch` n'acquiert pas les cautions.

**Independent Test**: depuis le rôle `cashless_app`, chaque écriture directe de la fiche d'OP-N60 est refusée ; les
parcours de lot existants passent inchangés.

**Acceptance Scenarios**:

1. **Given** le rôle `cashless_app`, **When** il insère un lot au statut `ACTIVE` ou `CLOSED`, **Then** refus ; un
   lot ne naît que `ORDERED`, par la fonction de création.
2. **Given** un lot existant, **When** `cashless_app` change directement `quantity`, `key_index`, `organizer_id`,
   `event_id` ou `status`, **Then** refus.
3. **Given** un bracelet, **When** `cashless_app` change son statut sans passer par la fonction qui exige un motif,
   **Then** refus ; l'historique n'a jamais de motif vide.
4. **Given** la route de création de lot du back-office, **When** elle est appelée comme avant, **Then** même réponse
   qu'avant la mission.

---

### User Story 2 - Seul le processus du PIN ouvre une session de vendeur (Priority: P1)

Un vendeur saisit son PIN sur un terminal. La vérification et l'ouverture de session sont faites par un processus
séparé, seul détenteur du secret des PIN. Une connexion de l'API compromise ne peut plus lire les empreintes ni ouvrir
une session pour un vendeur. Une vente ne peut être attribuée qu'au vendeur de la session désignée, par le schéma
lui-même et non plus seulement par la fonction d'écriture.

**Why this priority**: OP-N76 laisse une connexion de l'API ouvrir une session au nom de n'importe quel vendeur.

**Independent Test**: depuis `cashless_app`, la lecture d'empreinte et l'ouverture de session sont refusées ; le
parcours PIN du terminal réussit par le processus dédié ; une attribution de vente à un autre vendeur que celui de la
session est refusée par la base.

**Acceptance Scenarios**:

1. **Given** le rôle `cashless_app`, **When** il appelle la lecture d'empreinte ou l'ouverture de session, **Then**
   refus (droit d'exécution absent).
2. **Given** un PIN juste, **When** le terminal ouvre une session par la route existante, **Then** la session est
   ouverte par le processus dédié, auditée, et la réponse est celle d'avant.
3. **Given** un PIN faux, **When** le terminal essaie, **Then** l'essai est compté comme avant ; aucun chemin ne
   permet d'ouvrir une session sans essai compté.
4. **Given** le processus du PIN arrêté, **When** un vendeur essaie, **Then** refus sans session ouverte, l'API ne
   retombe sur aucune vérification de remplacement.
5. **Given** une session du vendeur A, **When** une attribution désigne cette session et le vendeur B, **Then** refus
   par la base.

---

### User Story 3 - L'IBAN ne s'expose ni au journal ni au repos (Priority: P1)

Un administrateur crée une demande de remboursement par virement avec un IBAN. L'IBAN n'apparaît en clair dans aucun
journal, et il est chiffré en base. Il n'est déchiffré que pour l'export du lot de virements, et affiché masqué
ailleurs.

**Why this priority**: OP-N140 bloque la production.

**Independent Test**: une requête qui porte un IBAN, journalisée en erreur, ne montre que l'IBAN masqué ; la colonne
lue directement en base ne contient pas l'IBAN en clair ; l'export rend l'IBAN exact.

**Acceptance Scenarios**:

1. **Given** une erreur sur une requête portant un IBAN, **When** elle est journalisée, **Then** l'IBAN est masqué.
2. **Given** une demande créée avec un IBAN, **When** la table est lue directement, **Then** aucune valeur ne contient
   l'IBAN en clair.
3. **Given** un lot de virements validé, **When** il est exporté, **Then** l'IBAN est exact ; ailleurs (listes, audit,
   approbation), il est masqué comme aujourd'hui.

---

### User Story 4 - Une demande de remboursement naît à son état initial (Priority: P1)

Une connexion de l'API compromise essaie d'insérer une demande de remboursement déjà `PAID`, ou d'appeler les anciennes
signatures de `refund_deposit`. Tout est refusé ; le parcours normal (création, approbation à deux, confirmation)
marche comme avant.

**Why this priority**: OP-N145 : sans garde d'insertion, une demande payée peut naître sans les deux personnes.

**Independent Test**: depuis `cashless_app`, l'insertion d'une demande hors de son état initial est refusée ; les
anciennes signatures n'existent plus ; les parcours de la 9a et de la 9b passent.

**Acceptance Scenarios**:

1. **Given** le rôle `cashless_app`, **When** il insère une demande à un autre état que l'état initial, **Then** refus.
2. **Given** la base, **When** on cherche `refund_deposit(uuid, uuid)` ou `refund_deposit_for_session(uuid, uuid)`,
   **Then** la première n'existe plus, la seconde n'est exécutable par aucun rôle.

---

### User Story 5 - Versements et régularisations sans angle mort (Priority: P2)

Un approbateur du mauvais rôle essaie de valider ou de refuser un lot de versements : il reçoit `403` et la demande
reste intacte. Un refus exige le rôle de la classe de bénéficiaire, comme la validation. Un `confirm` rejoué laisse une
trace d'audit. À la clôture, l'écart de régularisation des frais du prestataire ne peut pas dépasser les frais bruts.

**Why this priority**: OP-N137 et OP-N141, mineurs (aucune perte d'argent constatée) mais des angles morts d'audit et
de bornes.

**Independent Test**: les cas (a) à (d) d'OP-N137 et le plafond d'OP-N141 ont chacun un test qui échouait avant.

**Acceptance Scenarios**:

1. **Given** un lot en attente, **When** un approbateur du mauvais rôle le valide, **Then** `403`, la demande reste en
   attente (pas `FAILED`).
2. **Given** un lot en attente, **When** une personne sans le rôle de la classe de bénéficiaire le refuse, **Then**
   `403`.
3. **Given** un versement déjà confirmé, **When** la même confirmation est rejouée, **Then** `200` sans écriture, avec
   une ligne d'audit du rejeu.
4. **Given** l'auteur d'un lot, **When** il le valide lui-même, **Then** exactement `409 APPROVAL_INVALID`.
5. **Given** une régularisation `OPERATOR_FEE`, **When** l'écart demandé dépasse les frais bruts, **Then** refus sans
   écriture.

---

### User Story 6 - Assertions App Attest prêtes côté serveur (Priority: P3)

À l'enrôlement d'un iPhone, le serveur garde l'identifiant de la clé App Attest. Il sait vérifier une assertion de cet
appareil : signature par cette clé, compteur strictement croissant, lien avec la requête. La borne iOS actuelle (QR
seulement, enregistrement des clés de bracelet refusé) reste en place tant que l'app n'envoie pas d'assertions
(mission 12).

**Why this priority**: prépare la levée d'OP-N64 sans la promettre ; la levée dépend de l'app déléguée.

**Independent Test**: un enrôlement iOS garde l'identifiant de clé ; une assertion valide est acceptée ; une assertion
d'une autre clé, d'une autre requête ou avec un compteur non croissant est refusée ; la borne iOS reste vraie.

**Acceptance Scenarios**:

1. **Given** un iPhone enrôlé, **When** on lit son terminal en base, **Then** l'identifiant de clé App Attest est
   présent.
2. **Given** une assertion valide, **When** le serveur la vérifie, **Then** acceptée et le compteur est mis à jour.
3. **Given** une assertion rejouée, d'une autre clé ou d'une autre requête, **When** le serveur la vérifie, **Then**
   refus.
4. **Given** un terminal iOS, **When** il appelle l'enregistrement des clés de bracelet, **Then** refus comme avant.

---

### User Story 7 - L'inscription d'une passerelle trouve son grand livre (Priority: P3)

Un administrateur inscrit une passerelle de site pour un événement. Il ne saisit plus le grand livre : l'inscription
le trouve à partir de l'événement et le rend, et l'outil l'écrit dans le fichier d'enrôlement.

**Why this priority**: OP-N116, disponibilité seulement.

**Independent Test**: une inscription sans grand livre produit un fichier d'enrôlement qui porte le grand livre de
l'événement ; l'ancien argument est refusé.

**Acceptance Scenarios**:

1. **Given** un événement, **When** l'administrateur inscrit une passerelle, **Then** le fichier d'enrôlement porte le
   grand livre de cet événement.
2. **Given** l'ancien argument de grand livre, **When** il est passé, **Then** l'outil le refuse avec un message clair.

---

### Edge Cases

- Un lot de bracelets en cours de personnalisation pendant la migration : les lots existants gardent leur état ; seuls
  les chemins d'écriture changent.
- Un vendeur au milieu d'un essai de PIN au moment du passage au processus dédié : l'essai en cours expire normalement,
  aucune session n'est ouverte par l'ancien chemin.
- Des lignes existantes avec un IBAN en clair (bases de développement seulement, aucune donnée réelle avant la
  production) : elles ne sont pas reprises ; la base refuse toute nouvelle écriture en clair (amendé au plan).
- Une assertion App Attest dont le compteur est égal au dernier vu : refusée (rejeu).
- Un événement sans grand livre (configuration incomplète) : l'inscription d'une passerelle est refusée avec la raison.
- Un processus du PIN qui démarre sans son secret : refus de démarrer.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Lot créé par fonction seulement | En tant que plateforme, je veux qu'un lot de bracelets ne puisse naître que `ORDERED` par une fonction contrôlée, et que `cashless_app` ne puisse plus insérer de lot directement (OP-N60). | High | Open | build | no |
| FR-002 | Lot changé par fonction seulement | En tant que plateforme, je veux que `cashless_app` ne puisse modifier directement aucune colonne d'un lot (statut, quantité, index de clé, organisateur, événement) ; chaque passage passe par sa fonction (OP-N60). | High | Open | build | no |
| FR-003 | Statut d'un bracelet avec motif | En tant que plateforme, je veux que le statut d'un bracelet ne change que par la fonction qui exige un motif (OP-N60). | High | Open | build | no |
| FR-004 | Routes de lot inchangées | En tant que back-office, je veux que les routes de lot et de statut de bracelet rendent les mêmes réponses qu'avant la mission. | High | Open | ratchet | yes — contrôle positif : mêmes fixtures que FR-001 à FR-003, réponses comparées avant et après |
| FR-005 | Processus du PIN | En tant que plateforme, je veux qu'un processus séparé, seul détenteur du secret des PIN et d'un rôle de base propre, soit le seul à lire une empreinte de PIN et à ouvrir une session de vendeur (OP-N76). | High | Open | build | no |
| FR-006 | API sans droit sur le PIN | En tant que plateforme, je veux que `cashless_app` n'exécute plus la lecture d'empreinte ni l'ouverture de session, et que l'API n'ait aucune vérification de remplacement si le processus est absent (OP-N76). | High | Open | build | no |
| FR-007 | Parcours PIN inchangé | En tant que terminal, je veux que l'ouverture d'une session de vendeur garde ses réponses, son décompte d'essais et son audit. | High | Open | ratchet | yes — contrôle positif : parcours PIN juste et PIN faux sur la même fixture que FR-006 |
| FR-008 | Vendeur dans la clé de session | En tant que plateforme, je veux que la base refuse une attribution de vente dont le vendeur n'est pas celui de la session désignée (OP-N79). | High | Open | build | no |
| FR-009 | IBAN masqué au journal | En tant que plateforme, je veux qu'un IBAN ne paraisse jamais en clair dans un journal d'erreur ou de requête (OP-N140). | High | Open | build | no |
| FR-010 | IBAN chiffré au repos | En tant que plateforme, je veux que l'IBAN soit chiffré en base aux trois endroits où il est gardé (demande de remboursement, versement, contenu des demandes d'approbation), et déchiffré seulement pour l'export du lot de virements (OP-N140 ; moyen de chiffrement différé au plan, décision 1). | High | Open | build | no |
| FR-011 | Demande née à son état initial | En tant que plateforme, je veux que `cashless_app` ne puisse insérer une demande de remboursement qu'à son état initial (OP-N145). | High | Open | build | no |
| FR-012 | Anciennes signatures fermées | En tant que plateforme, je veux que `refund_deposit_for_session(uuid, uuid)` n'existe plus et que `refund_deposit(uuid, uuid)`, gardée pour ses appelants internes, ne soit exécutable par aucun rôle (OP-N145 ; amendé le 18/11/2026, décision du porteur). | Medium | Open | build | no |
| FR-013 | Mauvais rôle sans effet | En tant qu'administrateur, je veux qu'un approbateur du mauvais rôle reçoive `403` et que la demande de lot reste en attente (OP-N137 a). | Medium | Open | build | no |
| FR-014 | Refus par rôle de classe | En tant qu'administrateur, je veux qu'un refus de lot exige le même rôle de classe de bénéficiaire que la validation (OP-N137 b). | Medium | Open | build | no |
| FR-015 | Rejeu de confirmation audité | En tant qu'auditeur, je veux qu'une confirmation de versement rejouée laisse une ligne d'audit, sans écriture au grand livre (OP-N137 c). | Medium | Open | build | no |
| FR-016 | Auto-approbation : code exact | En tant que plateforme, je veux que la validation d'un lot par son auteur rende exactement `409 APPROVAL_INVALID`, sa réponse actuelle, et que le test n'accepte plus que celle-là (OP-N137 d ; amendé au plan le 18/11/2026, `403` changerait la route). | Low | Open | build | no |
| FR-017 | Plafond de régularisation | En tant que plateforme, je veux que l'écart de régularisation `OPERATOR_FEE` ne puisse dépasser les frais bruts du prestataire (OP-N141). | Medium | Open | build | no |
| FR-018 | Clé App Attest gardée | En tant que plateforme, je veux que l'enrôlement d'un iPhone garde l'identifiant de sa clé App Attest (OP-N64). | Low | Open | build | no |
| FR-019 | Assertions vérifiées | En tant que plateforme, je veux vérifier une assertion App Attest : clé de l'appareil, compteur strictement croissant, lien avec la requête ; borne iOS gardée tant que l'app n'en envoie pas (OP-N64, mission 12). | Low | Open | build | no |
| FR-020 | Grand livre rendu par l'inscription | En tant qu'administrateur de site, je veux que l'inscription d'une passerelle trouve le grand livre de l'événement et le rende, l'argument manuel étant refusé (OP-N116). | Low | Open | build | no |
| FR-021 | Levées consignées | En tant que porteur, je veux que chaque point levé passe « levé » dans `POINTS_OUVERTS.md` avec son test de levée, son test de borne inversé et son ADR mis à jour ; OP-N64 passe « côté serveur prêt ». | High | Open | build | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Ouverture de session de vendeur | p95 de l'ouverture de session (PIN juste) ≤ 300 ms et p99 ≤ 600 ms sur 200 essais en série, processus dédié compris. | Performance | High | Open |
| NFR-002 | Export d'un lot de virements | L'export d'un lot de 500 lignes avec IBAN chiffrés se fait en moins de 2 s. | Performance | Medium | Open |
| NFR-003 | Aucun droit élargi | 0 droit de table ou de colonne ajouté à `cashless_app` ; les seuls `EXECUTE` ajoutés portent sur des fonctions `SECURITY DEFINER` qui remplacent un droit retiré ou contrôlent elles-mêmes l'écriture, listés au plan et figés dans la liste des droits d'exécution (amendé au plan le 18/11/2026). | Security | High | Open |
| NFR-004 | Tests de borne inversés | 100 % des tests de borne des 9 points sont inversés ou remplacés par un test de levée qui échoue si la limite revient (mutation vérifiée pour chacun). | Security | High | Open |
| NFR-005 | Rien en clair après migration | 100 % des écritures d'IBAN en clair refusées par la base après la migration, sur `refund_request` et `payout` (contrôle en base), et 0 IBAN en clair dans le contenu des demandes d'approbation écrites ensuite ; aucune reprise de lignes (aucune donnée réelle avant la production ; amendé au plan le 18/11/2026). | Security | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Priorité des sources | SPECIFICATION §0.3 ; toute contradiction est signalée, jamais tranchée en silence. | Regulatory | High | Open |
| C-002 | Contrat inchangé | Aucune route du contrat `openapi.yaml` ne change de comportement. Le seul ajout envisagé (porter une assertion App Attest dans une requête) est listé au plan et soumis au porteur avant d'être fait (consigne du 05/11/2026), puis inscrit dans `contract-baseline.json` (ADR-215). | Business | High | Open |
| C-003 | Aucun contrôle affaibli | Règle du porteur du 13/10/2026 (`CLAUDE.md`) : tout écart qui affaiblit la sécurité est soumis avant d'être codé ; chaque écart accepté a une entrée OP, un ADR et un test. | Security | High | Open |
| C-004 | Fichiers générés intacts | Aucun `.sql` généré de `packages/ledger-sql/` n'est modifié ; les migrations sont nouvelles, les anciennes ne sont pas retouchées. | Technical | High | Open |
| C-005 | Droits gardés | Ne pas rouvrir les droits de `cashless_app` sur les historiques, les règles de passage, `media_assignment` et `device_config_served` ; `log_media_status` et `log_batch_status` restent `SECURITY DEFINER` ; `tests_definer_trigger_writers.sql` est mis à jour. | Security | High | Open |
| C-006 | Aucun faux en production | Le processus du PIN refuse de démarrer sans son secret ; la clé de chiffrement de l'IBAN est lue en configuration de l'API et le démarrage en production est refusé sans elle (décision du porteur du 18/11/2026) ; aucun faux nouveau. | Security | High | Open |
| C-007 | Chemins du monorepo | Code dans `apps/api/`, `packages/ledger-sql/` et `tools/edge-admin/` ; tests dans `apps/api/test/`, `packages/ledger-sql/tests/` et `tools/edge-admin/`. | Technical | Medium | Open |
| C-008 | Un rôle par processus | Le processus du PIN a son propre rôle de base ; aucun autre rôle n'exécute la lecture d'empreinte ni l'ouverture de session. | Security | High | Open |

### Key Entities

- **Lot de bracelets** (`media_batch`, existant) : statut, quantité, index de clé, organisateur, événement.
- **Bracelet** (`media`, existant) et son historique de statut (motif obligatoire).
- **Session de vendeur** (`vendor_session`, existant) et **attribution de vente** (`sale_attribution`, existant).
- **Processus du PIN** : nouveau processus, son rôle de base et son secret.
- **Demande de remboursement** (`refund_request`, existant) : IBAN chiffré.
- **Demande d'approbation de lot** (`PAYOUT`, existant) et **versement** (`payout`, existant).
- **Terminal** (`device`, existant) : identifiant de clé App Attest et dernier compteur d'assertion.
- **Inscription de passerelle** (existant) : grand livre rendu.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : 100 % des écritures directes listées dans les fiches d'OP-N60, OP-N76, OP-N79 et OP-N145 sont refusées
  depuis une connexion de l'API compromise. — build · no-op passable: no
- **SC-002** : 100 % des parcours existants touchés (lots, statut de bracelet, PIN de vendeur, remboursements,
  versements, inscription de passerelle) rendent les mêmes résultats qu'avant la mission. — ratchet · no-op passable:
  yes (contrôle positif : mêmes fixtures que SC-001)
- **SC-003** : 0 IBAN en clair dans les journaux et dans la table après migration. — build · no-op passable: no
- **SC-004** : 8 points ouverts levés (OP-N60, N76, N79, N116, N137, N140, N141, N145) et OP-N64 « côté serveur
  prêt », chacun avec un test qui échoue si la limite revient. — build · no-op passable: no
- **SC-005** : 0 droit de table ou de colonne ajouté à `cashless_app` ; `EXECUTE` ajoutés seulement ceux de la liste figée du plan. — ratchet · no-op passable: yes (contrôle positif : liste figée des
  droits comparée, mutation d'un `GRANT` détectée)

## Assumptions

- Le processus du PIN suit le modèle des processus de clés de la mission 4 (rôle propre, secret hors base, appel par
  l'API) ; son déploiement s'ajoute à ceux qui existent.
- Le plafond d'OP-N141 est celui de sa fiche : les frais bruts du prestataire pour l'événement.
- Le chiffrement de l'IBAN utilise une clé lue en configuration de l'API (décision du porteur du 18/11/2026) ; limite
  résiduelle : la clé est dans le processus public, levée avec le vrai KMS (12b).
- La vérification des assertions App Attest suit la documentation d'Apple ; l'app iOS (mission 12) devra envoyer les
  assertions pour que la borne iOS soit retirée.
- Aucun appelant des anciennes signatures de `refund_deposit` ne reste dans le code ; le plan le vérifie.

## Decisions

Décisions du porteur du 18/11/2026 (Decision Moments de cette mission) : OP-N64 : le serveur garde l'identifiant de
clé App Attest et vérifie les assertions, la borne iOS reste jusqu'à la mission 12, le point passe « côté serveur
prêt » sans être levé ; OP-N140 : masque dans les journaux et chiffrement au repos (au plan, faute d'accès du processus public au service de
clés : clé de configuration dans l'API, aux trois emplacements de l'IBAN) ; au plan aussi : `refund_deposit(uuid, uuid)`
gardée interne et exécutable par personne, `EXECUTE` étroit du compteur App Attest accordé à l'API ;
OP-N116 : grand livre rendu par l'inscription, argument manuel refusé, aucune lecture nouvelle pour
`cashless_edgeadmin`. Résumé d'intention confirmé le même jour.
