# Tasks — Bracelets NFC (format, clés, lots, cycle de vie)

Mission `bracelets-nfc-01M4TD3W` · branche `feat/bracelets-nfc` (planification et merge).
Sources : [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md).

Le suivi d'avancement est **événementiel** (`spec-kitty agent tasks mark-status Txxx --status done`) : les lignes
`Txxx` ci-dessous sont des références, pas des cases à cocher.

Règle transverse (`CLAUDE.md`, C-011) : tout écart qui affaiblit la sécurité est soumis au porteur avant d'être codé.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Workspace et vecteurs figés | WP01 | |
| T002 | Format B 1.0 et CRC | WP01 | |
| T003 | Dérivation et enveloppe de stockage | WP01 | |
| T004 | Enveloppe pour un appareil ou un poste | WP01 | |
| T005 | Code de rattachement | WP01 | |
| T006 | Tests | WP01 | |
| T007 | Paquet Dart | WP02 | |
| T008 | Format, dérivation, enveloppe, code | WP02 | |
| T009 | Tests sur les mêmes vecteurs | WP02 | |
| T010 | Tables et colonnes | WP03 | |
| T011 | Fonctions des codes | WP03 | |
| T012 | Fonctions de rattachement | WP03 | |
| T013 | Tests pgTAP | WP03 | |
| T014 | Rôle PERSONALIZER (0011) | WP04 | |
| T015 | Actions à deux (0011) | WP04 | |
| T016 | Travaux de clé et comptes rendus (0012) | WP04 | |
| T017 | Tests pgTAP | WP04 | |
| T018 | Enregistrement d'un bracelet personnalisé | WP05 | |
| T019 | Statut d'un lot | WP05 | |
| T020 | Blocage, perte, lecture | WP05 | |
| T021 | Tests pgTAP | WP05 | |
| T022 | Rôles et mots de passe | WP06 | |
| T023 | Droits de chaque rôle | WP06 | |
| T024 | Retraits à `cashless_app` | WP06 | |
| T025 | Tests pgTAP | WP06 | |
| T026 | Schémas | WP07 | |
| T027 | Routes des clés et des lots | WP07 | |
| T028 | Routes des bracelets et du poste | WP07 | |
| T029 | Génération et contrôle | WP07 | |
| T030 | Ports de clés et faux KMS | WP08 | |
| T031 | Identité du terminal | WP08 | |
| T032 | Identité du festivalier et empreinte des codes | WP08 | |
| T033 | Configuration et garde de production | WP08 | |
| T034 | Dettes de sécurité consignées | WP08 | |
| T035 | Pools et transactions par rôle | WP09 | |
| T036 | Modules racines et points d'entrée | WP09 | |
| T037 | Application de test par processus | WP09 | |
| T038 | Tests d'architecture | WP09 | |
| T039 | Lecture des clés et des travaux (API publique) | WP10 | |
| T040 | Actions à deux | WP10 | |
| T041 | Commande d'administration | WP10 | |
| T042 | Tests d'intégration | WP10 | |
| T043 | Création et rotation (processus de personnalisation) | WP11 | |
| T044 | Rechiffrement par tranches (processus des clés) | WP11 | |
| T045 | Cache court de la clé de données | WP11 | |
| T046 | Tests d'intégration | WP11 | |
| T047 | Création, lecture, modification | WP12 | |
| T048 | Cycle de vie et inventaire | WP12 | |
| T049 | Fichier de commande | WP12 | |
| T050 | Import des associations | WP12 | |
| T051 | Clôture et rattrapage | WP12 | |
| T052 | Tests d'intégration | WP12 | |
| T053 | Enregistrement | WP13 | |
| T054 | Clé de données pour la personnalisation | WP13 | |
| T055 | Refus et idempotence | WP13 | |
| T056 | Association du code scanné | WP13 | |
| T057 | Jeu de test partagé et tests | WP13 | |
| T058 | Demande de mot de passe | WP14 | |
| T059 | Lecture | WP14 | |
| T060 | Effets de sécurité durables | WP14 | |
| T061 | Tests d'intégration | WP14 | |
| T062 | Accès au guichet | WP15 | |
| T063 | Activation | WP15 | |
| T064 | Caution | WP15 | |
| T065 | Consultation | WP15 | |
| T066 | Tests d'intégration | WP15 | |
| T067 | Restitution et réattribution | WP16 | |
| T068 | Remplacement | WP16 | |
| T069 | Perte et bracelet retrouvé | WP16 | |
| T070 | Espèces dues | WP16 | |
| T071 | Tests d'intégration | WP16 | |
| T072 | Rattachement par le festivalier | WP17 | |
| T073 | Confirmation au guichet | WP17 | |
| T074 | Consultation anonyme | WP17 | |
| T075 | Indistinction et tests | WP17 | |
| T076 | Mise en liste noire | WP18 | |
| T077 | Sortie à deux | WP18 | |
| T078 | Tests d'intégration | WP18 | |
| T079 | Passage du contrôle | WP19 | |
| T080 | Alerte sur un écart | WP19 | |
| T081 | Point d'entrée et tests | WP19 | |
| T082 | Parcours complet | WP20 | |
| T083 | Aucun secret au repos | WP20 | |
| T084 | Isolation et droits | WP20 | |
| T085 | Latence | WP20 | |
| T086 | CI | WP20 | |
| T087 | Décisions et dettes | WP20 | |

## Ordre et parallélisme

- Socle sans dépendance entre eux : WP01 (bibliothèque TypeScript), WP03 (schéma S19), WP07 (contrat).
- Chaîne de la base : WP03 → WP04 → WP05 → WP06 (les migrations se suivent).
- Chaîne de l'API : WP08 (ports) → WP09 (processus) → WP10 → WP11 (clés) ; WP12 (lots) dès WP09 ; WP13 (personnalisation) après WP11 et WP12 ; puis WP14 → WP15 → WP16 → WP17.
- En parallèle de la fin de chaîne : WP02 (Dart, après WP01), WP18 (liste noire, après WP14), WP19 (contrôle quotidien, après WP13).
- WP20 ferme la mission.

Point ouvert connu dès le découpage (WP13) : le processus de personnalisation n'a pas le droit de déchiffrer une clé de données ; la manière de sceller le mot de passe d'un nouveau bracelet sous la clé de données active est à soumettre au porteur avant d'être codée.

## WP01 — Bibliothèque de format en TypeScript (`@cashless/tag-format`)

- **But** : Livrer la bibliothèque de format du serveur, conforme à l'octet près aux vecteurs du kit, et figer ces vecteurs en JSON pour les deux langages.
- **Phase** : Phase 1 - Socle · **Dépend de** : aucun · **Exigences** : FR-001, FR-002, FR-003, FR-004, FR-005
- **Prompt** : [tasks/WP01-bibliotheque-format-typescript.md](tasks/WP01-bibliotheque-format-typescript.md)
- **Critère** : `npm test -w @cashless/tag-format`, `npm run lint`, `npm run typecheck` verts ; `vectors.json` reproduit par le script du kit ; aucun secret journalisé.
- **Risques** : Recopier les vecteurs à la main masquerait un écart avec le kit. L'enveloppe pour un appareil doit suivre le contrat existant, pas une invention.

Sous-tâches :

T001 Workspace et vecteurs figés (WP01)
T002 Format B 1.0 et CRC (WP01)
T003 Dérivation et enveloppe de stockage (WP01)
T004 Enveloppe pour un appareil ou un poste (WP01)
T005 Code de rattachement (WP01)
T006 Tests (WP01)

## WP02 — Bibliothèque de format en Dart (`cashless_tag_format`)

- **But** : Livrer la même bibliothèque en Dart 3.8 et prouver qu'elle rend les mêmes octets que la version TypeScript.
- **Phase** : Phase 1 - Socle · **Dépend de** : WP01 · **Exigences** : FR-001, FR-002, FR-003, FR-004, FR-005
- **Prompt** : [tasks/WP02-bibliotheque-format-dart.md](tasks/WP02-bibliotheque-format-dart.md)
- **Critère** : `dart pub get --enforce-lockfile && dart analyze && dart test` verts dans `packages/tag-format/dart` ; 100 % des vecteurs et des entrées croisées identiques.
- **Risques** : Un écart d'un octet avec TypeScript rend les bracelets illisibles par les apps : le test croisé est la preuve, ne le contourne pas.

Sous-tâches :

T007 Paquet Dart (WP02)
T008 Format, dérivation, enveloppe, code (WP02)
T009 Tests sur les mêmes vecteurs (WP02)

## WP03 — Schéma S19 : codes et demandes de rattachement (migration 0010)

- **But** : Ajouter à la base les codes de rattachement, les demandes en attente et les essais, avec leurs règles en base.
- **Phase** : Phase 1 - Socle · **Dépend de** : aucun · **Exigences** : FR-015, FR-017, FR-030, FR-031, FR-032, FR-033
- **Prompt** : [tasks/WP03-schema-rattachement-s19.md](tasks/WP03-schema-rattachement-s19.md)
- **Critère** : `npm run reset-db -w @cashless/ledger-sql && npm run test:pgtap -w @cashless/ledger-sql` vert, suites de référence comprises ; migration rejouable.
- **Risques** : La base ne doit pas permettre de distinguer un code inconnu d'un code utilisé (`REFUSED` unique). Une fonction DEFINER de trop élargit les droits : justifie chacune.

Sous-tâches :

T010 Tables et colonnes (WP03)
T011 Fonctions des codes (WP03)
T012 Fonctions de rattachement (WP03)
T013 Tests pgTAP (WP03)

## WP04 — Rôle PERSONALIZER, actions à deux et travaux de clé (migrations 0011 et 0012)

- **But** : Ajouter le rôle humain `PERSONALIZER`, les quatre actions à deux de la mission, la table des travaux de clé et celle des comptes rendus du contrôle quotidien.
- **Phase** : Phase 1 - Socle · **Dépend de** : WP03 · **Exigences** : FR-007, FR-008, FR-009, FR-010, FR-029
- **Prompt** : [tasks/WP04-role-personalizer-travaux-cle.md](tasks/WP04-role-personalizer-travaux-cle.md)
- **Critère** : pgTAP vert, suites de référence et suites des missions 2 et 3 comprises (`tests_identity.sql`, `tests_approvals.sql`, `tests_platform_scope.sql`).
- **Risques** : Élargir la contrainte des rôles sans relire les fonctions de la mission 2 laisserait `PERSONALIZER` inattribuable ou attribuable par n'importe qui.

Sous-tâches :

T014 Rôle PERSONALIZER (0011) (WP04)
T015 Actions à deux (0011) (WP04)
T016 Travaux de clé et comptes rendus (0012) (WP04)
T017 Tests pgTAP (WP04)

## WP05 — Fonctions d'appui de l'API des bracelets (migration 0013)

- **But** : Regrouper en fonctions de la base les écritures que l'API fera sur les bracelets et les lots, pour que chaque rôle de base n'ait que les droits nécessaires.
- **Phase** : Phase 1 - Socle · **Dépend de** : WP04 · **Exigences** : FR-011, FR-012, FR-016, FR-024, FR-028, FR-029, FR-035
- **Prompt** : [tasks/WP05-fonctions-appui-bracelets.md](tasks/WP05-fonctions-appui-bracelets.md)
- **Critère** : pgTAP vert ; aucune colonne secrète rendue par une fonction de lecture ; suites de référence vertes.
- **Risques** : Une fonction DEFINER est un droit délégué : chaque DEFINER doit commencer par `assert_tenant` et ne rien rendre d'un autre prestataire.

Sous-tâches :

T018 Enregistrement d'un bracelet personnalisé (WP05)
T019 Statut d'un lot (WP05)
T020 Blocage, perte, lecture (WP05)
T021 Tests pgTAP (WP05)

## WP06 — Rôles de base des processus et retraits à l'API publique (`post-roles.sql`)

- **But** : Créer les quatre rôles de base des processus des clés et retirer à `cashless_app` la lecture des secrets chiffrés.
- **Phase** : Phase 1 - Socle · **Dépend de** : WP05 · **Exigences** : FR-006, FR-018, FR-016
- **Prompt** : [tasks/WP06-roles-de-base-processus.md](tasks/WP06-roles-de-base-processus.md)
- **Critère** : pgTAP vert sur base neuve et sur base rejouée ; Jest des missions 1 à 3 vert ; connexion réelle réussie sous chacun des quatre rôles.
- **Risques** : C'est le lot le plus sensible côté base : relis chaque `GRANT`. Un droit de trop sur `cashless_app` annule la seconde barrière ; un droit de trop sur `cashless_perso` ouvre le grand livre à un poste d'atelier.

Sous-tâches :

T022 Rôles et mots de passe (WP06)
T023 Droits de chaque rôle (WP06)
T024 Retraits à `cashless_app` (WP06)
T025 Tests pgTAP (WP06)

## WP07 — Contrat d'API : routes back-office des bracelets, types TypeScript et Dart

- **But** : Décrire au contrat les routes manquantes de la mission et régénérer les types, en TypeScript et en Dart.
- **Phase** : Phase 1 - Socle · **Dépend de** : aucun · **Exigences** : FR-036
- **Prompt** : [tasks/WP07-contrat-api-bracelets.md](tasks/WP07-contrat-api-bracelets.md)
- **Critère** : `npm run check -w @cashless/contracts` vert ; le contrat valide en OpenAPI 3.1 ; types Dart générés et analysables (`dart analyze`).
- **Risques** : Le balayage d'isolation de la mission 3 sélectionne ses routes par tags : vérifie que les nouvelles routes n'y entrent pas par accident (sinon elles y échoueront tant qu'elles ne sont pas servies).

Sous-tâches :

T026 Schémas (WP07)
T027 Routes des clés et des lots (WP07)
T028 Routes des bracelets et du poste (WP07)
T029 Génération et contrôle (WP07)

## WP08 — Ports (clés, terminal, festivalier), faux et garde de production

- **But** : Isoler le service de clés, l'identité du terminal et celle du festivalier derrière des ports, fournir les faux de test, et interdire tout faux en production.
- **Phase** : Phase 2 - Socle API · **Dépend de** : WP01 · **Exigences** : FR-006, FR-034
- **Prompt** : [tasks/WP08-ports-faux-garde-production.md](tasks/WP08-ports-faux-garde-production.md)
- **Critère** : Lint, types et Jest verts ; un faux en production fait échouer le démarrage (3 tests) ; un port non demandé n'est pas injectable ; les quatre dettes sont dans `docs/POINTS_OUVERTS.md`.
- **Risques** : Le faux KMS contient des clés de test : il ne doit être importé que par des modules de test et par le câblage hors production. La garde est la seule barrière : ne lui ajoute aucune échappatoire.

Sous-tâches :

T030 Ports de clés et faux KMS (WP08)
T031 Identité du terminal (WP08)
T032 Identité du festivalier et empreinte des codes (WP08)
T033 Configuration et garde de production (WP08)
T034 Dettes de sécurité consignées (WP08)

## WP09 — Quatre processus et commande d'administration des clés

- **But** : Donner à chaque service son point d'entrée, son module racine, son rôle de base et ses seules capacités de clés.
- **Phase** : Phase 2 - Socle API · **Dépend de** : WP06, WP08 · **Exigences** : FR-006, FR-018
- **Prompt** : [tasks/WP09-processus-et-commande-admin.md](tasks/WP09-processus-et-commande-admin.md)
- **Critère** : Les cinq points d'entrée démarrent hors production ; les tests d'architecture échouent si un port de clé devient atteignable depuis l'API publique (prouve-le en cassant volontairement puis en rétablissant).
- **Risques** : Le test d'architecture est la preuve de NFR-005 : un test qui passe toujours ne prouve rien, vérifie qu'il échoue quand on viole la règle.

Sous-tâches :

T035 Pools et transactions par rôle (WP09)
T036 Modules racines et points d'entrée (WP09)
T037 Application de test par processus (WP09)
T038 Tests d'architecture (WP09)

## WP10 — Clés : demandes à deux, suivi et commande d'administration

- **But** : Permettre à un administrateur de prestataire de demander une clé, une rotation ou un retrait (à deux), d'en suivre l'avancement, et à l'exploitant de créer et de désactiver une clé par la commande d'administration.
- **Phase** : Phase 3 - Clés et lots · **Dépend de** : WP04, WP07, WP09 · **Exigences** : FR-007, FR-009, FR-035
- **Prompt** : [tasks/WP10-cles-demandes-et-commande.md](tasks/WP10-cles-demandes-et-commande.md)
- **Critère** : Lint, types et Jest verts ; aucune création ni désactivation de clé possible depuis l'API publique (le port n'y est pas injectable) ; aucune action de clé avec une seule personne.
- **Risques** : La commande d'administration est le seul détenteur de `KeyAdminPort` (décision du porteur n° 6) : n'ajoute aucun raccourci dans un autre processus.

Sous-tâches :

T039 Lecture des clés et des travaux (API publique) (WP10)
T040 Actions à deux (WP10)
T041 Commande d'administration (WP10)
T042 Tests d'intégration (WP10)

## WP11 — Clés de données : création, rotation, rechiffrement, retrait

- **But** : Exécuter, dans les processus qui en ont le droit, la création de la clé de données, sa rotation avec rechiffrement par tranches, et le retrait d'une clé dédiée.
- **Phase** : Phase 3 - Clés et lots · **Dépend de** : WP10 · **Exigences** : FR-007, FR-008, FR-009
- **Prompt** : [tasks/WP11-cles-de-donnees-rotation-retrait.md](tasks/WP11-cles-de-donnees-rotation-retrait.md)
- **Critère** : Lint, types et Jest verts ; après rotation, 100 % des mots de passe se déchiffrent sous la nouvelle version et aucun sous l'ancienne ; aucun clair ne survit à un travail (tampons à zéro vérifiés).
- **Risques** : Un rechiffrement qui perd un mot de passe rend un bracelet illisible à jamais : la tranche doit être atomique et vérifiée avant validation (rouvrir ce qu'on vient de sceller).

Sous-tâches :

T043 Création et rotation (processus de personnalisation) (WP11)
T044 Rechiffrement par tranches (processus des clés) (WP11)
T045 Cache court de la clé de données (WP11)
T046 Tests d'intégration (WP11)

## WP12 — Lots : création, cycle de vie, codes à la commande, inventaire, clôture

- **But** : Permettre à un administrateur d'organisateur de commander un lot, d'obtenir une fois le fichier de commande, de faire avancer le lot, de lire son inventaire et de le clore.
- **Phase** : Phase 3 - Clés et lots · **Dépend de** : WP03, WP05, WP07, WP09 · **Exigences** : FR-011, FR-012, FR-013, FR-014, FR-015, FR-017
- **Prompt** : [tasks/WP12-lots-codes-inventaire.md](tasks/WP12-lots-codes-inventaire.md)
- **Critère** : Lint, types et Jest verts ; aucun code de rattachement en clair au repos ; clôture d'un gros lot menée au bout par relances.
- **Risques** : Le fichier de commande est le seul moment où les codes existent en clair côté serveur : toute conservation (idempotence, journal, audit) est une fuite.

Sous-tâches :

T047 Création, lecture, modification (WP12)
T048 Cycle de vie et inventaire (WP12)
T049 Fichier de commande (WP12)
T050 Import des associations (WP12)
T051 Clôture et rattrapage (WP12)
T052 Tests d'intégration (WP12)

## WP13 — Personnalisation : enregistrement d'un bracelet et association du code

- **But** : Enregistrer un bracelet personnalisé : calculer son mot de passe par le service de clés, le stocker chiffré, le rendre au poste sous enveloppe, associer le code imprimé.
- **Phase** : Phase 4 - Bracelets · **Dépend de** : WP11, WP12 · **Exigences** : FR-016, FR-017
- **Prompt** : [tasks/WP13-personnalisation.md](tasks/WP13-personnalisation.md)
- **Critère** : Lint, types et Jest verts ; le mot de passe n'existe en clair qu'en mémoire du processus de personnalisation, le temps de la requête ; la question des droits sur la clé de données est tranchée par le porteur ou explicitement en attente.
- **Risques** : Ce lot porte l'opération la plus sensible de la mission. Le point « clé de données » est un vrai trou du plan, découvert au découpage : ne le comble pas en élargissant un droit sans l'accord du porteur.

Sous-tâches :

T053 Enregistrement (WP13)
T054 Clé de données pour la personnalisation (WP13)
T055 Refus et idempotence (WP13)
T056 Association du code scanné (WP13)
T057 Jeu de test partagé et tests (WP13)

## WP14 — Mot de passe pour un terminal et lecture d'un bracelet

- **But** : Servir `POST /media/auth-keys` (processus des clés) et `POST /taps` (API publique), et rendre durables les effets de sécurité d'une lecture suspecte.
- **Phase** : Phase 4 - Bracelets · **Dépend de** : WP13 · **Exigences** : FR-018, FR-019, FR-020
- **Prompt** : [tasks/WP14-mot-de-passe-terminal-et-lecture.md](tasks/WP14-mot-de-passe-terminal-et-lecture.md)
- **Critère** : Lint, types et Jest verts ; 100 % des lectures copiées testées mettent le bracelet en liste noire, y compris quand l'opération échoue ; un seul déchiffrement au plus par demande.
- **Risques** : Le délai constant et l'indistinction protègent contre l'énumération des bracelets ; la seconde transaction de `register_tap` est ce qui rend la détection de copie réelle.

Sous-tâches :

T058 Demande de mot de passe (WP14)
T059 Lecture (WP14)
T060 Effets de sécurité durables (WP14)
T061 Tests d'intégration (WP14)

## WP15 — Activation, caution et consultation d'un bracelet

- **But** : Servir l'activation d'un bracelet au guichet, la prise et le rendu de la caution, et la consultation d'un bracelet.
- **Phase** : Phase 4 - Bracelets · **Dépend de** : WP14 · **Exigences** : FR-021, FR-022, FR-023, FR-024
- **Prompt** : [tasks/WP15-activation-caution-consultation.md](tasks/WP15-activation-caution-consultation.md)
- **Critère** : Lint, types et Jest verts ; aucune règle de `activate_media` ou de `take_deposit` réécrite dans l'API ; grand livre équilibré après chaque test.
- **Risques** : L'ouverture d'un portefeuille anonyme touche au plan de comptes : réutilise ce qui existe, ne crée pas un second chemin.

Sous-tâches :

T062 Accès au guichet (WP15)
T063 Activation (WP15)
T064 Caution (WP15)
T065 Consultation (WP15)
T066 Tests d'intégration (WP15)

## WP16 — Guichet de retour : restitution, remplacement, perte, espèces dues

- **But** : Servir la restitution (et la réattribution d'un lot réattribuable), le remplacement, la perte et le bracelet retrouvé, et le rendu des espèces dues.
- **Phase** : Phase 4 - Bracelets · **Dépend de** : WP15 · **Exigences** : FR-025, FR-026, FR-027, FR-028
- **Prompt** : [tasks/WP16-retour-remplacement-perte.md](tasks/WP16-retour-remplacement-perte.md)
- **Critère** : Lint, types et Jest verts ; les refus nomment ce qui reste à faire ; la caution suit le bracelet remplacé ; aucune règle du schéma réécrite.
- **Risques** : Créer une situation « espèces dues » sans la mission 6 demande un jeu de test fidèle au schéma : lis `refund_cash_due` et `anomaly_cash_due_guard` avant.

Sous-tâches :

T067 Restitution et réattribution (WP16)
T068 Remplacement (WP16)
T069 Perte et bracelet retrouvé (WP16)
T070 Espèces dues (WP16)
T071 Tests d'intégration (WP16)

## WP17 — Rattachement par code, demande en attente et consultation anonyme

- **But** : Servir le rattachement d'un bracelet par le festivalier, la demande en attente confirmée au guichet, les limites d'essais et la consultation anonyme du solde.
- **Phase** : Phase 4 - Bracelets · **Dépend de** : WP16 · **Exigences** : FR-030, FR-031, FR-032, FR-033
- **Prompt** : [tasks/WP17-rattachement-par-code.md](tasks/WP17-rattachement-par-code.md)
- **Critère** : Lint, types et Jest verts ; réponses indistinguables prouvées ; aucun code de confirmation en clair au repos.
- **Risques** : Toute différence observable entre « inconnu » et « utilisé » (statut, corps, temps, en-tête) permet l'énumération des codes.

Sous-tâches :

T072 Rattachement par le festivalier (WP17)
T073 Confirmation au guichet (WP17)
T074 Consultation anonyme (WP17)
T075 Indistinction et tests (WP17)

## WP18 — Liste noire et sortie à deux

- **But** : Permettre la mise en liste noire manuelle d'un bracelet et sa sortie après validation par une seconde personne.
- **Phase** : Phase 4 - Bracelets · **Dépend de** : WP14 · **Exigences** : FR-029, FR-035
- **Prompt** : [tasks/WP18-liste-noire.md](tasks/WP18-liste-noire.md)
- **Critère** : Lint, types et Jest verts ; aucune sortie de liste noire avec une seule personne.
- **Risques** : Petit lot, mais c'est un contrôle à deux : ne laisse aucune route qui appelle `reinstate_media` hors de l'action approuvée.

Sous-tâches :

T076 Mise en liste noire (WP18)
T077 Sortie à deux (WP18)
T078 Tests d'intégration (WP18)

## WP19 — Contrôle quotidien des mots de passe stockés

- **But** : Recalculer chaque jour un échantillon de mots de passe par le service de clés, comparer aux valeurs stockées et alerter sur un écart.
- **Phase** : Phase 5 - Exploitation et preuves · **Dépend de** : WP13 · **Exigences** : FR-010
- **Prompt** : [tasks/WP19-controle-quotidien.md](tasks/WP19-controle-quotidien.md)
- **Critère** : Lint, types et Jest verts ; un chiffré altéré est détecté ; aucun mot de passe en clair hors de la mémoire du processus.
- **Risques** : L'ordonnancement en production est hors mission (hypothèse de la spec) : livre une opération déclenchable et testée.

Sous-tâches :

T079 Passage du contrôle (WP19)
T080 Alerte sur un écart (WP19)
T081 Point d'entrée et tests (WP19)

## WP20 — Preuves de bout en bout, secrets, isolation, latence, CI et décisions

- **But** : Prouver la mission de bout en bout, l'absence de secret au repos, l'isolation et la latence ; étendre la CI ; consigner les décisions et les dettes.
- **Phase** : Phase 5 - Exploitation et preuves · **Dépend de** : WP17, WP18, WP19, WP02 · **Exigences** : FR-034, FR-035, FR-036
- **Prompt** : [tasks/WP20-preuves-ci-decisions.md](tasks/WP20-preuves-ci-decisions.md)
- **Critère** : Toute la chaîne verte en local dans l'ordre de `quickstart.md` ; zéro secret au repos ; zéro fuite entre prestataires ; seuils de latence tenus ; ADR et dettes écrits ; répétition de CI consignée.
- **Risques** : Ce lot est la preuve de la mission : un test de recherche de secrets qui ne cherche pas les bonnes valeurs ne prouve rien — vérifie qu'il échoue quand on écrit volontairement un secret en clair, puis rétablis.

Sous-tâches :

T082 Parcours complet (WP20)
T083 Aucun secret au repos (WP20)
T084 Isolation et droits (WP20)
T085 Latence (WP20)
T086 CI (WP20)
T087 Décisions et dettes (WP20)
