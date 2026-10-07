# Mission Specification: Fondations du grand livre et de l'API

**Mission Branch**: `feat/fondations-grand-livre`
**Created**: 2026-10-07
**Status**: Draft
**Input**: User description: "Fondations du système cashless (SPECIFICATION §2, §5, §10.1-10.2, §13.1, §14.2 S21, §16 critères 1 à 3) : monorepo, CI pgTAP, outillage local, migrations de `packages/ledger-sql`, squelette de l'API (isolation par prestataire, erreurs normalisées, idempotence, traçabilité, langue), moteur d'écritures (un constructeur par type, calculs entiers, 19 cas normatifs, types acceptés selon le statut de l'événement), rejeu du scénario de référence, types générés depuis le contrat."

**Sources normatives** : `docs/SPECIFICATION.md` (§2, §5, §10.1-10.2, §12.1, §13.1, §14.2 S21, §16), `packages/ledger-sql/*` (schéma, rôles, suites pgTAP, scénario, moteur de référence), `packages/contracts/openapi.yaml`. Règle de priorité : SPECIFICATION §0.3 (tests exécutables > schéma / contrat / protocole > SPECIFICATION > PRD). Toute contradiction constatée est signalée, jamais tranchée en silence.

## Contexte

Toutes les missions suivantes (identité, configuration, bracelets, terminaux, recharges) écrivent dans un grand livre en partie double. Cette mission livre ce socle et la preuve qu'il est juste : la base de référence et ses 464 assertions tournent partout (CI et poste local), l'API applique dès le premier jour les garanties transverses que chaque route héritera, et le moteur d'écritures reproduit au centime près le scénario de référence d'un festival complet, jusqu'à la clôture et au verrouillage.

Cette mission ne publie **aucune route métier** : l'API n'expose qu'une route de santé. Les garanties transverses sont prouvées par des tests d'intégration sur une route de test non publiée, absente du contrat.

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Grand livre | Comptabilité en partie double d'un pool de fonds, une seule devise | « compte », « registre » pour désigner le grand livre entier |
| Prestataire (`operator`) | Locataire (tenant) qui exploite la plateforme pour des organisateurs ; unité d'isolation des données | « client », « tenant » dans les textes visibles |
| Constructeur | Composant du moteur qui transforme une commande métier d'un type donné en lignes d'écriture, puis demande l'écriture | « handler », « service d'écriture » |
| Écriture / transaction | Une entrée du journal (`journal_transaction`) et ses lignes (`posting`), équilibrée | « opération » (réservé aux opérations d'un lot hors ligne) |
| Clé d'idempotence | Identifiant fourni par l'appelant qui garantit qu'une écriture n'a lieu qu'une fois | « request id » (c'est `X-Request-Id`, autre chose) |
| Unités mineures | Montant entier selon l'exposant ISO 4217 de la devise (XOF 0, EUR 2) | « centimes » pour une devise sans décimale |
| Code d'erreur stable (`ProblemCode`) | Code métier d'une réponse d'erreur, jamais renommé | « message d'erreur » |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - La base de référence est vérifiée partout (Priority: P1)

Un développeur (ou un agent de mission) récupère le dépôt, installe l'outillage par un script fourni, crée la base de test à partir des migrations et lance les deux suites pgTAP ; la même chose se produit automatiquement en CI à chaque commit.

**Why this priority**: Sans ce filet, aucune modification du schéma par les missions suivantes ne peut être vérifiée ; c'est le critère d'acceptation n° 1 de la V1.

**Independent Test**: Sur un poste Windows 10 avec PostgreSQL 17 sans pgTAP et sans Docker, exécuter le script d'outillage puis la commande de test : 400 + 64 assertions passent. Pousser un commit : la CI fait de même sous PostgreSQL 17.

**Acceptance Scenarios**:

1. **Given** un poste avec PostgreSQL 17 Windows sans pgTAP, **When** le développeur lance le script d'outillage du dépôt puis la commande de test, **Then** les 400 assertions de `tests_grand_livre_cashless.sql` et les 64 de `scenario_reference_test.sql` passent, sans droits administrateur sur le dossier d'installation de PostgreSQL.
2. **Given** une base créée par les migrations du dépôt (et non par le fichier de schéma brut), **When** les deux suites tournent, **Then** elles passent à l'identique.
3. **Given** un commit poussé, **When** la CI s'exécute, **Then** elle charge les migrations et `roles.sql` sous PostgreSQL 17 et échoue si une seule assertion échoue.
4. **Given** une modification à la main d'un fichier `.sql` généré, **When** la CI s'exécute, **Then** elle échoue en signalant l'écart avec la sortie des générateurs.

---

### User Story 2 - Le moteur d'écritures calcule exactement comme la référence (Priority: P1)

L'équipe dispose d'un moteur d'écritures avec un constructeur pour chacun des 26 types de transaction de la liste fermée ; chaque calcul (arrondi, frais, taxe extraite, partage, répartition offerts/payés) donne exactement le résultat du moteur de référence.

**Why this priority**: Une erreur d'une unité dans un frais se propage dans tous les versements ; c'est le critère d'acceptation n° 2.

**Independent Test**: Lancer les tests unitaires du moteur : les 19 cas normatifs de §5.5 passent avec les mêmes entrées et sorties que `moteur_ecritures_reference.py`, et chaque constructeur produit les lignes attendues pour son type.

**Acceptance Scenarios**:

1. **Given** une vente de 6 000 XOF, commission 12 % TTC, taxe 18 %, **When** le constructeur `PURCHASE` construit l'écriture, **Then** il produit cinq lignes : portefeuille +6 000, commerçant −6 000 et +720, commission −610, taxe −110.
2. **Given** une vente en ligne de 7 000 avec 5 400 disponibles, **When** l'écriture est demandée, **Then** elle est refusée `INSUFFICIENT_FUNDS` et rien n'est écrit.
3. **Given** un événement au statut `DRAFT`, **When** une commande `PURCHASE` arrive, **Then** le moteur la refuse `VALIDATION_FAILED` avant toute demande d'écriture à la base.
4. **Given** une commande d'un type que la base construit elle-même (`DEPOSIT_TAKEN`, `DEPOSIT_REFUNDED`, `DEPOSIT_FORFEITED`, `WALLET_REFUND` des espèces dues, `PROMO_CREDIT` de préchargement), **When** le moteur la traite, **Then** il délègue à la fonction de la base correspondante et ne construit aucune ligne lui-même.

---

### User Story 3 - Le festival de référence se rejoue au centime près (Priority: P1)

Un test d'intégration rejoue les 48 transactions de `scenario_reference.json` par les constructeurs du moteur, à travers la connexion applicative, en faisant passer l'événement par ses statuts jusqu'à `CLOSED` et le grand livre jusqu'à `LOCKED`.

**Why this priority**: C'est la preuve de bout en bout que le moteur, la base et l'isolation fonctionnent ensemble ; critère d'acceptation n° 3.

**Independent Test**: Lancer le test d'intégration sur une base fraîche : soldes exacts après la transaction 23 et en fin de clôture ; relancer le rejeu : zéro nouvelle transaction.

**Acceptance Scenarios**:

1. **Given** une base fraîche et la fixture du scénario (parties, événement, grand livre, comptes), **When** les transactions 1 à 23 sont rejouées par les constructeurs, **Then** chaque compte a exactement le solde attendu « fin de festival ».
2. **Given** le rejeu complet des 48 transactions et les passages de statut dans l'ordre de clôture de référence, **When** le test compare les soldes, **Then** chaque compte a exactement le solde attendu « fin de clôture », l'événement est `CLOSED` et le grand livre `LOCKED`.
3. **Given** un scénario déjà rejoué, **When** il est rejoué une seconde fois avec les mêmes clés, **Then** aucune transaction n'est créée et chaque écriture renvoie la transaction existante.

---

### User Story 4 - Chaque requête hérite des garanties transverses (Priority: P2)

Toute route que les missions suivantes ajouteront hérite automatiquement : isolation par prestataire, erreurs normalisées, idempotence, identifiant de requête et langue des messages.

**Why this priority**: Ces garanties sont exigées par toutes les routes du contrat ; les poser une fois évite cinq réimplémentations divergentes.

**Independent Test**: Tests d'intégration sur une route de test non publiée qui écrit dans une table métier : chaque garantie est vérifiée par un scénario dédié.

**Acceptance Scenarios**:

1. **Given** une requête qui écrit sans en-tête `Idempotency-Key`, **When** elle est reçue, **Then** la réponse est `IDEMPOTENCY_KEY_REQUIRED` en problem+json.
2. **Given** une requête déjà traitée avec la même clé et le même contenu, **When** elle est rejouée, **Then** la réponse d'origine est renvoyée avec `Idempotency-Replayed: true` et rien n'est réécrit.
3. **Given** une clé déjà utilisée avec un contenu différent, **When** la requête arrive, **Then** la réponse est `409 IDEMPOTENCY_KEY_REUSED`.
4. **Given** deux requêtes simultanées avec la même clé, **When** la seconde arrive pendant le traitement de la première, **Then** elle reçoit `409 IDEMPOTENCY_KEY_IN_PROGRESS`.
5. **Given** un refus de la base avec un SQLSTATE connu (par exemple `CL007`), **When** l'API répond, **Then** la réponse porte le `ProblemCode` correspondant (`INSUFFICIENT_FUNDS`) et ne contient aucun fragment du message SQL.
6. **Given** une requête sans `X-Request-Id`, **When** l'API répond, **Then** la réponse porte un `X-Request-Id` généré (UUID) ; avec un `X-Request-Id` fourni, le même est renvoyé.
7. **Given** `Accept-Language: en`, **When** une erreur est renvoyée, **Then** `title` et `detail` sont en anglais et `code` est inchangé ; sans en-tête, ils sont en français.
8. **Given** deux prestataires A et B, **When** une requête authentifiée pour A demande un objet de B, **Then** la réponse est identique à celle d'un objet inexistant (`NOT_FOUND`, sans détail).

---

### User Story 5 - Les types partagés viennent du contrat (Priority: P3)

Les développeurs utilisent dans l'API des types TypeScript générés depuis `openapi.yaml` ; une modification du contrat se propage par régénération.

**Why this priority**: Évite la dérive entre contrat et code ; nécessaire dès que les missions suivantes ajoutent des routes.

**Independent Test**: Lancer la génération, puis vérifier en CI que les types générés sont à jour avec le contrat.

**Acceptance Scenarios**:

1. **Given** le contrat `openapi.yaml`, **When** la commande de génération tourne, **Then** les types TypeScript (dont `ProblemCode`) sont produits dans `packages/contracts` et utilisés par l'API.
2. **Given** des types générés modifiés à la main ou périmés, **When** la CI s'exécute, **Then** elle échoue.

### Edge Cases

- Montant d'une moitié exacte négative (−100,5) : arrondi à −101 (la moitié s'éloigne de zéro).
- Taxe à 0 % : aucune ligne de taxe n'est écrite.
- Plusieurs frais vers le même bénéficiaire au même taux dans une transaction : taxe extraite une seule fois sur la somme (cas 2 et 18).
- Vente hors ligne synchronisée au-delà du solde : la part non couverte va en `S-ATTENTE` (cas 14 et 19).
- Grand livre en clôture et vente `ONLINE` : refus `EVENT_CLOSING` par la base, traduit en code stable.
- Grand livre verrouillé : seules les réclamations tardives de back-office passent ; tout le reste répond `LEDGER_LOCKED`.
- SQLSTATE inconnu ou `P0001` générique : réponse `INTERNAL_ERROR` (500) sans texte SQL, et journalisation avec `X-Request-Id`.
- Requête interrompue pendant son traitement : l'entrée d'idempotence `en cours` expire et la clé redevient utilisable ; une écriture au grand livre déjà validée reste protégée par la clé du grand livre.
- Connexion réutilisée par le pool après une requête d'un autre prestataire : le contexte de prestataire ne fuit pas (portée transactionnelle uniquement).

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status |
|----|-------|------------|----------|--------|
| FR-001 | Monorepo imposé | En tant que développeur, je veux l'arborescence de §2.1 gérée en npm workspaces, avec seulement les dossiers utiles à cette mission (`apps/api`, `packages/contracts`, `packages/ledger-sql`, dossiers existants) et aucun élément V2, afin que chaque mission ajoute son module au bon endroit. | High | Open |
| FR-002 | Migrations du grand livre | En tant que développeur, je veux que la base soit créée par des migrations versionnées dont la première reprend le schéma de référence puis `roles.sql`, afin que toute évolution future passe par une migration et garde les tests verts. | High | Open |
| FR-003 | Outillage pgTAP local | En tant que développeur sous Windows sans Docker, je veux un script du dépôt qui rend pgTAP et `pg_prove` utilisables avec le PostgreSQL 17 installé, sans compilation ni droits administrateur, afin de lancer les deux suites sur mon poste. | High | Open |
| FR-004 | Suites pgTAP en CI | En tant qu'équipe, je veux que la CI crée la base par les migrations sous PostgreSQL 17, charge `roles.sql` et exécute les 400 + 64 assertions à chaque commit, en échouant à la moindre assertion rouge. | High | Open |
| FR-005 | Garde des fichiers générés | En tant qu'équipe, je veux que la CI régénère les suites pgTAP par `gen_tests.py` et `gen_golden.py` et échoue si les fichiers `.sql` versionnés diffèrent, afin qu'aucun fichier généré ne soit modifié à la main. | Medium | Open |
| FR-006 | Connexion applicative cloisonnée | En tant que plateforme, je veux que l'API se connecte uniquement avec le rôle `cashless_app` et ouvre chaque transaction SQL par `set_config('app.operator_id', <prestataire authentifié>, true)`, jamais par un `SET` de session, afin que la RLS isole chaque prestataire même avec un pool de connexions. | High | Open |
| FR-007 | Prestataire déduit de l'identité | En tant que plateforme, je veux que le prestataire de la transaction vienne toujours du contexte authentifié et jamais d'un paramètre de requête ; en l'absence d'authentification réelle (mission 2), un fournisseur de contexte remplaçable alimente ce prestataire dans les tests. | High | Open |
| FR-008 | Erreurs normalisées | En tant que client de l'API, je veux que toute erreur soit en `application/problem+json` (RFC 9457) avec un `code` pris dans `ProblemCode`, la traduction se faisant par SQLSTATE selon la table de §5.7 (jamais par le texte du message), et qu'aucun message SQL brut ne soit jamais renvoyé ; un SQLSTATE non prévu donne `INTERNAL_ERROR`. | High | Open |
| FR-009 | Magasin d'idempotence applicatif (S21) | En tant que client de l'API, je veux que toute requête qui écrit exige `Idempotency-Key` (`IDEMPOTENCY_KEY_REQUIRED` sinon), que le serveur enregistre clé, portée (prestataire et préfixe client), empreinte de la requête, statut, réponse et expiration, et réponde : rejeu identique → réponse d'origine + `Idempotency-Replayed: true` ; contenu différent → `409 IDEMPOTENCY_KEY_REUSED` ; requête en cours → `409 IDEMPOTENCY_KEY_IN_PROGRESS`. La table est créée par migration, sous RLS forcée, avec `operator_id` et des tests pgTAP par contrainte. | High | Open |
| FR-010 | Identifiant de requête | En tant qu'exploitant, je veux que chaque réponse porte `X-Request-Id` (celui reçu, sinon un UUID généré) et que chaque ligne de journal de la requête le contienne. | Medium | Open |
| FR-011 | Langue des messages | En tant que client, je veux que `Accept-Language` (`fr`, `en`, défaut `fr`) choisisse la langue de `title` et `detail` des erreurs sans jamais changer `code` ni le statut HTTP. | Medium | Open |
| FR-012 | Route de santé | En tant qu'exploitant, je veux une route de santé qui indique si l'API joint la base ; c'est la seule route publiée par cette mission. | Low | Open |
| FR-013 | Un constructeur par type | En tant que moteur d'écritures, je veux un constructeur pour chacun des 26 types de la liste fermée de §5.3, chacun étant le seul code applicatif qui produit les lignes de son type et le seul appelant de `post_transaction` pour ce type. | High | Open |
| FR-014 | Délégation aux fonctions de la base | En tant que moteur, je veux que les constructeurs de `DEPOSIT_TAKEN`, `DEPOSIT_REFUNDED`, `DEPOSIT_FORFEITED`, `WALLET_REFUND` (espèces dues) et `PROMO_CREDIT` (préchargement) appellent respectivement `take_deposit`, `refund_deposit`, `forfeit_deposit`, `refund_cash_due` et `preload_media`, sans construire de lignes eux-mêmes. | High | Open |
| FR-015 | Ordre de traitement du moteur | En tant que moteur, je veux suivre l'ordre de §5.4 : recevoir la commande (type, clé, `occurred_at`, source, terminal, support, montant, devise), figer la configuration en vigueur à `occurred_at` et enregistrer sa version, lire les soldes seulement si nécessaire, calculer (brut, offerts/payés, frais TTC, taxe extraite, frais PSP), demander l'écriture, rendre l'identifiant de transaction (nouveau ou existant) ou un code d'erreur stable. | High | Open |
| FR-016 | Calculs entiers normatifs | En tant que moteur, je veux tous les montants en entiers d'unités mineures, sans aucun flottant, avec l'arrondi au plus proche (moitié s'éloignant de zéro), un arrondi par frais, la taxe extraite du TTC une fois par transaction et par bénéficiaire, les bornes min/max des frais et la règle de partage de §5.5. | High | Open |
| FR-017 | 19 cas normatifs | En tant qu'équipe, je veux que les 19 cas de §5.5 existent en tests unitaires TypeScript avec exactement les entrées et résultats de `moteur_ecritures_reference.py`. | High | Open |
| FR-018 | Types acceptés selon le statut | En tant que moteur, je veux refuser `VALIDATION_FAILED`, avant tout appel à la base, tout type absent de la colonne « Types acceptés » du statut de l'événement (§12.1), y compris les règles des grands livres `CLOSING` avec soldes restants et `LOCKED` (réclamations tardives seulement), et la règle `wallet_scope = ORGANIZER`. | High | Open |
| FR-019 | Écritures de back-office | En tant que moteur, je veux que les constructeurs des types de source `BACKOFFICE` (`ANOMALY_RESOLUTION`, `ADJUSTMENT`, `BREAKAGE_REVERSAL`, et réclamations tardives) reçoivent un auteur et un valideur distincts en paramètres explicites ; le flux qui fournit le valideur (double validation) n'est pas dans cette mission. | Medium | Open |
| FR-020 | Rejeu du scénario de référence | En tant qu'équipe, je veux un test d'intégration qui, sur une base fraîche, pose la fixture du scénario puis rejoue les 48 transactions par les constructeurs via la connexion applicative, fait passer l'événement par `set_event_status` dans l'ordre de clôture de référence, et vérifie les soldes exacts après la transaction 23 et en fin de clôture, puis `CLOSED` / `LOCKED`. | High | Open |
| FR-021 | Second rejeu sans effet | En tant qu'équipe, je veux qu'un second rejeu complet du scénario ne crée aucune transaction (nombre de lignes de `journal_transaction` et `posting` inchangé). | High | Open |
| FR-022 | Types générés depuis le contrat | En tant que développeur, je veux une commande qui génère les types TypeScript depuis `packages/contracts/openapi.yaml`, utilisés par l'API (dont `ProblemCode`), et une vérification CI qui échoue si les types versionnés ne correspondent pas au contrat. | Medium | Open |
| FR-023 | Tests TypeScript en CI | En tant qu'équipe, je veux que la CI exécute aussi les tests unitaires du moteur et les tests d'intégration de l'API (dont le rejeu) contre une base PostgreSQL 17 créée par les migrations. | High | Open |
| FR-024 | Signalement des contradictions | En tant qu'équipe, je veux que toute contradiction constatée entre sources normatives pendant la mission soit consignée (fichier de la mission ou PR) avec la règle de priorité appliquée, jamais tranchée en silence. | Medium | Open |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Exactitude comptable | 0 unité d'écart sur 100 % des comptes du scénario de référence, aux deux points de contrôle (après T23, fin de clôture) ; 19/19 cas normatifs verts. | Correctness | High | Open |
| NFR-002 | Idempotence du rejeu | Un second rejeu complet crée 0 transaction et 0 ligne. | Reliability | High | Open |
| NFR-003 | Couverture des suites de la base | 464/464 assertions pgTAP vertes (400 + 64), plus 100 % des assertions ajoutées pour S21, en local comme en CI. | Reliability | High | Open |
| NFR-004 | Absence de fuite SQL | 0 réponse d'erreur contenant un fragment de message SQL, vérifié par un test qui provoque chaque SQLSTATE de la table §5.7 accessible depuis cette mission. | Security | High | Open |
| NFR-005 | Isolation par prestataire | 0 objet d'un autre prestataire lisible ou modifiable via la connexion applicative ; vérifié par un test à deux prestataires, et par un test qui échoue si `set_config` est omis (la requête ne voit aucune ligne). | Security | High | Open |
| NFR-006 | Durée de la boucle locale | Le script d'outillage + création de base + exécution des deux suites pgTAP tient en moins de 5 minutes sur le poste de développement de référence (hors premier téléchargement). | Usability | Medium | Open |
| NFR-007 | Durée de la CI | Le pipeline complet (base, pgTAP, tests TypeScript, contrôles de génération) se termine en moins de 15 minutes. | Performance | Medium | Open |
| NFR-008 | Garde-fous de durée | Le rôle applicatif conserve `transaction_timeout = 60s`, `statement_timeout = 30s`, `idle_in_transaction_session_timeout = 10s` ; un test vérifie ces trois valeurs sur la connexion de l'API. | Reliability | Medium | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Point d'écriture unique | Seule `post_transaction` écrit dans `journal_transaction`, `posting` et `account_balance` ; le rôle applicatif n'a aucun `INSERT`, `UPDATE` ni `DELETE` sur ces tables. | Technical | High | Open |
| C-002 | Fichiers générés intouchables | Les `.sql` générés de `packages/ledger-sql/` ne sont jamais modifiés à la main ; on modifie `gen_tests.py`, `gen_golden.py` ou `scenario_reference.json`. | Technical | High | Open |
| C-003 | Fonctions internes | Les fonctions internes listées en §13.1 ne sont jamais rendues exécutables au rôle applicatif par une migration. | Security | High | Open |
| C-004 | Aucun flottant | Aucun calcul monétaire en virgule flottante, dans aucun langage. | Technical | High | Open |
| C-005 | Pile imposée | API en TypeScript / NestJS ; PostgreSQL 17 minimum ; monorepo en npm workspaces. | Technical | High | Open |
| C-006 | Environnement local | Windows 10, Node 22, PostgreSQL 17 Windows sans pgTAP, pas de Docker ; l'outillage local ne doit exiger ni compilation, ni droits administrateur, ni Docker. | Technical | High | Open |
| C-007 | Types jamais écrits à la main | Les types partagés sont générés depuis `openapi.yaml`. | Technical | High | Open |
| C-008 | Rien de V2 | Aucun élément marqué V2 (ADR-43) n'est créé : pas de `packages/nfc-sdk`, pas de route `x-release: V2`. | Business | High | Open |
| C-009 | Contrat inchangé | Cette mission n'ajoute aucune route à `openapi.yaml` ; la route de test des garanties transverses n'est pas publiée. | Business | Medium | Open |
| C-010 | Pas de remote | Le dépôt n'a pas encore de remote : la CI est écrite et validée localement autant que possible ; son exécution sur GitHub attend la création du remote. | Technical | Medium | Open |

### Key Entities *(include if feature involves data)*

- **Grand livre / compte / transaction / ligne** : déjà au schéma de référence (`ledger`, `account`, `journal_transaction`, `posting`, `account_balance`) ; cette mission les utilise sans en changer les règles.
- **Entrée d'idempotence applicative (S21)** : clé, portée (prestataire, préfixe client), empreinte de la requête, statut (en cours / terminé), réponse enregistrée (statut HTTP, corps, en-têtes utiles), expiration ; isolée par prestataire.
- **Commande d'écriture** : type, clé d'idempotence, `occurred_at`, source, grand livre, événement, terminal, support, montant brut, devise, auteur/valideur éventuels, original contre-passé éventuel, métadonnées.
- **Fixture du scénario** : parties, événement, grand livre et comptes de `scenario_reference.json`, posés pour le test par un rôle de préparation distinct du rôle applicatif.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 464 assertions de la base sur 464 passent, en local et en CI (critère V1 n° 1, hors compléments des missions suivantes).
- **SC-002**: 19 cas normatifs de calcul sur 19 donnent exactement le résultat de référence (critère V1 n° 2).
- **SC-003**: Le festival de référence rejoué donne 0 unité d'écart sur chaque compte aux deux points de contrôle, et un second rejeu crée 0 transaction (critère V1 n° 3).
- **SC-004**: 26 types de transaction sur 26 ont un constructeur couvert par au moins un test.
- **SC-005**: Un développeur sur un poste Windows neuf (Node 22, PostgreSQL 17) passe de la récupération du dépôt aux suites vertes en suivant une seule page d'instructions, sans installer Docker.
- **SC-006**: 0 réponse d'erreur exposant un texte SQL, et 0 objet d'un autre prestataire visible, sur l'ensemble des tests d'intégration.

## Assumptions

- La fixture du scénario (parties, événement, grand livre, comptes) est posée par un rôle de préparation de test distinct de `cashless_app`, comme le fait déjà `scenario_reference_test.sql` ; la création réelle de ces objets par l'API arrive en mission 3.
- L'authentification réelle arrive en mission 2 ; d'ici là, le prestataire de la transaction vient d'un fournisseur de contexte remplaçable, utilisé uniquement par les tests et la route de test.
- Les fonctions de la base auxquelles délèguent les constructeurs (FR-014) exigent des objets de bracelet et de lot ; le rejeu les pose dans la fixture quand le scénario les utilise, la gestion réelle des bracelets arrivant en mission 4. Si une de ces fonctions ne reproduit pas exactement une écriture du scénario (lignes ou clé interne, par exemple `deposit:W04:1`), c'est une contradiction à signaler (FR-024), traitée selon §0.3.
- La latence cible « serveur seul » (p95 ≤ 200 ms) n'est pas mesurable sans route métier ; elle sera vérifiée par les missions qui publient `POST /payments` et les recharges.
- Les types Dart générés depuis le contrat arrivent avec la mission 4 (premier consommateur Dart).
- Durée de vie par défaut d'une entrée d'idempotence applicative : 24 h, paramétrable.

## Dependencies

- Aucune mission précédente. Les missions 2 à 6 dépendent de celle-ci.
- PostgreSQL 17 local (installé) ; accès réseau pour télécharger pgTAP et le module Perl de `pg_prove` lors de la première installation.
