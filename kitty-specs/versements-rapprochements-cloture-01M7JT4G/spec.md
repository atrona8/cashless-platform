# Mission Specification: Versements, rapprochements et clôture

**Mission Branch**: `feat/versements-rapprochements-cloture`
**Created**: 2026-11-17
**Status**: Draft
**Input**: Mission 9b de `PROMPTS-A-ENVOYER.md` (suite de la 9a), avec les héritages des missions 6 et 9a ; décisions du
porteur du 17/11/2026 (`docs/passation-9b/contexte-9b.md`) : mission entière, ajouts au contrat listés au plan.

## Contexte

La mission 9a a livré les remboursements des festivaliers. Il reste à finir le cycle de l'argent d'un événement :
rapprocher le grand livre des relevés externes, écrire les frais de clôture, verser à chaque partie son droit net, faire
passer l'événement jusqu'à `CLOSED` puis verrouiller ses grands livres, traiter les réclamations tardives, sceller et
surveiller les grands livres, et produire relevés et export comptable (SPECIFICATION §11.3, §11.4, §12, §13.7, S22,
ADR-49, ADR-67, ADR-71, ADR-75, ADR-76, ADR-77).

Une grande partie des règles est déjà dans la base : `set_event_status` (conditions de passage, `CL018`/`CL019`),
`lock_settled_ledger`, `ledger_unsettled`, `check_late_claim`, `seal_ledger`, `verify_ledger_seals`, tables `payout`
et `external_statement_line`, vue `party_position`. La route de passage de statut est servie (mission 3). Cette
mission les expose au back-office, les enchaîne dans l'ordre de clôture de référence et ajoute ce qui manque.

Le contrat `openapi.yaml` ne décrit pas les opérations de versement, de rapprochement, de relevés ni la demande de
remboursement créée par le back-office ; il décrit déjà `postLateClaim` et les actions d'approbation `PAYOUT` et
`LATE_CLAIM`. Décision du porteur du 17/11/2026 : les opérations absentes sont ajoutées, listées au plan et validées par
le porteur avant l'implémentation, sans modifier l'existant.

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Droit net | Somme de tous les comptes de droits d'une partie (vue `party_position`) : ce qui lui revient | « solde » d'une partie |
| Lot de versements | Ensemble de lignes de versement préparé par une personne et validé par une seconde | « paiement groupé » |
| Versement | Ligne `payout` : bénéficiaire, moyen, montant, statut `INITIATED`/`CONFIRMED`/`FAILED` | « virement » (réservé au moyen `BANK_TRANSFER`) |
| Relevé externe | Ligne importée d'un relevé PSP, mobile money ou bancaire (`external_statement_line`) | « extrait » |
| Rapprochement | Association d'une ligne de relevé à une transaction du grand livre | « lettrage » |
| Étape de clôture | Écriture ordonnée de la clôture (droits de place, frais, redevance, casse, cautions acquises, crédits offerts) | « batch de clôture » |
| Aperçu | Calcul des écritures d'une étape sans rien écrire | « simulation » |
| Réclamation tardive | Écriture après verrouillage, bornée par `check_late_claim` et validée à deux | « correction » |
| Scellement | Empreinte chaînée des écritures d'un grand livre (`seal_ledger`), copiée hors de la base | « signature » |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clore un événement dans l'ordre de référence (Priority: P1)

Après la fin des ventes, une personne du back-office fait passer l'événement de `CLOSING` à `CLOSED`. À chaque statut,
elle voit la liste des conditions et leur état ; elle lance dans l'ordre les étapes de clôture (droits de place, frais
du prestataire, redevance, casse, cautions acquises, expiration des crédits offerts), voit pour chacune un aperçu des
montants, puis l'exécute. Quand toutes les positions sont soldées, les grands livres sont verrouillés.

**Why this priority**: sans clôture, aucun versement final n'est possible et l'argent reste bloqué.

**Independent Test**: un événement du scénario de référence, ventes finies, passe de `CLOSING` à `CLOSED` puis
`LOCKED` par les routes du back-office ; les soldes finaux égalent ceux du scénario de référence.

**Acceptance Scenarios**:

1. **Given** un événement en `SETTLING`, **When** la personne demande l'aperçu des droits de place, **Then** elle voit
   le montant par commerçant selon son mode (`DEDUCT_OR_DEBT`, `DEDUCT_CAPPED`, `PREPAID`) et rien n'est écrit.
2. **Given** le même aperçu, **When** elle exécute l'étape, **Then** les écritures `PITCH_FEE` (et
   `MERCHANT_DEBT_TRANSFER` si un commerçant passe en négatif) sont écrites une seule fois ; un second appel ne réécrit
   rien.
3. **Given** une étape lancée avant la précédente dans l'ordre de référence, **When** elle l'exécute, **Then** refus
   avec la condition manquante nommée, rien n'est écrit.
4. **Given** une session de caisse encore ouverte, **When** on demande le passage à `RECONCILING`, **Then** refus
   (héritage mission 6, constat A32).
5. **Given** toutes les positions soldées, **When** l'événement passe en `CLOSED`, **Then** chaque grand livre passe
   `LOCKED`, `late_claims_until` est posé et un scellement final est fait ; s'il reste des soldes tolérés, le grand
   livre reste `CLOSING` avec `locked_until` et un relevé des soldes restants est disponible.

---

### User Story 2 - Verser à chaque partie son droit net, à deux (Priority: P1)

Un administrateur prépare un lot de versements (commerçants, organisateur, prestataire, plateforme) à partir des
droits nets ; un second administrateur, distinct, le valide par le circuit d'approbation à deux. Le lot est exporté en
CSV, payé hors système, puis chaque ligne est confirmée ou déclarée en échec.

**Why this priority**: c'est la raison d'être de la clôture : rendre l'argent à ceux à qui il revient.

**Independent Test**: un lot de deux versements est préparé, validé par une autre personne, exporté, puis une ligne
confirmée et une ligne en échec ; le droit net des bénéficiaires et `L-VERS-ENCOURS` sont justes à chaque étape.

**Acceptance Scenarios**:

1. **Given** un commerçant au droit net de 39 225, **When** une ligne de 40 000 est préparée, **Then** refus (montant
   supérieur au droit net), rien n'est écrit.
2. **Given** un lot préparé, **When** son auteur tente de le valider, **Then** refus ; **When** une seconde personne
   habilitée le valide, **Then** `PAYOUT_INITIATED` gèle chaque montant dans `L-VERS-ENCOURS`.
3. **Given** un lot validé, **When** l'export est demandé, **Then** un CSV liste bénéficiaire, moyen, numéro ou IBAN,
   montant et référence, et ne contient rien d'autre.
4. **Given** une ligne initiée, **When** elle est confirmée avec une référence, **Then** `PAYOUT_CONFIRMED` sort
   l'argent du pool ; **When** elle est déclarée en échec avec un motif, **Then** `PAYOUT_FAILED` recrédite le droit.
5. **Given** une ligne `INITIATED` depuis plus de 48 h, **When** le contrôle quotidien passe, **Then** une alerte est
   levée à l'exploitation.

---

### User Story 3 - Rapprocher les relevés externes (Priority: P1)

Le back-office importe en CSV un relevé par compte d'argent (`A-*`). Le système rapproche automatiquement chaque ligne
dont la référence externe correspond à une transaction ; la personne rapproche le reste à la main. Le passage à
`SETTLING` exige les comptes PSP rapprochés.

**Why this priority**: le passage à `SETTLING` et la confirmation des remboursements et versements en dépendent.

**Independent Test**: un relevé de 10 lignes dont 8 correspondent par référence : 8 rapprochées automatiquement, 2
proposées au rapprochement manuel ; le compte est rapproché quand toutes ses lignes le sont et que les soldes
concordent.

**Acceptance Scenarios**:

1. **Given** un fichier déjà importé, **When** il est réimporté, **Then** aucune ligne n'est créée deux fois.
2. **Given** une ligne sans transaction correspondante, **When** l'import finit, **Then** elle reste non rapprochée
   et visible ; **When** une personne l'associe à une transaction du même compte, **Then** elle est rapprochée.
3. **Given** des anomalies `PSP_TOPUP_OVER_LIMIT` ou `PSP_TOPUP_NOT_CREDITED` ouvertes, **When** le contrôle « grand
   livre = relevé » passe, **Then** elles sont représentées dans l'écart, non comptées comme écart inexpliqué
   (héritage mission 6, OP-N82).
4. **Given** une ligne d'un autre prestataire ou d'un autre compte, **When** on tente de la rapprocher, **Then** refus.

---

### User Story 4 - Réclamations tardives après verrouillage (Priority: P2)

Après le verrouillage, une personne propose une réclamation tardive (annulation de casse, ajustement, remboursement,
contestation tardive) ; une seconde la valide. La base la borne (`check_late_claim`).

**Why this priority**: la casse est réversible pendant `late_claim_years` ; le festivalier doit pouvoir être remboursé.

**Independent Test**: après `LOCKED`, une annulation de casse d'un portefeuille puis son remboursement passent à deux ;
une annulation au-delà de la casse prise est refusée.

**Acceptance Scenarios**:

1. **Given** un grand livre `LOCKED` dans `late_claims_until`, **When** `postLateClaim` est proposée puis validée par
   une autre personne, **Then** l'écriture est passée une seule fois.
2. **Given** une annulation supérieure à la casse du portefeuille, **When** elle est validée, **Then** refus de la base,
   rien n'est écrit.
3. **Given** `late_claims_until` dépassée, **When** une réclamation est proposée, **Then** refus.

---

### User Story 5 - Demande de remboursement créée par le back-office, et dettes de la 9a (Priority: P2)

Une personne du back-office crée une demande de remboursement par virement (`BANK_TRANSFER`, IBAN) pour un festivalier
sans mobile money (OP-N123) ; elle suit ensuite le circuit à deux de la 9a. La mission lève aussi les limites
consignées en 9a.

**Why this priority**: les festivaliers sans mobile money ne peuvent pas être remboursés aujourd'hui.

**Independent Test**: une demande `BANK_TRANSFER` créée par le back-office passe `REQUESTED`, est approuvée par une
autre personne, puis confirmée ; `requested_by` porte son auteur.

**Acceptance Scenarios**:

1. **Given** un IBAN mal formé, **When** la demande est créée, **Then** refus `422`.
2. **Given** une demande créée par une personne, **When** cette même personne tente de l'approuver, **Then** refus.
3. **Given** une demande `PAID`, **When** un `UPDATE` direct tente de la ramener à `REQUESTED`, **Then** la base refuse
   (OP-N130).
4. **Given** une décision du titulaire qui échoue après la vérification du code, **When** le titulaire réessaie,
   **Then** son code reste utilisable (OP-N124).
5. **Given** un remboursement `FAILED`, **When** son recrédit est demandé, **Then** il exige le rapprochement de la
   ligne de relevé correspondante ou un second valideur (OP-N126).

---

### User Story 6 - Sceller, surveiller, alerter (Priority: P2)

Les grands livres sont scellés toutes les 5 minutes (y compris `LOCKED`), avec une copie hors de la base, et vérifiés
chaque jour, comme la chaîne du journal d'audit. Les contrôles permanents (§12.2) tournent et lèvent une alerte à
l'exploitation en cas d'échec ; une transaction de plus de 60 s est signalée.

**Why this priority**: la preuve d'intégrité et la détection des écarts protègent l'argent de tous.

**Independent Test**: une écriture modifiée à la main dans une base de test fait échouer la vérification quotidienne et
lève une alerte ; un compte de grand livre dont la somme n'est pas nulle lève une alerte au contrôle suivant.

**Acceptance Scenarios**:

1. **Given** un grand livre avec des écritures non scellées, **When** la tâche de scellement passe, **Then** un
   scellement est écrit et copié hors de la base.
2. **Given** la copie externe simulée, **When** l'application démarre en configuration de production, **Then** le
   démarrage est refusé (règle 2).
3. **Given** une chaîne de scellement altérée, **When** la vérification quotidienne passe, **Then** alerte.

---

### User Story 7 - Relevés des parties et export comptable (Priority: P3)

Chaque partie obtient son relevé (commerçant, festivalier, organisateur, prestataire, plateforme) par l'API et en CSV ;
l'exploitation exporte la comptabilité par entité selon une table de correspondance configurable.

**Why this priority**: utile à la clôture et à la comptabilité, mais ne bloque pas les versements.

**Independent Test**: sur le scénario de référence, le relevé de l'organisateur donne les montants attendus ligne à
ligne ; l'export comptable équilibre débit et crédit par entité.

**Acceptance Scenarios**:

1. **Given** un commerçant, **When** il demande son relevé, **Then** il voit ventes brutes, annulations, commissions,
   droit de place, versements et solde, et rien d'un autre commerçant.
2. **Given** une correspondance comptable sans ligne pour un type de transaction, **When** l'export est demandé,
   **Then** l'export signale le type non mappé au lieu de l'omettre.

---

### Edge Cases

- Étape de clôture exécutée deux fois, ou en concurrence par deux personnes : une seule écriture.
- Droit net d'un commerçant négatif après droits de place en `DEDUCT_OR_DEBT` : transfert de dette vers
  `L-ORG-CREANCES`, relevé « reste dû ».
- Versement préparé, puis le droit net baisse (réclamation, contestation) avant la validation : la validation refuse
  tout montant supérieur au droit net du moment.
- Grand livre d'un organisateur à portée `ORGANIZER` (plusieurs événements) : il reste `OPEN` ; seules les transactions
  de l'événement sont concernées.
- Autorité de débit encore détenue par une passerelle : passage à `RECONCILING` refusé (base).
- Relevé importé dans une autre devise que le compte : refus de l'import.
- Clôture avec soldes restants (casse `NONE` ou `LEGAL_ACCOUNT`) : `CLOSED` avec grand livre `CLOSING`, verrouillage
  plus tard quand les soldes restants sont à 0.
- Contestation tardive après verrouillage : anomalie `LATE_CHARGEBACK` et demande d'approbation (déjà en place,
  mission 6) ; ici, son écriture passe par le même circuit que les réclamations tardives.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Conditions de passage visibles | En tant que back-office, je veux voir pour chaque statut de clôture la liste des conditions et leur état, et que tout passage soit refusé tant qu'une condition manque (§12.1). | High | Open | build | no |
| FR-002 | Caisse ouverte bloquante | En tant qu'opérateur, je veux que le passage à `RECONCILING` soit refusé tant qu'une session de caisse de l'événement est ouverte (héritage mission 6, A32). | High | Open | build | no |
| FR-003 | Étapes de clôture avec aperçu | En tant que back-office, je veux lancer chaque étape de clôture (droits de place, frais du prestataire, redevance, casse, cautions acquises, expiration des crédits offerts) avec un aperçu calculé qui n'écrit rien, puis l'exécuter. | High | Open | build | no |
| FR-004 | Ordre de clôture imposé | En tant qu'opérateur, je veux qu'une étape soit refusée tant que les précédentes de l'ordre de référence (§12.1) ne sont pas faites, et que chaque étape n'écrive qu'une fois (rejeu sans effet). | High | Open | build | no |
| FR-005 | Droits de place par mode | En tant qu'organisateur, je veux que le droit de place suive le mode de chaque participation (`DEDUCT_OR_DEBT` avec transfert de dette, `DEDUCT_CAPPED`, `PREPAID` avec référence enregistrée). | High | Open | build | no |
| FR-006 | Frais, redevance et régularisation | En tant que prestataire, je veux que frais du prestataire et redevance de la plateforme soient écrits selon le contrat, avec la régularisation `NET_OF_REFUNDS` à l'échéance (§5.6). | High | Open | build | no |
| FR-007 | Casse, cautions acquises, crédits offerts | En tant qu'opérateur, je veux qu'à la date limite de remboursement la casse soit partagée selon la configuration, les cautions non rendues acquises et les crédits offerts expirés. | High | Open | build | no |
| FR-008 | Clôture et verrouillage | En tant que back-office, je veux faire passer l'événement en `CLOSED` et que chaque grand livre soit verrouillé si ses positions sont soldées, ou reste `CLOSING` avec un relevé des soldes restants, puis soit verrouillé plus tard. | High | Open | build | no |
| FR-009 | Préparation d'un lot de versements | En tant qu'administrateur selon le bénéficiaire (`ORGANIZER_ADMIN` pour les commerçants et l'organisateur, `OPERATOR_ADMIN` pour le prestataire et la plateforme ; décision du porteur du 17/11/2026, SPECIFICATION §3.2 amendée), je veux préparer un lot de versements à partir des droits nets, chaque montant borné par le droit net. | High | Open | build | no |
| FR-010 | Validation à deux du lot | En tant que second administrateur, distinct de l'auteur, je veux valider le lot par le circuit d'approbation existant (action `PAYOUT`) ; la validation écrit `PAYOUT_INITIATED` et gèle les montants. | High | Open | build | no |
| FR-011 | Export du lot | En tant qu'administrateur, je veux exporter un lot validé en CSV (bénéficiaire, moyen, numéro ou IBAN, montant, référence). | High | Open | build | no |
| FR-012 | Résultat de chaque versement | En tant qu'administrateur, je veux enregistrer `PAYOUT_CONFIRMED` (référence) ou `PAYOUT_FAILED` (motif, droit recrédité) pour chaque ligne. `PAYOUT_FAILED` (qui recrédite le droit) est enregistré par une personne distincte du préparateur et du valideur du lot, qui devient le valideur de la transaction ; `PAYOUT_CONFIRMED` reste à une personne (amendé le 17/11/2026, décision 18, ADR-214). | High | Open | build | no |
| FR-013 | Import des relevés | En tant que back-office, je veux importer en CSV un relevé par compte d'argent, sans doublon au réimport, avec refus d'une devise ou d'un compte étranger. | High | Open | build | no |
| FR-014 | Rapprochement | En tant que back-office, je veux que les lignes soient rapprochées automatiquement par référence externe, puis à la main pour le reste, et voir l'état de rapprochement de chaque compte. | High | Open | build | no |
| FR-015 | Anomalies PSP dans le rapprochement | En tant qu'opérateur, je veux que le contrôle « grand livre = relevé » représente les anomalies `PSP_TOPUP_OVER_LIMIT` et `PSP_TOPUP_NOT_CREDITED` ouvertes (OP-N82). | High | Open | build | no |
| FR-016 | Réclamations tardives | En tant que back-office, je veux proposer puis faire valider par une seconde personne une réclamation tardive : `postLateClaim` du contrat (annulation de casse puis remboursement du festivalier) et l'apport d'un bénéficiaire (`ADJUSTMENT`, opération ajoutée au contrat), bornés par `check_late_claim` ; la contestation tardive reste celle de la mission 6 (décision du porteur du 17/11/2026). | Medium | Open | build | no |
| FR-017 | Demande de remboursement du back-office | En tant que back-office, je veux créer une demande de remboursement par virement (`BANK_TRANSFER`, IBAN) pour un festivalier, avec `requested_by` renseigné, qui suit le circuit à deux de la 9a (OP-N123). | Medium | Open | build | no |
| FR-018 | Transitions d'une demande gardées par la base | En tant qu'opérateur, je veux que la base refuse toute transition d'une demande de remboursement hors du graphe prévu, et fige montant et frais après `PROCESSING` (l'approbation les recalcule au passage `REQUESTED` → `PROCESSING`) (OP-N130). | High | Open | build | no |
| FR-019 | Limites de la 9a levées | En tant qu'opérateur, je veux lever OP-N124 (code du titulaire consommé seulement si la décision est écrite), OP-N126 (recrédit d'un `FAILED` borné par le rapprochement ou un second valideur) et OP-N128 (`approved_by` porté par l'écriture de caution, cumul relu sous verrou du portefeuille). | Medium | Open | build | no |
| FR-020 | Scellement et vérification | En tant qu'opérateur, je veux un scellement de chaque grand livre (y compris `LOCKED`) et du journal d'audit toutes les 5 minutes, copié hors de la base, et une vérification quotidienne des deux chaînes. | High | Open | build | no |
| FR-021 | Contrôles permanents | En tant qu'exploitant, je veux les contrôles du §12.2 (sommes nulles, droits = argent, caches, comptes chauds, relevés, versements > 48 h, anomalies ouvertes, transactions > 60 s) avec une alerte à chaque échec. | High | Open | build | no |
| FR-022 | Relevés des parties | En tant que partie (commerçant, festivalier, organisateur, prestataire, plateforme), je veux mon relevé par l'API et en CSV, limité à mon périmètre (§12.3). | Medium | Open | build | no |
| FR-023 | Export comptable configurable | En tant qu'exploitant, je veux un export comptable par entité selon une correspondance (`account_mapping`) configurable, jamais codée en dur, qui signale les types non mappés. | Medium | Open | build | no |
| FR-024 | Journal d'audit | En tant qu'auditeur, je veux que chaque étape de clôture, préparation, validation, export, résultat de versement, import, rapprochement et réclamation soit tracé avec son auteur. | High | Open | build | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Pas de double écriture | 0 écriture en double sur 50 exécutions concurrentes d'une même étape de clôture, d'une même validation de lot ou d'un même résultat de versement, et sur 50 rejeux d'une même clé d'idempotence. | Reliability | High | Open |
| NFR-002 | Grand livre juste à la clôture | Sur le scénario de référence, après clôture complète : chaque transaction à somme nulle, soldes finaux égaux aux valeurs attendues, droits nets = argent détenu à chaque étape. | Reliability | High | Open |
| NFR-003 | Import des relevés | Un relevé de 10 000 lignes est importé et rapproché automatiquement en moins de 60 s. | Performance | Medium | Open |
| NFR-004 | Réponses du back-office | 95 % des aperçus d'étape, listes de versements et relevés d'une partie répondent en moins de 1 s sur un événement de 100 000 transactions. | Performance | Medium | Open |
| NFR-005 | Fraîcheur du scellement | Aucune écriture d'un grand livre ne reste non scellée plus de 10 minutes (copie externe comprise) en fonctionnement normal. | Reliability | High | Open |
| NFR-006 | Délai d'alerte | Un échec d'un contrôle permanent lève une alerte au plus tard une période de contrôle après sa survenue (5 min, horaire ou quotidien selon le contrôle). | Reliability | Medium | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Priorité des sources | SPECIFICATION §0.3 ; toute contradiction est signalée, jamais tranchée en silence. | Regulatory | High | Open |
| C-002 | Ajouts au contrat validés | Décision du porteur du 17/11/2026 : les opérations absentes sont ajoutées à `openapi.yaml`, listées au plan (route, champ, code d'erreur) et validées par le porteur avant l'implémentation ; rien de l'existant ne change. | Business | High | Open |
| C-003 | Paiement manuel en V1 | Aucun versement ni remboursement n'est déclenché par l'API : paiement hors système, puis confirmation (ADR-53). Les relevés entrent par import CSV jusqu'aux vrais adaptateurs (12b). | Business | High | Open |
| C-004 | Écritures par le grand livre | Toute écriture passe par les fonctions du grand livre (`post_transaction`, `set_event_status`, `lock_settled_ledger`, `check_late_claim`, `seal_ledger`) et la double validation existante (ADR-74). Aucun `.sql` généré n'est modifié. | Technical | High | Open |
| C-005 | Droits de la base | Un rôle par processus ; les tâches d'exploitation (scellement, contrôles, exports) utilisent un rôle qui n'écrit pas au grand livre ; aucun `DELETE` sur les tables de cette mission. | Security | High | Open |
| C-006 | Copie externe simulée | Décision du porteur du 17/11/2026 : la copie des scellements hors de la base est simulée jusqu'à la 12b ; le faux fait refuser le démarrage en production (règle 2), dette consignée (OP + ADR + test). | Security | High | Open |
| C-007 | Correspondance comptable indicative | La correspondance SYSCOHADA (§12.3) est un exemple à valider (OP-N3) : configurable, jamais codée. | Regulatory | Medium | Open |
| C-008 | Écarts de sécurité | Règle du porteur du 13/10/2026 (`CLAUDE.md`) : tout écart qui affaiblit la sécurité est soumis avant d'être codé ; chaque écart accepté a une entrée OP, un ADR et un test. | Security | High | Open |
| C-010 | Alertes sans envoi réel | Décision du porteur du 17/11/2026 : une alerte = ligne d'audit + journal structuré `ALERT` + notification de la base ; l'envoi à une personne (courriel, SMS, astreinte) vient en 12b, dette consignée (OP + ADR). | Security | Medium | Open |
| C-011 | Transactions longues sans texte de requête | Décision du porteur du 17/11/2026 : la surveillance des transactions de plus de 60 s passe par une fonction dédiée qui ne rend jamais le texte des requêtes, exécutable par le seul rôle de maintenance ; pas de `pg_read_all_stats`. | Security | High | Open |
| C-009 | Chemins du monorepo | Code dans `apps/api/` et `packages/ledger-sql/` ; tests dans `apps/api/test/` et `packages/ledger-sql/tests/`. | Technical | Medium | Open |

### Key Entities

- **Lot de versements** : auteur, valideur distinct, demande d'approbation `PAYOUT`, lignes, état, export.
- **Versement** (`payout`, existant) : bénéficiaire, moyen, montant ≤ droit net, statut, référence, transactions.
- **Ligne de relevé** (`external_statement_line`, existant) : compte d'argent, source, référence, date, montant,
  transaction rapprochée.
- **Import de relevé** : fichier, compte, auteur, nombre de lignes créées, rapprochées, ignorées.
- **Étape de clôture** : événement, type d'étape, auteur, date, transactions écrites.
- **Réclamation tardive** : demande d'approbation `LATE_CLAIM`, type, lignes, transaction.
- **Correspondance comptable** (`account_mapping`, S22) : entité, usage, type de transaction, compte légal, version.
- **Scellement** (`ledger_seal`, `audit_seal`, existants) et sa copie externe.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : le scénario de référence se clôt de bout en bout (`CLOSING` → `CLOSED` → `LOCKED`) par les seules
  opérations du back-office, et ses soldes finaux égalent les valeurs attendues.
- **SC-002** : 100 % des versements tentés au-delà du droit net, ou validés par leur auteur, sont refusés.
- **SC-003** : sur un relevé où 80 % des lignes portent une référence connue, 100 % de ces lignes sont rapprochées sans
  intervention.
- **SC-004** : toute altération d'une écriture scellée est détectée à la vérification suivante.
- **SC-005** : chaque contrôle permanent du §12.2 a un test qui le fait échouer et observe l'alerte.
- **SC-006** : les dettes OP-N123, OP-N124, OP-N126, OP-N128 et OP-N130 sont levées, chacune avec son test de levée.

## Assumptions

- Les montants des frais, du droit de place, de la redevance et du partage de la casse se calculent entièrement à
  partir de la configuration en vigueur (contrat, participations, profil de législation) ; une personne suffit à
  exécuter une étape (décision du porteur du 17/11/2026).
- Le format CSV d'import est un format commun (source, référence externe, date de valeur, montant, devise) ;
  l'adaptation aux formats propres de Wave, Orange Money et des banques vient avec les vrais adaptateurs (12b).
- Les alertes passent par le mécanisme d'alarme des processus existant (`alarm()` des travailleurs) ; l'envoi vers un
  outil d'astreinte relève de l'exploitation.
- Les relevés sont des données par l'API et des CSV ; la mise en page PDF viendra plus tard (décision du 17/11/2026).
- La demande de remboursement du back-office suit le circuit de la 9a (approbation `WALLET_REFUND`, confirmation).

## Decisions

Décisions du porteur du 17/11/2026 (Decision Moments de cette mission et `docs/passation-9b/contexte-9b.md`) :
mission entière ; ajouts au contrat listés au plan ; relevés importés en CSV, rapprochement automatique puis manuel ;
lot préparé par un administrateur et validé par un second ; étapes de clôture par action avec aperçu ; copie externe des
scellements simulée jusqu'à la 12b ; relevés par API et CSV. Au plan : rôle du versement selon le bénéficiaire
(SPECIFICATION §3.2 amendée) ; transactions longues par fonction dédiée sans texte de requête ; alertes par audit,
journal et notification, envoi réel en 12b ; `postLateClaim` du contrat plus l'apport `ADJUSTMENT` ajouté au contrat.
