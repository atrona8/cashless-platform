# Mission Review Report: remboursement-partiel-especes-01M84932

**Reviewer**: Claude (revue post-fusion, sous-agent)
**Date**: 2026-11-24
**Mission**: `remboursement-partiel-especes-01M84932` — Remboursement partiel en espèces au guichet (mission 9c)
**Baseline commit**: `68c8fef526e898e2dd61740b90c18504b436c503`
**HEAD at review**: `b688e09c1ca04d691e5f40ad5758cb279faa8f49` (squash `4365e93b`)
**WPs reviewed**: WP01 à WP06 (tous `done`, aucun auto-approbation `ReviewerSelfApproval`)

## Gate Results

Le projet n'a pas les portes `tests/contract`, `tests/architectural`, E2E inter-dépôts ni `issue-matrix.json` de Spec Kitty. Équivalents du projet :

- **Gate 1 (contrat)** : PASS. Batterie de l'orchestrateur : contrat 84 admises / 0 refus. Relu ici : `contract-additions-9b.spec.ts` rejoué (vert). Le diff de `openapi.yaml` ne contient que A1 (opération, `PartialCashRefundCreate`, `PartialCashRefund`), A2 (propriété facultative hors `required`) et A3 (descriptions), conformes à `contracts/partial-cash-refund.md`. Aucune route, aucun champ existant, aucune énumération modifié. Chaque ajout est inscrit dans `contract-baseline.json` avec la ligne de décision du porteur (ADR-233).
- **Gate 2 (architecture, gardes transverses)** : PASS. `device-auth-matrix`, `media-isolation` (48 opérations) et `media-port-swap` ont reçu leur cas (retouches hors carte, consignées au cycle 2 de WP05).
- **Gate 3 (E2E inter-dépôts)** : sans objet pour ce dépôt.
- **Gate 4 (issue matrix)** : sans objet (aucune issue GitHub citée par la spec).
- **Suites ciblées rejouées ici sur `cashless_wp09c`** : Jest `partial-cash-refund`, `partial-refund-threshold`, `partial-refund-settings`, `contract-additions-9b` : 4 suites, 50 tests passés. pgTAP : `pg_prove` introuvable dans ce shell, non rejoué (7541/7541 par l'orchestrateur).

## Revue de l'historique

Aucun lot à 3 cycles ou plus. Rejets : WP05 (cycle 2, trois gardes transverses sans cas pour la route nouvelle, corrigées en ajoutant des cas sans élargir les gardes) ; WP06 (cycle 1, chiffres de preuves non sourcés, matrice de droits à relire, deux faits non consignés, état périmé de PROMPTS). Deux retours arrière forcés (`approved -> planned`, `in_review -> planned`), tous deux par renvoi de cycle de revue, pas de contournement. `retrospective.yaml` présent.

## FR Coverage Matrix

| FR | Objet | Code | Test | Adéquation |
|----|-------|------|------|------------|
| FR-001, FR-003 | rendu du solde payé, crédits offerts et caution intacts | `partial-refund.service.ts` (`WALLET_REFUND` sur `WALLET_PAID`) | `partial-cash-refund.spec.ts` | ADEQUATE |
| FR-002 | bracelet actif | aucune libération | `partial-cash-refund.spec.ts` (OP-N180 : « paiement suivant » non testé, consigné) | PARTIAL, consigné |
| FR-004, FR-005 | deux réglages, défaut faux, règle croisée | `settings-catalog.ts`, `bounds-validator.ts`, migration 0100 | `partial-refund-settings.spec.ts`, `tests_cash_partial_refund.sql` | ADEQUATE |
| FR-006 | refus explicite `PARTIAL_CASH_REFUND_DISABLED` | `assertAllowed` (service l.~190-215) | `partial-cash-refund.spec.ts` | ADEQUATE |
| FR-007 | seconde personne au cumul du portefeuille | `partial-refund-threshold.ts` | `partial-refund-threshold.spec.ts`, concurrence | ADEQUATE |
| FR-008 | frais à chaque rendu | moteur + garde `fee >= amount` | `partial-cash-refund.spec.ts` | ADEQUATE |
| FR-009 | bracelets anonymes | `wallet()` sans compte | `partial-cash-refund.spec.ts` | ADEQUATE |
| FR-010 | caisse | `requireCashSession`, `attach_cash_tx` | `partial-cash-refund.spec.ts` | ADEQUATE |
| FR-011 | idempotence | `@Idempotent` + clé moteur `partial-refund:{media}:{key}` | `partial-cash-refund.spec.ts` | ADEQUATE |
| FR-012 | refus en `EDGE` | contrôlé avant toute écriture | `partial-cash-refund.spec.ts` | ADEQUATE |
| FR-013 | journal | `MEDIA_PARTIAL_CASH_REFUNDED`, journal de config existant | `partial-cash-refund.spec.ts` | ADEQUATE |
| NFR-001 à NFR-004 | latence, concurrence, cloisonnement, droits | suite de concurrence, `media-isolation`, absence de GRANT | présents | ADEQUATE (NFR-002 : OP-N181) |

## Vérifications demandées

- **Aucun GRANT/REVOKE dans la migration 0100** : confirmé (colonne `boolean NOT NULL DEFAULT false` et index partiel seulement). `cashless_app` garde ses droits existants sur `event`.
- **Cloisonnement** : la requête du portefeuille filtre `ma.released_at IS NULL AND w.ledger_id = $2 AND ma.currency = $3` avec le grand livre du terminal ; le cumul filtre `jt.ledger_id`. Cas `refundPartialCash` ajouté à `media-isolation`.
- **Verrou du solde payé avant le seuil** : `lockWalletPaidBalance` (service) précède `paidBalance`, puis `requireApprovalOverDailyCumul`, qui ne verrouille pas et le documente. Ordre bracelet puis portefeuille respecté.
- **Les deux réglages contrôlés à chaque rendu** : `assertAllowed` résout la cascade à chaque appel (autorisation ET activation) ; retirer l'autorisation refuse les événements déjà activés. La politique de remboursement (`open`, canal `CASH`) est aussi exigée.
- **Contrat limité aux ajouts acceptés** : oui (voir Gate 1).
- **Fichiers `.sql` générés de `packages/ledger-sql`** : aucun modifié. Seuls ajouts : `migrations/0100_...sql` et `tests/tests_cash_partial_refund.sql` (écrit à la main, comme les autres `tests_*.sql`, il n'y a pas de générateur de ce répertoire).
- **Migrations existantes** : aucune modifiée (statut `A` uniquement).
- **Création d'événement** : n'active pas le réglage (`EventCreate` inchangé).

## Drift Findings

Aucune dérive bloquante. Aucune invasion de non-objectif ; C-002 (guichet de retour inchangé) respecté : aucun fichier du guichet de retour modifié. Contrôles : `except`/`return ""` silencieux absents du code nouveau ; aucun faux ni bouchon introduit ; module nouveau câblé (`return.module.ts`).

## Risk Findings

### RISK-1 (LOW) : rendu partiel marqué par une chaîne dans `metadata`
`partial-refund.service.ts` écrit `metadata.partial_cash_refund = 'true'` et le cumul le relit mot pour mot (`partial-refund-threshold.ts`, prédicat identique à l'index partiel). Un autre chemin qui écrirait ce marqueur fausserait le cumul. Aucun n'existe ; `partial-refund-threshold.spec.ts` couvre la borne. Consigné par OP-N182/OP-N183 pour le plan et le filtre `p.amount > 0`.

### RISK-2 (LOW) : cumul qui ignore les contre-passations
OP-N173 : prudent (seuil atteint plus vite). Consigné, testé.

### RISK-3 (LOW) : `single_max` absent traité comme 0
`BigInt(wallet.single_max ?? 0)` : tout rendu exige alors une seconde personne. Échec côté sûr.

## Silent Failure Candidates

Aucun nouveau. `paidBalance` renvoie 0 sans ligne : suivi par le refus `amount > paid` (`INSUFFICIENT_FUNDS`), donc sûr.

## Security Notes

| Point | Constat |
|---|---|
| Droits de la base | aucun GRANT nouveau (NFR-004) ; écriture par le moteur du grand livre existant |
| Matrice de réglage | `cash_partial_refund_allowed` : niveau `OPERATOR` seul, `OPERATOR_ADMIN` ; l'organisateur ne peut pas s'autoriser. `cash_partial_refund_enabled` : `ORGANIZER_ADMIN`, règle croisée |
| Seconde personne | jeton `X-Approval-Token` consommé dans la même transaction ; portée = événement du terminal ; `approved_by` porté par l'écriture |
| Injection / chemins | requêtes paramétrées ; aucun appel de processus, de fichier ou de réseau nouveau |
| Faux en production | aucun faux introduit par la mission |

## Écarts de sécurité ouverts

**Aucun écart qui affaiblisse la sécurité.** Les deux écarts au plan sont des renforcements consignés : cumul par portefeuille (au lieu de par bracelet) et refus d'une `refund_policy` sans `channels`. Les limites OP-N173 à OP-N184 sont toutes présentes dans `docs/POINTS_OUVERTS.md` (§2 et §13), avec ADR-234 (risque, raison, mission qui lève, condition), test de borne ou absence assumée, et report dans `PROMPTS-A-ENVOYER.md` (missions 11, 12, 13) et `PRD.md`. ADR-233 et ADR-234 existent. Donc aucun constat bloquant de la règle 3.

## Constats mineurs (non bloquants)

1. `PROMPTS-A-ENVOYER.md` : la ligne d'état dit encore « WP06 (consignation) au cycle 2 » ; la mission est livrée. Rectifier lors d'une prochaine édition.
2. `spec.md` porte encore `Status: Draft`.
3. OP-N180 et OP-N183 sont des absences de test assumées : FR-002 (« paiement suivant ») n'est prouvé que par la relecture du statut et du solde.
4. OP-N181 : test de concurrence détecté 4 fois sur 5 pour la mutation du verrou de portefeuille ; le verrou du bracelet couvre le cas d'un seul bracelet.
5. OP-N184 : lignes de plus de 100 caractères, à reformater (Prettier) à la fusion de main, selon la décision du 14/10.
6. `pg_prove` n'a pas été rejoué dans cette revue (démarrage de shell sans l'outil) ; l'orchestrateur rapporte 7541/7541.

## Fichiers à faire relire par une personne

- `apps/api/src/media/lifecycle/partial-refund.service.ts` (verrous, frais, caisse)
- `apps/api/src/media/lifecycle/partial-refund-threshold.ts` (cumul, seconde personne)
- `packages/ledger-sql/migrations/0100_event_cash_partial_refund.sql`
- `apps/api/src/configuration/bounds-validator.ts` et `settings-catalog.ts` (règle croisée, matrice des droits)
- `packages/contracts/openapi.yaml`, `tools/contract-stability/contract-baseline.json`, `contract-additions-9b.spec.ts`

## Final Verdict

**PASS WITH NOTES**

### Verdict rationale

Les treize FR et quatre NFR ont du code et des tests qui contraignent le comportement ; les suites ciblées rejouées passent (50 tests). Aucune migration existante ni fichier SQL généré modifié, aucun GRANT, contrat limité aux ajouts acceptés et inscrits au gel, deux réglages contrôlés à chaque rendu, solde payé verrouillé avant la lecture du cumul, cloisonnement par grand livre. Aucun écart de sécurité n'affaiblit le système, et toutes les limites sont consignées (OP-N173 à OP-N184, ADR-233/234, reports PROMPTS et PRD). Aucun constat CRITICAL ou HIGH.

### Open items (non bloquants)

Constats mineurs 1 à 6 ci-dessus ; limites portées aux missions 11, 12 et 13.

## Retrospective Reminder

`kitty-specs/remboursement-partiel-especes-01M84932/retrospective.yaml` est présent (écrit au merge). Pour la suite : `spec-kitty retrospect summary` et `spec-kitty agent retrospect synthesize --mission remboursement-partiel-especes-01M84932` (à sec par défaut ; `--apply` mute), sous `LC_ALL=C LANG=C`.
