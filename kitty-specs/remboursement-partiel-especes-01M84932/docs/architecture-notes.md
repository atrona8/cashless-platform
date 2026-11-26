# Notes d'architecture : mission remboursement-partiel-especes-01M84932

> État : **relue le 23/11/2026, six lots approuvés, non acceptée, non fusionnée** (code dans les lanes a à f, tout dans la lane `f`). Recalé sur le code réel, `docs/passation-9c/`, `docs/POINTS_OUVERTS.md` §13
> (OP-N173 à OP-N184), ADR-233 et ADR-234 ; aucun test relancé par cette mise à jour. Les décisions D1 à D6 du plan, prises par défaut, ont été reprises ou corrigées par les décisions du porteur du 23/11/2026
> (ADR-233) : voir le tableau. Aucun conteneur nouveau : tout vit dans l'API centrale et la base existantes (`media/lifecycle/`, à côté de `release.service.ts` et `cash-due.service.ts`).

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **API centrale, module `media/lifecycle/`** (NestJS, TypeScript) : `partial-refund.controller.ts` (garde de guichet, jeton sur place facultatif de rôle `SUPERVISOR`, idempotence par terminal), `partial-refund.service.ts` (route `refundPartialCash`) et `partial-refund-threshold.ts` (cumul du jour et seconde personne, module autonome : le guichet de retour garde son cumul). Réutilisent `counter-access.ts`, `onsite-approval.ts`, les verrous bracelet puis solde payé (`lockWalletPaidBalance`), le moteur d'écritures (`WALLET_REFUND` `ONLINE`, frais de `refund_policy`) et `attach_cash_tx`. Écriture marquée `metadata.partial_cash_refund = 'true'` ; audit `MEDIA_PARTIAL_CASH_REFUNDED` (une valeur ajoutée à l'union d'`audit.service.ts`, aucune contrainte en base).
- **Configuration** (`settings-catalog.ts`, `bounds-validator.ts`) : colonne d'événement `cash_partial_refund_enabled` (`ORGANIZER_ADMIN`), clé de cascade `cash_partial_refund_allowed` (prestataire seul, `OPERATOR_ADMIN`), règle croisée `operator.cash_partial_refund_allowed` (activer sans autorisation : `422`). `events.dto.ts` et `events.service.ts` **inchangés** : ils lisent les clés d'`UPDATE_KEYS` du catalogue. **Type `boolean` ajouté au catalogue des réglages** (`SettingType`, contrôle de type), absent du plan.
- **Base** (PostgreSQL 17) : migration `0100_event_cash_partial_refund.sql` : colonne `NOT NULL DEFAULT false` **sans CHECK** (le plan en prévoyait un) et **index partiel `journal_transaction_partial_refund_idx`** `(ledger_id, recorded_at) WHERE type = 'WALLET_REFUND' AND metadata->>'partial_cash_refund' = 'true'` (non prévu comme livrable au plan, né de la tâche T003) ; aucune table, aucune fonction de grand livre, aucun `GRANT` : `cashless_app` couvre déjà la colonne (NFR-004).
- **Contrat** (`openapi.yaml`, `contract-baseline.json`, test de gel `contract-additions-9b.spec.ts`, `tools/contract-stability/check.test.mjs` 75 → 84 admises) : une route, deux schémas (`PartialCashRefundCreate`, `PartialCashRefund`), une propriété facultative sur `Event` et `EventUpdate`, une phrase de description de la clé de cascade ; types TypeScript et Dart régénérés. Ajouts rétrocompatibles seuls, acceptés par le porteur (ADR-233 e).
- **Gardes transverses** (cycle 2 de WP05, `cfa11861`) : `device-auth-matrix.spec.ts`, `media-isolation.spec.ts` (47 → 48 opérations), `media-port-swap.spec.ts` (exclusion du seul chemin exact du contrôleur nouveau) reçoivent le cas de la route ; **sans tolérance générale**. Suite de concurrence écartée de la passe parallèle (`jest.config.cjs`) et lancée seule par une étape de `ledger-tests.yml`.

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| D1 : autorisation du prestataire en clé de cascade `OPERATOR`, activation en colonne d'événement (confirmée, ADR-233 c) | Modèles existants, aucune route de réglage nouvelle | Deux colonnes d'événement ; clé au niveau `ORGANIZER` |
| D2 : montant saisi = montant débité brut, espèces = brut moins frais, frais à chaque rendu, anonymes compris (confirmée, ADR-233 b et d) | Même convention que le guichet de retour ; seuil sur le brut | Saisir le net |
| D3 corrigée : cumul du jour = somme des bruts des `WALLET_REFUND` marqués **du portefeuille** (tous bracelets), 00:00 UTC, lu après le verrou du solde payé, comparé `>` au seuil ; `ledgerId` ajouté aux signatures (`partialRefundDayTotal`, `requireApprovalOverDailyCumul`) pour que l'index partiel serve ; `REVERSAL` non déduit (OP-N173) | ADR-190, ADR-195 ; renforcement du choix par bracelet (ADR-233 a) | Cumul par bracelet (un portefeuille à plusieurs bracelets multiplie le seuil) |
| D4 : aucun code d'erreur nouveau, `reason` distinct dans `REFUND_NOT_ALLOWED` (confirmée) | Énumération gelée ; test de gel mutant | Code `PARTIAL_CASH_REFUND_DISABLED` |
| D5 : `POST /media/{media_id}/partial-cash-refunds`, `refundPartialCash` (confirmée) | Même famille que `cash-due-refunds` et `release` | Paramètre `amount` sur `releaseMedia` |
| D6 : `SPECIFICATION.md` §8.5 et §17 amendés, ADR-233, sans changer le numéro de version (fait) | Règle de priorité §0.3 ; réalise ADR-53 point 3 | — |
| Phases d'événement tenues par la matrice du moteur (`status-matrix.ts`), sans contrôle propre au service (OP-N179) | Comme le guichet de retour ; `DRAFT` refusé `422 VALIDATION_FAILED`, `LIVE` à `CLOSED` non verrouillé permis | Contrôle de phase propre à l'opération (à décider par le porteur) |

## Dette de sécurité et fichiers à faire relire

Aucun écart n'affaiblit la sécurité (ADR-234, `POINTS_OUVERTS.md` §13) ; deux renforcements consignés : cumul par portefeuille, `refund_policy` sans `channels` refusée. Limites consignées : OP-N173 à OP-N184 (dont OP-N174 = L2 espèces dues, OP-N181 verrou du solde payé détecté 4 fois sur 5 par la mutation, OP-N182 index partiel non mesuré à volume réel). L1 du plan non reprise (le cumul suit le portefeuille). **À faire relire par une personne** (règle 4 de `CLAUDE.md`, liste de WP06) : `partial-refund.service.ts`, `partial-refund-threshold.ts`, migration `0100`, `bounds-validator.ts`, `settings-catalog.ts` (matrice des droits de réglage), `openapi.yaml`, `contract-baseline.json` et le test de gel.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Détail par mission » et « Décisions notables ». Vue C4 inchangée (aucun conteneur nouveau).

## Nécessaire pour cette mission ? Oui : décisions D1 à D6, correction de D3, migration et contrat à tracer, même sans conteneur nouveau (réponse proposée par l'Agent le 23/11/2026, en attente du porteur).
## Complet ? Oui pour la relecture : numéro de migration réel `0100`, fichiers à relire, limites consignées, écarts au plan listés ; reste à vérifier à la fusion le reformatage à 100 caractères (OP-N184) et l'état de la CI pgTAP (non établi) (réponse proposée par l'Agent le 23/11/2026, en attente du porteur).
## Validé par : réponse proposée par l'Agent le 23/11/2026, en attente du porteur.
