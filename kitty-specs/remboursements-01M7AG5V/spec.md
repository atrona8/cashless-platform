# Mission Specification: Remboursements des festivaliers

**Mission Branch**: `feat/remboursements`
**Created**: 2026-11-13
**Status**: Planned
**Input**: Mission 9a de `PROMPTS-A-ENVOYER.md` (découpée de la mission 9 le 13/11/2026, décision du porteur) : remboursements
des festivaliers par l'app, le back-office et le guichet de retour.

## Contexte

L'app festivalier (déléguée à une autre équipe) appelle déjà `POST`/`GET /me/refund-requests` et
`POST /refund-requests/{refund_request_id}/holder-decision` : ces routes sont au contrat `openapi.yaml` mais répondent
`404` (signalé par l'équipe Flutter le 13/11/2026). Le grand livre connaît déjà le type `WALLET_REFUND`, la caution
(`refund_deposit`), les espèces dues (`refund_cash_due`), la restitution (`release_media`), la double validation
(ADR-74) et les codes à usage unique du festivalier (`/customer-auth/*`). Il manque la demande de remboursement
(`refund_request`, S16), son circuit à deux et l'enchaînement du guichet de retour, aujourd'hui refusé
(`422 release.no_chaining`, OP-N51).

Sources normatives : SPECIFICATION §8.5, §7.9, §11.4, §12.1 (matrice des statuts), §14.2 S16 ; ADR-49, ADR-53, ADR-67,
ADR-73, ADR-74, ADR-76, ADR-91, ADR-100 ; contrat `packages/contracts/openapi.yaml` (opérations `createMyRefundRequest`,
`listMyRefundRequests`, `listRefundRequests`, `decideRefundRequestAsHolder`, `approveRefundRequest`,
`confirmRefundRequest`, `rejectRefundRequest`, `releaseMedia`, `refundCashDue`, `refundDeposit`).

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Demande de remboursement (`refund_request`) | Demande de rendre le solde payé d'un portefeuille vers Wave ou Orange Money | « retrait », « virement » (le virement est un canal distinct, reporté) |
| Solde payé (`paid`) | Part remboursable du portefeuille | « solde » seul (ambigu avec `spendable` qui inclut les crédits offerts) |
| Crédits offerts (`promo`) | Part non remboursable, expirée au guichet de retour (`PROMO_EXPIRY`) | « bonus remboursable » |
| Titulaire | Personne au numéro vérifié rattaché au portefeuille | « propriétaire du bracelet » |
| Autre numéro | Numéro de destination différent du numéro vérifié du titulaire (ADR-76) | « nouveau compte » |
| Paiement hors système | Versement Wave / Orange Money fait à la main par l'opérateur, puis confirmé au back-office | « paiement automatique » |
| Guichet de retour | Enchaînement imposé caution → crédits offerts → solde payé → espèces dues → restitution (§7.9) | — |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Le festivalier demande le remboursement de son solde payé (Priority: P1)

Un festivalier connecté à l'app demande que son solde payé lui soit rendu sur son numéro Wave ou Orange Money vérifié.
Il suit ensuite l'état de sa demande.

**Why this priority**: c'est ce qu'attend l'app festivalier ; sans demande, aucun remboursement mobile n'est possible.

**Independent Test**: un festivalier au solde payé positif crée une demande, la retrouve dans sa liste avec le statut
`REQUESTED` et le montant estimé ; une seconde demande sur le même portefeuille est refusée.

**Acceptance Scenarios**:

1. **Given** un portefeuille au solde payé de 25 000 et sans demande ouverte, pendant la fenêtre de remboursement,
   **When** le titulaire demande un remboursement Wave vers son numéro vérifié, **Then** la demande est créée en
   `REQUESTED`, avec le montant estimé (solde payé moins les frais) et la destination.
2. **Given** une demande déjà ouverte sur ce portefeuille, **When** une seconde demande est envoyée, **Then** elle est
   refusée (`409 REFUND_ALREADY_OPEN`).
3. **Given** un événement dont la date limite de remboursement est passée, **When** une demande est envoyée, **Then**
   elle est refusée (`422 REFUND_WINDOW_CLOSED`).
4. **Given** un portefeuille au solde payé nul (seulement des crédits offerts), **When** une demande est envoyée,
   **Then** elle est refusée (`422 REFUND_NOT_ALLOWED`).
5. **Given** une demande créée, **When** le festivalier liste ses demandes, **Then** il voit seulement les siennes,
   paginées, avec leur statut courant.

---

### User Story 2 - Deux personnes du back-office approuvent, puis confirment le paiement (Priority: P1)

Une personne du back-office propose l'approbation d'une demande ; une seconde, différente, l'approuve. Le grand livre
sort alors l'argent du portefeuille. L'opérateur paie hors système, puis enregistre le résultat.

**Why this priority**: sans ce circuit, une demande ne débouche jamais sur un remboursement.

**Independent Test**: une demande `REQUESTED` est approuvée par deux personnes distinctes, le solde payé passe à 0, la
demande passe `PROCESSING`, puis `PAID` avec une référence ; sur un autre essai, `FAILED` recrédite le portefeuille.

**Acceptance Scenarios**:

1. **Given** une demande `REQUESTED`, **When** une personne propose l'approbation, **Then** une demande d'approbation
   `PENDING` est créée et rien n'est écrit au grand livre.
2. **Given** cette approbation en attente, **When** une seconde personne, distincte de l'auteur et du demandeur,
   l'approuve, **Then** une écriture `WALLET_REFUND` du solde payé (frais déduits) est passée une seule fois et la
   demande passe `PROCESSING`.
3. **Given** la même personne que l'auteur ou que le demandeur, **When** elle tente d'approuver, **Then** c'est refusé.
4. **Given** une demande `PROCESSING`, **When** le back-office enregistre `PAID` avec la référence du paiement,
   **Then** la demande passe `PAID` sans nouvelle écriture ; sans référence, c'est refusé.
5. **Given** une demande `PROCESSING`, **When** le back-office enregistre `FAILED` avec un motif, **Then** le
   remboursement est contre-passé (`REVERSAL`), le solde payé revient au portefeuille et une nouvelle demande devient
   possible.
6. **Given** une demande `REQUESTED`, **When** le back-office la refuse avec un motif, **Then** elle passe `REJECTED`
   sans écriture.
7. **Given** n'importe quelle de ces actions rejouée avec la même clé d'idempotence, **Then** la même réponse est
   rendue et rien n'est écrit deux fois.

---

### User Story 3 - Remboursement vers un autre numéro, sous contrôle du titulaire (Priority: P2)

Le festivalier veut être remboursé sur un autre numéro que son numéro vérifié (téléphone perdu, numéro d'un proche).
Le nouveau numéro prouve qu'il existe par un code ; le titulaire peut confirmer ou bloquer.

**Why this priority**: prévu par ADR-76 et par le contrat ; c'est le cas le plus exposé à la fraude.

**Independent Test**: une demande vers un autre numéro, avec le code de ce numéro, est créée en `AWAITING_HOLDER` ; le
titulaire la bloque par son code (`BLOCKED`), ou la confirme (`REQUESTED`), ou ne répond pas et elle passe `REQUESTED`
à l'échéance.

**Acceptance Scenarios**:

1. **Given** un titulaire au numéro vérifié, **When** il demande un remboursement vers un autre numéro sans code de ce
   numéro, **Then** c'est refusé (`422 REFUND_NOT_ALLOWED`).
2. **Given** la même demande avec un code valide du nouveau numéro, **When** elle est créée, **Then** elle est
   `AWAITING_HOLDER`, avec `hold_until` = création + `refund_new_number_hold_hours`, et un code est envoyé au numéro
   vérifié du titulaire.
3. **Given** une demande `AWAITING_HOLDER`, **When** le titulaire envoie `CONFIRM` avec son code, **Then** elle passe
   `REQUESTED` ; **When** il envoie `BLOCK`, **Then** elle passe `BLOCKED` et ne peut plus être approuvée.
4. **Given** une demande `AWAITING_HOLDER` sans réponse, **When** `hold_until` est dépassé, **Then** elle est traitée
   comme `REQUESTED` ; le titulaire ne peut plus la bloquer après cette échéance.
5. **Given** un compte sans identité de festivalier vérifiée, **When** une demande est créée, **Then** elle est refusée
   (`422 REFUND_NOT_ALLOWED`) ; il n'existe pas de demande vers un autre numéro sans titulaire vérifié (décision du
   porteur du 16/11/2026, C-001, ADR-194 ; amendement : la branche « `REQUESTED` directement » est retirée).
6. **Given** un montant estimé au-delà de `refund_new_number_max`, **When** la demande est créée, **Then**
   `extra_check_required = true`, et l'approbation exige que la vérification d'identité soit notée dans la décision.

---

### User Story 4 - Le guichet de retour solde et restitue le bracelet en une fois (Priority: P2)

Au guichet de retour, le caissier lit le bracelet et rend tout dans l'ordre imposé : caution, crédits offerts expirés,
solde payé en espèces, espèces dues, puis restitution.

**Why this priority**: lève le refus provisoire `422 release.no_chaining` hérité de la mission 4 (OP-N51, ADR-91).

**Independent Test**: un bracelet avec caution `HELD`, crédits offerts, solde payé et espèces dues est restitué par un
seul appel `releaseMedia` avec `settle_balance` ; les écritures sont passées dans l'ordre et le bracelet est `RELEASED`.

**Acceptance Scenarios**:

1. **Given** un bracelet avec caution détenue, crédits offerts, solde payé et espèces dues, **When** le caissier appelle
   la restitution avec `settle_balance`, **Then** les étapes s'enchaînent dans l'ordre de §7.9 et le bracelet est
   `RELEASED`.
2. **Given** un solde payé à rendre au-delà de `cash_refund_single_max`, **When** la restitution est demandée sans jeton
   d'approbation sur place, **Then** elle est refusée (`403 APPROVAL_REQUIRED`) et rien n'est écrit.
3. **Given** une étape refusée au milieu (par exemple jeton manquant), **Then** rien n'est écrit ; **When** l'appel
   réussi est rejoué avec la même clé, **Then** la même réponse est rendue sans nouvelle écriture.
4. **Given** une restitution sans `settle_balance` sur un bracelet soldé, **Then** le comportement actuel est conservé.
5. **Given** un bracelet remplacé dont l'ancien portait des espèces dues (OP-N55), **When** ces espèces sont rendues,
   **Then** elles le sont une fois et une seule.

---

### Edge Cases

- Autorité de débit `EDGE` (passerelle locale active) : approbation et échec de paiement refusés
  (`409 DEBIT_AUTHORITY_EDGE`), comme toute écriture centrale qui touche le portefeuille.
- Le solde payé change entre la demande et l'approbation (achat, recharge) : le montant remboursé est celui du moment
  de l'approbation ; un solde devenu nul fait échouer l'approbation sans écriture.
- Portefeuille bloqué (`BLOCKED`) ou bracelet suspendu : voir Assumptions ; portefeuille `CLOSED` : refusée.
- Code à usage unique expiré, déjà utilisé ou faux : refusé, avec les limites d'essais existantes (`429`).
- Décision du titulaire après l'échéance, ou sur une demande qui n'est pas `AWAITING_HOLDER` : `409 CONFLICT_STATE`.
- Demande d'un autre festivalier : invisible (`404`), jamais `403`, pour ne pas révéler son existence.
- Création sur un portefeuille inconnu ou d'un autre festivalier : `422 REFUND_NOT_ALLOWED`, même réponse dans les deux
  cas (le contrat ne déclare pas `404` sur cette route).
- Clôture de l'événement : les statuts où `WALLET_REFUND` est permis suivent la matrice §12.1 ; hors de ces statuts, la
  base refuse et l'API rend une erreur explicite.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Demande de remboursement enregistrée | En tant que système, je veux une demande de remboursement persistante (S16 : portefeuille, canal, destination, statut, demandeur, valideur distinct, transaction `WALLET_REFUND`, confirmation ou échec, frais, échéance) dans le grand livre du prestataire, isolée par prestataire. | High | Open | build | no |
| FR-002 | Création par le festivalier | En tant que festivalier connecté, je veux créer une demande (`createMyRefundRequest`) vers mon numéro Wave ou Orange Money vérifié, avec clé d'idempotence, afin d'être remboursé de mon solde payé. | High | Open | build | no |
| FR-003 | Une seule demande ouverte | En tant qu'opérateur, je veux qu'un portefeuille n'ait jamais plus d'une demande non terminée (`409 REFUND_ALREADY_OPEN`), garanti par la base. | High | Open | build | no |
| FR-004 | Fenêtre et éligibilité | En tant qu'opérateur, je veux refuser une demande hors de la fenêtre de remboursement de l'événement (`422 REFUND_WINDOW_CLOSED`) ou sur un portefeuille non remboursable (solde payé nul, portefeuille fermé, destination non vérifiée : `422 REFUND_NOT_ALLOWED`). | High | Open | build | no |
| FR-005 | Montant estimé | En tant que festivalier, je veux voir le montant estimé (solde payé moins les frais de remboursement de l'événement) ; les crédits offerts n'en font jamais partie. | High | Open | build | no |
| FR-006 | Mes demandes | En tant que festivalier, je veux lister mes demandes, paginées, avec leur statut courant (`listMyRefundRequests`) ; les demandes des autres me sont invisibles. | High | Open | build | no |
| FR-007 | Liste du back-office | En tant que personne du back-office, je veux lister les demandes de mon périmètre, filtrées par statut et événement (`listRefundRequests`). | High | Open | build | no |
| FR-008 | Approbation à deux | En tant que back-office, je veux que `approveRefundRequest` crée une demande d'approbation `WALLET_REFUND` et qu'une seconde personne, distincte de l'auteur et du demandeur, l'exécute une seule fois : écriture `WALLET_REFUND` (source back-office, frais compris), demande `PROCESSING`. | High | Open | build | no |
| FR-009 | Résultat du paiement | En tant que back-office, je veux enregistrer `PAID` (référence obligatoire, aucune écriture) ou `FAILED` (motif obligatoire, `REVERSAL` du remboursement, solde recrédité) sur une demande `PROCESSING` (`confirmRefundRequest`). | High | Open | build | no |
| FR-010 | Refus | En tant que back-office, je veux refuser une demande `REQUESTED` avec un motif (`rejectRefundRequest`), sans écriture. | High | Open | build | no |
| FR-011 | Autre numéro | En tant que festivalier, je veux demander un remboursement vers un autre numéro en joignant le code de ce numéro ; sans code valide, refus (ADR-76). | Medium | Open | build | no |
| FR-012 | Décision du titulaire | En tant que titulaire vérifié, je veux recevoir un code et confirmer ou bloquer la demande vers un autre numéro (`decideRefundRequestAsHolder`) jusqu'à `hold_until` ; toute demande a un titulaire vérifié (amendement du 16/11/2026, C-001, ADR-194). | Medium | Open | build | no |
| FR-013 | Échéance de l'attente | En tant qu'opérateur, je veux qu'une demande `AWAITING_HOLDER` sans réponse devienne `REQUESTED` à `hold_until` (`refund_new_number_hold_hours`, 48 h par défaut), sans action manuelle. | Medium | Open | build | no |
| FR-014 | Vérification d'identité au-delà du seuil | En tant qu'opérateur, je veux que les demandes vers un autre numéro au-delà de `refund_new_number_max` portent `extra_check_required` et que leur approbation exige la vérification d'identité notée dans la décision. | Medium | Open | build | no |
| FR-015 | Guichet de retour enchaîné | En tant que caissier, je veux que `releaseMedia` avec `settle_balance` enchaîne caution, expiration des crédits offerts, remboursement du solde payé en espèces, espèces dues et restitution, dans cet ordre, sur la session de caisse ouverte du terminal ; le refus `release.no_chaining` disparaît (OP-N51, ADR-91). | Medium | Open | build | no |
| FR-016 | Seconde personne au guichet | En tant qu'opérateur, je veux qu'un remboursement en espèces au-delà de `cash_refund_single_max` exige un jeton d'approbation sur place d'une seconde personne (`403 APPROVAL_REQUIRED` / `APPROVAL_INVALID`). | Medium | Open | build | no |
| FR-017 | Enchaînement atomique et rejouable | En tant que caissier, je veux que l'enchaînement soit tout ou rien (un refus à une étape n'écrit rien) et qu'un rejeu avec la même clé rende la même réponse sans rien écrire deux fois. | Medium | Open | build | no |
| FR-018 | Espèces dues d'un bracelet remplacé | En tant qu'opérateur, je veux que les espèces dues d'un bracelet remplacé soient rendues une fois et une seule (OP-N55, ADR-100), en faisant suivre au bracelet neuf, lors du remplacement, les espèces dues encore ouvertes de l'ancien (le contrat n'a pas de route de rendu au back-office). | Medium | Open | build | no |
| FR-019 | Autorité de débit | En tant qu'opérateur, je veux que toute écriture de remboursement (approbation, échec, guichet) respecte l'autorité de débit : refus `409 DEBIT_AUTHORITY_EDGE` quand la passerelle locale a l'autorité. | High | Open | build | no |
| FR-020 | Journal d'audit | En tant qu'auditeur, je veux que chaque création, décision, approbation, confirmation et refus soit tracé au journal d'audit avec son auteur. | High | Open | build | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Aucun double remboursement | 0 écriture `WALLET_REFUND` en double sur 100 approbations ou exécutions concurrentes d'une même demande, et sur 100 rejeux d'une même clé d'idempotence. | Reliability | High | Open |
| NFR-002 | Une seule demande ouverte sous concurrence | 0 portefeuille avec deux demandes non terminées après 50 créations simultanées sur le même portefeuille. | Reliability | High | Open |
| NFR-003 | Grand livre équilibré | Après tout parcours (payé, échoué, refusé, bloqué, guichet), la somme de chaque transaction est nulle et le solde payé du portefeuille égale le solde initial moins les remboursements payés. | Reliability | High | Open |
| NFR-004 | Temps de réponse | 95 % des créations et lectures de demandes répondent en moins de 500 ms sous 20 requêtes simultanées. | Performance | Medium | Open |
| NFR-005 | Échéance tenue | Une demande `AWAITING_HOLDER` devient traitable au plus 5 minutes après `hold_until`. | Reliability | Medium | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Priorité des sources | SPECIFICATION §0.3 ; toute contradiction est signalée, jamais tranchée en silence. | Regulatory | High | Open |
| C-002 | Contrat stable | Décision du porteur du 05/11/2026 : les opérations du contrat sont servies telles qu'elles sont décrites ; aucune route, aucun champ ni code d'erreur nouveau sans accord préalable du porteur. | Business | High | Open |
| C-003 | Paiement manuel en V1 | Décision du porteur du 13/11/2026 (SPECIFICATION §8.5, ADR-53) : aucun versement n'est déclenché par l'API ; le paiement est fait hors système puis confirmé. Pas de remboursement par carte. | Business | High | Open |
| C-004 | Demande créée par le back-office reportée | Décision du porteur du 13/11/2026 : la demande créée par le back-office (virement `BANK_TRANSFER`) reste hors de la 9a, consignée (OP + report en 9b). | Business | High | Open |
| C-005 | Écritures par les fonctions du grand livre | Les écritures passent par les fonctions existantes du grand livre (`post_transaction`, `refund_deposit`, `refund_cash_due`, `release_media`) et la double validation existante (ADR-74) ; les migrations complètent sans affaiblir un contrôle. Les `.sql` générés de `packages/ledger-sql/` ne sont jamais modifiés à la main. | Technical | High | Open |
| C-006 | Droits de la base | Un rôle par processus (`post-roles.sql`) ; le rôle applicatif ne reçoit que les droits nécessaires sur la table des demandes ; aucun `DELETE`. | Security | High | Open |
| C-007 | Écarts de sécurité | Règle du porteur du 13/10/2026 (`CLAUDE.md`) : tout écart qui affaiblit la sécurité est soumis avant d'être codé ; chaque écart accepté a une entrée OP, un ADR et un test qui échoue si la limite s'élargit. | Security | High | Open |
| C-008 | Chemins du monorepo | Le code vit dans `apps/api/` et `packages/ledger-sql/` (et `packages/contracts/` en lecture) ; les tests dans `apps/api/test/` et `packages/ledger-sql/tests/`. | Technical | Medium | Open |

### Key Entities

- **Demande de remboursement** : portefeuille, événement, canal (`WAVE`, `ORANGE_MONEY`), destination (numéro), autre
  numéro ou non, statut (`AWAITING_HOLDER`, `REQUESTED`, `PROCESSING`, `PAID`, `FAILED`, `REJECTED`, `CANCELLED`,
  `BLOCKED`), montant estimé, frais, `hold_until`, vérification supplémentaire exigée, demandeur, valideur,
  transaction de remboursement, référence externe, motif d'échec ou de refus, transaction de contre-passation.
- **Défi du titulaire** : code à usage unique envoyé au numéro vérifié pour décider d'une demande vers un autre numéro.
- **Écritures** : `WALLET_REFUND` (sortie du solde payé, frais), `REVERSAL` (échec), `DEPOSIT_REFUNDED`, `PROMO_EXPIRY`
  (guichet de retour).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : l'app festivalier crée, liste et suit ses demandes sur l'API partagée sans aucune réponse `404` sur les
  trois routes festivalier du contrat. — [build] · no-op passable: no
- **SC-002** : un parcours complet (demande, approbation à deux, paiement confirmé) rend au festivalier exactement son
  solde payé moins les frais, et un parcours échoué lui rend tout son solde payé. — [build] · no-op passable: no
- **SC-003** : 100 % des tentatives d'approbation par la même personne que l'auteur ou le demandeur sont refusées. —
  [build] · no-op passable: no
- **SC-004** : un bracelet avec caution, crédits offerts, solde payé et espèces dues est restitué en une seule opération
  au guichet, avec les écritures dans l'ordre de §7.9. — [build] · no-op passable: no
- **SC-005** : aucune demande vers un autre numéro n'est traitable avant la décision du titulaire ou l'échéance. —
  [build] · no-op passable: no

## Assumptions

- Le titulaire est la personne au numéro vérifié rattachée au portefeuille par son compte (`customer_identity`, livré le
  10/11/2026) ; un bracelet anonyme rattaché à un compte a ce compte pour titulaire.
- Les frais de remboursement suivent la règle de frais de l'événement déjà livrée par la mission 3 ; sans règle configurée, le remboursement est refusé (décision du porteur du 13/11/2026 au plan : l'organisateur configure une règle, éventuellement à 0).
- Le remboursement en espèces au guichet n'existe qu'à travers le guichet de retour (`releaseMedia`), comme le décrit
  le contrat ; aucune route d'espèces séparée n'est ajoutée.
- L'envoi du code au titulaire réutilise l'envoyeur simulé existant (OP-N120), refusé en production.
- Un portefeuille dont le seul blocage vient d'un bracelet déclaré perdu (`SUSPENDED`) reste remboursable ; un
  portefeuille bloqué pour contestation, fraude ou autre cause, ou portant un bracelet `BLACKLISTED`, ne l'est pas
  (`422 REFUND_NOT_ALLOWED`) (décision du porteur du 13/11/2026 au plan).
- Les statuts de l'événement où `WALLET_REFUND` est permis sont ceux de la matrice §12.1 ; la 9a ne change pas ces
  statuts (la clôture est en 9b).

## Contradictions de sources

- `PROMPTS-A-ENVOYER.md` (texte de la 9a du 13/11/2026) parlait d'un « port de versement avec faux » ; SPECIFICATION
  §8.5, ADR-53 et le contrat prévoient un paiement manuel. Tranché par le porteur le 13/11/2026 : manuel (C-003) ;
  `PROMPTS-A-ENVOYER.md` est corrigé.
- SPECIFICATION §8.5 prévoit le virement bancaire « réservé aux demandes créées par le back-office » ; le contrat déclare
  cette opération « à ajouter, non décrite ». Tranché par le porteur le 13/11/2026 : reportée (C-004).

## Decisions

Décisions du porteur du 13/11/2026, consignées dans `decisions/` : découpage de la mission 9 en 9a et 9b ; services
externes simulés jusqu'à la 12b ; paiement manuel des remboursements (aucun port de versement) ; demande créée par le
back-office (virement) reportée et consignée.
