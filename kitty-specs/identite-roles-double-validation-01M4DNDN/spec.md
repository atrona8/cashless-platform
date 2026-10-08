# Mission Specification: Identité, rôles et double validation

**Mission Branch**: `feat/identite-roles`
**Created**: 2026-10-08
**Status**: Draft
**Input**: User description: "Identité des personnes, rôles et double validation (SPECIFICATION §3.2, §10.3, §13.3, §14.2 S1 et S3, ADR-74) : utilisateurs et rôles par portée, journal d'audit en ajout seul, authentification par jeton court et jeton de rafraîchissement, prestataire déduit de l'identité, jeton d'approbation sur place (`X-Approval-Token`), demande puis approbation au back-office (`/approval-requests`), mécanisme d'exécution générique des actions approuvées, garde imposant la transaction idempotente aux routes d'écriture (RISK-2 de la revue de la mission 1)."

**Sources normatives** : `docs/SPECIFICATION.md` (§3.1, §3.2, §10.1-10.3, §13.1, §13.3, §14.2 S1 et S3), `docs/DECISIONS_ADR.md` (ADR-74), `packages/contracts/openapi.yaml` (description générale « Double validation », `humanBearer`, `/approval-requests`, `ApprovalAction`, `ApprovalRequest`, `ProblemCode`), `packages/ledger-sql/schema_grand_livre_cashless.sql` (`approval_request`, `decide_approval_request`, `CL023`, contraintes « deux personnes distinctes »). Règle de priorité : SPECIFICATION §0.3. Toute contradiction constatée est signalée, jamais tranchée en silence.

**Dépend de** : mission `fondations-grand-livre-01M4AY8M` (mergée sur `feat/fondations-grand-livre`) — transaction cloisonnée par prestataire, idempotence applicative, erreurs normalisées, port de contexte de prestataire (aujourd'hui en refus systématique), moteur d'écritures.

## Contexte

Depuis la mission 1, l'API refuse toute requête faute d'identité : le prestataire de chaque transaction ne peut venir que d'une personne (ou d'un terminal) authentifiée, et aucune n'existe encore. Cette mission donne une identité aux **personnes** (back-office et guichet), leurs **rôles** sur une **portée** (plateforme, prestataire, organisateur, événement, commerçant), un **journal d'audit** en ajout seul, et les deux formes de **double validation** exigées par ADR-74 : le jeton d'approbation sur place au guichet, et la demande puis approbation au back-office.

Les actions qui passent par la double validation (versements, écritures manuelles, levée d'un trou de séquence, réclamations tardives, etc.) appartiennent aux missions suivantes. Cette mission livre le mécanisme générique sur lequel chacune branchera son action, et le prouve par une action de démonstration présente uniquement dans les tests.

Hors périmètre : terminaux et vendeurs (S2, S5 : mission « Terminaux »), festivaliers et code à usage unique (S17, `/customer-auth` : mission « App festivalier »), choix du produit de serveur d'identité en production.

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Personne / utilisateur | Être humain qui se connecte au back-office ou au guichet (`app_user`) | « compte » (réservé aux comptes du grand livre), « client » |
| Serveur d'identité | Service OIDC externe qui authentifie les personnes et délivre leurs jetons | « SSO », « auth » seul |
| Jeton d'accès | Jeton court (JWT) qui prouve l'identité d'une personne à chaque requête | « session » côté API (l'API ne garde pas de session) |
| Rôle | Ensemble de droits de §3.2 (`PLATFORM_ADMIN` … `CUSTOMER`) | « profil », « groupe » |
| Portée | Périmètre sur lequel un rôle s'exerce : plateforme, prestataire, organisateur, événement, commerçant | « scope » dans les textes visibles |
| Attribution de rôle | Lien entre une personne, un rôle et une portée (`role_assignment`) | « permission » |
| Auteur / valideur | Personne qui lance une action à deux / seconde personne, distincte, qui la valide | « approbateur » et « approver » mélangés |
| Jeton d'approbation | Preuve à usage unique, liée à une action précise, de la validation sur place par la seconde personne (`X-Approval-Token`) | « code de validation » |
| Demande d'approbation | Action à deux figée en attente de la seconde personne au back-office (`approval_request`) | « ticket », « workflow » |
| Journal d'audit | Trace en ajout seul de toute action d'administration et de toute action à deux (`audit_log`) | « logs » (journaux techniques, autre chose) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Une personne connectée agit dans son seul prestataire (Priority: P1)

Une personne se connecte auprès du serveur d'identité et appelle l'API avec son jeton d'accès. L'API la reconnaît, détermine son prestataire et ses rôles à partir des données de la plateforme, et n'expose que les données de ce prestataire.

**Why this priority**: Sans identité, aucune route de l'API ne peut servir ; c'est la condition de toutes les missions suivantes.

**Independent Test**: Deux personnes de deux prestataires appellent la même route de lecture : chacune ne voit que les objets de son prestataire ; un jeton expiré, mal signé, d'un autre émetteur ou d'une personne désactivée est refusé `401`.

**Acceptance Scenarios**:

1. **Given** une personne active rattachée au prestataire A, **When** elle appelle l'API avec un jeton d'accès valide, **Then** la requête s'exécute dans le seul périmètre de A.
2. **Given** un jeton expiré, à la signature invalide, d'un émetteur ou d'une audience non attendus, **When** il est présenté, **Then** la réponse est `401 UNAUTHENTICATED` et rien n'est exécuté.
3. **Given** un jeton valide dont le sujet ne correspond à aucune personne active, **When** il est présenté, **Then** la réponse est `401 UNAUTHENTICATED`.
4. **Given** un jeton qui annonce un prestataire différent de celui de la personne, **When** il est présenté, **Then** la réponse est `401 UNAUTHENTICATED` (le prestataire vient toujours de la personne, jamais du jeton ni de la requête).
5. **Given** un rôle retiré à une personne, **When** elle rappelle avec un jeton encore valide, **Then** le droit correspondant lui est refusé dès la requête suivante.

---

### User Story 2 - Un administrateur gère les personnes et leurs rôles, tout est tracé (Priority: P1)

Un administrateur (plateforme ou prestataire) crée une personne, lui attribue un rôle sur une portée, le lui retire, ou désactive la personne. Chaque action est inscrite au journal d'audit avec l'auteur, l'objet, les valeurs avant et après, la date et l'origine.

**Why this priority**: Sans attribution de rôles, personne ne peut rien faire ; sans journal, aucune action d'administration n'est contrôlable (§13.3).

**Independent Test**: Un `OPERATOR_ADMIN` attribue `ORGANIZER_ADMIN` sur un organisateur de son prestataire : l'attribution existe et une ligne d'audit la décrit ; la même tentative sur un organisateur d'un autre prestataire est refusée ; aucune ligne du journal ne peut être modifiée ni supprimée.

**Acceptance Scenarios**:

1. **Given** le tout premier administrateur de la plateforme, **When** l'exploitant lance la commande d'amorçage, **Then** une personne `PLATFORM_ADMIN` existe et l'amorçage est journalisé ; relancée, la commande ne crée pas de doublon.
2. **Given** un `OPERATOR_ADMIN` du prestataire A, **When** il attribue un rôle sur une portée de A, **Then** l'attribution est créée et journalisée (auteur, rôle, portée, avant = rien, après = attribution).
3. **Given** le même administrateur, **When** il vise une portée du prestataire B, ou un rôle qu'il n'a pas le droit de donner, **Then** la réponse est `403 FORBIDDEN` et rien n'est écrit.
4. **Given** une attribution existante, **When** elle est retirée, **Then** elle cesse de valoir immédiatement et le retrait est journalisé.
5. **Given** une ligne du journal d'audit, **When** quiconque tente de la modifier ou de la supprimer par la connexion de l'application, **Then** la base le refuse.

---

### User Story 3 - Une action sensible au back-office attend une seconde personne (Priority: P1)

Une personne lance au back-office une action qui exige deux personnes. L'action n'est pas exécutée : une demande figée est créée et la réponse est `202 Accepted`. Une seconde personne, connectée avec sa propre session et le rôle exigé sur la même portée, l'approuve (l'action est exécutée une seule fois, avec les paramètres figés) ou la refuse avec une note.

**Why this priority**: C'est la seule façon conforme (ADR-74) de faire valider une action à deux au back-office ; toutes les actions sensibles des missions suivantes en dépendent.

**Independent Test**: Avec l'action de démonstration des tests : l'auteur crée une demande (`202`, `PENDING`) ; l'auteur lui-même ne peut pas l'approuver (`409 APPROVAL_INVALID`) ; une seconde personne au bon rôle l'approuve : l'action s'exécute une fois, la demande passe `EXECUTED` et le journal contient auteur et valideur.

**Acceptance Scenarios**:

1. **Given** une opération branchée sur la double validation, **When** l'auteur l'appelle, **Then** la réponse est `202 Accepted` avec une demande `PENDING` dont les paramètres sont figés, et rien d'autre n'est exécuté.
2. **Given** une demande `PENDING`, **When** une seconde personne avec le rôle exigé sur la même portée l'approuve, **Then** l'action s'exécute une seule fois avec l'auteur `requested_by` et le valideur = le sujet de la session de la seconde personne, et la demande passe `EXECUTED` (avec son résultat) ou `FAILED` (avec le code et la raison) ; la réponse est `200` dans les deux cas.
3. **Given** une demande, **When** son auteur tente de la décider, ou qu'elle est expirée ou déjà décidée, **Then** la réponse est `409 APPROVAL_INVALID` et rien n'est exécuté ; une demande expirée est présentée `EXPIRED`.
4. **Given** une seconde personne sans le rôle exigé, ou avec ce rôle sur une autre portée, **When** elle tente de décider, **Then** la réponse est `403 FORBIDDEN`.
5. **Given** un refus, **When** la note est absente, **Then** la réponse est `400` ; avec une note, la demande passe `REJECTED` et rien n'est exécuté.
6. **Given** une approbation déjà rendue, **When** la même requête est rejouée avec la même clé d'idempotence, **Then** la même réponse est renvoyée et l'action n'est pas exécutée une seconde fois.
7. **Given** un corps de requête contenant un champ `approved_by`, **When** il est reçu, **Then** il est ignoré : le valideur ne vient que de l'authentification.
8. **Given** des demandes de plusieurs prestataires, **When** une personne liste ou consulte les demandes, **Then** elle ne voit que celles de son prestataire, et seulement celles des actions qu'elle peut lancer ou approuver.

---

### User Story 4 - Au guichet, la seconde personne valide sur place (Priority: P2)

Au guichet, une opération sensible (rendu d'espèces au-delà du plafond, par exemple) exige la validation immédiate d'une seconde personne présente. Celle-ci s'authentifie sur le même terminal auprès du serveur d'identité, qui délivre un jeton d'approbation de 5 minutes, à usage unique, lié à cette requête précise ; le terminal le joint à la requête.

**Why this priority**: Exigé par ADR-74 pour les remboursements en espèces des missions bracelets et recharges ; la vérification doit exister avant que ces opérations n'arrivent.

**Independent Test**: Sur une route de démonstration des tests marquée « jeton d'approbation exigé » : sans jeton `403 APPROVAL_REQUIRED` ; avec un jeton valide de la seconde personne, l'opération passe et le valideur transmis est le sujet du jeton ; le même jeton présenté une seconde fois, ou modifié, ou pour une autre requête, ou émis pour l'appelant lui-même, est refusé `403 APPROVAL_INVALID`.

**Acceptance Scenarios**:

1. **Given** une opération qui exige la validation sur place, **When** la requête arrive sans `X-Approval-Token`, **Then** la réponse est `403 APPROVAL_REQUIRED`.
2. **Given** un jeton valide : signé par le serveur d'identité, non expiré, jamais utilisé, `act` = l'opération appelée, `act_hash` = l'empreinte de la requête canonique (méthode, chemin, corps JCS sans le jeton), `sub` ≠ l'appelant, sujet ayant le rôle exigé sur la même portée, **When** il est présenté, **Then** l'opération s'exécute avec ce sujet comme valideur.
3. **Given** un jeton expiré, déjà utilisé, mal signé, d'une autre opération, d'une autre requête (corps différent), émis pour l'appelant, ou dont le sujet n'a pas le rôle exigé, **When** il est présenté, **Then** la réponse est `403 APPROVAL_INVALID` et le jeton n'est pas consommé s'il n'était pas valide.
4. **Given** deux requêtes simultanées avec le même jeton valide, **When** elles arrivent, **Then** une seule l'utilise ; l'autre reçoit `403 APPROVAL_INVALID`.

---

### User Story 5 - Les routes d'écriture enregistrent leur réponse avec leur travail (Priority: P2)

Toute route d'écriture idempotente enregistre sa réponse dans la même transaction que son travail métier, afin qu'une panne entre les deux ne puisse pas rejouer un travail déjà fait.

**Why this priority**: Constat RISK-2 de la revue de la mission 1 ; cette mission publie les premières routes d'écriture.

**Independent Test**: Une route idempotente qui écrit sans passer par la transaction idempotente fait échouer un test automatique avant toute mise en production.

**Acceptance Scenarios**:

1. **Given** une route marquée idempotente qui écrit hors de la transaction idempotente, **When** les tests tournent, **Then** un test échoue en nommant la route.
2. **Given** les routes d'écriture de cette mission, **When** les tests tournent, **Then** toutes passent par la transaction idempotente.

---

### Edge Cases

- Personne désactivée pendant que son jeton est encore valide : refus `401` dès la requête suivante.
- Personne qui a plusieurs rôles sur des portées différentes : chaque contrôle porte sur la portée de l'objet visé.
- `PLATFORM_ADMIN` : rattaché à la plateforme, il n'est lié à aucun prestataire ; pour agir dans les données d'un prestataire, la portée de la requête doit désigner ce prestataire (jamais par un paramètre libre : par l'objet visé, contrôlé).
- Retrait du dernier `PLATFORM_ADMIN` : refusé (la plateforme ne peut pas perdre tout administrateur).
- Une personne ne peut ni s'attribuer un rôle ni augmenter ses propres droits.
- Demande d'approbation dont l'action n'est branchée par aucune mission : création refusée `VALIDATION_FAILED`.
- Exécution d'une action approuvée qui échoue (règle métier, base) : la demande passe `FAILED` avec le code stable ; elle ne se rejoue pas.
- Approbation reçue au moment exact de l'expiration : la base tranche (`CL023`).
- Jeton d'approbation dont l'horloge du terminal diffère : seule l'horloge du serveur compte (tolérance d'horloge de quelques secondes).
- Serveur d'identité injoignable pour récupérer ses clés publiques : refus `503 SERVICE_UNAVAILABLE`, jamais d'acceptation sans vérification.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status |
|----|-------|------------|----------|--------|
| FR-001 | Personnes et attributions de rôles | En tant que plateforme, je veux une table des personnes (identifiant du serveur d'identité, e-mail ou téléphone, statut, prestataire de rattachement ou plateforme) et une table des attributions (personne, rôle de §3.2, portée plateforme / prestataire / organisateur / événement / commerçant, objet de la portée, auteur, dates), créées par migration, sous RLS forcée avec `operator_id`, testées par pgTAP contrainte par contrainte, afin que chaque droit soit vérifiable par la base. | High | Open |
| FR-002 | Journal d'audit en ajout seul | En tant que contrôleur, je veux un journal d'audit (acteur, rôle exercé, action, objet, valeurs avant et après, valeur, valideur, date, origine : adresse IP ou terminal, identifiant de requête) en ajout seul — ni modification ni suppression possibles pour la connexion de l'application — sous RLS forcée, testé par pgTAP. | High | Open |
| FR-003 | Authentification par jeton d'accès | En tant que personne, je veux que chaque requête soit authentifiée par un jeton d'accès court émis par le serveur d'identité (signature vérifiée par ses clés publiques, émetteur, audience, expiration, tolérance d'horloge bornée) ; la connexion et le renouvellement par jeton de rafraîchissement restent chez le serveur d'identité ; tout défaut donne `401 UNAUTHENTICATED`. | High | Open |
| FR-004 | Prestataire et rôles déduits de la personne | En tant que plateforme, je veux que le sujet du jeton désigne une personne active, que le prestataire de la transaction et les rôles viennent de la plateforme (personne et attributions), jamais d'un paramètre de requête ni des rôles annoncés par le jeton ; un prestataire annoncé par le jeton différent de celui de la personne est refusé `401`. Le fournisseur de contexte de prestataire de la mission 1 est remplacé par cette identité. | High | Open |
| FR-005 | Contrôle des rôles par portée | En tant que plateforme, je veux déclarer pour chaque route le ou les rôles exigés et la portée de l'objet visé, et refuser `403 FORBIDDEN` toute personne sans un de ces rôles sur cette portée ou une portée englobante (prestataire ⊃ organisateur ⊃ événement ; commerçant rattaché à l'événement). | High | Open |
| FR-006 | Gestion des personnes et des rôles | En tant qu'administrateur, je veux créer, lister, consulter et désactiver des personnes, et attribuer ou retirer un rôle sur une portée, par des routes ajoutées au contrat (`openapi.yaml`) ; qui peut donner quel rôle suit la hiérarchie de §3.1 (plateforme → prestataire → organisateur → événement / commerçant) ; personne ne s'attribue de rôle ni n'augmente ses propres droits ; le dernier `PLATFORM_ADMIN` ne peut pas être retiré. | High | Open |
| FR-007 | Amorçage du premier administrateur | En tant qu'exploitant, je veux une commande d'exploitation, idempotente et journalisée, qui crée le premier `PLATFORM_ADMIN` à partir de son identifiant chez le serveur d'identité. | High | Open |
| FR-008 | Journalisation des actions | En tant que contrôleur, je veux que toute action d'administration (personnes, rôles, amorçage) et toute étape d'une action à deux (création de demande, approbation, refus, exécution, échec, utilisation d'un jeton d'approbation) écrive une ligne d'audit dans la même transaction que l'action. | High | Open |
| FR-009 | Demande d'approbation générique | En tant que mission suivante, je veux brancher une action à deux en déclarant son nom (`ApprovalAction`), le rôle exigé de l'auteur et du valideur, la portée, et la fonction qui l'exécute avec des paramètres figés ; l'appel de l'opération par l'auteur crée la demande (`approval_request`, expiration 24 h) et répond `202 Accepted` avec la demande `PENDING`, sans rien exécuter. | High | Open |
| FR-010 | Routes des demandes d'approbation | En tant que personne du back-office, je veux `listApprovalRequests` (filtres statut et action, pagination par curseur, demandes de mon prestataire et des actions que je peux lancer ou approuver ; `PENDING` échue présentée `EXPIRED`), `getApprovalRequest`, `approveApprovalRequest` et `rejectApprovalRequest` conformes au contrat. | High | Open |
| FR-011 | Approbation et exécution unique | En tant que valideur, je veux que l'approbation vérifie mon rôle sur la même portée (`403` sinon), appelle `decide_approval_request` avec le sujet de MA session (`409 APPROVAL_INVALID` sur `CL023`), puis exécute l'action une seule fois avec les paramètres figés, l'auteur et le valideur, et fasse passer la demande `EXECUTED` (résultat, transaction éventuelle) ou `FAILED` (code stable, raison) ; réponse `200` dans les deux cas ; un rejeu avec la même clé d'idempotence renvoie la même réponse. | High | Open |
| FR-012 | Refus d'une demande | En tant que valideur, je veux refuser une demande avec une note obligatoire (`400` sans note) ; la demande passe `REJECTED` et rien n'est exécuté ; `409 APPROVAL_INVALID` si la demande n'est plus décidable. | High | Open |
| FR-013 | Valideur jamais pris dans la requête | En tant que plateforme, je veux qu'un champ `approved_by` (ou tout champ désignant un valideur) reçu dans un corps de requête soit ignoré ; le valideur vient seulement de la session de la seconde personne ou du sujet d'un jeton d'approbation. | High | Open |
| FR-014 | Vérification du jeton d'approbation sur place | En tant que plateforme, je veux une garde réutilisable, déclarée par opération (nom de l'opération, rôle exigé du valideur), qui exige `X-Approval-Token` (`403 APPROVAL_REQUIRED` sinon) et vérifie signature, expiration, `act` = opération, `act_hash` = SHA-256 de la requête canonique (méthode, chemin, corps JCS, sans le jeton), `sub` ≠ appelant, rôle du sujet sur la même portée et usage unique du `jti` (mémorisé jusqu'à l'expiration, consommé atomiquement) ; tout défaut donne `403 APPROVAL_INVALID` ; le valideur transmis à la base est le `sub`. | High | Open |
| FR-015 | Garde de la transaction idempotente | En tant qu'équipe, je veux qu'une route d'écriture marquée idempotente qui écrit hors de la transaction idempotente soit détectée par un test automatique (RISK-2 de la revue de la mission 1). | Medium | Open |
| FR-016 | Faux serveur d'identité de test | En tant qu'équipe, je veux un faux serveur d'identité de test (clés publiques publiées, jetons d'accès et d'approbation signés à la demande, jetons volontairement défectueux) afin de tester toutes les règles sans dépendre d'un service externe. | High | Open |
| FR-017 | Signalement des contradictions | En tant qu'équipe, je veux que toute contradiction constatée entre sources normatives soit consignée avec la règle de priorité appliquée, jamais tranchée en silence. | Medium | Open |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Isolation | 0 personne, attribution, ligne d'audit ou demande d'un autre prestataire lisible ou modifiable via la connexion de l'application ; vérifié par un test à deux prestataires sur chaque nouvelle route et par pgTAP sur chaque nouvelle table. | Security | High | Open |
| NFR-002 | Couverture des refus d'authentification | 100 % des cas de refus listés (jeton expiré, signature, émetteur, audience, sujet inconnu, personne désactivée, prestataire annoncé différent) couverts par un test qui attend `401`. | Security | High | Open |
| NFR-003 | Couverture du jeton d'approbation | 100 % des conditions de FR-014 couvertes par un test, dont l'usage concurrent du même jeton (exactement 1 succès sur 2 requêtes simultanées). | Security | High | Open |
| NFR-004 | Journal sans trou | 100 % des actions d'administration et des étapes d'action à deux exercées par les tests ont exactement une ligne d'audit correspondante ; 0 ligne d'audit modifiable ou supprimable par la connexion de l'application. | Security | High | Open |
| NFR-005 | Coût de l'authentification | La vérification d'un jeton d'accès ajoute au plus 5 ms au p95 d'une requête, clés publiques en cache (aucun appel au serveur d'identité par requête). | Performance | Medium | Open |
| NFR-006 | Non-régression | 100 % des tests de la mission 1 (505 assertions pgTAP, tests unitaires et d'intégration, rejeu du scénario) restent verts. | Reliability | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Valideur jamais auto-déclaré | Aucun chemin ne prend le valideur dans le corps ou les paramètres d'une requête (ADR-74). | Security | High | Open |
| C-002 | Contraintes de la base intactes | Les contraintes existantes « valideur ≠ auteur » de la base (`journal_transaction`, `payout`, `device_seq_registry`, `debit_authority_handover`, `approval_request`) ne sont ni affaiblies ni contournées. | Security | High | Open |
| C-003 | Migrations et pgTAP | Les nouvelles tables sont créées par migration, avec RLS forcée, `operator_id` et des tests pgTAP par contrainte (§14.2) ; les `.sql` générés ne sont jamais modifiés à la main. | Technical | High | Open |
| C-004 | Serveur d'identité standard | Le serveur d'identité est un service OIDC standard derrière une interface ; aucun produit n'est imposé par cette mission ; les tests n'appellent aucun service externe. | Technical | High | Open |
| C-005 | Pas de mots de passe dans l'API | L'API ne stocke ni ne vérifie aucun mot de passe ni code personnel de personne ; la connexion, l'authentification renforcée et le jeton de rafraîchissement relèvent du serveur d'identité. | Security | High | Open |
| C-006 | Contrat | Les routes ajoutées (gestion des personnes et des rôles) sont décrites dans `openapi.yaml` en suivant ses conventions ; les types générés sont régénérés ; aucune route `x-release: V2`. | Technical | High | Open |
| C-007 | Hors périmètre | Terminaux, vendeurs et codes PIN (S2, S5), festivaliers et code à usage unique (S17, `/customer-auth`), actions métier à deux des missions suivantes : non livrés ici. | Business | High | Open |
| C-008 | Fonctions internes | Aucune fonction interne de §13.1 n'est rendue exécutable au rôle applicatif. | Security | High | Open |

### Key Entities

- **Personne (`app_user`)** : identifiant chez le serveur d'identité (unique par émetteur), e-mail ou téléphone, statut (actif, désactivé), prestataire de rattachement (aucun pour la plateforme), dates.
- **Attribution de rôle (`role_assignment`)** : personne, rôle de §3.2, type de portée et objet de la portée (prestataire, organisateur, événement ou commerçant), auteur, date d'attribution, date de retrait.
- **Ligne d'audit (`audit_log`)** : acteur, rôle exercé, action, type et identifiant de l'objet, valeurs avant et après, valideur, date, origine (adresse IP ou terminal), identifiant de requête ; ajout seul.
- **Demande d'approbation (`approval_request`, existante)** : action, objet visé, paramètres figés, auteur, expiration, statut, valideur, note, résultat ou échec.
- **Utilisation d'un jeton d'approbation** : identifiant unique du jeton (`jti`), opération, sujet, date d'expiration ; mémorisée jusqu'à l'expiration pour garantir l'usage unique.
- **Action à deux enregistrée** : nom (`ApprovalAction`), rôle exigé, portée, exécution ; déclarée par chaque mission qui la branche (pas une table).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % des requêtes sans identité valide sont refusées, et 0 requête ne s'exécute dans un autre prestataire que celui de la personne authentifiée, sur l'ensemble des tests à deux prestataires.
- **SC-002**: Une action à deux de démonstration va de la demande à l'exécution en exactement 2 interventions de 2 personnes distinctes, et 0 exécution n'a lieu par une seule personne, quel que soit le chemin tenté (auteur qui approuve, valideur pris dans le corps, jeton réutilisé).
- **SC-003**: 100 % des actions d'administration et des étapes d'action à deux laissent une trace d'audit complète (qui, quoi, avant, après, valideur, quand, d'où).
- **SC-004**: Un administrateur peut donner à une personne un rôle sur un organisateur en une seule action, effective dès la requête suivante de la personne.
- **SC-005**: Les missions suivantes peuvent brancher une nouvelle action à deux sans modifier le mécanisme générique (démontré par l'action de démonstration des tests).

## Assumptions

- Le serveur d'identité de production (produit, hébergement, authentification renforcée pour la validation sur place) sera choisi plus tard ; il publiera ses clés publiques selon le standard OIDC et ses jetons porteront `sub` (et éventuellement `operator_id`, vérifié mais non cru).
- Les personnes sont créées dans la plateforme par un administrateur à partir de leur identifiant chez le serveur d'identité ; l'inscription en libre-service n'existe pas pour le personnel.
- Le rôle `CUSTOMER` existe dans la liste des rôles mais les festivaliers s'authentifient par le flux de l'app festivalier (mission dédiée) ; cette mission ne crée aucun festivalier.
- `PLATFORM_ADMIN` n'appartient à aucun prestataire ; ses actions dans un prestataire passent par un objet de ce prestataire, jamais par un paramètre libre.
- L'action de démonstration et la route de démonstration du jeton d'approbation n'existent que dans les tests et ne sont pas publiées.

## Decisions

Décisions de cadrage prises par l'agent sur délégation du porteur du projet (2026-10-08), consignées en Decision Moments :

| Sujet | Décision |
|---|---|
| Serveur d'identité | OIDC standard derrière une interface, faux fournisseur en test, produit choisi plus tard |
| Source des rôles et du prestataire | La plateforme (personne + attributions), le jeton ne prouve que l'identité |
| Gestion des personnes et des rôles | Routes minimales ajoutées au contrat, journalisées, plus une commande d'amorçage |
| Actions d'approbation | Aucune action métier ; mécanisme générique et 4 routes `/approval-requests` ; action de démonstration en test |
| Jeton d'approbation sur place | Vérification complète côté API, garde réutilisable ; émission par le serveur d'identité |
