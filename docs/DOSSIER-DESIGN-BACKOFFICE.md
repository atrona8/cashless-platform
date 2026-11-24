# Back-office web cashless — dossier de design fonctionnel

> **Copie de dépôt du 24/11/2026.** Source : document Claude Docs « Back-office web cashless — dossier de design
> fonctionnel » (claude.ai/artifact/1JNhpeW929zF6dY1w6Vh77), exporté en Markdown. La copie du checkout, non indexée, a
> été perdue le 23/11/2026 ; ce fichier la remplace. Le document en ligne reste la version de travail.

16 novembre 2026 (revu le 17/11/2026)

## Synthèse

L'interface web à construire est le **back-office**, déjà prévu dans le projet comme la **mission 11 « Back-office web » (déléguée)**. Le projet fixe déjà sa pile, son périmètre et un brouillon de commande `/spec-kitty.specify` dans `PROMPTS-A-ENVOYER.md`. Ce dossier en est la matière d'entrée.

Ce que le projet tranche déjà :

- **Publics** : plateforme, prestataire, organisateur, commerçant (`SPECIFICATION.md` §1.2). Le festivalier n'a pas de portail web en V1 (§1.3) : il passe par l'app Flutter.
- **Pile** : Next.js 15, React 19, Tailwind 4, shadcn/ui, TanStack Query 5, axios, types générés depuis `openapi.yaml` (`docs/08-pile-logicielle.md` §2).
- **Langues** : toutes les interfaces en français et en anglais (§15) ; étendu le 17/11 à l'espagnol, au portugais et à l'italien pour le back-office.
- **Contrat** : `packages/contracts/openapi.yaml` (OpenAPI 3.1, 185 chemins, 222 opérations) fait foi.

Ce que le projet ne dit pas : niveau d'accessibilité, identité visuelle, produit du serveur d'identité, et plusieurs routes de lecture dont le back-office a besoin (section « Manques de l'API »).

**Démarche recommandée.** Créer d'abord la charte du projet (aucune n'existe : pas de `.kittify/charter/`), puis ouvrir la mission 11 avec `/spec-kitty.specify` nourri par ce dossier. En parallèle, ouvrir une mission serveur pour les routes manquantes, sinon plusieurs écrans n'auront rien à afficher.

Chaque élément ci-dessous est marqué **\[déduit\]** (lu dans le code, le contrat ou les specs) ou **\[hypothèse\]** (proposition à valider).

## Contrat d'API

Le contrat est en format machine, à jour (18/11/2026) et assez riche pour générer le client du front. Il n'y a rien à reconstituer. \[déduit\]

| Élément | Constat | Effet sur le front |
| --- | --- | --- |
| Portée | 155 opérations en `humanBearer` (personnes) ; une dizaine sont pour l'app festivalier (/me, paiement d'un QR) | Le back-office couvre environ 140 opérations |
| Hors V1 | 8 opérations `x-release: V2` (intentions de paiement, webhooks sortants) | À exclure des écrans |
| Montants | Entiers en unités mineures, toujours avec la devise ISO 4217 de l'événement (`XOF` en exemple) | Composant de montant unique, sans flottant |
| Dates | RFC 3339 en UTC ; chaque événement porte un fuseau IANA (`Africa/Dakar`) | Affichage dans le fuseau de l'événement |
| Pagination | Curseur (`cursor`, `limit`, `has_more`) | Listes « charger plus » ou défilement, pas de numéros de page |
| Erreurs | RFC 9457, 97 codes stables (`ProblemCode`), `errors[].pointer` par champ, `violations` pour les bornes | Erreurs de champ et bannières générées depuis le code |
| Idempotence | `Idempotency-Key` obligatoire sur toute écriture (UUID) | Clé générée par formulaire, réutilisée en cas de nouvel essai |
| Double validation | Les actions à deux répondent `202` avec une demande `PENDING` (27 actions, expiration 24 h) | État « en attente d'approbation » dans tous les écrans concernés |
| Langue | `Accept-Language` `fr` ou `en`, `fr` par défaut ; les 97 codes ont un message dans les deux langues côté API | Le front envoie la langue choisie |
| Rôles | Écrits dans le texte des descriptions, pas dans un champ lisible par une machine | Matrice des permissions à maintenir à la main (voir décisions) |

Depuis le 18/11/2026, les routes des missions 9a (remboursements) et 9b (clôture, versements, rapprochements, relevés, export comptable) sont dans `main`. Mode d'emploi des 20 opérations de la 9b : `docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md`.

## Acteurs et permissions

Six rôles du personnel utilisent le back-office, chacun sur une portée. \[déduit : `StaffRole`, `RoleScopeType`, SPECIFICATION §3.2\] Une même personne peut avoir plusieurs rôles sur plusieurs portées. Le front doit donc proposer un **sélecteur d'espace** (prestataire, organisateur, événement, commerçant). La portée s'emboite : plateforme ⊃ prestataire ⊃ organisateur ⊃ événement ; prestataire ⊃ commerçant.

| Rôle | Portée | Ce qu'il fait au back-office |
| --- | --- | --- |
| `PLATFORM_ADMIN` | Plateforme | Prestataires, contrats plateforme–prestataire, redevances, profils de législation, configuration plateforme, autres administrateurs plateforme |
| `OPERATOR_ADMIN` | Prestataire | Organisateurs, commerçants, contrats, configuration du prestataire, clés de bracelet, plafond hors ligne, configurations PSP, personnes et rôles, terminaux, bascule vers la passerelle |
| `ORGANIZER_ADMIN` | Organisateur ou événement | Événements et leurs statuts, participations, points de vente, frais, catalogues, lots de bracelets, terminaux et codes d'enrôlement, politique hors ligne, choix des PSP, sessions de caisse, dépôts en banque, remboursements |
| `SUPERVISOR` | Événement | Trous de séquence, import du journal d'un terminal révoqué, liste noire, annulation hors délai, sessions de caisse ; seconde personne des actions à deux |
| `MERCHANT_ADMIN` | Commerçant | Vendeurs et PIN, catalogue si l'organisateur le délègue, consultation de ses paiements et participations |
| `CASHIER` | Événement | Surtout sur le terminal ; au back-office : identification d'un festivalier (KYC), perte et récupération d'un bracelet, lecture des lots |

Deux acteurs restent hors du back-office. `PERSONALIZER` est l'agent du **poste de personnalisation** : il écrit la clé et le mot de passe dans la puce des bracelets nominatifs avant l'événement, avec un lecteur NFC, sur un processus serveur séparé (`main.personalization.ts`). Ce poste a son propre outil. \[décidé le 17/11\] Le festivalier, lui, passe par l'app mobile.

Règles transverses \[déduit\] :

- Le prestataire de la session vient de l'identité, jamais d'un paramètre (§10.3). Un objet d'un autre prestataire répond `404` neutre : le front ne doit pas distinguer « absent » et « interdit ».
- Le valideur d'une action à deux doit avoir le rôle exigé sur la même portée et être distinct de l'auteur. Le bouton « Approuver » est masqué à l'auteur.
- Les rôles par opération sont dans les descriptions du contrat ; l'API les vérifie dans ses services. Le front s'en sert pour masquer, pas pour protéger.

### Gestion des identités aujourd'hui

L'API ne gère ni mot de passe ni écran de connexion : elle délègue l'authentification à un **serveur d'identité OIDC externe**, dont le produit reste à choisir (PRD §4, mission 12b). \[déduit : `apps/api/src/identity/`, contrat `identity.md` de la mission 2\]

1. La personne se connecte chez le serveur d'identité, qui remet au back-office un jeton d'accès court (JWT signé `RS256` ou `ES256`).
2. Le back-office envoie ce jeton dans `Authorization: Bearer` à chaque appel.
3. L'API vérifie la signature, l'émetteur et l'audience (variables `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`), puis retrouve la personne en base par le couple émetteur et identifiant (`iss`, `sub`).
4. Les rôles et leurs portées viennent de la base, jamais du jeton. Une personne désactivée est refusée (`401`) même avec un jeton valide.

Conséquences pour le back-office : il doit mener la connexion OIDC lui-même (flux « code d'autorisation » avec PKCE) et rafraîchir le jeton. Une personne doit d'abord exister chez le serveur d'identité avant d'être créée dans la plateforme avec son `issuer` et son `subject`. Le premier administrateur est créé en ligne de commande (`bootstrap-admin`). En développement, seuls les tests disposent d'un faux serveur d'identité : il en faudra un utilisable par le back-office.

## Inventaire des écrans

Je propose **47 écrans** en cinq espaces : 40 sont servis par l'API au 18/11/2026, 4 n'ont pas encore de route et 3 ne dépendent pas de l'API. \[hypothèse sur le découpage ; déduit pour l'état de l'API\] Une « fiche » regroupe la consultation et ses actions ; une création simple se fait en panneau latéral, pas en page.

| ID | Écran | Rôles | API |
| --- | --- | --- | --- |
| **Transverse** |  |  |  |
| T1 | Connexion (serveur d'identité OIDC) | Tous | Hors API |
| T2 | Accueil et sélecteur d'espace | Tous | Manquant (qui suis-je) |
| T3 | Demandes d'approbation : liste filtrée par statut et action | Tous les rôles qui approuvent | Servi |
| T4 | Demande d'approbation : détail, approuver, refuser avec note | Idem | Servi |
| T5 | Introuvable ou accès refusé, session expirée | Tous | — |
| T6 | Préférences : langue | Tous | Local |
| **Plateforme** |  |  |  |
| P1 | Prestataires : liste et création | `PLATFORM_ADMIN` | Servi |
| P2 | Fiche prestataire : contrats plateforme et versions, redevances, plafond hors ligne | `PLATFORM_ADMIN` | Servi |
| P3 | Profils de législation : liste, fiche, nouvelle version | `PLATFORM_ADMIN` | Servi |
| P4 | Configuration de la plateforme : versions | `PLATFORM_ADMIN` | Servi |
| P5 | Administrateurs de la plateforme | `PLATFORM_ADMIN` | Servi |
| **Prestataire** |  |  |  |
| O1 | Organisateurs : liste et création | `OPERATOR_ADMIN` | Servi |
| O2 | Fiche organisateur : contrats et versions, configuration, politique hors ligne | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | Servi |
| O3 | Commerçants : liste, fiche, création | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | Servi |
| O4 | Personnes et rôles : liste, fiche, attribution, retrait, désactivation | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | Servi |
| O5 | Configuration du prestataire et règles de frais | `OPERATOR_ADMIN` | Servi |
| O6 | Plafond hors ligne du prestataire | `OPERATOR_ADMIN` | Servi |
| O7 | Clés de bracelet : liste, fiche, création, rotation, retrait (à deux) | `OPERATOR_ADMIN` | Servi |
| O8 | Travaux de clé et contrôles quotidiens | `OPERATOR_ADMIN` | Servi |
| O9 | Configurations PSP : liste, fiche, activation ou suspension (à deux) | `OPERATOR_ADMIN` | Servi |
| O10 | Terminaux : liste filtrée | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | Servi |
| O11 | Fiche terminal : suspendre, réactiver, révoquer, politique hors ligne, import du journal | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR` | Servi |
| O12 | Codes d'enrôlement : création (affichage en QR), liste | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | Servi |
| O13 | Autorité de débit : état, bascule vers la passerelle, rendu, reprise forcée | `OPERATOR_ADMIN` | Servi |
| **Organisateur et événement** |  |  |  |
| E1 | Événements : liste filtrée par statut | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR` | Servi |
| E2 | Création d'un événement (assistant en étapes) | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` | Servi |
| E3 | Tableau de bord de l'événement : statut, conditions du passage suivant, passage | `ORGANIZER_ADMIN` | Servi (chiffres manquants) |
| E4 | Réglages de l'événement et configuration résolue | `ORGANIZER_ADMIN` | Servi |
| E5 | Participations et points de vente | `ORGANIZER_ADMIN`, `MERCHANT_ADMIN` | Servi |
| E6 | Catalogue d'un point de vente : catégories, articles, versions, délégation | `ORGANIZER_ADMIN`, `MERCHANT_ADMIN` | Servi |
| E7 | Lots de bracelets : liste, fiche, inventaire, codes imprimés, clôture | `ORGANIZER_ADMIN` | Servi |
| E8 | Bracelets : liste, fiche, liste noire, perte, récupération | `OPERATOR_ADMIN`, `SUPERVISOR`, `CASHIER` | Servi |
| E9 | Politique hors ligne et risque maximal | `ORGANIZER_ADMIN` | Servi |
| E10 | Remontée des terminaux et trous de séquence | `ORGANIZER_ADMIN`, `SUPERVISOR` | Servi |
| E11 | Sessions de caisse : liste, fiche, fermeture | `ORGANIZER_ADMIN`, `SUPERVISOR` | Servi |
| E12 | Choix des PSP de l'événement | `ORGANIZER_ADMIN` | Servi |
| E13 | Actions financières à deux : dépôt en banque, déblocage de portefeuille, contestation tardive | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | Servi |
| E14 | Remboursements : liste, détail, proposer, refuser, confirmer `PAID` ou `FAILED` | `ORGANIZER_ADMIN` | Servi (9a, dans `main` le 16/11/2026) |
| E15 | Réclamation tardive après la casse | `ORGANIZER_ADMIN` | Servi (9a, dans `main` le 16/11/2026) |
| E16 | Paiement : consultation et annulation (à deux) | `ORGANIZER_ADMIN`, `SUPERVISOR` | Servi par identifiant seulement |
| E17 | Identification d'un festivalier (KYC) et révocation | `CASHIER`, `ORGANIZER_ADMIN` | Servi |
| E18 | Clôture et versements | `ORGANIZER_ADMIN` | Servi (9b, dans `main` le 18/11/2026) |
| E19 | Anomalies (compte d'attente, trous, PSP) | `ORGANIZER_ADMIN`, `SUPERVISOR` | Manquant |
| E20 | Relevés et exports comptables | `ORGANIZER_ADMIN` | Servi (9b, dans `main` le 18/11/2026) |
| E21 | Modèles de téléphone et niveau NFC | `ORGANIZER_ADMIN` | Manquant |
| **Commerçant** |  |  |  |
| M1 | Vendeurs : liste, création, nouveau PIN, désactivation | `MERCHANT_ADMIN` | Servi |
| M2 | Ventes par article et par taux | `MERCHANT_ADMIN` | Manquant |

Le catalogue (E6) sert aussi au commerçant quand l'organisateur le délègue : un seul écran, droits différents.

## Matrice écran ↔ mission ↔ opérations

Chaque écran servi s'appuie sur des `operationId` du contrat et sur les cas d'usage d'une mission (`kitty-specs/<mission>/docs/use-case.md`). \[déduit\] Les numéros de mission suivent `PROMPTS-A-ENVOYER.md`.

| Écran | Mission (cas d'usage) | Opérations |
| --- | --- | --- |
| T3, T4 | 2 identité et double validation | `listApprovalRequests`, `getApprovalRequest`, `approveApprovalRequest`, `rejectApprovalRequest` |
| P1, P2 | 3 configuration | `listOperators`, `createOperator`, `getOperator`, `updateOperator`, `listPlatformContracts`, `createPlatformContract`, `createPlatformContractVersion`, `listPlatformFeeRules`, `createPlatformFeeRule` |
| P3 | 3 configuration | `listJurisdictionProfiles`, `createJurisdictionProfile`, `getJurisdictionProfile`, `createJurisdictionProfileVersion` |
| P4 | 3 configuration | `listPlatformConfigVersions`, `createPlatformConfigVersion` |
| P5, O4 | 2 identité | `createPlatformAdmin`, `listUsers`, `createUser`, `getUser`, `disableUser`, `grantRole`, `revokeRole` |
| O1, O2 | 3 configuration | `listOrganizers`, `createOrganizer`, `getOrganizer`, `updateOrganizer`, `listOrganizerContracts`, `createOrganizerContract`, `createOrganizerContractVersion`, `listOrganizerConfigVersions`, `createOrganizerConfigVersion` |
| O3 | 3 configuration | `listMerchants`, `createMerchant`, `getMerchant`, `updateMerchant` |
| O5 | 3 configuration | `listOperatorConfigVersions`, `createOperatorConfigVersion`, `listFeeRules`, `createFeeRule`, `replaceFeeRule` |
| O6, E9 | 7 hors ligne | `getOfflineCeiling`, `setOfflineCeiling`, `get/setOrganizerOfflinePolicy`, `get/setEventOfflinePolicy`, `get/setDeviceOfflinePolicy`, `getEventOfflineRisk` |
| O7, O8 | 4 bracelets | `listTagKeys`, `requestTagKey`, `getTagKey`, `requestDekRotation`, `requestTagKeyRetirement`, `listTagKeyJobs`, `retryTagKeyJob`, `listTagKeyCheckRuns` |
| O9 | 6 recharges et PSP | `listPspConfigurations`, `createPspConfiguration`, `getPspConfiguration`, `requestPspConfigurationChange` |
| O10, O11 | 5a terminaux, 7 hors ligne | `listDevices`, `getDevice`, `suspendDevice`, `reactivateDevice`, `revokeDevice`, `importDeviceJournal`, `getDeviceJournalImport` |
| O12 | 5a terminaux | `createDeviceEnrollmentCode`, `listDeviceEnrollmentCodes` |
| O13 | 8 passerelle | `getDebitAuthority`, `requestDebitAuthorityChange` |
| E1 à E4 | 3 configuration | `listEvents`, `createEvent`, `getEvent`, `updateEvent`, `getResolvedEventConfig`, `getEventStatusConditions`, `transitionEventStatus` |
| E5 | 3 configuration | `listParticipations`, `createParticipation`, `getParticipation`, `updateParticipation`, `listPointsOfSale`, `createPointOfSale`, `getPointOfSale`, `renamePointOfSale` |
| E6 | 5b encaissement | `getCatalog`, `createCatalogCategory`, `updateCatalogCategory`, `createCatalogItem`, `updateCatalogItem`, `getCatalogVersion`, `setCatalogPolicy` |
| E7 | 4 bracelets | `listMediaBatches`, `createMediaBatch`, `getMediaBatch`, `updateMediaBatch`, `setMediaBatchStatus`, `getMediaBatchInventory`, `issueClaimCodeOrder`, `importClaimCodeAssociations`, `closeMediaBatch`, `catchUpBatchPreload` |
| E8 | 4 bracelets | `listMedia`, `getMediaAdmin`, `blacklistMedia`, `requestMediaReinstatement`, `reportMediaLost`, `recoverMedia` |
| E10 | 7 hors ligne | `getEventDeviceSyncStatus`, `waiveSeqGap` |
| E11 | 6 recharges et caisses | `listCashSessions`, `getCashSession`, `closeCashSession` |
| E12 | 6 recharges et PSP | `getEventPspSelections`, `setEventPspSelection` |
| E13 | 6 recharges et PSP | `requestCashDeposit`, `requestWalletUnblock`, `requestLateChargeback` |
| E14, E15 | 9a remboursements | `listRefundRequests`, `approveRefundRequest`, `rejectRefundRequest`, `confirmRefundRequest`, `postLateClaim` |
| E16 | 5b encaissement | `getPayment`, `reversePayment` |
| E17 | 6 caisses (identité réelle en 10) | `createKycVerification`, `revokeKycVerification` |
| M1 | 5b encaissement | `listVendors`, `createVendor`, `getVendor`, `setVendorPin`, `setVendorStatus` |
| E18 | 9b versements, rapprochements et clôture | listEventClosingSteps, previewEventClosingStep, executeEventClosingStep, getEventRemainingBalances, listPayoutEntitlements, requestPayoutBatch, listPayouts, exportPayoutBatch, confirmPayout, postLateAdjustment |
| E20 | 9b versements, rapprochements et clôture | importAccountStatement, listStatementLines, matchStatementLine, getLedgerReconciliation, getPartyStatement, listAccountMappings, createAccountMappingVersion, exportAccounting |

Le détail des rôles par opération est dans la description de chaque opération du contrat. Une table complète des quelque 140 opérations du back-office peut être générée et jointe à la spec de la mission.

## Parcours d'interaction

La double validation est le parcours qui touche le plus d'écrans : 27 actions du contrat le suivent. \[déduit : SPECIFICATION §3.2, `ApprovalAction`\] Chaque écran qui déclenche une de ces actions doit afficher « envoyé pour approbation », pas « fait ».

*(Schéma « double validation au back-office · 3 étapes, 3 issues » non repris : perdu à l'export ; voir `docs/05-sequence-diagrams.md`, flux « Double validation au back-office ».)*

La demande expirée est renvoyée `EXPIRED` dès la lecture. Au guichet, la seconde personne valide sur place par un jeton `X-Approval-Token` de 5 min : c'est l'app terminal, pas le back-office.

**Autres parcours clés** \[déduit des use-cases\]

1. **Cycle d'un événement** (E1 à E4) : création en `DRAFT`, inscription des commerçants et points de vente, catalogue, lots de bracelets, codes d'enrôlement des terminaux, PSP. Passage à `LIVE` à deux, puis `CLOSING`, `RECONCILING`, `SETTLING`, `REFUND_WINDOW`, `CLOSED`. Avant chaque passage, l'écran lit les conditions (`getEventStatusConditions`) et montre celles qui manquent. Pendant `LIVE`, modifier les réglages, une participation, une règle de frais ou un PSP passe à deux.
2. **Lot de bracelets** (E7) : commande, fichier des codes de rattachement produit une seule fois, import de la correspondance de l'imprimeur, personnalisation, livraison, activation, clôture.
3. **Terminal** (O10 à O12, E10) : code d'enrôlement affiché en QR, suivi du terminal, suspension ou révocation ; après une coupure, remontée des terminaux, trous de séquence levés à deux, import du journal d'un terminal révoqué à deux.
4. **Remboursement** (E14) : demande `REQUESTED` (ou `AWAITING_HOLDER` vers un autre numéro), proposition d'approbation, approbation à deux (`PROCESSING`), paiement hors système, confirmation `PAID` ou `FAILED` ; `FAILED` refusé à qui a proposé ou approuvé.
5. **Coupure réseau** (O13) : bascule de l'autorité de débit vers la passerelle, rendu au central, reprise forcée à deux si la passerelle est perdue.

## Composants

Les composants se déduisent des formes du contrat : 222 schémas, au moins 12 énumérations de statut, 27 actions à deux. \[déduit\] Ceux de base viennent de shadcn/ui, déjà retenu ; les composants métier sont à spécifier.

**Composants métier**

| Composant | Tiré de | Variantes et états | Écrans |
| --- | --- | --- | --- |
| Montant | `Amount`, `SignedAmount`, `Currency` | positif, négatif, nul ; devise sans décimale (`XOF`) ou avec ; saisie et lecture | E3, E11, E13, E14, E16, P3 |
| Badge de statut | 12 énumérations : événement, bracelet, lot, terminal, demande d'approbation, remboursement, session de caisse, portefeuille, clé, PSP, vendeur, recharge | une couleur sémantique par famille d'état + texte + icône | Toutes les listes |
| Stepper de cycle d'événement | `EventStatus` (7 statuts) et `getEventStatusConditions` | statut courant, conditions remplies ou non, passage à deux vers `LIVE` | E3 |
| Carte de demande d'approbation | `ApprovalRequest`, `ApprovalAction` | `PENDING`, `EXPIRED` avec compte à rebours (24 h), `EXECUTED`, `FAILED` ; auteur ne peut pas approuver | T3, T4, bannière dans les écrans d'origine |
| Bannière « envoyé pour approbation » | réponses `202` | lien vers la demande, état suivi | O7, O9, E3, E10, E13, E14 |
| Fenêtre de confirmation d'action critique | révocation, liste noire, clôture de lot, passage de statut | simple, avec ressaisie du nom, avec note obligatoire | O11, E3, E7, E8, T4 |
| Jauge de risque hors ligne | `getEventOfflineRisk`, politique `capped` | sous plafond, plafonné par le prestataire | E9 |
| Tableau des versions | configurations, contrats, profils, catalogues versionnés | version courante, historique, date d'effet | P2 à P4, O2, O5, E6 |
| Code d'enrôlement en QR | `createDeviceEnrollmentCode` | QR, code en clair, expiration, déjà utilisé | O12 |
| Indicateur d'autorité de débit | `DebitAuthorityState`, époque | central, passerelle, bascule en cours | O13, en-tête de l'événement |
| Inventaire de lot | `MediaBatchInventory` | répartition des bracelets par statut | E7 |
| Éditeur de catalogue | catégories et articles, libellés `fr` et `en`, prix, taux de TVA en points de base | actif, inactif, délégué | E6 |
| Champ de libellé bilingue | `label_fr`, `label_en` | une langue manquante signalée | E6 |
| Champ de téléphone international | motif `^\+[1-9][0-9]{6,14}$` | indicatif, erreur de format | O4, E17 |

**Composants de base** (shadcn/ui) : bouton, champ, liste déroulante, case, interrupteur, date et heure avec fuseau, fenêtre modale, panneau latéral, onglets, info-bulle, notification, bannière, fil d'Ariane, menu.

**Gabarits d'écran** : liste paginée par curseur avec filtres et état vide ; fiche avec en-tête, onglets et actions ; formulaire de création en panneau ; assistant en étapes (E2) ; tableau de bord d'événement (E3).

Ce que le projet ne dit pas \[hypothèse\] : densité par défaut « tableau » pour les listes (usage bureau), édition en panneau latéral plutôt qu'en page, pas d'édition en ligne dans les tableaux (chaque écriture demande une clé d'idempotence et peut partir en approbation).

## Tokens de design

Les catégories de tokens se déduisent des composants ; leurs valeurs relèvent de votre identité de marque, absente du projet. \[catégories déduites ; valeurs à fournir\] shadcn/ui et Tailwind 4 s'appuient sur des variables CSS : les tokens prennent cette forme.

| Catégorie | Tokens nécessaires | Pourquoi dans ce projet |
| --- | --- | --- |
| Couleurs de marque | primaire, secondaire, accent, avec leurs états survol, actif, désactivé | Boutons, liens, sélection |
| Couleurs neutres | fond, surface, surface élevée, bordure, texte principal, texte secondaire | Tableaux denses, fiches |
| Couleurs sémantiques | succès, avertissement, erreur, information, neutre | Badges de statut, bannières, erreurs `problem+json` |
| Familles d'état | actif, en attente, bloqué ou suspendu, terminé, annulé ou révoqué | Les 12 énumérations de statut se ramènent à ces cinq familles |
| Autorité de débit | central, passerelle, bascule en cours | Indicateur toujours visible pendant une coupure |
| Action à deux | en attente d'approbation, expirée | Distinguer « fait » de « demandé » |
| Typographie | famille, échelle (au moins 6 tailles), graisses, **chiffres tabulaires** pour les montants | Colonnes de montants alignées |
| Espacement | échelle de 4 px ; densité compacte et confortable | Listes longues au bureau |
| Rayons, ombres, bordures | 3 rayons, 2 niveaux d'élévation | Panneaux, modales |
| Focus | couleur et épaisseur de l'anneau de focus | Accessibilité au clavier |
| Thème | clair ; sombre en option | À décider |
| Mouvement | durées courte et moyenne, réduction si l'utilisateur la demande | Panneaux, notifications |

Décidé le 17/11 : l'IA propose un jeu par défaut avec la compétence frontend-design, personnalisé à terme. Il serait rangé dans un fichier de tokens versionné du dépôt, cité par la charte et le plan.

## Internationalisation

Le projet est déjà prêt pour une interface bilingue français-anglais ; aucun manque bloquant côté serveur. \[déduit\]

| Sujet | Constat dans le projet | Exigence pour le front |
| --- | --- | --- |
| Langues | Toutes les interfaces en `fr` et `en` (SPECIFICATION §15) | Cinq catalogues complets : français, anglais, espagnol, portugais, italien ; `fr` par défaut ; aucune langue de droite à gauche \[décidé le 17/11\] |
| Langue envoyée à l'API | `Accept-Language`, `fr` par défaut, poids `q` respectés (`apps/api/src/http/language.ts`) | Envoyer la langue choisie sur chaque requête |
| Messages d'erreur | Codes stables ; les 96 codes ont un titre et un détail en `fr` et en `en` côté API (`messages.fr.json`, `messages.en.json`) | Afficher le message par code depuis le catalogue du front, avec le titre de l'API en repli |
| Libellés saisis | Articles et catégories du catalogue en `label_fr` et `label_en` (1 à 120 caractères) | Saisie côte à côte des deux langues ; afficher celle de l'utilisateur |
| Montants | Entiers en unités mineures avec code ISO 4217 ; devise unique par événement ; plusieurs devises possibles entre événements (§6.4) | Format par `Intl.NumberFormat` selon la langue et le nombre de décimales de la devise (0 pour `XOF`) |
| Dates | RFC 3339 en UTC ; fuseau IANA par événement | Afficher dans le fuseau de l'événement, en le nommant ; saisir dans ce fuseau |
| Pays | Codes ISO 3166 sur les profils de législation, organisateurs, commerçants | Noms de pays traduits par `Intl.DisplayNames` |
| Téléphones | Format E.164 | Saisie avec indicatif |
| Taux | TVA en points de base (0 à 10 000) | Affichage en pourcentage localisé |
| Identifiants et codes | En anglais dans le contrat (statuts, actions) | Toujours traduits à l'affichage, jamais montrés bruts |

Effet de l'ajout de l'espagnol, du portugais et de l'italien : l'API ne répond qu'en français ou en anglais, et les articles du catalogue n'ont que deux libellés. Le front affiche donc les erreurs depuis son propre catalogue, par code, dans les cinq langues. Pour les articles, il montre le libellé anglais aux trois nouvelles langues, sauf si l'équipe serveur ajoute des libellés. Reste à décider le choix de la langue (préférence du navigateur ou réglage de la personne). Aucune préférence de langue n'est stockée côté serveur pour le personnel : `StaffUser` n'a pas de champ langue.

## Accessibilité

La cible est **WCAG 2.2 niveau AA, sans prise en charge des lecteurs d'écran en V1**. \[décidé le 17/11\] Le back-office est **responsive** : ordinateur, tablette et téléphone.

Ce retrait laisse de côté une partie de AA : textes alternatifs, rôles et noms des composants, annonces des messages (critères 1.1.1, 4.1.2, 4.1.3). On ne pourra donc pas déclarer le back-office conforme AA. Les composants Radix sous shadcn/ui gardent toutefois leur balisage de base, sans effort de plus.

**Exigences retenues pour la V1**

- Clavier : tout se fait au clavier ; ordre de tabulation logique ; anneau de focus visible ; fenêtres modales et panneaux qui gardent le focus et se ferment par Échap.
- Formulaires : chaque champ a une étiquette visible ; chaque erreur `errors[].pointer` s'affiche sous son champ ; résumé des erreurs en tête de formulaire.
- Couleur : contraste AA (4,5:1 pour le texte) ; un statut n'est jamais porté par la couleur seule (badge avec texte et icône) ; un montant négatif a un signe.
- Responsive : mise en page lisible de 320 px à 1 920 px de large ; zoom à 200 % sans perte ; cibles tactiles d'au moins 24 × 24 px ; les tableaux larges passent en cartes ou défilent horizontalement sur petit écran.
- Actions critiques (révocation d'un terminal, liste noire, clôture d'un lot, passage de statut) : confirmation explicite, avec le nom de l'objet concerné.
- Expirations (demande d'approbation de 24 h, session) affichées en clair ; la session prévient avant d'expirer et propose de prolonger.

**Hors V1** : régions vivantes et annonces vocales, tests avec NVDA ou VoiceOver.

## Manques de l'API

Depuis la 9b, le contrat sert l'administration, la clôture, les versements et les relevés, mais pas encore toute la **lecture de l'activité** : ni ventes, ni anomalies. Un back-office sans ces vues ne permet pas de piloter un événement. La spécification le prévoit déjà (§10.4 : « endpoints du back-office à ajouter »). \[déduit\]

| # | Manque | Écrans bloqués | Gravité | Mission qui le porterait |
| --- | --- | --- | --- | --- |
| 1 | Aucune route « qui suis-je » pour le personnel : ses rôles, ses portées, son `user_id`. Les rôles sont relus en base, pas dans le jeton | T2, toute la navigation par rôle | Bloquant | Nouvelle mission serveur ou 11a |
| 2 | Pas de liste des paiements et ventes (par événement, point de vente, commerçant, article, taux) ; un paiement ne se lit que par son identifiant | M2, E16, chiffres de E3 | Bloquant | Nouvelle mission serveur |
| 3 | Pas de liste des anomalies (compte d'attente `S-ATTENTE`, recharges PSP non créditées, trous) ni de leur résolution `ANOMALY_RESOLUTION` | E19 | Bloquant pour l'exploitation | Nouvelle mission serveur (non couvert par la 9b) |
| 4 | Clôture, versements (`PAYOUT`), relevés, exports comptables, écritures manuelles (`ADJUSTMENT`) | E18, E20 | Levé | Servi par la 9b (18/11/2026) |
| 5 | Liste des modèles de téléphone et de leur niveau NFC, exigée au back-office par §15 | E21, alerte sur la fiche terminal | Moyen | Nouvelle mission serveur |
| 6 | Recherche d'un bracelet par UID ou code imprimé, d'un portefeuille, d'un festivalier | E8 (filtres limités au lot et au statut) | Moyen | Nouvelle mission serveur |
| 7 | Créer une personne exige son `issuer` et son `subject` OIDC : pas de parcours d'invitation | O4 | Moyen, lié au choix du serveur d'identité | 12b |
| 8 | Rôles par opération seulement en texte | Toute la matrice des permissions | Faible, mais coûteux à maintenir | Ajouter une extension `x-roles` au contrat |

Règle du projet à respecter (`PROMPTS-A-ENVOYER.md`) : toute route demandée par l'équipe cliente passe par l'équipe serveur. Ces huit points sont donc à soumettre avant ou pendant la spécification du back-office.

Consigné dans le dépôt le 23/11/2026 : les manques 1, 2, 3, 5, 6 et 8 forment le point ouvert **OP-N170** (`docs/POINTS_OUVERTS.md`, numéro OP-N164 d'origine repris entre-temps par la mission 10a) ; le manque 7 forme **OP-N171**, reporté dans `PRD.md` §2.7 et §2.12 et dans la mission 11 de `PROMPTS-A-ENVOYER.md`.

## Décisions à prendre

Sept décisions ont été prises le 17/11 (marquées « Décidé »). Restent ouvertes : qui code (1), la mission serveur (2), l'ordre et le parcours pilote revus (3, 4), le thème sombre (9), la connexion (12) et le champ des rôles (14). Les quatre premières conditionnent la spécification.

| # | Question | Défaut proposé ou décision du 17/11 | Où la consigner |
| --- | --- | --- | --- |
| 1 | Qui code le back-office : l'équipe déléguée prévue, ou vous avec Claude dans ce dépôt ? | Vous, dans le monorepo (`apps/backoffice`), pour profiter des types générés et de la charte | Plan de la mission 11 |
| 2 | Faut-il ouvrir une mission serveur pour les manques 1, 2, 3, 5 et 6 avant le back-office ? | Oui, en parallèle, avant les écrans d'activité | `PROMPTS-A-ENVOYER.md`, `PRD.md` |
| 3 | Ordre de livraison des espaces | Revu le 17/11, dans l'ordre des dépendances : socle et transverse, plateforme, prestataire, organisateur et événement, commerçant | Spec de la mission 11 |
| 4 | Parcours pilote | Revu le 17/11 : créer un organisateur et son contrat, créer un événement, lire ses conditions, demander `LIVE`, faire approuver par une seconde personne | Spec de la mission 11 |
| 5 | Niveau d'accessibilité | **Décidé** : WCAG 2.2 AA, sans lecteurs d'écran en V1 | Charte |
| 6 | Obligations légales par pays d'exploitation | **Décidé** : non bloquant pour la V1, à vérifier plus tard | Charte |
| 7 | Langues au-delà de `fr` et `en`, écriture de droite à gauche | **Décidé** : français, anglais, espagnol, portugais, italien ; aucune langue de droite à gauche | Charte |
| 8 | Identité visuelle : couleurs, polices, logo, ton | **Décidé** : charte proposée par l'IA avec la compétence `frontend-design`, personnalisée à terme | Document de référence de la charte + fichier de tokens |
| 9 | Thème sombre | Non en V1 | Plan |
| 10 | Appareils cibles | **Décidé** : responsive, sur ordinateur, tablette et téléphone | Spec (contexte d'usage) |
| 11 | Navigateurs et technologies d'assistance de recette | **Décidé** : Chrome, Firefox, Safari, Edge (deux dernières versions), sur ordinateur et mobile ; aucun lecteur d'écran | Spec (critères d'acceptation) |
| 12 | Serveur d'identité (produit à choisir, PRD §4) et connexion en développement | Connexion OIDC par code d'autorisation avec PKCE (voir « Gestion des identités aujourd'hui ») ; faux serveur d'identité local en développement, refusé en production | Plan de la mission 11 ; produit en 12b |
| 13 | Écran du poste de personnalisation dans le back-office ou à part | **Décidé** : hors du back-office ; le poste de personnalisation a son propre outil | Spec |
| 14 | Écrire dans le contrat, pour chaque opération, la liste des rôles autorisés (champ `x-roles`), pour que le front masque menus et boutons sans recopier ces règles à la main | Oui, par l'équipe serveur ; non bloquant pour la V1 | Mission serveur, contrôle de stabilité du contrat |

Ne consignez pas ces décisions dans les tâches ou les lots : ils sont régénérés depuis la spec et le plan.

## Suite avec Spec Kitty

Le projet utilise Spec Kitty 3.2.7, sans charte à ce jour. Une fois les décisions prises, l'enchaînement proposé est le suivant.

**Même projet, pas un nouveau.** Le back-office est une nouvelle mission (la 11) du projet Spec Kitty existant, dans le même dépôt et le même `kitty-specs/`, à côté des dix missions du serveur. La **charte** est un document de règles commun à toutes les missions, que Spec Kitty propose de créer par `/spec-kitty.charter`. Ce projet n'en a jamais créé : ses règles sont aujourd'hui dans `CLAUDE.md`, `SPECIFICATION.md` et `DECISIONS_ADR.md`. La créer maintenant ne change rien au serveur déjà livré ; elle donne aux missions suivantes, back-office compris, un endroit unique pour les règles d'interface décidées le 17/11.

1. **Charte** : `/spec-kitty.charter`, avec les décisions 5 à 8 (accessibilité, obligations légales, langues, identité visuelle en document de référence). Elle vaudra pour toutes les missions, back-office compris.
2. **Mission serveur des routes de lecture** (décision 2) : une entrée « Mission N » dans `PROMPTS-A-ENVOYER.md` et le besoin reporté dans `PRD.md`, dans le même geste, comme l'exige `CLAUDE.md`. Puis `/spec-kitty.specify` sur les manques 1, 2, 3, 5, 6 et 8.
3. **Mission 11 back-office** : `/spec-kitty.specify` en partant du brouillon déjà écrit dans `PROMPTS-A-ENVOYER.md`, enrichi de ce dossier : acteurs, inventaire des écrans, matrice, parcours, composants, internationalisation, accessibilité, critères d'acceptation par parcours.
4. **Plan** : `/spec-kitty.plan` avec la pile de `08-pile-logicielle.md`, l'emplacement du code, le client généré depuis `@cashless/contracts`, la gestion des clés d'idempotence, la connexion OIDC et le faux de développement, les tests de bout en bout (Playwright) par parcours.
5. **Lots** : un lot socle (connexion, sélecteur d'espace, client d'API, erreurs, i18n, gabarits), puis un lot par parcours complet.
6. **Parcours pilote** (décision 4) : implémenté seul, relu, puis spec et plan corrigés avant les autres lots.
7. Après le plan et après la review, `spec-kitty-docs-maintain` (automatique avec les commandes `/spec-kitty.*`).

**Faire utiliser `frontend-design` par l'IA.** Spec Kitty ne lance pas lui-même l'IA : c'est Claude Code qui exécute ses commandes, et Claude Code charge les compétences (fichiers `SKILL.md`) rangées dans `.claude/skills/` du dépôt. Le projet y range déjà `spec-kitty-docs-maintain`. Trois gestes suffisent :

1. Copier la compétence dans `.claude/skills/frontend-design/SKILL.md` et la versionner, pour que toute session sur le dépôt la trouve.
2. L'écrire comme règle dans la charte : « toute tâche qui produit de l'interface charge la compétence `frontend-design` avant d'écrire du code ».
3. La répéter dans le `plan.md` de la mission 11, d'où sont tirés les lots : chaque lot d'interface en hérite.

La revue de chaque lot vérifie ensuite que la charte graphique a été suivie.

Je peux préparer dès maintenant le texte de la charte, l'entrée de la mission serveur et le texte complet du `/spec-kitty.specify` du back-office, une fois vos réponses aux quatre premières décisions connues.
