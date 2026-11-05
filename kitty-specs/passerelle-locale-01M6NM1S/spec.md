# Mission Specification: Passerelle locale de site

**Mission Branch**: `feat/passerelle-locale`
**Created**: 2026-11-05
**Status**: Draft
**Input**: User description: "Passerelle locale de site, mission 8 (voir PROMPTS-A-ENVOYER.md, section Mission 8, héritages et décisions du 05/11/2026 : recharges espèces servies sous session de caisse ; contrat openapi.yaml stable, ne pas le modifier)."

**Sources normatives** : `docs/SPECIFICATION.md` (§9.7, §12.1, §13.1, §14.1 S12 et S13), `docs/sync_protocol.md` (§9, §13-4, §13-5), `docs/DECISIONS_ADR.md` (ADR-52), `packages/contracts/openapi.yaml` (tag Passerelle, marques `x-edge-available`). Règle de priorité : SPECIFICATION §0.3.

## Contexte

Les festivals perdent souvent leur liaison Internet. Le hors ligne de la mission 7 borne alors le risque par des plafonds : le terminal décide seul, sur une copie de l'état des bracelets. La passerelle locale, installée sur le site, offre mieux : pendant la coupure, elle devient la seule autorité qui débite les portefeuilles de l'événement. Les terminaux restent « en ligne » sur elle, sans plafond hors ligne, et les soldes restent exacts. Au retour du réseau, tout est reversé au central, sans perte ni double écriture.

Le grand livre sait déjà tenir cette exclusion (fonctions de bascule et registre de la passerelle, S12 et S13). Il manque la passerelle elle-même et les routes du central qui la pilotent.

Les routes sont partagées avec les équipes clientes depuis le 05/11/2026. La mission sert ce que le contrat déclare déjà, sans rien changer pour elles.

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Passerelle | Serveur local du site, certificat propre, rattaché à un événement | edge (hors identifiants), serveur local |
| Central | L'API et la base de la plateforme | cloud, serveur principal |
| Autorité de débit | Qui peut débiter les portefeuilles d'un grand livre : `CENTRAL` ou `EDGE` | maître, leader |
| Époque | Entier incrémenté à chaque bascule, jeton d'exclusion | version, epoch (hors identifiants) |
| Bascule | Passage de l'autorité du central à la passerelle | failover |
| Rendu | Retour normal de l'autorité au central | failback |
| Reprise forcée | Retour de l'autorité au central sans la passerelle, à deux, après constat physique | force release |
| Filigrane | Dernière écriture centrale que la passerelle doit avoir reçue avant de débiter | watermark (hors identifiants) |
| File de la passerelle | Opérations décidées par la passerelle, à transmettre au central dans l'ordre | queue |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - L'admin bascule, la passerelle prend l'autorité (Priority: P1)

Avant l'ouverture des portes ou aux premiers signes d'instabilité du réseau, un admin demande la bascule. Le central cesse aussitôt de débiter. La passerelle rattrape tout ce qui a été écrit jusqu'au filigrane, accuse réception, et commence alors seulement à débiter.

**Why this priority**: C'est la condition de tout le reste, et le moment où deux autorités pourraient coexister.

**Independent Test**: Bascule sous charge de 100 débits par seconde, en vérifiant qu'aucun débit de source autre que `EDGE_SYNC` n'est écrit au central après la bascule et qu'aucune opération n'est perdue.

**Acceptance Scenarios**:

1. **Given** un grand livre en `CENTRAL` et une passerelle active de cet événement, **When** l'admin demande la bascule, **Then** le central répond `202`, l'époque augmente, et tout débit central répond `409 DEBIT_AUTHORITY_EDGE`.
2. **Given** une bascule accordée, **When** la passerelle accuse réception avant d'avoir atteint le filigrane, **Then** l'accusé est refusé et elle ne débite pas.
3. **Given** un accusé accepté, **When** la passerelle reçoit la réponse `200`, **Then** elle commence à débiter sur la nouvelle époque, et pas avant.
4. **Given** une bascule qui échoue, **When** elle est abandonnée, **Then** l'autorité revient au central par les seules fonctions du schéma.

---

### User Story 2 - Les terminaux continuent de vendre sur la passerelle (Priority: P1)

Un terminal reçoit `409 DEBIT_AUTHORITY_EDGE` du central, ou apprend la bascule par son battement de cœur. Il rejoue vers la passerelle avec la même clé. La vente aboutit, comme en ligne, sans plafond hors ligne.

**Why this priority**: C'est la valeur de la mission : le site continue d'encaisser avec des soldes exacts.

**Independent Test**: Coupure simulée du lien vers le central, puis ventes, annulations et lectures de solde sur la passerelle depuis un terminal de test.

**Acceptance Scenarios**:

1. **Given** une passerelle active sur l'époque `e`, **When** un terminal paie avec `X-Authority-Epoch = e`, **Then** la vente est acceptée, le solde local baisse et une entrée numérotée rejoint la file.
2. **Given** une requête portant une époque supérieure, **When** la passerelle la reçoit, **Then** elle cesse immédiatement de débiter (`409 STALE_AUTHORITY_EPOCH`).
3. **Given** un solde insuffisant ou un bracelet bloqué répliqué, **When** un terminal paie, **Then** la vente est refusée comme au central.
4. **Given** une opération absente de la liste des opérations servies (caution sur solde, remboursement, restitution, QR), **When** un terminal l'envoie, **Then** elle est refusée (`409 DEBIT_AUTHORITY_EDGE`).

---

### User Story 3 - Le guichet recharge en espèces sous session déjà ouverte (Priority: P1)

Un caissier dont la session de caisse a été ouverte au central avant la bascule recharge des bracelets, active des bracelets sans frais sur solde et prend des cautions en espèces. La passerelle transmet ensuite ces opérations au central.

**Why this priority**: Décision du porteur du 05/11/2026 ; sans cela, l'argent ne rentre plus pendant une coupure.

**Independent Test**: Ouvrir une session au central, basculer, recharger, activer et prendre une caution sur la passerelle, puis rendre et fermer la session au central : l'écart est juste.

**Acceptance Scenarios**:

1. **Given** une session ouverte et répliquée avant la bascule, **When** le caissier recharge, **Then** la recharge est acceptée et rattachée à cette session.
2. **Given** un terminal sans session répliquée, **When** il recharge, **Then** la recharge est refusée et rien n'est écrit.
3. **Given** une session ouverte après la bascule, **When** le caissier tente de recharger sur la passerelle, **Then** la recharge est refusée.
4. **Given** le rendu terminé, **When** le responsable ferme la session au central, **Then** le comptage inclut les espèces reçues pendant la coupure.

---

### User Story 4 - Le rendu reverse tout au central, sans perte (Priority: P1)

Au retour du réseau, un admin demande le rendu. La passerelle persiste cet état, cesse de débiter, vide sa file dans l'ordre, puis le central vérifie la continuité et reprend l'autorité. Les terminaux reviennent au central.

**Why this priority**: Toute la coupure se joue ici : aucune vente perdue, aucune écrite deux fois.

**Independent Test**: Rendu avec 10 000 opérations en file, panne et redémarrage de la passerelle au milieu, en vérifiant la continuité des numéros et l'absence de tout débit après `RELEASING`.

**Acceptance Scenarios**:

1. **Given** une demande de rendu, **When** la passerelle la reçoit, **Then** elle persiste `RELEASING`, répond `409 DEBIT_AUTHORITY_MOVING` et refuse les nouveaux lots.
2. **Given** une passerelle en `RELEASING` redémarrée, **When** elle repart, **Then** elle ne reprend jamais les débits, sauf échec explicite du handover signalé par le central pour la même époque.
3. **Given** un rendu avec un numéro manquant, **When** elle demande le rendu final, **Then** le central répond `409 EDGE_NOT_CAUGHT_UP` et elle reprend le vidage.
4. **Given** une chaîne incohérente, **When** le central la compare, **Then** il répond `409 CHAIN_BROKEN` et une alerte demande un examen manuel.
5. **Given** une opération déjà reçue directement du terminal, **When** elle arrive par la file, **Then** elle est marquée `DUPLICATE` et la passerelle annule son delta local selon la règle par issue (le central a déjà débité ; solde jamais sur-évalué).
6. **Given** un événement à clôturer, **When** l'autorité est encore à la passerelle, **Then** le passage en `RECONCILING` est refusé.

---

### User Story 5 - La réplication garde la passerelle à jour tant que le lien existe (Priority: P1)

Tant que le lien existe, la passerelle reçoit les soldes, les statuts et les nouveaux bracelets de l'événement, ainsi que ce qu'il lui faut pour servir les terminaux. Un blocage déclaré au central s'applique sur le site dès réception.

**Why this priority**: Une décision de la passerelle ne vaut que par la fraîcheur de ce qu'elle sait.

**Independent Test**: Crédit et blocage au central pendant `EDGE`, puis lecture de l'état sur la passerelle et vérification que le solde vu pour les débits locaux ne dépasse jamais le solde réel (il ne le dépasse que de la somme des recharges espèces locales pas encore rejouées), et qu'un blocage sans écriture comptable posé une seconde avant la bascule refuse la première vente après l'accusé.

**Acceptance Scenarios**:

1. **Given** un crédit central pendant `EDGE`, **When** la réplication passe, **Then** la passerelle le voit et l'utilise.
2. **Given** un bracelet bloqué au central, **When** la réplication passe, **Then** la passerelle l'applique et produit un snapshot signé par sa propre clé pour les terminaux du site.
3. **Given** une panne du lien, **When** il revient, **Then** la réplication reprend là où elle s'était arrêtée, sans trou ni doublon.

---

### User Story 6 - Les lots hors ligne passent par la passerelle (Priority: P2)

Un terminal entre en hors ligne, y compris pendant une coupure sans bascule préalable. Ses lots sont traités par la passerelle si elle détient l'autorité, puis relayés au central avec leur signature d'origine.

**Why this priority**: Terminaux isolés et passerelle doivent cohabiter sans double écriture.

**Independent Test**: Lot signé envoyé à la passerelle en `EDGE`, relayé en `EDGE_SYNC`, puis rejeu direct du même lot au central.

**Acceptance Scenarios**:

1. **Given** un lot reçu par une passerelle active, **When** elle le traite, **Then** les règles de la mission 7 s'appliquent avec ses soldes et l'opération rejoint la file.
2. **Given** un lot relayé dont la signature d'origine est invalide, **When** le central le reçoit, **Then** il répond `400 BATCH_SIGNATURE_INVALID` et ne le traite pas.
3. **Given** un terminal qui lit son état sur la passerelle, **When** il demande `GET /device/seq-status`, **Then** il reçoit l'accusé du central, pas l'accusé provisoire de la passerelle.

---

### User Story 7 - Deux personnes reprennent la main si la passerelle est perdue (Priority: P2)

La passerelle est détruite ou débranchée. Après constat physique, une personne demande la reprise forcée, une seconde l'approuve. Le central révoque le certificat et reprend l'autorité. Les terminaux renvoient tout leur journal non acquitté.

**Why this priority**: Sans cela, une passerelle perdue bloque les débits de tout l'événement.

**Independent Test**: Reprise forcée à deux après arrêt de la passerelle, renvoi du journal, puis tentative de la passerelle révoquée.

**Acceptance Scenarios**:

1. **Given** une demande de reprise, **When** elle n'est pas approuvée par une seconde personne, **Then** l'autorité ne change pas.
2. **Given** une reprise approuvée, **When** le central l'exécute, **Then** la passerelle est révoquée, l'époque augmente et le handover est `FORCED`.
3. **Given** un journal renvoyé par un terminal, **When** une opération a déjà été transmise par la passerelle, **Then** elle n'est écrite qu'une fois.
4. **Given** une passerelle révoquée, **When** elle tente de se synchroniser, **Then** elle est refusée.

---

### User Story 8 - Une passerelle de secours ne débite jamais sans promotion (Priority: P2)

Une seconde passerelle est installée en `STANDBY`. Elle refuse tout débit. Pour la promouvoir, on passe par un handover normal.

**Why this priority**: Deux passerelles actives seraient deux autorités.

**Independent Test**: Débit envoyé à une `STANDBY`, puis promotion par `EDGE`, `CENTRAL`, `EDGE`.

**Acceptance Scenarios**:

1. **Given** une passerelle `STANDBY`, **When** un terminal lui envoie un débit, **Then** il est refusé.
2. **Given** une demande de bascule vers une `STANDBY`, **When** le central la traite, **Then** elle est refusée tant que la passerelle n'est pas promue.

---

### User Story 9 - On installe et on révoque une passerelle en confiance (Priority: P2)

Un opérateur inscrit une passerelle pour un événement, avec son certificat et ses clés. La passerelle démarre depuis une image prête à déployer. En production, elle refuse de démarrer tant que son stockage matériel de clés n'est qu'un faux.

**Why this priority**: La passerelle garde les mots de passe des bracelets de l'événement sur le site.

**Independent Test**: Inscription, démarrage de l'image, appel avec un certificat étranger, révocation, puis démarrage en configuration de production.

**Acceptance Scenarios**:

1. **Given** une passerelle inscrite, **When** elle appelle `/edge/*` avec son certificat, **Then** elle est servie, et seulement pour son événement.
2. **Given** un autre certificat, **When** il appelle `/edge/*`, **Then** il est refusé.
3. **Given** une configuration de production, **When** le stockage de clés est le faux, **Then** le démarrage est refusé.
4. **Given** une image de passerelle, **When** on inspecte ses données, **Then** on n'y trouve aucune clé maître de bracelet.

### Edge Cases

- Coupure sans bascule préalable : la bascule ne peut pas être accordée ; les terminaux passent en hors ligne avec plafonds (mission 7).
- Lien perdu entre l'accord de bascule et l'accusé : aucun débit nulle part, les terminaux passent en hors ligne si la politique le permet ; l'accord peut être abandonné.
- Lien qui revient pendant `EDGE` : `ISOLATED`, puis `CATCHING_UP`, puis `ACTIVE`, en continuant de servir les terminaux.
- Passerelle zombie après reprise forcée : risque résiduel accepté par le protocole (§9.7-4), borné par le compte d'attente et imputé selon le contrat.
- Rejeu impossible d'une activation ou d'une caution : `REJECTED EDGE_REPLAY_FAILED`, anomalie, espèces au compte d'attente, résolution à deux.
- Crédit de l'événement fait au central pendant `EDGE` : accepté, puis répliqué ; pour les débits locaux le solde vu sur le site reste inférieur ou égal au solde réel (les recharges espèces locales non encore rejouées sont la seule exception ; au rejeu la borne du solde central protège le central).
- Requête de terminal portant une époque forgée très supérieure : refusée sans arrêter les débits ; seule une époque confirmée ou plausible (au plus l'époque détenue + 2) fait persister l'arrêt, levé localement à deux personnes si le lien est coupé.
- Redémarrage de la passerelle avec une horloge système reculée : l'heure servie ne recule jamais sous le plafond persisté.
- Passerelle de secours inscrite par une seule personne : alerte immédiate et aucun mot de passe de bracelet servi avant le délai ; rien du tout tant qu'elle n'est pas promue.
- Clôture de l'événement ou ordre de purge à deux personnes : les clés et les mots de passe de la passerelle sont détruits.
- Session de caisse fermée au central pendant `EDGE` : la fermeture répliquée met fin aux recharges sur cette session.
- Session vendeur expirée pendant la coupure : aucune ouverture de session sur la passerelle ; le vendeur ne peut plus vendre sous son nom.
- Redémarrage de la passerelle en plein traitement : aucun numéro perdu, aucune réponse renvoyée sans écriture persistée.
- Grand livre verrouillé ou période close au moment du rejeu : traités comme la mission 7 pour une synchronisation tardive.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Application passerelle | En tant qu'opérateur, je veux une application de passerelle, avec sa propre base, qui réutilise les règles de l'API au lieu de les réécrire, afin que le site se comporte comme le central. | High | Open | build | no |
| FR-002 | Inscription d'une passerelle | En tant qu'opérateur, je veux inscrire une passerelle pour un événement (numéro, rôle, certificat, clé d'accord, adresse sur le site) par un outil d'administration, hors API publique, afin de ne pas ajouter de route aux équipes clientes. | High | Open | build | no |
| FR-003 | Demande de bascule | En tant qu'admin, je veux demander le passage à `EDGE` sur `POST /ledgers/{id}/debit-authority`, par `grant_edge_authority`, afin que le central cesse de débiter dès la validation. | High | Open | build | no |
| FR-004 | État de l'autorité | En tant qu'admin ou passerelle, je veux lire l'autorité, l'époque et l'adresse de la passerelle (`getDebitAuthority`), et que le terminal les reçoive par son battement de cœur et sa configuration. | High | Open | build | no |
| FR-005 | Canal de contrôle | En tant que passerelle, je veux interroger le central en attente longue (`getCurrentEdgeHandover`, 25 s au plus), ce qui vaut battement de cœur, afin de recevoir accords et demandes de rendu. | High | Open | build | no |
| FR-006 | Accusé de bascule | En tant que passerelle, je veux accuser réception (`époque`, filigrane atteint), le central refusant un accusé incomplet, et ne débiter qu'après sa réponse `200`. | High | Open | build | no |
| FR-007 | Échec de bascule | En tant qu'admin, je veux qu'une bascule non accusée puisse échouer (`fail_edge_grant`) et rendre l'autorité au central. | High | Open | build | no |
| FR-008 | Flux de réplication | En tant que passerelle, je veux tirer en continu `getEdgeReplicationFeed` et mémoriser ma position, afin de recevoir soldes, statuts, nouveaux bracelets et mots de passe chiffrés pour ma clé d'accord, sans jamais manquer une écriture validée hors ordre ni un blocage sans écriture comptable. | High | Open | build | no |
| FR-009 | Données de service répliquées | En tant que passerelle, je veux recevoir aussi les sessions de caisse ouvertes, les sessions vendeur valides, les terminaux de l'événement et leurs clés publiques, le catalogue et les réglages de l'événement, par des champs facultatifs et rétrocompatibles limités à `/edge/*` (schéma unique : `contracts/replication-page-additions.yaml`). | High | Open | build | no |
| FR-010 | Opérations servies | En tant que terminal, je veux que la passerelle serve exactement les 16 opérations marquées `x-edge-available`, avec le même format et les mêmes erreurs qu'au central. | High | Open | build | no |
| FR-011 | Opérations refusées | En tant que terminal, je veux un refus `409 DEBIT_AUTHORITY_EDGE` pour tout prélèvement sur solde autre qu'une vente, remboursement, restitution, paiement par QR. | High | Open | build | no |
| FR-012 | Exclusion par l'époque | En tant que système, je veux que la passerelle ne débite que si elle détient l'autorité active et que la requête porte son époque, et qu'elle cesse de débiter, de façon persistante, dès qu'elle voit une époque supérieure confirmée par le central ou plausible (au plus l'époque détenue + 2) ; une époque implausible est refusée sans arrêt ni persistance, avec alerte. | High | Open | build | no |
| FR-013 | Refus central pendant EDGE | En tant que système, je veux que tout débit central réponde `409 DEBIT_AUTHORITY_EDGE`, avec l'adresse de la passerelle et l'époque, en acceptant les crédits, sur tous les chemins de débit. | High | Open | ratchet | no |
| FR-014 | Numérotation et chaîne | En tant que passerelle, je veux numéroter chaque décision par un `edge_seq` continu et chaîné, persistant, avec la clé d'origine du terminal (son `Idempotency-Key`), écrit avant toute réponse au terminal. | High | Open | build | no |
| FR-015 | Recharges espèces | En tant que caissier, je veux recharger sur la passerelle, seulement sur une session ouverte au central et répliquée avant la bascule ; toute autre recharge est refusée et rien n'est écrit. Au rejeu au central, elle n'est jamais rejetée pour un plafond réglementaire (deux parts, anomalie résolue à deux). | High | Open | build | no |
| FR-016 | Activation et caution | En tant que caissier, je veux activer un bracelet sans frais sur solde et prendre une caution en espèces, transmises au central dans la même file (`ACTIVATION`, `DEPOSIT_CASH`). | High | Open | build | no |
| FR-017 | Vidage de la file | En tant que passerelle, je veux envoyer mes opérations par `submitEdgeSyncBatch`, dans l'ordre, un lot en vol à la fois (500 opérations et 1 Mio au plus), dès le retour du lien, en continuant de servir les terminaux. | High | Open | build | no |
| FR-018 | Rejeu au central | En tant que central, je veux écrire chaque opération en `EDGE_SYNC`, avec la clé d'origine, `origin_occurred_at` et `origin_mode`, en reprenant la décision de la passerelle et en ne recalculant que frais et commissions ; une clé déjà connue est `DUPLICATE`. | High | Open | build | no |
| FR-019 | Refus de la file | En tant que central, je veux refuser un lot hors ordre (`SEQ_OUT_OF_ORDER`), à la chaîne rompue (`CHAIN_BROKEN`, avec alerte), à la signature invalide ou d'une époque périmée. | High | Open | build | no |
| FR-020 | Rejeu impossible | En tant que central, je veux traiter un rejeu impossible d'activation ou de caution en `REJECTED EDGE_REPLAY_FAILED`, avec anomalie et espèces au compte d'attente, sans jamais le rejouer ; une opération déjà rejouée sous la même clé de terminal n'ouvre aucune anomalie. | High | Open | build | no |
| FR-021 | Demande de rendu | En tant qu'admin, je veux demander le retour au central (`RELEASE_REQUESTED`) ; la passerelle persiste `RELEASING`, cesse de débiter (`409 DEBIT_AUTHORITY_MOVING`) et refuse les nouveaux lots. | High | Open | build | no |
| FR-022 | Rendu final | En tant que passerelle, je veux demander le rendu (`final_edge_seq`, `last_chain_hash`, `operations_count`) ; le central passe en `RELEASING` avant toute vérification, répond `409 EDGE_NOT_CAUGHT_UP` si la continuité manque, sinon reprend l'autorité. | High | Open | build | no |
| FR-023 | Pas de reprise après RELEASING | En tant que système, je veux qu'une passerelle en `RELEASING` ne reprenne jamais les débits, même après redémarrage, sauf échec du handover signalé pour la même époque. | High | Open | build | no |
| FR-024 | Autorité avant clôture | En tant que système, je veux que le passage en `RECONCILING` soit refusé tant que l'autorité n'est pas revenue au central (`CL019`). | High | Open | ratchet | no |
| FR-025 | Lots hors ligne relayés | En tant que passerelle, je veux traiter les lots de terminaux selon les règles de la mission 7 avec mes soldes, puis les relayer avec l'en-tête et la signature d'origine. | High | Open | build | no |
| FR-026 | Accusé du central aux terminaux | En tant que terminal, je veux lire sur la passerelle (`getDeviceSeqStatus`) l'accusé contigu du central, jamais un accusé provisoire, seul à m'autoriser à marquer une opération acquittée (donnée `device_seq_acked` du flux). | High | Open | build | no |
| FR-027 | Blocages et snapshots locaux | En tant que passerelle, je veux appliquer un blocage dès réception et produire un snapshot au format de la mission 7, signé par ma clé propre déclarée dans `config.snapshot_keys`. | High | Open | build | no |
| FR-028 | Reprise forcée | En tant qu'`OPERATOR_ADMIN`, je veux demander la reprise forcée (constat physique déclaré), approuvée par une seconde personne (`FORCE_CENTRAL_AUTHORITY`), qui révoque la passerelle et rend l'autorité au central. | High | Open | build | no |
| FR-029 | Journal après reprise | En tant que central, je veux traiter le journal non acquitté renvoyé par les terminaux, y compris les opérations confirmées par la passerelle, sans double écriture, comme prévu par le protocole (§9.7-3). | High | Open | build | no |
| FR-030 | STANDBY | En tant que système, je veux qu'une passerelle `STANDBY` refuse tout débit et ne reçoive jamais l'autorité sans promotion par handover normal. | High | Open | build | no |
| FR-031 | Certificat et périmètre | En tant que système, je veux que `/edge/*` n'accepte que le certificat d'une passerelle non révoquée, et seulement pour son événement et son prestataire. | High | Open | build | no |
| FR-032 | Port de stockage matériel | En tant qu'opérateur, je veux que la clé de signature et la clé d'accord de la passerelle passent par un port de stockage matériel, avec un faux refusé au démarrage en production. | High | Open | build | no |
| FR-033 | Image et procédure de site | En tant qu'opérateur, je veux une image de déploiement de la passerelle et une procédure de site (disque chiffré, onduleur, Wi-Fi dédié, révocation à distance). | Medium | Open | build | no |
| FR-034 | Audit et alertes | En tant que responsable, je veux un audit de chaque bascule, rendu, reprise et révocation, et une alerte sur chaîne rompue, rendu bloqué et passerelle muette. | Medium | Open | build | no |
| FR-035 | Purge des secrets du site | En tant qu'opérateur, je veux que les clés et les mots de passe de bracelets de la passerelle soient détruits à la clôture de l'événement et sur ordre de deux personnes, afin qu'un mini-PC récupéré ne livre rien (limite : mini-PC volé avant la purge). | High | Open | build | no |
| FR-036 | Audit de la tolérance versé au central | En tant que responsable, je veux que chaque usage d'un jeton de personne expiré toléré au guichet soit versé au central avec le lot suivant (champ facultatif sous `/edge/*`) et recopié dans l'audit, afin de voir ce qui s'est passé pendant la coupure. | High | Open | build | no |
| FR-037 | Inscription avec alerte et délai | En tant que responsable, je veux qu'une inscription ou un changement de rôle de passerelle lève une alerte immédiate et qu'aucun mot de passe de bracelet ne parte avant un délai, ni vers une `STANDBY` non promue. | High | Open | build | no |
| FR-038 | Bornes du rejeu `EDGE_ONLINE` | En tant que central, je veux, au rejeu d'une vente ou d'une annulation décidée par la passerelle, vérifier en SQL sous verrou le type, les comptes, la preuve du bracelet, le plafond par vente et par terminal et par heure, et rogner à la borne du solde central, afin de borner la perte d'une passerelle compromise. | High | Open | build | no |
| FR-039 | Jeton d'appareil sans rotation | En tant que terminal, je veux renouveler mon jeton d'accès sur la passerelle avec mon certificat, ma preuve de possession et mon jeton de rafraîchissement, sans que la passerelle le fasse tourner, afin de continuer à vendre au-delà de 15 minutes de coupure. | High | Open | build | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Exclusion sous charge | Bascule sous 100 débits par seconde : 0 débit de portefeuille de source autre que `EDGE_SYNC` écrit au central après la bascule, 0 opération perdue (`sync_protocol.md` §13-4). | Reliability | High | Open |
| NFR-002 | Rendu d'une grosse file | Rendu avec 10 000 opérations en file : continuité vérifiée, 0 débit de passerelle après `RELEASING`, 0 opération perdue (§13-5). | Reliability | High | Open |
| NFR-003 | Aucune double écriture | 0 double écriture sur 100 rejeux d'une même opération, par tous les chemins (direct, passerelle, journal après reprise). | Reliability | High | Open |
| NFR-004 | Tenue aux pannes | Arrêt brutal de la passerelle à 3 moments (avant écriture, après écriture avant réponse, pendant le vidage) : 0 opération perdue et numérotation continue au redémarrage. | Reliability | High | Open |
| NFR-005 | Latence d'un paiement sur la passerelle | Paiement par bracelet sur la passerelle, réseau local : p95 ≤ 200 ms et p99 ≤ 500 ms sur 1 000 paiements (200 ne donnerait que 2 observations au-delà du p99), serveur seul, comme au central. | Performance | High | Open |
| NFR-006 | Durée du vidage | 10 000 opérations reversées au central en moins de 10 minutes sur un lien local, mesuré sur poste, à remesurer en recette. | Performance | Medium | Open |
| NFR-007 | Prise d'autorité | Accusé de bascule en moins de 30 s après l'accord quand le lien est sain et que moins de 10 000 écritures restent à rattraper. | Performance | Medium | Open |
| NFR-008 | Fraîcheur de la réplication | Un blocage au central est appliqué sur la passerelle en moins de 5 s, lien sain, au p95. | Security | High | Open |
| NFR-009 | Aucun faux en production | 100 % des ports à faux et réglages de développement de la passerelle (stockage de clés, autorité des passerelles, points d'arrêt, identité de test, CORS ouvert, écoute sans TLS, joker d'autorité, `NODE_ENV` inconnu) refusent le démarrage en configuration de production, chacun prouvé par un démarrage réel. | Security | High | Open |
| NFR-010 | Aucune clé maître | 0 clé maître et 0 mot de passe en clair de bracelet, sous aucune représentation (hexadécimal, base64, échappé), dans le flux, la base de la passerelle, les journaux (PostgreSQL local compris), la sortie des processus et l'image, prouvé par un test à canari avec contrôle positif. | Security | High | Open |
| NFR-011 | Cloisonnement | 0 lecture d'une autre passerelle, d'un autre événement ou d'un autre prestataire, prouvé par test sur chaque route `/edge/*`. | Security | High | Open |
| NFR-012 | Stabilité du contrat | 0 différence pour les routes hors `/edge/*`, et différences limitées à des ajouts facultatifs sous `/edge/*` (aucune valeur d'énumération ajoutée), vérifié en CI contre le contrat du 05/11/2026. | Maintainability | High | Open |
| NFR-013 | Purge | Après la purge (clôture ou ordre à deux), 0 occurrence du canari sous toute représentation et 0 clé utilisable (`sign`, `agree` refusés). | Security | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Priorité des sources | SPECIFICATION §0.3 ; toute contradiction est signalée, jamais tranchée en silence. | Regulatory | High | Open |
| C-002 | Contrat stable | Décision du porteur du 05/11/2026 : aucun renommage, retrait ni changement de route, schéma ou code d'erreur. Ajouts facultatifs et rétrocompatibles sous `/edge/*` seulement (champs de `ReplicationPage`, paramètre `after_change_seq`, propriété `staff_token_audit` d'`EdgeSyncBatch`) ; aucune valeur d'énumération ajoutée ; tout autre ajout est soumis au porteur avant d'être codé. | Business | High | Open |
| C-003 | Fonctions de bascule | L'application n'appelle jamais `set_debit_authority` ; seules les fonctions S12 changent l'autorité. Les fonctions S12 et S13 existantes sont appelées, pas réécrites, et complétées par migration sans affaiblir les contrôles. | Technical | High | Open |
| C-004 | Bascule anticipée | Décision du porteur du 05/11/2026 : la bascule est demandée par un admin, avec le lien. Aucune prise d'autorité automatique par la passerelle. | Business | High | Open |
| C-005 | Session de caisse | Décision du porteur du 05/11/2026 : aucune ouverture, relève ni fermeture de session sur la passerelle. Garde de caisse inchangée, aucune exemption. | Business | High | Open |
| C-006 | Espèces hors ligne | L'interdiction des recharges espèces hors ligne du 30/10/2026 reste entière pour les terminaux sans réseau : un `TOPUP_CASH` dans un lot de terminal reste rejeté, y compris par la passerelle. | Business | High | Open |
| C-007 | Stockage matériel simulé | Décision du porteur du 05/11/2026 : adaptateur réel en mission 12b. Dette nommée (OP, ADR, test, report en 12b, `PRD.md`, `PROMPTS-A-ENVOYER.md`). La passerelle n'est pas utilisable en production avant la 12b. | Regulatory | High | Open |
| C-008 | Réplication synchrone exclue | Décision du porteur du 05/11/2026 : promotion d'une `STANDBY` par handover normal seulement. | Business | Medium | Open |
| C-009 | Pas de clé maître | La passerelle ne détient aucune clé maître (§9.7). Certificat propre, révocable à distance. | Regulatory | High | Open |
| C-010 | Fichiers générés | Ne jamais modifier les `.sql` générés de `packages/ledger-sql/` ; modifier les générateurs ou `scenario_reference.json`. | Technical | High | Open |
| C-011 | Pile logicielle | Suivre `docs/08-pile-logicielle.md` (ADR-78) ; toute nouvelle dépendance y est vérifiée et épinglée. | Technical | High | Open |
| C-012 | Ordre de verrouillage | Verrous consultatifs d'abord, puis lignes, pour ne pas s'interbloquer avec les écritures. | Technical | High | Open |
| C-013 | Applications clientes hors périmètre | Aucun écran. L'app terminal (déléguée) apprend l'autorité par les routes existantes. | Business | High | Open |

### Key Entities

- **Passerelle** : serveur de site rattaché à un événement et à un prestataire ; rôle `PRIMARY` ou `STANDBY`, état, certificat, clé d'accord, adresse sur le site, dernière écriture répliquée, dernier numéro et dernière chaîne acceptés.
- **Autorité de débit** : portée par le grand livre (`CENTRAL` ou `EDGE`, époque, passerelle désignée).
- **Handover** : une bascule, avec son époque, son filigrane et son état (`GRANTED`, `ACTIVE`, `RELEASE_REQUESTED`, `RELEASING`, `COMPLETED`, `FAILED`, `FORCED`).
- **File de la passerelle** : opérations numérotées et chaînées, avec clé d'origine, décision prise, heure et mode d'origine, résultat du central.
- **État répliqué** : soldes, statuts, bracelets et mots de passe chiffrés, sessions de caisse et de vendeur, terminaux, catalogue, réglages de l'événement.
- **Registre de la passerelle** : côté central, trace de chaque numéro reçu, dans l'ordre.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : un parcours complet (inscription, bascule, ventes, recharge espèces, activation, caution, blocage répliqué, coupure, retour du lien, rendu, fermeture de caisse) se déroule sans intervention manuelle autre que les demandes d'admin, et les soldes du central égalent ceux de la passerelle à la fin. — [build] · no-op passable: no
- **SC-002** : sur 100 % des essais de bascule et de rendu sous charge, une seule autorité débite à tout instant. — [build] · no-op passable: no
- **SC-003** : 0 vente perdue et 0 vente écrite deux fois sur 10 000 opérations, y compris avec arrêt brutal de la passerelle pendant le vidage. — [build] · no-op passable: no
- **SC-004** : un paiement sur la passerelle reste aussi rapide qu'au central pour le terminal : 95 % en 200 ms ou moins. — [build] · no-op passable: no
- **SC-005** : une passerelle perdue est remplacée par le central en moins de 5 minutes une fois les deux personnes présentes, sans perdre d'opération acquittée par un terminal. — [build] · no-op passable: no
- **SC-006** : les équipes clientes n'ont rien à changer : 0 différence sur les routes qu'elles utilisent. — [ratchet] · no-op passable: yes (témoin positif : le même contrôle échoue sur un contrat modifié en essai)
- **SC-007** : 100 % des faux de la passerelle sont refusés au démarrage en production. — [build] · no-op passable: no

## Assumptions

- La passerelle tourne en configuration de développement jusqu'à la mission 12b, comme le KMS : services réels simulés, faux refusés en production.
- Une session vendeur ouverte au central avant la bascule reste valable sur la passerelle jusqu'à son expiration (12 h, décision du 29/10/2026) ; on n'ouvre aucune session vendeur sur la passerelle, `x-edge-available` ne le prévoit pas.
- Les jetons de personne présentés au guichet sont vérifiés hors réseau avec une copie des clés publiques du serveur d'identité, tenue par la passerelle. Un jeton expiré pendant la coupure est toléré aux conditions de la décision 3 du porteur, renforcées (le jeton était valable à la bascule), pendant 12 h au plus après la bascule, chaque usage audité et versé au central (décisions 3 et 18).
- Les jetons d'appareil délivrés par la passerelle sont signés par sa clé propre, valables sur elle seule et renouvelés sans rotation du jeton de rafraîchissement (décisions 2 et 11) ; un jeton du central présenté à la passerelle y est refusé (le terminal rafraîchit).
- La passerelle sert une heure qui ne recule jamais sous un plafond persisté ; une horloge système reculée pendant un arrêt fait perdre la durée de l'arrêt (limite consignée).
- La passerelle exécute PostgreSQL local avec `fsync`, `full_page_writes` et `synchronous_commit` actifs ; la coupure de courant sans onduleur relève de la procédure de site.
- Les preuves tournent sur le poste et en CI : central et passerelle en deux processus, deux bases, lien coupé par simulation. Les seuils de performance sont à remesurer en recette sur le matériel réel.
- Disque chiffré, onduleur et Wi-Fi dédié relèvent d'une procédure de site, non testable sans matériel.
- Les fonctions S12 et S13 du schéma sont correctes ; un défaut trouvé se corrige par migration, signalé au porteur s'il touche à la sécurité. Les migrations ne rendent jamais les suites SQL générées du kit inexécutables (colonnes nouvelles nullables, aucune contrainte qui casse leurs insertions ni `force_central_authority`).

## Contradictions de sources

1. **Recharges espèces** : le `PRD.md` appliquait à la passerelle l'interdiction du 30/10/2026 « sauf décision contraire ». Tranché par le porteur le 05/11/2026 : servies sous session de caisse, `PRD.md` mis à jour.
2. **Flux de réplication** : `ReplicationPage` ne porte que portefeuilles et bracelets, alors que SPECIFICATION §9.7 demande à la passerelle de servir des opérations qui exigent aussi sessions, terminaux et catalogue. Tranché par le porteur le 05/11/2026 : ajouts facultatifs limités à `/edge/*`.
3. **Inscription d'une passerelle** : le schéma porte `edge_gateway`, mais le contrat n'a aucune route d'inscription. Tranché par le porteur le 05/11/2026 : outil d'administration, hors API publique.
4. **« Même moteur d'écritures »** (SPECIFICATION §9) : le flux ne porte que des soldes et `post_transaction` refuse les débits sous `EDGE`. Tranché par le porteur le 05/11/2026 : « mêmes modules », base locale à schéma réduit.
5. **`TOPUP_CASH` « toujours rejeté »** (`OfflineOperationType`) contre la recharge espèces servie par la passerelle : l'interdiction vaut pour un lot de terminal, pas pour une décision de la passerelle (C-006).

## Decisions

Décisions du porteur du 05/11/2026, consignées dans `decisions/` : recharges espèces servies ; contrat stable ; bascule anticipée par un admin ; sessions de caisse ouvertes avant la bascule ; port de stockage matériel avec faux refusé en production et adaptateur réel en 12b ; `STANDBY` promue par handover normal seulement ; ajouts limités à `/edge/*` et inscription par outil d'administration.

Décisions du porteur après la passe contradictoire du plan (05/11/2026, `docs/passation-8/contexte-m8.md` 11 à 18) : jeton d'appareil renouvelé sans rotation sur la passerelle (FR-039) ; paramètre `after_change_seq` accepté ; ventes `EDGE_ONLINE` bornées au rejeu avec perte maximale chiffrée (FR-038) ; recharge espèces jamais rejetée pour un plafond au rejeu (FR-015) ; `STALE` seulement si confirmé ou plausible (FR-012) ; inscription par une personne avec alerte et délai (FR-037) ; purge (FR-035) ; audit de la tolérance versé au central (FR-036).
