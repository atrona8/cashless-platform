# Mission Specification: Routes serveur du back-office

**Mission Branch**: `feat/routes-backoffice`
**Created**: 2026-11-24
**Status**: Draft
**Input**: User description: "Mission 11b — Routes serveur dont le back-office web a besoin et que le contrat ne sert pas (entrée « Mission 11b » de PROMPTS-A-ENVOYER.md, décision du porteur du 23/11/2026 ; OP-N170 ; `docs/DOSSIER-DESIGN-BACKOFFICE.md`, section « Manques de l'API », manques 1, 2, 3, 5, 6 et 8)."

Le back-office web (mission 11) ne peut pas piloter un événement avec le contrat actuel : il ne sait pas qui est
connecté ni ce que cette personne a le droit de faire, il ne voit ni les ventes ni les anomalies, et il ne peut
retrouver ni un bracelet ni un festivalier. Cette mission ajoute ces lectures côté serveur, plus le classement des
anomalies et la liste des modèles de téléphone, avant que l'équipe du back-office ne commence. Elle lève OP-N170.

Décisions du porteur du 24/11/2026 (moments de décision du specify) : (1) anomalies : liste et classement « traitée »
avec un motif, **sans écriture** au grand livre ; les résolutions qui écrivent de l'argent vont dans une mission
suivante, type par type ; (2) recherche d'un festivalier par numéro : administrateurs dans leur portée et superviseur,
numéro exact seulement, numéro masqué dans la réponse, chaque recherche journalisée, débit limité ; (3) modèles de
téléphone : liste tenue par l'administrateur plateforme, signalement d'un modèle toléré ou non testé, aucun refus
d'enrôlement.

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| **Personnel** | Personne qui se connecte au back-office ou à un terminal avec un rôle (administrateur, superviseur, caissier, vendeur) | « utilisateur » seul, ambigu avec le festivalier |
| **Portée** | Périmètre d'un rôle : plateforme, prestataire, organisateur, événement ou commerçant | « scope », « tenant » |
| **Profil du personnel** | Réponse « qui suis-je » : identité de la personne connectée, ses rôles et leurs portées | « session », « compte » |
| **Vente** | Paiement d'un festivalier à un commerçant, avec ses lignes d'articles ; une vente annulée reste une vente, marquée annulée | « transaction » seul, « achat » |
| **Anomalie** | Signalement d'un des 21 types fermés de SPECIFICATION §12.2, ouvert par le système | « erreur », « incident » |
| **Classement** | Passage d'une anomalie ouverte à « traitée », avec un motif écrit, sans aucune écriture d'argent | « résolution » (réservé aux traitements qui écrivent au grand livre) |
| **Niveau NFC** | Qualité de lecture mesurée d'un modèle de téléphone : « recommandé », « toléré » (SPECIFICATION §15) ; un modèle absent de la liste est « non testé » | « compatibilité » |
| **Rôles autorisés d'une opération** | Liste, lisible par une machine, des rôles qui peuvent appeler une opération du contrat | « permissions » seul |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Savoir qui est connecté et ce qu'il peut faire (Priority: P1)

Un administrateur ouvre le back-office. Le back-office demande au serveur qui est connecté et reçoit ses rôles avec
leurs portées ; il n'affiche que les espaces et les menus correspondants. Il sait aussi, pour chaque opération du
contrat, quels rôles peuvent l'appeler, et masque les boutons que la personne ne peut pas utiliser.

**Why this priority**: sans ces deux lectures, aucun écran du back-office ne peut se construire ; toute la navigation
par rôle en dépend.

**Independent Test**: une personne ayant un rôle d'organisateur sur un organisateur et un rôle de commerçant sur un
commerçant reçoit exactement ces deux rôles et leurs portées ; chaque opération du contrat déclare ses rôles
autorisés, et un contrôle automatique vérifie qu'ils correspondent aux contrôles réels du serveur.

**Acceptance Scenarios**:

1. **Given** une personne du personnel connectée avec deux rôles sur deux portées, **When** le back-office demande son profil, **Then** il reçoit son identifiant, son nom affichable et exactement ces deux rôles avec leur portée, et rien d'autre.
2. **Given** une personne connectée sans aucun rôle actif, **When** elle demande son profil, **Then** elle reçoit un profil sans rôle (le back-office lui montre qu'elle n'a accès à rien), pas une erreur.
3. **Given** un festivalier ou un terminal authentifié, **When** il demande le profil du personnel, **Then** la demande est refusée.
4. **Given** le contrat publié, **When** on lit une opération quelconque, **Then** ses rôles autorisés sont déclarés ; **and** si un rôle déclaré ne correspond pas au contrôle réel du serveur, le contrôle automatique échoue.

---

### User Story 2 - Lister les ventes d'un événement (Priority: P1)

Un administrateur d'organisateur veut voir les ventes de son événement d'hier, par point de vente. Il filtre par
événement, point de vente, commerçant, vendeur et période, pagine la liste, puis ouvre une vente pour voir ses lignes
(articles, quantités, prix, taux de commission). Un administrateur de commerçant ne voit que les ventes de son
commerçant.

**Why this priority**: c'est la première chose qu'on regarde pour piloter un événement ; plusieurs écrans (ventes,
tableau de bord) en dépendent.

**Independent Test**: sur un événement avec des ventes réparties sur deux points de vente, deux commerçants et deux
vendeurs, chaque filtre ne rend que les ventes attendues ; la pagination rend toutes les ventes une seule fois ; le
détail d'une vente rend ses lignes.

**Acceptance Scenarios**:

1. **Given** un événement avec 120 ventes sur deux points de vente, **When** l'administrateur de l'organisateur filtre par un point de vente et une période, **Then** il ne reçoit que les ventes de ce point de vente dans cette période, page par page, sans doublon ni oubli.
2. **Given** une vente annulée, **When** elle apparaît dans la liste, **Then** elle est marquée annulée avec la référence de son annulation.
3. **Given** un administrateur de commerçant, **When** il liste les ventes de l'événement, **Then** il ne voit que celles de son commerçant.
4. **Given** une personne d'un autre prestataire ou hors de la portée de l'événement, **When** elle demande la liste ou une vente, **Then** elle reçoit « introuvable », sans indice sur l'existence de l'événement ou de la vente.

---

### User Story 3 - Voir et classer les anomalies (Priority: P1)

Un administrateur de prestataire ou d'organisateur voit les anomalies ouvertes de ses événements, filtrées par type,
statut, événement et période. Pour une anomalie qui ne demande aucun mouvement d'argent (un écart de caisse expliqué,
un trou de séquence déjà couvert ailleurs), il la classe « traitée » avec un motif écrit. Les anomalies qui exigent une
écriture d'argent restent ouvertes et signalées comme telles : leur traitement relève d'une mission suivante.

**Why this priority**: une anomalie ouverte est un contrôle permanent (SPECIFICATION §12.2) ; sans liste, personne ne
les voit ; sans classement, la liste ne fait que grossir.

**Independent Test**: sur des anomalies de plusieurs types et de deux prestataires, chaque filtre rend les bonnes ; un
classement avec motif passe l'anomalie à « traitée », journalise l'auteur et le motif, et n'écrit rien au grand livre.

**Acceptance Scenarios**:

1. **Given** des anomalies ouvertes de trois types sur un événement, **When** l'administrateur filtre par un type, **Then** il ne reçoit que celles de ce type, avec leur date, leur montant éventuel et l'objet concerné (bracelet, terminal, session de caisse, recharge).
2. **Given** une anomalie ouverte d'un type classable, **When** un administrateur de la portée la classe avec un motif, **Then** elle passe à « traitée », le motif, l'auteur et la date sont enregistrés et journalisés, et aucune écriture n'est créée au grand livre.
3. **Given** un classement sans motif, ou d'une anomalie déjà traitée, **When** il est demandé, **Then** il est refusé sans rien changer.
4. **Given** une anomalie d'un type dont le traitement exige une écriture d'argent, **When** on demande à la classer, **Then** le classement est refusé avec un motif distinct, et l'anomalie reste ouverte.
5. **Given** un administrateur d'un autre prestataire, **When** il liste ou classe, **Then** il ne voit ni ne touche les anomalies hors de sa portée.

---

### User Story 4 - Retrouver un bracelet, un portefeuille ou un festivalier (Priority: P2)

Au back-office ou au guichet, une personne du personnel doit retrouver un festivalier : à partir de l'UID d'un
bracelet, du code imprimé sur le bracelet, d'un portefeuille, ou du numéro de téléphone vérifié du festivalier. La
recherche par bracelet ou portefeuille rend l'état utile (statut du bracelet, événement, soldes). La recherche par
numéro, réservée aux administrateurs dans leur portée et au superviseur, exige le numéro exact et rend les
portefeuilles et bracelets liés, numéro masqué.

**Why this priority**: indispensable au support et à l'identification au guichet, mais le back-office peut démarrer
ses premiers écrans sans elle.

**Independent Test**: un bracelet retrouvé par son UID et par son code imprimé rend le même résultat ; une recherche
par numéro exact rend les portefeuilles du festivalier dans la portée, numéro masqué ; une recherche par un préfixe de
numéro ne rend rien ; chaque recherche par numéro laisse une trace d'audit.

**Acceptance Scenarios**:

1. **Given** un bracelet actif dans un événement de la portée, **When** on le cherche par UID ou par code imprimé, **Then** on reçoit le bracelet, son statut, son événement et son portefeuille avec ses soldes.
2. **Given** un festivalier au numéro vérifié avec deux portefeuilles dans deux événements de la portée, **When** un administrateur cherche ce numéro exact, **Then** il reçoit les deux portefeuilles et leurs bracelets, le numéro masqué, et la recherche est journalisée (auteur, portée, date, sans le numéro en clair).
3. **Given** un numéro incomplet ou approché, **When** il est cherché, **Then** rien n'est rendu (aucune recherche partielle).
4. **Given** un vendeur ou un caissier, **When** il cherche par numéro, **Then** la recherche est refusée.
5. **Given** un nombre de recherches par numéro au-delà de la limite de débit, **When** une recherche de plus arrive, **Then** elle est refusée pour débit, et le refus est journalisé.
6. **Given** un bracelet ou un festivalier hors de la portée, **When** il est cherché, **Then** le résultat est vide, sans indice d'existence.

---

### User Story 5 - Tenir la liste des modèles de téléphone et leur niveau NFC (Priority: P3)

L'administrateur plateforme tient la liste des modèles de téléphone mesurés au banc, avec leur niveau (« recommandé »
ou « toléré ») et la date de mesure. Un administrateur qui regarde la fiche d'un terminal, ou la liste des terminaux
d'un événement, voit un signalement quand le modèle du terminal est toléré ou absent de la liste (non testé).

**Why this priority**: exigé par SPECIFICATION §15, mais purement informatif : aucun terminal n'est refusé.

**Independent Test**: un modèle ajouté « toléré » fait apparaître le signalement sur les terminaux de ce modèle ; un
terminal d'un modèle absent apparaît « non testé » ; un terminal d'un modèle recommandé n'a pas de signalement ;
l'enrôlement d'un terminal non testé reste possible.

**Acceptance Scenarios**:

1. **Given** l'administrateur plateforme, **When** il ajoute ou modifie un modèle avec son niveau et sa date de mesure, **Then** la liste est à jour et le changement est journalisé.
2. **Given** un administrateur de prestataire ou d'organisateur, **When** il lit la liste des modèles, **Then** il la voit sans pouvoir la modifier.
3. **Given** un terminal enrôlé dont le modèle est toléré ou non testé, **When** on lit sa fiche ou la liste des terminaux de son événement, **Then** le niveau du modèle y figure avec le signalement.
4. **Given** un terminal d'un modèle non testé, **When** il s'enrôle, **Then** l'enrôlement se fait normalement.

### Edge Cases

- Une personne dont un rôle est retiré pendant sa session : le profil suivant ne le contient plus ; les listes et recherches suivantes appliquent la portée à jour.
- Une vente faite hors ligne puis synchronisée : elle apparaît dans la liste avec sa date d'origine et son origine (en ligne, passerelle, hors ligne).
- Une période de filtrage trop large ou une page demandée au-delà de la limite : la taille de page est bornée ; un curseur invalide ou périmé est refusé proprement.
- Une anomalie classée pendant qu'une autre personne la classe aussi : un seul classement gagne, l'autre reçoit un refus.
- Un bracelet réattribué (identité retirée) : la recherche par l'ancien code imprimé ne rend pas le nouveau porteur.
- Un festivalier dont le numéro n'est pas vérifié : il n'est pas trouvable par numéro.
- Un modèle de téléphone retiré de la liste : ses terminaux passent « non testé ».

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Profil du personnel | En tant que personne du personnel connectée, je veux obtenir mon identité, mes rôles et la portée de chacun, afin que le back-office ne m'affiche que ce qui me concerne. | High | Open | [build] | no |
| FR-002 | Profil réservé au personnel | En tant que prestataire, je veux que seul le personnel authentifié obtienne un profil du personnel (ni festivalier, ni terminal), afin de ne rien exposer hors du back-office. | High | Open | [build] | no |
| FR-003 | Rôles autorisés par opération | En tant qu'équipe du back-office, je veux que chaque opération du contrat déclare les rôles qui peuvent l'appeler, sous une forme lisible par une machine, afin de masquer les actions interdites sans recopier les règles. | Medium | Open | [build] | no |
| FR-004 | Rôles déclarés fidèles | En tant que porteur, je veux qu'un contrôle automatique échoue si les rôles déclarés d'une opération diffèrent des contrôles réels du serveur, afin que la déclaration ne dérive pas. | High | Open | [build] | no |
| FR-005 | Liste des ventes | En tant qu'administrateur, je veux lister les ventes d'un événement de ma portée, filtrées par point de vente, commerçant, vendeur et période, et paginées, afin de suivre l'activité. | High | Open | [build] | no |
| FR-006 | Détail d'une vente | En tant qu'administrateur, je veux voir une vente avec ses lignes (article, quantité, prix, taux), son origine (en ligne, passerelle, hors ligne) et son éventuelle annulation, afin de répondre à une réclamation. | High | Open | [build] | no |
| FR-007 | Ventes du commerçant | En tant qu'administrateur de commerçant, je veux ne voir que les ventes de mon commerçant, afin que les commerçants ne voient pas l'activité des autres. | High | Open | [build] | no |
| FR-008 | Liste des anomalies | En tant qu'administrateur de prestataire ou d'organisateur, je veux lister les anomalies de ma portée, filtrées par type, statut, événement et période, avec l'objet concerné et le montant éventuel, afin de les traiter. | High | Open | [build] | no |
| FR-009 | Classement d'une anomalie | En tant qu'administrateur de la portée, je veux classer « traitée » une anomalie ouverte d'un type classable, avec un motif obligatoire, sans aucune écriture d'argent, afin de vider la liste de ce qui est expliqué. | High | Open | [build] | no |
| FR-010 | Types non classables refusés | En tant que porteur, je veux que le classement d'une anomalie dont le traitement exige une écriture d'argent soit refusé avec un motif distinct, afin qu'aucune anomalie d'argent ne disparaisse sans écriture. | High | Open | [build] | no |
| FR-011 | Recherche par bracelet | En tant que personne du personnel, je veux retrouver un bracelet de ma portée par son UID ou son code imprimé, avec son statut, son événement et son portefeuille, afin d'aider un festivalier. | Medium | Open | [build] | no |
| FR-012 | Recherche par portefeuille | En tant que personne du personnel, je veux retrouver un portefeuille de ma portée avec ses soldes et ses bracelets, afin d'aider un festivalier. | Medium | Open | [build] | no |
| FR-013 | Recherche par numéro | En tant qu'administrateur dans ma portée ou superviseur, je veux retrouver les portefeuilles et bracelets d'un festivalier par son numéro vérifié exact, numéro masqué dans la réponse, afin de l'identifier sans son bracelet. | Medium | Open | [build] | no |
| FR-014 | Recherche par numéro encadrée | En tant que porteur, je veux que la recherche par numéro refuse les vendeurs et caissiers, refuse toute recherche partielle, soit limitée en débit et que chaque recherche et chaque refus soient journalisés sans le numéro en clair, afin de limiter l'exposition des données personnelles. | High | Open | [build] | no |
| FR-015 | Liste des modèles de téléphone | En tant qu'administrateur plateforme, je veux tenir la liste des modèles de téléphone avec leur niveau NFC et leur date de mesure ; les autres administrateurs la lisent sans la modifier. | Low | Open | [build] | no |
| FR-016 | Signalement des terminaux | En tant qu'organisateur, je veux voir sur la fiche d'un terminal et sur la liste des terminaux de mon événement le niveau du modèle, signalé quand il est toléré ou non testé, sans refus d'enrôlement. | Low | Open | [build] | no |
| FR-017 | Cloisonnement | En tant que prestataire, je veux que toute lecture, recherche ou classement hors de la portée de la personne rende « introuvable » ou vide, sans indice d'existence, afin qu'aucune donnée ne passe d'un prestataire ou d'une portée à l'autre. | High | Open | [build] | no |
| FR-018 | Traçabilité | En tant qu'auditeur, je veux que chaque classement d'anomalie, chaque changement de la liste des modèles et chaque recherche par numéro soient journalisés (auteur, portée, objet, date), afin de reconstituer qui a fait quoi. | High | Open | [build] | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Rapidité des listes | 95 % des pages de liste (ventes, anomalies) et des recherches répondent en moins de 500 ms côté serveur sur un événement de 200 000 ventes, mesurés sur l'environnement de test de la mission. | Performance | Medium | Open |
| NFR-002 | Pages bornées | Aucune page ne dépasse 200 éléments ; la pagination parcourt un ensemble de 1 000 ventes sans doublon ni oubli (0 écart). | Reliability | High | Open |
| NFR-003 | Cloisonnement vérifié | 0 donnée d'un autre prestataire ou hors portée rendue, vérifié sur chaque nouvelle opération par des personnes de deux prestataires et de portées différentes. | Security | High | Open |
| NFR-004 | Débit de la recherche par numéro | Au plus 20 recherches par numéro par personne et par minute ; au-delà, refus pour débit (seuil réglable). | Security | High | Open |
| NFR-005 | Aucun droit élargi | Aucun droit de table ni de colonne nouveau pour le rôle applicatif de la base sans décision du porteur ; les écritures (classement, modèles) passent par des fonctions de la base ; vérifié par les tests de droits existants. | Security | High | Open |
| NFR-006 | Minimisation | Aucune réponse nouvelle ne contient de numéro de téléphone en clair, d'adresse électronique ni de nom de festivalier ; vérifié par un test sur toutes les nouvelles opérations. | Privacy | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Contrat stable | Le contrat partagé ne change que par ajouts rétrocompatibles (opérations, schémas, extension des rôles autorisés), présentés au porteur au plan avant d'être codés et inscrits au contrôle de stabilité du contrat ; aucune opération existante modifiée. | Technical | High | Open |
| C-002 | Pas d'écriture d'argent | Aucune opération de la mission n'écrit au grand livre ; les résolutions d'anomalies qui écrivent de l'argent sont reportées et consignées (point ouvert et ADR, mission qui les reprend). | Business | High | Open |
| C-003 | Aucun refus d'enrôlement | Le niveau NFC d'un modèle n'empêche jamais l'enrôlement ni l'usage d'un terminal. | Business | Medium | Open |
| C-004 | Écart de sécurité soumis | Tout écart au plan ou à la spécification qui affaiblit la sécurité est soumis au porteur avant d'être codé (règle 1 de `CLAUDE.md`). | Regulatory | High | Open |
| C-005 | Liste fermée des anomalies | Les types d'anomalie restent ceux de SPECIFICATION §12.2 ; la mission n'en ajoute ni n'en retire. | Technical | High | Open |
| C-006 | Pas d'écran | La mission ne livre aucun écran ; les écrans sont la mission 11. | Business | Medium | Open |

### Key Entities *(include if the mission involves data)*

- **Profil du personnel** : identifiant de la personne, nom affichable, liste des rôles actifs, chacun avec son type de portée et l'identifiant de cette portée.
- **Rôles autorisés d'une opération** : pour chaque opération du contrat, la liste des rôles qui peuvent l'appeler.
- **Vente** : événement, point de vente, commerçant, vendeur, terminal, date d'origine, origine (en ligne, passerelle, hors ligne), montant, statut (valide ou annulée, avec la référence de l'annulation), lignes (article, quantité, prix unitaire, taux).
- **Anomalie** (existante) : type, statut, événement, objet concerné, montant éventuel, date d'ouverture ; ajout : classement (motif, auteur, date).
- **Modèle de téléphone** : fabricant, modèle, niveau NFC (recommandé ou toléré), date de mesure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Le parcours du scénario principal (profil, ventes de la veille par point de vente, détail d'une vente, anomalies ouvertes, classement d'une anomalie, recherche d'un bracelet) se fait entièrement avec les opérations du contrat, sans aucune requête directe à la base. — [build] · no-op passable: no
- **SC-002**: 100 % des opérations du contrat déclarent leurs rôles autorisés, et le contrôle de fidélité échoue si l'on retire un rôle d'un contrôle du serveur sans changer la déclaration. — [build] · no-op passable: no
- **SC-003**: 0 donnée hors portée rendue sur l'ensemble des nouvelles opérations, pour des personnes de deux prestataires et de quatre portées différentes. — [build] · no-op passable: no
- **SC-004**: 100 % des classements d'anomalie laissent le grand livre inchangé (aucune écriture créée), et 100 % des recherches par numéro laissent une trace d'audit. — [build] · no-op passable: no

## Assumptions

- Les rôles et leurs portées existent déjà (mission 2) ; la mission les lit, elle n'en crée pas.
- Les anomalies existent déjà en base avec un statut ; la mission ajoute le classement, pas de nouveau type.
- Un type d'anomalie est « classable » s'il ne laisse aucun montant en attente au grand livre ; la liste exacte des types classables est fixée au plan et présentée au porteur.
- La période des filtres s'exprime en UTC, comme le reste du système (SPECIFICATION §2.2).
- Le superviseur cherche par numéro dans la portée de son événement seulement.
- Le seuil de débit de la recherche par numéro (20 par minute et par personne) est une valeur par défaut, réglable.
- Le profil du personnel ne contient pas le nom de famille ni l'adresse électronique au-delà du nom affichable déjà servi ailleurs.
