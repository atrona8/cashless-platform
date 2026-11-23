# Mission Specification: Remboursement partiel en espèces au guichet

**Mission Branch**: `feat/remboursement-partiel-especes`
**Created**: 2026-11-23
**Status**: Draft
**Input**: User description: "Mission 9c — Remboursement partiel en espèces au guichet, sans restitution du bracelet (entrée « Mission 9c » de PROMPTS-A-ENVOYER.md, décision du porteur du 23/11/2026). Un réglage d'événement, réglé par l'organisateur et désactivé par défaut, permet au guichet de rendre en espèces tout ou partie du solde payé du portefeuille du bracelet lu ; le bracelet reste actif."

Aujourd'hui, au guichet, le solde payé d'un portefeuille ne se rend en espèces qu'en rendant le bracelet (guichet de
retour). Cette mission permet de rendre **tout ou partie** du solde payé en espèces **sans restitution**, si le
prestataire l'autorise et si l'organisateur l'active pour l'événement. Elle réalise ADR-53 point 3 (« sur présentation
du bracelet lu par le terminal ») et respecte la règle de la seconde personne appliquée au cumul (ADR-190).

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| **Rendu partiel** | Remboursement en espèces d'un montant choisi, au plus le solde payé, le bracelet restant actif | « retrait » (aucun retrait hors remboursement, SPECIFICATION §6.5), « avance » |
| **Solde payé** | Compte remboursable du portefeuille (`WALLET_PAID`) | « solde » seul, qui inclut les crédits offerts |
| **Guichet de retour** | Restitution du bracelet avec remboursement complet (existant, inchangé) | « rendu partiel » |
| **Cumul du jour** | Somme des rendus partiels d'un bracelet depuis 00:00 UTC, rendu en cours compris | — |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rendre une partie du solde en gardant son bracelet (Priority: P1)

Un festivalier, avec ou sans compte, se présente au guichet pendant l'événement. Il veut récupérer en liquide une partie
de son solde payé et continuer à payer avec son bracelet. Le caissier lit le bracelet, saisit le montant, remet les
espèces ; le bracelet reste actif avec le solde restant.

**Why this priority**: c'est le besoin exprimé par le porteur ; sans lui, la mission n'apporte rien.

**Independent Test**: sur un événement où la fonction est permise, un bracelet anonyme au solde payé de 20 000 XOF
reçoit un rendu de 5 000 XOF ; son solde payé passe à 15 000 XOF moins les frais, il paie ensuite un achat.

**Acceptance Scenarios**:

1. **Given** un événement où le prestataire autorise et l'organisateur active la fonction, une session de caisse
   ouverte et un bracelet actif au solde payé de 20 000 XOF, **When** le caissier demande un rendu de 5 000 XOF,
   **Then** 5 000 XOF sortent de la caisse, le solde payé baisse de 5 000 XOF plus les frais éventuels, et le bracelet
   reste actif.
2. **Given** le même bracelet, **When** le caissier demande un rendu égal à tout le solde payé, **Then** le rendu est
   accepté, le solde payé passe à zéro et le bracelet reste actif.
3. **Given** un bracelet avec des crédits offerts et une caution détenue, **When** un rendu partiel est fait,
   **Then** les crédits offerts et la caution sont inchangés.

---

### User Story 2 - L'organisateur décide, dans la limite du prestataire (Priority: P1)

Le prestataire autorise ou non la fonction pour ses organisateurs. L'organisateur l'active ou non pour chacun de ses
événements. Par défaut, elle est refusée.

**Why this priority**: c'est la condition posée par le porteur (« c'est les organisateurs qui décident »).

**Independent Test**: sans autorisation du prestataire, l'organisateur ne peut pas activer la fonction ; avec, il
l'active, et le guichet accepte un rendu partiel ; il la désactive, et le guichet le refuse.

**Acceptance Scenarios**:

1. **Given** un prestataire qui n'a pas autorisé la fonction, **When** l'organisateur tente de l'activer pour son
   événement, **Then** la demande est refusée et rien ne change.
2. **Given** la fonction autorisée et activée, **When** l'organisateur la désactive, **Then** tout rendu partiel
   suivant est refusé, avec un motif explicite.
3. **Given** un nouvel événement, **When** personne n'a rien réglé, **Then** le rendu partiel est refusé.
4. **Given** le prestataire retire son autorisation alors qu'un événement l'avait activée, **When** le guichet demande
   un rendu partiel, **Then** il est refusé.

---

### User Story 3 - Seconde personne au-delà du cumul du jour (Priority: P2)

Pour qu'un gros remboursement ne soit pas découpé en petits rendus sans seconde personne, le seuil de l'événement
(`cash_refund_single_max`, 50 000 XOF par défaut) s'applique au cumul des rendus partiels du bracelet sur la journée.

**Why this priority**: renforcement déjà décidé (ADR-190) ; sans lui, la fonction ouvre un contournement.

**Independent Test**: seuil à 50 000 XOF ; rendus de 30 000 puis 25 000 XOF le même jour sur le même bracelet : le
second exige un jeton d'approbation sur place.

**Acceptance Scenarios**:

1. **Given** un seuil de 50 000 XOF et un premier rendu de 30 000 XOF dans la journée, **When** le caissier demande
   25 000 XOF sans seconde personne, **Then** le rendu est refusé (seconde personne exigée) et rien n'est écrit.
2. **Given** la même situation avec un jeton d'approbation valide d'une autre personne, **When** le caissier redemande
   25 000 XOF, **Then** le rendu est accepté et la seconde personne est portée par l'écriture.
3. **Given** un rendu de 30 000 XOF la veille, **When** le caissier demande 30 000 XOF aujourd'hui, **Then** une seule
   personne suffit.

---

### Edge Cases

- Montant nul, négatif, ou supérieur au solde payé disponible : refus, rien n'est écrit.
- Solde payé insuffisant pour couvrir le montant plus les frais : refus.
- Bracelet suspendu, en liste noire, remplacé, non activé ou rendu : refus, avec le motif du bracelet.
- Portefeuille bloqué ou clôturé : refus.
- Aucune session de caisse ouverte sur le terminal, ou terminal qui n'est pas un guichet : refus.
- Événement hors des phases où le guichet rembourse, ou autorité de débit sur la passerelle (coupure) : refus.
- Même demande rejouée (même clé d'idempotence) : même réponse, aucune seconde sortie d'espèces.
- Deux rendus simultanés sur le même bracelet : le cumul et le solde restent justes (aucun dépassement).
- Espèces dues ouvertes sur le bracelet (recharge hors ligne au-delà d'un plafond) : elles ne sont pas rendues par
  cette opération ; elles restent rendues par l'opération existante.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Rendu partiel au guichet | En tant que caissier ou superviseur d'un guichet, avec une session de caisse ouverte, je veux rendre en espèces un montant choisi, au plus le solde payé du portefeuille du bracelet lu, afin que le festivalier récupère son argent en gardant son bracelet. | High | Open | [build] | no |
| FR-002 | Bracelet gardé actif | En tant que festivalier, je veux que mon bracelet reste actif et rattaché au même portefeuille après un rendu partiel, afin de continuer à payer. | High | Open | [build] | no |
| FR-003 | Solde payé seulement | En tant qu'organisateur, je veux que seul le solde payé soit rendu, sans toucher les crédits offerts ni la caution, afin que les crédits offerts ne deviennent jamais remboursables. | High | Open | [build] | no |
| FR-004 | Autorisation du prestataire | En tant que prestataire, je veux autoriser ou non le rendu partiel pour mes organisateurs (refusé par défaut), afin de garder la main sur les sorties d'espèces de mes caisses. | High | Open | [build] | no |
| FR-005 | Activation par l'organisateur | En tant qu'organisateur, je veux activer ou désactiver le rendu partiel pour chacun de mes événements (désactivé par défaut), seulement si mon prestataire l'autorise, afin de décider de la politique de mon événement. | High | Open | [build] | no |
| FR-006 | Refus explicite | En tant que caissier, je veux un refus avec un motif distinct quand la fonction n'est pas permise pour l'événement, afin d'orienter le festivalier vers le guichet de retour ou l'app. | Medium | Open | [build] | no |
| FR-007 | Seconde personne au cumul du jour | En tant qu'organisateur, je veux qu'une seconde personne présente valide le rendu dès que le cumul des rendus partiels du bracelet sur la journée UTC, rendu en cours compris, dépasse le seuil de l'événement, afin qu'un gros remboursement ne soit pas fractionné. | High | Open | [build] | no |
| FR-008 | Frais à chaque rendu | En tant qu'organisateur, je veux que la règle de frais de remboursement de l'événement s'applique à chaque rendu partiel, afin de décourager les petits rendus répétés. | Medium | Open | [build] | no |
| FR-009 | Bracelets anonymes | En tant que festivalier sans compte, je veux bénéficier du rendu partiel sur simple présentation de mon bracelet lu par le terminal, comme au guichet de retour. | Medium | Open | [build] | no |
| FR-010 | Contrôle de caisse | En tant que superviseur, je veux que chaque rendu partiel sorte de la caisse de la session ouverte et soit compté à sa fermeture, afin que l'écart de caisse le couvre. | High | Open | [build] | no |
| FR-011 | Idempotence | En tant que caissier, je veux qu'une demande rejouée rende la même réponse sans nouvelle sortie d'espèces, afin qu'une coupure réseau ne double pas un rendu. | High | Open | [build] | no |
| FR-012 | Indisponible pendant une coupure | En tant que prestataire, je veux que le rendu partiel soit refusé quand l'autorité de débit est sur la passerelle locale, comme le guichet de retour. | Medium | Open | [build] | no |
| FR-013 | Traçabilité | En tant qu'auditeur, je veux que chaque rendu partiel et chaque changement des réglages soient journalisés (auteur, seconde personne, montant, frais, terminal, session), afin de pouvoir reconstituer les sorties d'espèces. | High | Open | [build] | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Rapidité au guichet | 95 % des rendus partiels répondent en moins de 300 ms côté serveur, mesurés sur l'environnement de test de la mission. | Performance | Medium | Open |
| NFR-002 | Aucun dépassement | Sur 20 demandes simultanées de rendu pour un même bracelet, la somme rendue ne dépasse jamais le solde payé et le cumul du jour reste exact (0 écart). | Reliability | High | Open |
| NFR-003 | Cloisonnement | 0 rendu ni réglage visible ou modifiable par un autre prestataire ou un autre organisateur, vérifié sur toutes les nouvelles opérations. | Security | High | Open |
| NFR-004 | Aucun droit élargi | Aucun droit de table ni de colonne ajouté au rôle applicatif ; les écritures passent par des fonctions de la base, vérifié par les tests de droits existants. | Security | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Contrat stable | Le contrat partagé ne change pas : opération et réglages nouveaux seulement, rétrocompatibles, présentés au porteur au plan avant d'être codés, et inscrits au contrôle de stabilité du contrat. | Technical | High | Open |
| C-002 | Guichet de retour inchangé | La restitution du bracelet et son enchaînement (caution, crédits offerts, solde, espèces dues, restitution) ne changent pas. | Business | High | Open |
| C-003 | Spécification amendée | `SPECIFICATION.md` §8.5 est amendé pour décrire le rendu partiel et ses conditions ; ADR à ajouter à la suite (règle de priorité §0.3). | Regulatory | Medium | Open |
| C-004 | Écart de sécurité soumis | Tout écart au plan ou à la spécification qui affaiblit la sécurité est soumis au porteur avant d'être codé (règle 1 de `CLAUDE.md`). | Regulatory | High | Open |
| C-005 | Pas de remboursement hors espèces | Le rendu partiel ne rend que des espèces, depuis la caisse du guichet ; ni mobile money, ni carte, ni virement. | Business | High | Open |

### Key Entities *(include if the mission involves data)*

- **Autorisation du prestataire** : indicateur par prestataire, « rendu partiel permis à mes organisateurs », refusé par défaut.
- **Réglage de l'événement** : indicateur par événement, « rendu partiel activé », désactivé par défaut, modifiable seulement si le prestataire l'autorise.
- **Rendu partiel** : une sortie d'espèces vers le festivalier : bracelet, portefeuille, montant, frais, caissier, seconde personne éventuelle, terminal, session de caisse, date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sur un événement qui l'autorise, un festivalier récupère une partie de son solde en espèces au guichet et paie ensuite avec le même bracelet, en un seul passage au guichet. — [build] · no-op passable: no
- **SC-002**: 100 % des demandes de rendu partiel sur un événement non autorisé ou non activé sont refusées, sans aucune sortie d'espèces. — [build] · no-op passable: no
- **SC-003**: 100 % des cumuls du jour au-dessus du seuil exigent une seconde personne, y compris quand le montant est fractionné en plusieurs rendus. — [build] · no-op passable: no
- **SC-004**: À la fermeture d'une session de caisse, l'écart calculé tient compte de tous les rendus partiels de la session (0 écart sur un scénario de recette sans erreur de comptage). — [build] · no-op passable: no

## Assumptions

- La journée du cumul est la journée UTC (le système travaille en UTC, SPECIFICATION §2.2).
- Les phases d'événement où le rendu partiel est permis sont celles où le guichet rembourse déjà en espèces.
- Les espèces dues (recharges hors ligne au-delà d'un plafond) restent rendues par l'opération existante, hors de ce rendu.
- Pas de nombre maximal de rendus par jour : les frais et la seconde personne suffisent à borner les abus.
