# Mission Specification: Adaptateurs conformes aux documentations des fournisseurs choisis (mission 12b-1)

**Mission Branch**: `feat/adaptateurs-fournisseurs-choisis`
**Created**: 2026-11-26
**Status**: Draft
**Input**: User description: "Mission 12b-1 (entrée « Mission 12b-1 » de PROMPTS-A-ENVOYER.md, PRD.md §2.8, décision du porteur du 26/11/2026) : si les placeholders des services externes ne prennent pas en compte leur fonctionnement, les rendre conformes à leur documentation en ligne pour qu'il ne reste qu'à mettre les identifiants et les clés ; ne rien faire pour les fournisseurs pas encore décidés."

Les services externes sont aujourd'hui servis par des faux, refusés en production. Leur modèle commun est calqué sur
un seul fournisseur (Stripe) et ne suit pas le fonctionnement réel des autres : Wave signe autrement ses notifications,
PayDunya ne les signe pas du tout. Cette mission écrit, pour chaque fournisseur **déjà choisi**, un adaptateur réel
conforme à sa documentation publique, de sorte qu'il ne reste au porteur qu'à poser les identifiants et les clés, puis à
lancer un essai contre le vrai service. Elle est la première partie de la mission 12b et ne demande aucun accès
extérieur.

Décisions du porteur du 26/11/2026 : (1) Orange Money : documentation officielle introuvable hors du portail Sonatel
(accès par compte) ; hors périmètre jusqu'à ce que le porteur la fournisse ; (2) PayDunya : sa notification est un
**simple signal** ; rien n'est crédité avant la relecture du statut auprès de PayDunya par un appel authentifié ; écart
de sécurité à consigner ; (3) chaque adaptateur reste **refusé en production** jusqu'à un essai réel réussi, levé
service par service par une modification relue ; (4) mission Spec Kitty ; (5) Stripe inclus, son éligibilité au Sénégal
restant à vérifier par le porteur ; (6) remboursement au payeur d'un paiement non crédité : reste hors plateforme
(OP-N82).

Sources lues le 26/11/2026 : docs.wave.com (checkout, webhook, business, balance-api) ; SDK officiels PayDunya
(`paydunyadev/paydunya-node-master`, `paydunyadev/paydunya-woocommerce-gateway`), le site de documentation de PayDunya
refusant la lecture automatique ; developer.orange.com (Orange Money Web Payment, sans contenu technique) et
developer.orange-sonatel.com (accès par compte).

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| **Fournisseur choisi** | Service externe retenu par une décision du porteur ou un ADR (Wave, PayDunya, Stripe, AWS) | « intégration » seul |
| **Fournisseur non décidé** | Service dont le fournisseur n'est pas retenu (SMS, WhatsApp, OIDC, matériel de la passerelle, banque) ou dont la documentation n'est pas accessible (Orange Money) | — |
| **Faux** | Implémentation de test d'un port, refusée en production | « mock », « placeholder » |
| **Adaptateur réel** | Implémentation d'un port qui parle au vrai service selon sa documentation | « connecteur » |
| **Essai réel** | Exécution d'une commande d'essai contre le vrai service (bac à sable ou compte de test) avec les identifiants du porteur | « test » seul (réservé aux tests automatiques, sans réseau) |
| **Notification** | Appel entrant d'un PSP annonçant un changement de statut d'un paiement | « webhook » en prose, « callback » |
| **Signal** | Notification dont l'origine est vérifiée mais dont le contenu n'est pas cru : elle déclenche une relecture du statut auprès du PSP | — |
| **Garde de production** | Refus de démarrer en configuration de production avec un faux ou un adaptateur non essayé | — |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recharger par Wave (Priority: P1)

Un festivalier recharge son portefeuille en ligne par Wave. Le serveur ouvre une session de paiement Wave, le
festivalier paie dans l'application Wave, Wave notifie le serveur, et le portefeuille est crédité une seule fois.

**Why this priority**: Wave est le premier moyen de paiement mobile au Sénégal ; sans adaptateur conforme, aucune
recharge en ligne réelle n'est possible.

**Independent Test**: Contre un serveur local qui rejoue les réponses et les notifications documentées par Wave :
ouverture de session, notification signée valide, notification rejouée, notification forgée.

**Acceptance Scenarios**:

1. **Given** une configuration Wave d'un détenteur des fonds, **When** une recharge est demandée, **Then** une session Wave est ouverte au montant exact en XOF, avec la référence de la demande, et l'adresse de paiement Wave est rendue.
2. **Given** une session payée, **When** Wave envoie sa notification signée selon sa documentation, **Then** elle est acceptée et le portefeuille est crédité une fois.
3. **Given** une rotation de la clé de notification, **When** l'en-tête porte plusieurs signatures, **Then** la notification est acceptée si l'une d'elles est valide.
4. **Given** une notification dont la signature, l'horodatage ou le corps sont faux ou hors délai, **When** elle arrive, **Then** elle est refusée et rien n'est crédité.
5. **Given** une journée de paiements Wave, **When** le relevé est lu, **Then** chaque paiement, frais et annulation de la journée apparaît comme ligne de relevé rapprochable.

---

### User Story 2 - Recharger par PayDunya (Priority: P1)

Un festivalier recharge par PayDunya. Le serveur crée une facture PayDunya, le festivalier paie sur la page PayDunya,
PayDunya notifie le serveur ; le serveur vérifie l'origine, puis relit le statut de la facture auprès de PayDunya avant
de créditer.

**Why this priority**: PayDunya est l'agrégateur local retenu pour la carte et le paiement mobile ; sa notification ne
prouve pas son contenu, ce qui impose un parcours différent des autres.

**Independent Test**: Contre un serveur local qui rejoue les réponses documentées de PayDunya : facture créée,
notification d'origine valide suivie d'une confirmation « payée », notification valide suivie d'une confirmation
« non payée », notification d'origine fausse.

**Acceptance Scenarios**:

1. **Given** une configuration PayDunya, **When** une recharge est demandée, **Then** une facture est créée au montant exact et l'adresse de paiement PayDunya est rendue.
2. **Given** une notification d'origine valide, **When** PayDunya, interrogé, confirme le paiement, **Then** le portefeuille est crédité une fois, au montant confirmé par PayDunya.
3. **Given** une notification d'origine valide, **When** PayDunya, interrogé, ne confirme pas le paiement, **Then** rien n'est crédité et une anomalie est enregistrée.
4. **Given** une notification dont la preuve d'origine est fausse, **When** elle arrive, **Then** elle est refusée sans appel à PayDunya.

---

### User Story 3 - Recharger par carte avec Stripe (Priority: P2)

Un festivalier paie par carte via Stripe, avec authentification 3-D Secure. Stripe notifie le serveur, qui crédite une
fois.

**Why this priority**: carte internationale ; l'éligibilité d'un marchand établi au Sénégal reste à vérifier.

**Independent Test**: Contre un serveur local qui rejoue les réponses documentées de Stripe, avec les vecteurs de
signature de sa documentation.

**Acceptance Scenarios**:

1. **Given** une configuration Stripe, **When** une recharge par carte est demandée, **Then** un paiement Stripe est ouvert au montant exact en XOF, avec 3-D Secure exigé.
2. **Given** une notification Stripe signée selon sa documentation, **When** elle arrive dans le délai, **Then** elle est acceptée ; hors délai ou mal signée, elle est refusée.
3. **Given** une période, **When** le relevé Stripe est lu, **Then** chaque mouvement de solde de la période apparaît comme ligne de relevé.

---

### User Story 4 - Garder les secrets des PSP dans le coffre AWS (Priority: P1)

Le porteur range les identifiants de chaque PSP, par détenteur des fonds, dans AWS Secrets Manager. Le serveur les lit
par leur référence ; un détenteur ne lit jamais les secrets d'un autre.

**Why this priority**: sans coffre réel, aucun identifiant PSP ne peut être posé en production.

**Independent Test**: Contre un serveur local qui rejoue les réponses documentées de Secrets Manager.

**Acceptance Scenarios**:

1. **Given** un secret rangé sous la référence d'un détenteur, **When** le serveur le lit pour une configuration de ce détenteur, **Then** il obtient la valeur courante et, en rotation, la précédente avec son échéance.
2. **Given** une configuration d'un autre détenteur, **When** elle demande cette référence, **Then** la lecture est refusée.
3. **Given** un coffre indisponible, **When** un secret est demandé, **Then** un refus « coffre indisponible » est rendu, sans valeur ni référence dans le message.

---

### User Story 5 - Clés des bracelets, signature des snapshots et copie des scellements sur AWS (Priority: P2)

Les processus du service de clés, de personnalisation, du contrôle quotidien, d'administration des clés et de
signature des snapshots utilisent AWS KMS ; le scellement du journal est copié sur un stockage S3 à écriture unique.

**Why this priority**: lève le dernier faux de ces processus ; bloque la production des bracelets, du hors-ligne et du
scellement hors base.

**Independent Test**: Contre un serveur local qui rejoue les réponses documentées de KMS et de S3, et en vérifiant
qu'un résultat (signature, MAC, clé de données) se vérifie ou se rouvre comme avec le faux actuel.

**Acceptance Scenarios**:

1. **Given** une clé de signature des snapshots, **When** un snapshot est signé, **Then** la signature produite se vérifie avec la clé publique servie, au même format qu'aujourd'hui.
2. **Given** une clé de dérivation, **When** le mot de passe d'un bracelet est calculé, **Then** il a le format attendu par le bracelet.
3. **Given** un scellement, **When** il est copié, **Then** la copie est écrite en écriture unique avec une durée de rétention, et sa relecture rend la même empreinte.
4. **Given** un processus, **When** il démarre, **Then** il ne reçoit que les droits KMS de son rôle, comme aujourd'hui.

---

### User Story 6 - Passer un service en production après essai (Priority: P1)

Le porteur pose les identifiants et les clés d'un service, lance sa commande d'essai contre le vrai service, puis lève la
garde de production de ce seul service par une modification relue.

**Why this priority**: c'est le résultat attendu par le porteur : « il ne reste qu'à mettre les identifiants et les
clés ».

**Independent Test**: La garde de production refuse le démarrage avec un adaptateur non essayé, même configuré ; la
commande d'essai, lancée sans identifiants, échoue avec un message clair.

**Acceptance Scenarios**:

1. **Given** un adaptateur réel configuré mais non essayé, **When** le processus démarre en production, **Then** il refuse de démarrer en nommant le service.
2. **Given** les identifiants d'un service, **When** sa commande d'essai est lancée, **Then** elle exécute le parcours minimal documenté du service (création, lecture du statut, vérification d'une notification ou d'une signature) et rend un compte rendu sans aucun secret.
3. **Given** la liste des paramètres à poser pour un service, **When** le porteur la consulte, **Then** elle nomme chaque identifiant et chaque clé, où les ranger, et rien d'autre à coder.

---

### Edge Cases

- Notification reçue deux fois (le PSP en renvoie) : un seul crédit.
- Notification arrivée avant la réponse d'ouverture de la session : traitée sans crédit en double.
- Montant notifié différent du montant demandé : refus et anomalie, jamais de crédit au montant notifié.
- Devise autre que XOF : refus.
- PSP injoignable lors de la relecture du statut (PayDunya) : la notification n'est pas perdue, la relecture est reprise plus tard ; rien n'est crédité entre-temps.
- Session expirée côté PSP avant paiement : la demande passe à l'état annulé seulement si le PSP le confirme.
- Rotation de la clé de notification : l'ancienne n'est plus acceptée après son échéance.
- Réponse du service à un format inattendu : refus, journalisé sans secret ni corps complet.
- Erreur de débit (429) ou indisponibilité (5xx) du service : nouvel essai borné, sans double opération.
- Coffre ou KMS indisponible au démarrage : le processus démarre en mode dégradé documenté ou refuse, selon le comportement actuel du faux.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Port des PSP fidèle à chaque fournisseur | En tant que porteur, je veux que le port commun des PSP laisse chaque fournisseur vérifier sa notification selon son propre mécanisme (format de l'en-tête, contenu signé, rotation, présence ou absence d'horodatage), afin que les adaptateurs réels suivent leur documentation sans affaiblir les autres. | High | Open | [build] | no |
| FR-002 | Session de paiement Wave | En tant que festivalier, je veux qu'une recharge Wave ouvre une session de paiement Wave conforme à sa documentation (montant, devise XOF, référence, adresses de retour), afin de payer dans l'application Wave. | High | Open | [build] | no |
| FR-003 | Notification Wave | En tant que prestataire, je veux qu'une notification Wave soit acceptée seulement si l'une de ses signatures est valide pour le contenu signé que décrit Wave, dans le délai documenté, afin qu'aucune notification forgée ou rejouée ne crédite. | High | Open | [build] | no |
| FR-004 | Statut, annulation et relevé Wave | En tant que prestataire, je veux relire le statut d'une session Wave, l'annuler quand Wave le permet, et lire le relevé des transactions d'une journée, afin de rapprocher les paiements. | High | Open | [build] | no |
| FR-005 | Facture PayDunya | En tant que festivalier, je veux qu'une recharge PayDunya crée une facture PayDunya conforme à sa documentation, afin de payer sur la page PayDunya. | High | Open | [build] | no |
| FR-006 | Notification PayDunya traitée comme un signal | En tant que prestataire, je veux qu'une notification PayDunya ne soit acceptée qu'avec une preuve d'origine valide, puis qu'aucun crédit n'ait lieu avant la confirmation du paiement par un appel authentifié à PayDunya, au montant confirmé (la devise étant celle de la configuration, XOF, PayDunya n'en rendant pas), afin de compenser l'absence de signature du contenu. | High | Open | [build] | no |
| FR-007 | Paiement par carte Stripe | En tant que festivalier, je veux qu'une recharge par carte ouvre un paiement Stripe avec 3-D Secure exigé, conforme à la documentation de Stripe, afin de payer par carte. | Medium | Open | [build] | no |
| FR-008 | Notification, statut, annulation et relevé Stripe | En tant que prestataire, je veux vérifier les notifications Stripe selon leur documentation (contenu signé, plusieurs signatures, délai), relire un statut, annuler, et lire les mouvements de solde d'une période, afin de rapprocher. | Medium | Open | [build] | no |
| FR-009 | Coffre AWS des secrets PSP | En tant que porteur, je veux que les secrets des PSP soient lus dans AWS Secrets Manager, par référence liée au détenteur des fonds, avec un secret courant et un précédent à échéance, afin de poser les identifiants sans toucher au code. | High | Open | [build] | no |
| FR-010 | Clés des bracelets et des snapshots sur KMS | En tant que porteur, je veux que les cinq ports de clés (MAC, clé de données, déchiffrement, signature, administration) soient servis par AWS KMS selon sa documentation, avec des résultats au même format qu'aujourd'hui, afin que bracelets et snapshots fonctionnent avec de vraies clés. | High | Open | [build] | no |
| FR-011 | Copie des scellements sur S3 à écriture unique | En tant que porteur, je veux que chaque scellement soit copié sur un stockage S3 en écriture unique avec rétention, et relu par sa référence, afin de détecter une réécriture complète de la base. | Medium | Open | [build] | no |
| FR-012 | Attestations Android et Apple vérifiées | En tant que porteur, je veux que la vérification d'attestation Android et Apple App Attest, déjà branchée, soit comparée à la documentation de Google et d'Apple, et corrigée seulement en cas d'écart, afin qu'il ne reste que la configuration à poser. | Medium | Open | [build] | yes |
| FR-013 | Garde de production par service | En tant que porteur, je veux que tout adaptateur réel non essayé contre son vrai service fasse refuser le démarrage en production, service par service, en nommant le service, afin qu'aucun adaptateur non éprouvé ne traite de l'argent ou des clés réels. | High | Open | [build] | no |
| FR-014 | Commande d'essai par service | En tant que porteur, je veux une commande d'essai par service qui, avec mes identifiants, exécute le parcours minimal du service contre le vrai service et rend un compte rendu sans secret, afin de prouver l'adaptateur avant de lever sa garde. | High | Open | [build] | no |
| FR-015 | Liste des paramètres à poser | En tant que porteur, je veux, par service, la liste exacte des identifiants et clés à poser, où les ranger et la commande d'essai à lancer, afin qu'il ne reste rien à coder. | High | Open | [build] | no |
| FR-016 | Fournisseurs non décidés inchangés | En tant que porteur, je veux que les faux d'Orange Money, des codes SMS et WhatsApp, du serveur d'identité, du matériel de la passerelle et de la banque restent tels quels, afin de ne rien présumer d'un fournisseur non choisi. | High | Open | [build] | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Aucun réseau en test | 0 appel réseau vers un service externe pendant les tests automatiques ; les réponses documentées sont rejouées par des serveurs locaux, et un test échoue si un adaptateur vise une adresse externe. | Fiabilité | High | Open |
| NFR-002 | Vecteurs tirés des documentations | 100 % des vérifications de signature de notification sont testées avec au moins un exemple publié par la documentation du fournisseur lorsqu'elle en publie un, et avec un cas forgé, un cas rejoué et un cas hors délai. | Sécurité | High | Open |
| NFR-003 | Aucun secret journalisé | 0 secret, identifiant, clé ou corps de notification complet dans les journaux, comptes rendus d'essai et messages d'erreur, vérifié par un test qui parcourt les sorties. | Sécurité | High | Open |
| NFR-004 | Délais bornés | Chaque appel à un service externe a un délai maximal (10 s par défaut, réglable) et au plus 2 nouveaux essais sur erreur de débit ou d'indisponibilité, sans répéter une opération non idempotente. | Fiabilité | High | Open |
| NFR-005 | Crédit unique | 0 double crédit sur 100 notifications identiques rejouées en parallèle, pour chaque PSP. | Fiabilité | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Contrat d'API stable | Le contrat partagé (`openapi.yaml`) ne change pas, sauf ajout rétrocompatible présenté au porteur avant d'être codé. | Contrat | High | Open |
| C-002 | Aucun faux en production | Un faux ou un adaptateur non essayé fait refuser le démarrage en configuration de production, et un test le prouve (règle du porteur du 13/10/2026). | Sécurité | High | Open |
| C-003 | Écart PayDunya consigné | La preuve d'origine de PayDunya, plus faible que la règle actuelle du port, a une entrée dans `docs/POINTS_OUVERTS.md`, un ADR, et un test qui échoue si un crédit a lieu sans confirmation. | Sécurité | High | Open |
| C-004 | Dépendances épinglées | Toute dépendance nouvelle est choisie et épinglée selon `docs/08-pile-logicielle.md`. | Technique | High | Open |
| C-005 | Un droit par processus | Chaque processus ne reçoit que les droits KMS et coffre de son rôle, comme les ports actuels ; aucun processus public ne reçoit de droit de clé. | Sécurité | High | Open |
| C-006 | Fichiers générés intacts | Les fichiers `.sql` générés de `packages/ledger-sql/` ne sont pas modifiés à la main. | Technique | High | Open |

### Key Entities *(include if the mission involves data)*

- **Configuration PSP** (existante) : fournisseur, détenteur des fonds, référence de secret ; ajout éventuel : environnement (bac à sable ou production).
- **Notification PSP** (existante) : corps brut gardé, statut de traitement ; ajout : état « en attente de confirmation » pour un signal.
- **Ligne de relevé PSP** (existante) : date, montant, frais, référence du paiement, sens.
- **Paramètres d'un service** : liste nommée des identifiants et clés, emplacement (coffre, configuration), commande d'essai.
- **Essai réel d'un service** : service, date, résultat, sans secret ; condition de levée de la garde.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pour chacun des 6 services du périmètre (Wave, PayDunya, Stripe, Secrets Manager, KMS, S3), la liste des paramètres à poser ne contient que des identifiants, des clés et des références, et aucune étape de code. — [build] · no-op passable: no
- **SC-002**: 100 % des notifications forgées, rejouées ou hors délai des suites de test sont refusées, et 0 crédit PayDunya n'a lieu sans confirmation. — [build] · no-op passable: no
- **SC-003**: 100 % des processus de production refusent de démarrer avec un adaptateur non essayé ou un faux, chacun en nommant le service. — [build] · no-op passable: no
- **SC-004**: 0 faux de fournisseur non décidé modifié (Orange Money, SMS, WhatsApp, OIDC, matériel de la passerelle, banque). — [build] · no-op passable: no

## Assumptions

- Les ports existants (`PspAdapter`, `PspSecretStore`, ports KMS, `SealExternalCopy`) restent la frontière ; seul `PspAdapter` évolue (FR-001).
- Les comptes, clés et bacs à sable des fournisseurs ne sont pas disponibles pendant la mission ; les essais réels sont lancés par le porteur après la mission.
- La région AWS reste `eu-west-3` provisoire (OP-N11) et se règle par configuration.
- Wave : délai de notification de 5 minutes (documentation) ; PayDunya : aucun horodatage, aucun relevé ni remboursement documenté ; Stripe : délai de 300 s (documentation).
- Le remboursement au payeur d'un paiement non crédité reste hors plateforme (OP-N82, décision du 26/11/2026).
- Orange Money entrera dans une mission suivante dès que le porteur fournira la documentation du portail Sonatel.
