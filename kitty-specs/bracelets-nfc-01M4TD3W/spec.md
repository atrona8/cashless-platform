# Mission Specification: Bracelets NFC (format, clés, lots, cycle de vie)

**Mission Branch**: `feat/bracelets-nfc`
**Created**: 2026-10-13
**Status**: Draft
**Input**: User description: "Bracelets NFC côté serveur et bibliothèques de format (SPECIFICATION §7, §6.1, §6.4, §14.2 S19, ADR-36, ADR-56, ADR-57, ADR-59). `packages/tag-format` en TypeScript et en Dart : format B 1.0 (28 octets, CRC-32/ISO-HDLC, majeur inconnu refusé), message de dérivation SP 800-108, AAD et chiffrement AES-256-GCM de PWD‖PACK, code de rattachement (10 caractères, alphabet de 32) ; les deux implémentations reproduisent `vecteurs_test_bracelet.py`. Ports KMS (GenerateMac, GenerateDataKey, Decrypt) avec faux pour les tests. Service des clés de bracelet (`POST /media/auth-keys`, un seul Decrypt de DEK, effacement en mémoire), service de personnalisation (enregistrement `token_hash`, UID, signature d'originalité et son empreinte, chiffré, lot), contrôle quotidien sur 100 bracelets, rotation de DEK, `tag_key` et `retire_dedicated_key` puis désactivation KMS. Lots (`media_batch` : kind, clé partagée ou dédiée, préchargement, caution, réutilisation, cycle de vie, inventaire). Codes de rattachement générés à la commande, empreinte seule conservée, association à la personnalisation, limites d'essais, demandes en attente pour un bracelet approvisionné (`media_claim`, confirmation au guichet). `POST /taps` (`register_tap`, effets de sécurité validés dans une transaction séparée), activation, consultation, caution et rendu, restitution, remplacement (la caution suit le bracelet), espèces dues (`refund_cash_due`), liste noire et `reinstate_media` à deux."

**Sources normatives** : `docs/SPECIFICATION.md` (§3.2, §6.1, §6.4, §7.1 à §7.10, §8.5, §13.2, §14.2 S19), `docs/DECISIONS_ADR.md` (ADR-36, ADR-41, ADR-42, ADR-50, ADR-56, ADR-57, ADR-59, ADR-71), `packages/tag-format/vecteurs_test_bracelet.py`, `packages/ledger-sql/schema_grand_livre_cashless.sql` (tables et fonctions des bracelets, lots, cautions, passages), `packages/contracts/openapi.yaml` (tag « Bracelets », routes du festivalier). En cas de contradiction, la règle de priorité de SPECIFICATION §0.3 s'applique et la contradiction est signalée.

**Dépend de** : missions `fondations-grand-livre-01M4AY8M` (moteur d'écritures, idempotence, erreurs normalisées), `identite-roles-double-validation-01M4DNDN` (personnes, rôles, audit, double validation) et `configuration-parties-evenements-01M4GCJ9` (organisateurs, événements, grand livre d'événement, réglages `activation_modes`, `identity_mode`, `tap_replay_window_seconds`, `lost_media_policy`, `cash_refund_single_max`).

## Contexte

Le bracelet est le support de paiement du festivalier. Il ne porte aucun montant, seulement une identité opaque ; le solde vit dans le portefeuille, au grand livre central. Cette mission livre tout ce que le serveur doit savoir faire d'un bracelet avant qu'un terminal ne paie avec : le format de la puce et sa cryptographie (bibliothèque partagée par le serveur et les apps), les clés, les lots commandés à un fournisseur, les codes imprimés qui permettent au festivalier de rattacher son bracelet, puis la vie du bracelet (lecture, activation, caution, restitution, remplacement, liste noire).

Les règles de fond existent déjà dans le schéma de référence, sous forme de fonctions de la base. La mission les rend utilisables par l'API, ajoute ce que le schéma annonce sans le fournir (S19 : codes et demandes de rattachement), et prouve le tout par des tests.

Trois décisions de cadrage, prises avec le porteur le 13 octobre 2026, bornent la mission (voir « Decisions ») : les terminaux et les festivaliers sont représentés par un port d'identité et un faux pour les tests ; la bibliothèque existe en TypeScript et en Dart dès maintenant ; le KMS est un port avec un faux, sans adaptateur AWS.

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Bracelet | Support NFC (`media`) : simple identifiant, sans montant | « carte », « tag » dans les textes destinés aux personnes |
| Identité | 16 octets aléatoires écrits dans la puce ; le serveur n'en garde que l'empreinte (`token_hash`) | « numéro du bracelet » |
| UID | Numéro de série de la puce (7 octets), lisible par tous | « identité » |
| Mot de passe du bracelet | `PWD` (4 octets) et `PACK` (2 octets), propres à chaque bracelet | « clé du bracelet » |
| Clé de dérivation | Clé du KMS qui sert à calculer les mots de passe ; ne sort jamais du KMS | « clé maître » sans précision |
| Clé de données | Clé qui chiffre les mots de passe stockés ; elle-même stockée chiffrée | « DEK » dans les textes destinés aux personnes |
| Lot | Série de bracelets commandée pour un organisateur (`media_batch`) | « série », « commande » |
| Lecture (ou passage) | Une présentation du bracelet à un terminal, tracée (`media_tap`) ; sert à une seule écriture | « scan » |
| Code de rattachement | Code de 10 caractères imprimé sur un bracelet `PUBLIC` | « code d'activation » |
| Code de confirmation | Code à 6 chiffres d'une demande de rattachement en attente | « code de rattachement » |
| Demande en attente | Demande de rattachement d'un bracelet déjà approvisionné, à confirmer au guichet (`media_claim`) | « réclamation » |
| Restitution | Retour du bracelet au guichet (`release_media`) | « désactivation » |
| Liste noire | Bracelet bloqué pour fraude suspectée (`BLACKLISTED`) | « suspension » (qui désigne une perte déclarée) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deux bibliothèques, un seul format (Priority: P1)

Un développeur du serveur ou d'une app encode et décode un bracelet avec la bibliothèque de son langage, et obtient exactement les octets du kit.

**Why this priority**: toute la suite en dépend ; une divergence entre serveur et terminal rendrait les bracelets illisibles.

**Independent Test**: lancer les tests de chaque bibliothèque ; chacune reproduit tous les vecteurs de `vecteurs_test_bracelet.py`.

**Acceptance Scenarios**:

1. **Given** l'identité et l'index de clé du vecteur du kit, **When** la bibliothèque encode le format B 1.0, **Then** elle produit les 28 octets attendus, CRC compris.
2. **Given** 28 octets dont le majeur n'est pas `1`, **When** la bibliothèque les décode, **Then** elle refuse en nommant la version inconnue ; un mineur plus récent est accepté.
3. **Given** 28 octets dont le CRC est faux, **When** la bibliothèque les décode, **Then** elle refuse.
4. **Given** le prestataire, l'index et l'UID du vecteur, **When** la bibliothèque construit le message de dérivation, **Then** un calcul avec la clé de test donne `PWD` et `PACK` du kit.
5. **Given** la clé de données, le nonce et le bracelet du vecteur, **When** la bibliothèque chiffre `PWD‖PACK`, **Then** elle produit les 34 octets du kit, et les déchiffre à l'inverse ; un bracelet, un prestataire, un index ou un UID différent fait échouer le déchiffrement.
6. **Given** un code saisi avec tirets, espaces ou minuscules, **When** la bibliothèque le normalise, **Then** elle rend les 10 caractères de l'alphabet permis, ou refuse un caractère interdit.
7. **Given** les deux bibliothèques, **When** on leur donne les mêmes entrées, **Then** elles rendent les mêmes octets.

---

### User Story 2 - L'organisateur commande et suit un lot (Priority: P1)

Un administrateur d'organisateur crée un lot de bracelets, reçoit le fichier de commande avec les codes à imprimer, puis fait avancer le lot jusqu'à sa mise en service et consulte son inventaire.

**Why this priority**: sans lot, aucun bracelet n'existe ni ne paie.

**Independent Test**: créer un lot `PUBLIC` de 50 bracelets, télécharger le fichier de commande, le faire passer de commandé à actif, lire l'inventaire.

**Acceptance Scenarios**:

1. **Given** un organisateur et un index de clé actif, **When** l'administrateur crée un lot (type, quantité, événement ou non, préchargement, caution et son mode, politique de réutilisation), **Then** le lot existe au statut commandé.
2. **Given** une caution sans mode, ou un mode sans caution, **When** il crée le lot, **Then** la création est refusée avec la règle citée.
3. **Given** un lot `PUBLIC` commandé, **When** il demande le fichier de commande, **Then** il reçoit un code de rattachement par bracelet ; le serveur n'en garde que les empreintes, et une seconde demande ne peut plus rendre les codes en clair.
4. **Given** un lot `STAFF` ou `VIP`, **When** il demande le fichier de commande, **Then** aucun code n'est généré.
5. **Given** un lot, **When** il demande un passage de statut non prévu, **Then** le passage est refusé ; un passage permis est tracé avec son auteur.
6. **Given** un lot en service, **When** il lit l'inventaire, **Then** il voit le nombre de bracelets commandés, enregistrés, en stock, remis, actifs, suspendus, en liste noire, remplacés, rendus, en fin de vie et manquants.
7. **Given** un lot à clé dédiée, **When** il le crée sans événement ou avec une autre politique que l'usage unique, **Then** la création est refusée.

---

### User Story 3 - Le poste de personnalisation enregistre un bracelet (Priority: P1)

Le poste de personnalisation, qui vient d'écrire une puce, enregistre le bracelet auprès du serveur ; le serveur calcule son mot de passe par le KMS, le stocke chiffré et associe le code imprimé.

**Why this priority**: un bracelet non enregistré est inconnu des terminaux.

**Independent Test**: enregistrer un bracelet d'un lot avec le faux KMS, puis vérifier que son mot de passe stocké se déchiffre en la valeur attendue.

**Acceptance Scenarios**:

1. **Given** un lot commandé et une puce à signature valide, **When** le poste enregistre le bracelet (empreinte de l'identité, UID, signature, lot), **Then** le bracelet existe au statut personnalisé, avec l'index du lot, l'empreinte de la signature et son mot de passe chiffré ; il reçoit en retour le mot de passe à écrire dans la puce.
2. **Given** une signature d'originalité déclarée invalide, **When** le poste enregistre, **Then** l'enregistrement est refusé.
3. **Given** un code imprimé scanné par le poste, **When** il enregistre le bracelet, **Then** le code est associé à ce bracelet ; un code d'un autre lot, inconnu ou déjà associé est refusé.
4. **Given** un fichier de correspondance code ↔ UID fourni par l'imprimeur, **When** l'administrateur l'importe, **Then** chaque code est associé à son bracelet, et les lignes en erreur sont listées sans bloquer les autres.
5. **Given** une clé qui n'est plus active, **When** le poste enregistre un bracelet d'un nouveau lot avec cet index, **Then** l'enregistrement est refusé.
6. **Given** le même enregistrement renvoyé, **When** le poste rejoue avec la même clé d'idempotence, **Then** il reçoit la même réponse et un seul bracelet existe.

---

### User Story 4 - Le terminal lit un bracelet (Priority: P1)

Un terminal authentifié demande le mot de passe d'un bracelet, puis enregistre sa lecture ; le serveur dit si le bracelet peut servir.

**Why this priority**: chaque opération en caisse commence par une lecture.

**Independent Test**: avec un faux terminal, demander le mot de passe d'un bracelet actif, enregistrer une lecture, puis rejouer la même lecture et une lecture copiée.

**Acceptance Scenarios**:

1. **Given** un bracelet du prestataire du terminal, **When** le terminal demande son mot de passe (index, UID), **Then** il le reçoit ; le serveur a fait un seul déchiffrement de la clé de données et n'a rien gardé en mémoire.
2. **Given** un bracelet d'un autre prestataire ou inconnu, **When** le terminal demande son mot de passe, **Then** la réponse est la même que pour un bracelet inconnu.
3. **Given** un bracelet actif d'un lot actif, **When** le terminal enregistre une lecture, **Then** il reçoit `OK`, l'identifiant de la lecture, le bracelet et son solde disponible.
4. **Given** un bracelet non activé, bloqué, remplacé, rendu, en fin de vie, d'un lot inactif ou d'un autre événement, **When** le terminal enregistre une lecture, **Then** il reçoit le résultat correspondant, avec le statut HTTP 200.
5. **Given** un UID ou une signature différents de ceux de la personnalisation, ou un compteur déjà vu depuis un autre terminal, **When** le terminal enregistre la lecture, **Then** le bracelet passe en liste noire et une anomalie est ouverte, même si l'opération qui portait la lecture échoue.
6. **Given** la même lecture renvoyée par le même terminal (même UID, même compteur), **When** elle arrive de nouveau, **Then** le terminal reçoit le même résultat et le même identifiant, sans anomalie.
7. **Given** une lecture sans signature alors que le bracelet en a une, **When** le terminal l'enregistre en ligne, **Then** il reçoit `SIGNATURE_MISSING`, sans liste noire ni anomalie.

---

### User Story 5 - Le guichet active un bracelet et encaisse la caution (Priority: P1)

Un agent de guichet active un bracelet pour un festivalier : le bracelet est rattaché à un portefeuille, préchargé si le lot le prévoit, et la caution est prise.

**Why this priority**: c'est l'entrée du festivalier dans le système.

**Independent Test**: activer un bracelet d'un lot avec préchargement et caution, puis lire le bracelet et son solde.

**Acceptance Scenarios**:

1. **Given** un bracelet personnalisé d'un lot actif et un événement qui permet l'activation au guichet, **When** l'agent l'active sans portefeuille, **Then** un portefeuille anonyme est créé au grand livre de l'événement et le bracelet devient actif.
2. **Given** un événement qui n'autorise pas ce mode d'activation, **When** l'agent active, **Then** l'activation est refusée avec la règle citée.
3. **Given** un événement où le compte est obligatoire, **When** l'agent active sans festivalier désigné, **Then** l'activation est refusée.
4. **Given** un lot avec crédits offerts, **When** le bracelet est activé, **Then** les crédits sont posés une seule fois, même si l'activation est rejouée.
5. **Given** un lot à caution prise sur le solde et un solde payé insuffisant, **When** le bracelet est activé, **Then** la caution reste due ; elle sera prise dès qu'un crédit payé arrive.
6. **Given** un lot à caution payée à part, **When** l'agent active sans moyen de paiement de la caution, **Then** l'activation est refusée ; avec des espèces, la caution est détenue.
7. **Given** un bracelet actif, **When** l'agent le consulte, **Then** il voit son statut, son lot, l'état de sa caution et ses portefeuilles, sans jamais voir l'identité ni le mot de passe.

---

### User Story 6 - Le guichet de retour : caution, restitution, remplacement (Priority: P1)

Un agent rend la caution, rend les espèces dues, enregistre la restitution ; ou remplace un bracelet abîmé ou perdu par un neuf.

**Why this priority**: sans cela, un festivalier ne peut ni récupérer sa caution ni continuer après une perte.

**Independent Test**: sur un bracelet actif avec caution, rendre la caution puis restituer ; sur un autre, remplacer par un bracelet neuf et vérifier que portefeuilles et caution ont suivi.

**Acceptance Scenarios**:

1. **Given** un bracelet à caution détenue, **When** l'agent rend la caution, **Then** elle est rendue par le canal de son mode, une seule fois.
2. **Given** un bracelet dont un portefeuille n'est pas soldé, dont la caution est détenue ou qui a des espèces dues, **When** l'agent demande la restitution, **Then** elle est refusée en nommant ce qui reste à faire.
3. **Given** un bracelet soldé, sans caution détenue ni espèces dues, **When** l'agent enregistre la restitution, **Then** le bracelet est rendu ; pour un lot réattribuable, il peut être remis en stock avec une nouvelle identité, et l'ancienne identité présentée ensuite déclenche une suspicion de copie.
4. **Given** des espèces dues sur un bracelet, **When** l'agent les rend, **Then** l'écriture est passée et l'anomalie close ; au-delà du maximum de l'événement pour une seule personne, une seconde personne doit valider sur place.
5. **Given** un bracelet actif ou suspendu et un bracelet neuf du même organisateur, **When** l'agent remplace l'un par l'autre, **Then** l'ancien est remplacé, le neuf reprend tous les portefeuilles sans écriture comptable ni préchargement, et la caution suit le neuf.
6. **Given** un bracelet de remplacement déjà rattaché, déjà sous caution, ou d'un lot dont le mode de caution diffère alors qu'une caution est détenue, **When** l'agent remplace, **Then** le remplacement est refusé.
7. **Given** un bracelet déclaré perdu puis retrouvé, **When** l'agent le signale, **Then** il redevient actif ou part en fin de vie selon le réglage de l'événement.

---

### User Story 7 - Le festivalier rattache son bracelet avec le code imprimé (Priority: P2)

Un festivalier connecté saisit ou scanne le code imprimé sur son bracelet pour le rattacher à son compte ; sans compte, il consulte seulement son solde.

**Why this priority**: nécessaire à l'app festivalier, mais le parcours au guichet suffit à faire tourner un événement.

**Independent Test**: avec un faux festivalier, rattacher un bracelet à solde nul ; puis tenter un bracelet approvisionné et le confirmer au guichet.

**Acceptance Scenarios**:

1. **Given** un bracelet à solde nul et son code, **When** le festivalier saisit le code, **Then** le bracelet est rattaché à son compte et le code ne sert plus.
2. **Given** un code inconnu ou déjà utilisé, **When** le festivalier le saisit, **Then** il reçoit la même réponse dans les deux cas.
3. **Given** un festivalier qui a fait 5 essais dans l'heure, ou un appareil qui en a fait 20 dans la journée, **When** il essaie encore, **Then** il est bloqué temporairement et une alerte est levée.
4. **Given** un bracelet dont le portefeuille anonyme a un solde disponible, **When** le festivalier saisit le code, **Then** une demande en attente est créée (24 heures, 3 au plus par bracelet), il reçoit un code de confirmation à 6 chiffres, et le code imprimé n'est pas consommé.
5. **Given** une demande en attente, **When** le guichet lit le même bracelet et saisit le bon code de confirmation, **Then** le portefeuille est rattaché au festivalier sans mouvement d'argent, le code imprimé est consommé et les autres demandes du bracelet sont annulées.
6. **Given** une demande en attente, **When** le guichet saisit 5 codes de confirmation faux, ou lit un autre bracelet, **Then** la confirmation est refusée et la demande ne peut plus être confirmée.
7. **Given** un code non encore utilisé, **When** une personne sans compte le présente, **Then** elle voit le solde et les 10 derniers mouvements, en lecture seule et sans donnée personnelle.
8. **Given** un bracelet d'un lot réattribuable déjà rattaché une fois par son code, **When** un nouveau porteur saisit le code, **Then** il reçoit la réponse d'un code déjà utilisé.

---

### User Story 8 - Les clés vivent et se retirent sous contrôle (Priority: P2)

Un administrateur de prestataire crée un index de clé, fait tourner la clé de données, retire une clé dédiée après l'événement ; un contrôle quotidien vérifie les mots de passe stockés.

**Why this priority**: indispensable avant la production, pas pour une première démonstration.

**Independent Test**: créer une clé, personnaliser des bracelets, faire tourner la clé de données, lancer le contrôle quotidien, retirer une clé dédiée dont les lots sont clos.

**Acceptance Scenarios**:

1. **Given** un prestataire, **When** l'administrateur demande une nouvelle clé (partagée, ou dédiée à un événement), **Then** la demande passe par une seconde personne, puis la clé existe avec un nouvel index et sa clé de données active.
2. **Given** une clé active, **When** une nouvelle série prend un nouvel index, **Then** l'ancienne clé ne sert plus qu'à déchiffrer.
3. **Given** une clé de données active, **When** l'administrateur demande sa rotation (à deux), **Then** une nouvelle clé de données devient active, l'ancienne ne sert plus qu'à déchiffrer, et les mots de passe sont rechiffrés par tranches jusqu'à ce qu'il n'en reste aucun sous l'ancienne.
4. **Given** des bracelets personnalisés, **When** le contrôle quotidien tourne, **Then** il recalcule 100 bracelets au plus par le KMS, compare avec les valeurs stockées, et lève une alerte au premier écart.
5. **Given** une clé dédiée dont un lot n'est pas clos, **When** l'administrateur demande son retrait, **Then** le retrait est refusé.
6. **Given** une clé dédiée dont tous les lots sont clos, **When** le retrait est approuvé, **Then** la clé et sa clé de données sont retirées, les mots de passe stockés effacés, les bracelets en fin de vie, la clé désactivée dans le KMS et la date de désactivation enregistrée.

---

### User Story 9 - Sortir un bracelet de la liste noire, à deux (Priority: P2)

Après enquête, un superviseur demande la sortie de liste noire d'un bracelet ; une seconde personne valide.

**Why this priority**: une fausse alerte ne doit pas priver durablement un festivalier de son argent, mais l'action est rare.

**Independent Test**: mettre un bracelet en liste noire par une lecture copiée, demander sa sortie, la faire approuver par une autre personne.

**Acceptance Scenarios**:

1. **Given** un bracelet en liste noire, **When** un superviseur demande sa sortie avec un motif, **Then** rien ne change tant qu'une seconde personne n'a pas validé.
2. **Given** la demande, **When** la même personne tente de la valider, **Then** la validation est refusée.
3. **Given** la demande validée par une autre personne habilitée, **Then** le bracelet redevient actif et l'historique porte l'auteur, le valideur et le motif.
4. **Given** un agent habilité, **When** il met un bracelet en liste noire à la main avec un motif, **Then** le bracelet est bloqué aussitôt et l'action est tracée.

---

### User Story 10 - Clore un lot (Priority: P3)

En fin d'événement, l'administrateur clôt un lot : les bracelets en circulation partent en fin de vie et les cautions non rendues sont acquises.

**Why this priority**: opération de fin d'événement, qui peut attendre la première exploitation.

**Independent Test**: clore un lot de 600 bracelets à caution détenue et vérifier que les cautions sont acquises par tranches avant la clôture.

**Acceptance Scenarios**:

1. **Given** un lot dont plus de 500 cautions sont détenues, **When** l'administrateur demande la clôture, **Then** les cautions sont d'abord acquises par tranches, puis le lot est clos.
2. **Given** un lot clos, **Then** ses bracelets ne paient plus, les portefeuilles restent remboursables, et les codes de rattachement jamais associés à une puce sont invalidés.
3. **Given** un lot avec préchargement dont des bracelets actifs n'ont pas été préchargés, **When** l'administrateur lance le rattrapage, **Then** ils le sont par tranches, une seule fois chacun.

### Edge Cases

- Deux postes enregistrent en même temps le même UID : un seul bracelet est créé, l'autre reçoit un conflit.
- Enregistrement d'un bracelet au-delà de la quantité du lot : refusé.
- Mot de passe demandé pour un index dont la clé est retirée : refusé comme bracelet inconnu.
- Lecture embarquée dans une opération qui échoue : la lecture n'est pas enregistrée, un nouvel essai avec la même lecture reste possible, mais la liste noire et l'anomalie d'une lecture suspecte restent.
- Lecture d'un bracelet dont le lot est suspendu (stock volé) : `BATCH_INACTIVE`, sans trace de passage.
- Activation rejouée avec la même clé d'idempotence : même réponse, un seul rattachement, un seul préchargement.
- Activation d'un bracelet d'un lot non réservé sans préciser l'événement : refusée.
- Caution due puis crédit payé reçu : la caution est prise dans une opération distincte ; si cette prise échoue, le crédit reste acquis.
- Remplacement dont l'ancien bracelet a une caution due : la dette suit le nouveau bracelet.
- Demande en attente expirée : elle ne peut plus être confirmée ; une nouvelle demande reste possible dans la limite de 3.
- Quatrième demande en attente sur un même bracelet : refusée.
- Code de rattachement saisi avec un caractère hors alphabet (`0`, `1`, `I`, `O`) : refusé sans compter comme un essai sur un code existant.
- Fichier de correspondance dont un UID est inconnu du lot : ligne rejetée, les autres importées.
- Rotation de la clé de données interrompue : elle reprend où elle s'était arrêtée ; aucun mot de passe n'est perdu.
- KMS indisponible pendant une personnalisation ou une demande de mot de passe : refus explicite et temporaire, rien n'est enregistré à moitié.
- Retrait d'une clé dédiée dont la désactivation dans le KMS échoue : la clé reste retirée en base, la désactivation est retentée et l'absence de date de désactivation reste visible.
- Sortie de liste noire d'un bracelet remplacé entre-temps : refusée.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status |
|----|-------|------------|----------|--------|
| FR-001 | Format B 1.0 | En tant que développeur, je veux encoder et décoder les 28 octets du format B 1.0 (version, index de clé, identité, drapeaux, CRC), avec refus d'un majeur inconnu, acceptation d'un mineur plus récent et refus d'un CRC faux, afin que serveur et terminal lisent la même puce. | High | Open |
| FR-002 | Message de dérivation | En tant que développeur, je veux construire le message de dérivation du mot de passe (compteur, label, prestataire, index, UID, longueur) et en extraire `PWD` et `PACK`, afin qu'un seul calcul du KMS donne le mot de passe d'un bracelet. | High | Open |
| FR-003 | Chiffrement du mot de passe | En tant que développeur, je veux chiffrer et déchiffrer `PWD‖PACK` avec la clé de données, lié au bracelet, au prestataire, à l'index et à l'UID (34 octets stockés), afin qu'un chiffré ne puisse pas être déplacé d'un bracelet à un autre. | High | Open |
| FR-004 | Code de rattachement | En tant que développeur, je veux générer un code de 10 caractères dans l'alphabet de 32 sans ambiguïté, l'afficher en deux groupes, normaliser une saisie (tirets, espaces, casse) et calculer son empreinte, afin que l'impression, la saisie et le serveur s'accordent. | High | Open |
| FR-005 | Deux implémentations conformes | En tant que porteur du projet, je veux la bibliothèque en TypeScript et en Dart, chacune reproduisant tous les vecteurs de `vecteurs_test_bracelet.py`, afin que le serveur et les apps ne divergent jamais. | High | Open |
| FR-006 | Service de gestion des clés substituable | En tant qu'exploitant, je veux que le calcul du mot de passe, la création et le déchiffrement d'une clé de données et la désactivation d'une clé passent par un service de clés remplaçable, livré ici avec un faux qui reproduit les vecteurs, afin de brancher le vrai KMS plus tard sans toucher aux règles. | High | Open |
| FR-007 | Clés de bracelet | En tant qu'`OPERATOR_ADMIN`, je veux créer une clé (nouvel index, partagée ou dédiée à un événement) avec sa clé de données, lister et consulter les clés et leur statut, toute création passant par une seconde personne, afin de maîtriser les séries de bracelets. | High | Open |
| FR-008 | Rotation de la clé de données | En tant qu'`OPERATOR_ADMIN`, je veux faire tourner la clé de données d'un index (à deux) : nouvelle clé active, ancienne en déchiffrement seul, rechiffrement par tranches et suivi de l'avancement, afin de limiter l'exposition d'une clé. | Medium | Open |
| FR-009 | Retrait d'une clé dédiée | En tant qu'`OPERATOR_ADMIN`, je veux retirer une clé dédiée quand tous ses lots sont clos (à deux), ce qui efface les mots de passe stockés, retire les bracelets, désactive la clé dans le service de clés et enregistre la date, afin qu'une clé d'événement ne survive pas à l'événement. | Medium | Open |
| FR-010 | Contrôle quotidien | En tant qu'exploitant, je veux qu'un contrôle recalcule chaque jour le mot de passe de 100 bracelets au plus et le compare à la valeur stockée, avec une alerte tracée au premier écart et un compte rendu de chaque passage, afin de détecter une corruption ou une substitution. | Medium | Open |
| FR-011 | Lots | En tant qu'`ORGANIZER_ADMIN`, je veux créer, lister, consulter et modifier (tant qu'il est commandé) un lot : type, quantité, clé, événement ou non, crédits offerts, caution et mode, mode de clé, politique de réutilisation, référence de commande, afin de préparer les bracelets d'un événement. | High | Open |
| FR-012 | Cycle de vie d'un lot | En tant qu'`ORGANIZER_ADMIN`, je veux faire passer un lot d'un statut au suivant (commandé, personnalisé, livré, actif, suspendu, clos) selon les seuls passages permis par la base, avec un motif pour la suspension, chaque passage étant tracé, afin de savoir quels bracelets peuvent payer. | High | Open |
| FR-013 | Clôture d'un lot et rattrapages | En tant qu'`ORGANIZER_ADMIN`, je veux clore un lot (cautions non rendues acquises par tranches, bracelets en circulation retirés, codes non associés invalidés) et relancer le préchargement des bracelets actifs qui ne l'ont pas été, afin de terminer proprement un événement. | Medium | Open |
| FR-014 | Inventaire d'un lot | En tant qu'`ORGANIZER_ADMIN`, je veux lire l'inventaire d'un lot (commandés, enregistrés, en stock, remis, actifs, suspendus, en liste noire, remplacés, rendus, en fin de vie, manquants), afin de suivre le stock. | Medium | Open |
| FR-015 | Codes générés à la commande | En tant qu'`ORGANIZER_ADMIN`, je veux obtenir une seule fois le fichier de commande d'un lot `PUBLIC` avec un code de rattachement par bracelet, le serveur ne gardant que les empreintes, afin de l'envoyer à l'imprimeur sans que le serveur détienne les codes. | High | Open |
| FR-016 | Enregistrement d'un bracelet personnalisé | En tant que poste de personnalisation, je veux enregistrer un bracelet (empreinte de l'identité, UID, signature d'originalité et sa validité, lot) : le serveur calcule son mot de passe, le stocke chiffré, garde l'empreinte de la signature et me rend le mot de passe à écrire, afin que le bracelet soit connu des terminaux. | High | Open |
| FR-017 | Association du code à la puce | En tant que poste de personnalisation ou qu'`ORGANIZER_ADMIN`, je veux associer le code imprimé à son bracelet, un par un au scan ou par import du fichier de correspondance de l'imprimeur, avec la liste des lignes refusées, afin que le code désigne le bon bracelet. | High | Open |
| FR-018 | Mot de passe d'un bracelet pour un terminal | En tant que terminal authentifié, je veux obtenir le mot de passe d'un bracelet de mon prestataire à partir de son index et de son UID, afin de m'authentifier auprès de la puce sans détenir de clé. | High | Open |
| FR-019 | Lecture d'un bracelet | En tant que terminal authentifié, je veux enregistrer une lecture (empreinte de l'identité, UID, compteur, signature) et recevoir le résultat de la base tel quel, l'identifiant de la lecture, le bracelet et son solde disponible si le résultat est favorable, afin de savoir si le bracelet peut servir. | High | Open |
| FR-020 | Effets de sécurité durables | En tant que responsable de la fraude, je veux que la mise en liste noire et l'anomalie d'une lecture suspecte (UID ou signature différents, compteur déjà vu) soient enregistrées même si l'opération qui portait la lecture échoue, afin qu'une copie soit bloquée dès sa première apparition. | High | Open |
| FR-021 | Activation | En tant qu'agent de guichet, je veux activer un bracelet (remise et rattachement à un portefeuille existant ou à un portefeuille anonyme créé pour l'événement), dans un mode permis par l'événement, avec les crédits offerts du lot posés une seule fois, afin que le festivalier puisse payer. | High | Open |
| FR-022 | Caution | En tant qu'agent de guichet, je veux prendre la caution d'un bracelet (sur le solde payé, ou payée à part en espèces), la voir rester due si le solde ne suffit pas, et la rendre par le canal de son mode, afin de garantir le retour des bracelets. | High | Open |
| FR-023 | Prise d'une caution due | En tant que moteur d'écritures, je veux qu'une opération permette de prendre la caution due d'un bracelet, dans une opération distincte de celle qui a crédité le portefeuille, afin que les missions de recharge l'appellent après chaque crédit payé. | Medium | Open |
| FR-024 | Consultation d'un bracelet | En tant qu'agent ou administrateur habilité, je veux consulter un bracelet (statut, lot, caution, portefeuilles, historique des statuts), sans jamais voir l'identité ni le mot de passe, afin de renseigner un festivalier. | Medium | Open |
| FR-025 | Restitution et réattribution | En tant qu'agent de guichet, je veux enregistrer la restitution d'un bracelet soldé, le refus nommant ce qui reste à faire sinon, et, pour un lot réattribuable, le remettre en stock avec une nouvelle identité, afin de boucler le retour. | High | Open |
| FR-026 | Espèces dues | En tant qu'agent de guichet, je veux rendre les espèces dues d'un bracelet, avec la validation sur place d'une seconde personne au-delà du maximum de l'événement, afin de solder un festivalier avant la restitution. | Medium | Open |
| FR-027 | Remplacement | En tant qu'agent de guichet, je veux remplacer un bracelet actif ou suspendu par un bracelet neuf du même organisateur : les portefeuilles et la caution suivent, sans écriture comptable ni préchargement, afin qu'un festivalier garde son argent après une perte. | High | Open |
| FR-028 | Perte et bracelet retrouvé | En tant qu'agent de guichet, je veux déclarer un bracelet perdu (suspendu) et signaler qu'il est retrouvé, le résultat suivant le réglage de l'événement, afin de bloquer un bracelet égaré sans le condamner. | Medium | Open |
| FR-029 | Liste noire et sortie à deux | En tant que `SUPERVISOR`, je veux mettre un bracelet en liste noire avec un motif, et demander sa sortie, effective seulement après validation par une autre personne habilitée, afin de corriger une fausse alerte sans qu'une seule personne puisse lever un blocage. | High | Open |
| FR-030 | Rattachement par code | En tant que festivalier connecté, je veux rattacher un bracelet à mon compte par son code imprimé : immédiatement si son solde est nul, sinon par une demande en attente avec un code de confirmation, la réponse étant la même pour un code inconnu et un code déjà utilisé, afin de retrouver mon bracelet dans l'app. | Medium | Open |
| FR-031 | Limites d'essais | En tant que responsable de la sécurité, je veux au plus 5 essais de code par compte et par heure et 20 par appareil et par jour, puis un blocage temporaire et une alerte, afin d'empêcher la recherche de codes par essais. | Medium | Open |
| FR-032 | Confirmation au guichet | En tant qu'agent de guichet, je veux confirmer une demande en attente en lisant le même bracelet et en saisissant le code de confirmation (5 essais au plus), ce qui rattache le portefeuille sans mouvement d'argent, consomme le code imprimé et annule les autres demandes, afin que seul le porteur du bracelet récupère son solde. | Medium | Open |
| FR-033 | Consultation anonyme du solde | En tant que porteur d'un bracelet sans compte, je veux voir le solde et les 10 derniers mouvements avec le code imprimé, en lecture seule et sans donnée personnelle, tant que le bracelet n'est pas rattaché, afin de connaître mon solde sans créer de compte. | Low | Open |
| FR-034 | Identité du terminal et du festivalier substituable | En tant que porteur du projet, je veux que les routes appelées par un terminal ou par un festivalier reçoivent leur identité (terminal, prestataire, événement, point de vente ; compte, appareil) d'un fournisseur d'identité remplaçable, livré ici avec un faux pour les tests, afin que les missions des terminaux et de l'app festivalier branchent l'identité réelle sans modifier ces routes. | High | Open |
| FR-035 | Audit et historique | En tant que contrôleur, je veux une ligne d'audit pour chaque action d'administration (clé, lot, code, personnalisation, liste noire) et l'historique de chaque changement de statut d'un bracelet ou d'un lot (motif, auteur, valideur, date), afin de reconstituer la vie d'un bracelet. | High | Open |
| FR-036 | Contrat d'API et types générés | En tant que développeur des apps, je veux que toutes les routes de cette mission figurent au contrat d'API (celles déjà décrites servies telles quelles, celles du back-office ajoutées avec les mêmes conventions) et que les types TypeScript et Dart en soient régénérés, afin de coder les apps contre un contrat à jour. | High | Open |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Conformité aux vecteurs | 100 % des vecteurs de `vecteurs_test_bracelet.py` reproduits à l'octet près par chacune des deux bibliothèques, vérifié à chaque commit en CI. | Reliability | High | Open |
| NFR-002 | Aucun secret en clair au repos | 0 identité de bracelet, 0 mot de passe, 0 clé de données et 0 code de rattachement en clair dans la base, les journaux, le journal d'audit et les réponses d'erreur ; vérifié par un test qui recherche les valeurs de test dans la base et dans la sortie des journaux après un parcours complet. | Security | High | Open |
| NFR-003 | Durée de vie d'un secret en mémoire | Un mot de passe ou une clé de données déchiffrés sont effacés avant la fin de la requête qui les a demandés ; au plus 1 déchiffrement de clé de données par requête de mot de passe ; vérifié par un test sur le faux service de clés (compte des appels) et sur les tampons. | Security | High | Open |
| NFR-004 | Isolation entre prestataires | 0 bracelet, lot, clé, code, demande ou lecture d'un autre prestataire lisible ou modifiable ; vérifié par un test à deux prestataires sur chaque route de la mission et par un test en base sur chaque nouvelle table. | Security | High | Open |
| NFR-005 | Séparation des droits sur les clés | Les routes publiques de l'API ne peuvent appeler ni le calcul d'un mot de passe ni le déchiffrement d'une clé de données : 0 appel possible hors du service des clés de bracelet, du service de personnalisation et du contrôle quotidien, vérifié par un test d'architecture. | Security | High | Open |
| NFR-006 | Latence | Demande de mot de passe et enregistrement d'une lecture : p95 ≤ 200 ms et p99 ≤ 500 ms côté serveur, mesurés sur une base de 100 000 bracelets ; activation : p95 ≤ 500 ms. | Performance | Medium | Open |
| NFR-007 | Pas d'énumération | Pour un code inconnu et un code déjà utilisé : même statut, même corps, et un écart de temps de réponse médian inférieur à 20 ms sur 200 essais de chaque sorte. | Security | Medium | Open |
| NFR-008 | Traitements par tranches | Clôture d'un lot, préchargement de rattrapage et rechiffrement traitent au plus 500 bracelets par tranche, peuvent être relancés sans double effet, et vont au bout sur un lot de 5 000 bracelets. | Reliability | Medium | Open |
| NFR-009 | Tests existants verts | Les suites de la base (947 assertions), les tests des missions 1 à 3 (876) et le rejeu du scénario de référence restent verts en CI à chaque commit. | Reliability | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Les fonctions de la base font les règles | Les règles des bracelets, lots, cautions et lectures sont celles des fonctions du schéma de référence ; l'API les appelle sans les réécrire (§2.2). | Technical | High | Open |
| C-002 | Fichiers générés du kit intouchables | Les fichiers `.sql` générés de `packages/ledger-sql/` ne sont jamais modifiés à la main ; tout ajout au schéma (S19) passe par une migration et sa suite de tests en base. | Technical | High | Open |
| C-003 | Vecteurs du kit comme vérité | `vecteurs_test_bracelet.py` fait foi pour le format et la cryptographie ; un écart avec le texte de la spécification est signalé, jamais tranché en silence (§0.3). | Technical | High | Open |
| C-004 | Pas d'adaptateur AWS | Le service de clés réel (AWS KMS) n'est pas livré : port et faux seulement (décision du porteur, 13/10/2026). | Business | High | Open |
| C-005 | Identités réelles hors mission | L'enrôlement des terminaux, la signature de leurs requêtes et les comptes des festivaliers ne sont pas livrés : port d'identité et faux seulement (décision du porteur, 13/10/2026). | Business | High | Open |
| C-006 | Pas de lecture NFC ni d'outil de poste | Le code de lecture ou d'écriture de la puce (terminal Android, poste de personnalisation) n'est pas dans cette mission. | Business | High | Open |
| C-007 | Pas de paiement ni de recharge | Paiements, recharges, remboursement du solde, mobile money, hors ligne et passerelle relèvent des missions 5 à 9 ; ici, la caution payée à part se règle en espèces seulement. | Business | High | Open |
| C-008 | Contrat d'abord | Toute route est décrite au contrat d'API avant d'être servie ; les types sont générés, jamais écrits à la main. | Technical | High | Open |
| C-009 | Aucun écran | La mission ne livre aucune interface ; le back-office web est la mission 11. | Business | Medium | Open |
| C-010 | Bracelets pour le cashless seulement | Un bracelet ne sert ni de billet ni de contrôle d'accès (ADR-41). | Business | Medium | Open |

### Key Entities

- **Bracelet** : support d'un festivalier ; empreinte de l'identité, UID, index de clé, empreinte de la signature d'originalité, mot de passe chiffré, lot, statut, état de la caution, empreinte du code de rattachement.
- **Lot** : série de bracelets d'un organisateur, réservée ou non à un événement ; type, quantité, clé, crédits offerts, caution, politique de réutilisation, statut, historique.
- **Clé de bracelet** : clé de dérivation d'un prestataire pour un index ; partagée ou dédiée à un événement ; statut actif, déchiffrement seul ou retirée.
- **Clé de données** : clé qui chiffre les mots de passe d'un index, stockée chiffrée ; une seule active par index.
- **Lecture** : présentation d'un bracelet à un terminal, avec compteur et résultat ; sert à une seule écriture.
- **Rattachement** : lien daté entre un bracelet et un portefeuille.
- **Code de rattachement** : empreinte d'un code imprimé, rattachée à un lot puis à un bracelet ; date d'utilisation.
- **Demande en attente** : demande de rattachement d'un bracelet approvisionné ; compte, bracelet, statut, empreinte du code de confirmation, essais, expiration, terminal et agent de confirmation.
- **Essai de code** : trace d'un essai (compte, appareil, date, résultat) qui sert aux limites.
- **Anomalie** : signalement ouvert par une lecture suspecte ou par des espèces dues.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : les deux bibliothèques reproduisent 100 % des vecteurs du kit, et rendent des octets identiques pour 1 000 entrées tirées au hasard.
- **SC-002** : un parcours complet (créer une clé, commander un lot, personnaliser, activer avec caution, lire, remplacer, rendre la caution, restituer, clore le lot) se déroule par l'API sans aucune intervention directe en base.
- **SC-003** : 100 % des lectures copiées testées (UID différent, signature différente, compteur rejoué depuis un autre terminal) mettent le bracelet en liste noire, y compris quand l'opération qui portait la lecture échoue.
- **SC-004** : après ce parcours, aucune identité, aucun mot de passe et aucun code de rattachement en clair n'est retrouvé dans la base ni dans les journaux.
- **SC-005** : aucune fuite entre deux prestataires sur l'ensemble des routes de la mission.
- **SC-006** : un tiers qui connaît seulement le code imprimé d'un bracelet approvisionné ne peut pas le rattacher : 0 rattachement sans lecture du bracelet au guichet sur les cas testés.
- **SC-007** : aucune sortie de liste noire, création, rotation ou retrait de clé n'est effective avec une seule personne.
- **SC-008** : la mission des terminaux peut brancher l'identité réelle du terminal sans modifier une seule route livrée ici (vérifié par le remplacement du faux dans un test).

## Assumptions

- Le poste de personnalisation est représenté, côté serveur, par une personne habilitée du prestataire (rôle à arrêter au plan parmi les rôles existants) ; aucun nouveau rôle humain n'est créé sans décision du porteur.
- Le serveur calcule le mot de passe à l'enregistrement et le rend au poste, qui l'écrit dans la puce ; l'ordre exact des étapes du poste (§7.5) reste de la responsabilité de l'outil de poste, hors mission.
- La validité de la signature d'originalité est vérifiée par le poste (clé publique NXP) et déclarée au serveur ; le serveur en garde l'empreinte et la compare à chaque lecture.
- Les routes de terminal et de festivalier déjà décrites au contrat sont servies telles quelles ; si une contradiction apparaît entre le contrat, le schéma et la spécification, elle est signalée et la règle de §0.3 s'applique.
- Le contrôle quotidien est livré comme une opération déclenchable et testable ; son ordonnancement en production (planificateur) relève de l'exploitation.
- L'alerte d'un blocage d'essais ou d'un écart au contrôle quotidien est une trace exploitable (anomalie ou journal d'audit) ; l'envoi de notifications relève d'une mission ultérieure.
- Le fichier de commande est remis une seule fois à l'administrateur ; son format (colonnes, encodage) est arrêté au plan.
- La création d'un compte festivalier est hors mission : le faux festivalier fournit un identifiant de compte ; un portefeuille est anonyme ou rattaché à cet identifiant.
- Les plafonds réglementaires du portefeuille (§6.3) ne sont pas exercés ici au-delà de ce que font déjà les fonctions de la base.
- Les codes `CL` de la base sont traduits en erreurs normalisées par le mécanisme de la mission 1 ; les erreurs `MEDIA_*` du contrat sont utilisées pour les opérations d'écriture.

## Decisions

| # | Question | Décision du porteur (13/10/2026) |
|---|---|---|
| 1 | Routes de terminal alors que l'enrôlement arrive en mission 5 | Servies ici derrière un port d'identité du terminal, avec un faux pour les tests ; la mission 5 branche l'enrôlement réel |
| 2 | Bibliothèque Dart sans SDK sur le poste | Livrée ici, prouvée en CI et en local ; SDK Dart 3.8 installé sur le poste avec l'accord du porteur |
| 3 | Adaptateur AWS KMS | Ports et faux seulement ; l'adaptateur réel viendra quand la région et les comptes AWS seront arrêtés |
| 4 | Résumé d'intention et hypothèses (port d'identité du festivalier, routes back-office ajoutées au contrat, périmètre exclu, caution à part en espèces) | Confirmé (« ok ») |
