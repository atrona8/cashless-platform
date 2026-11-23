# Notes d'architecture : mission remboursement-partiel-especes-01M84932

> État : **plan finalisé le 23/11/2026, rien n'est codé.** Sources : `plan.md`, `research.md` (D1 à D6 **prises par défaut pendant l'absence du porteur, non encore validées par lui**),
> `data-model.md`, `contracts/partial-cash-refund.md` (**ajouts au contrat soumis au porteur**). Aucun conteneur nouveau : tout vit dans l'API centrale et la base existantes
> (`media/lifecycle/`, à côté de `release.service.ts` et `cash-due.service.ts`).

## Composant(s) introduit(s) ou modifié(s) par cette mission (prévu)

- **API centrale, module `media/lifecycle/`** (NestJS, TypeScript) : `partial-refund.controller.ts` et `partial-refund.service.ts` (route `refundPartialCash`), qui réutilisent la garde de guichet (`counter-access.ts`), le jeton sur place (`onsite-approval.ts`), les verrous bracelet puis solde payé et le moteur d'écritures (`WALLET_REFUND`, frais de `refund_policy`, `attach_cash_tx`).
- **Configuration** (`settings-catalog.ts`, `bounds-validator.ts`, `events.service.ts`) : colonne d'événement `cash_partial_refund_enabled`, clé de cascade `cash_partial_refund_allowed`, règle croisée prestataire vers événement.
- **Base** (PostgreSQL 17) : migration `0100_event_cash_partial_refund.sql` (une colonne `NOT NULL DEFAULT false` et son CHECK) ; aucune table, aucune fonction de grand livre nouvelle ; aucun droit de table ou de colonne ajouté à `cashless_app` (NFR-004).
- **Contrat** (`openapi.yaml`, `contract-baseline.json`, test de gel `contract-additions-9b.spec.ts`) : une route, une propriété facultative sur `Event` et `EventUpdate`, une description de clé de cascade ; ajouts rétrocompatibles seulement, **soumis au porteur avant tout code qui touche la route**.

## Décisions d'architecture prises dans cette mission (D1 à D6 : par défaut, à valider par le porteur)

| Décision | Justification | Alternative envisagée |
|---|---|---|
| D1 : autorisation du prestataire en clé de cascade `OPERATOR`, activation en colonne d'événement | Modèles existants (`cash_refund_single_max_cap`, `cash_refund_single_max`), aucune route de réglage nouvelle | Deux colonnes d'événement ; clé au niveau `ORGANIZER` (contraire à « événement par événement ») |
| D2 : montant saisi = montant débité brut, espèces = brut moins frais | Même convention que le guichet de retour ; seuil déjà sur le brut (ADR-190) | Saisir le net (inverser le calcul des frais, code nouveau) |
| D3 : cumul du jour = somme des bruts des `WALLET_REFUND` marqués (`metadata.partial_cash_refund`) depuis 00:00 UTC, lue après le verrou du solde payé, comparée `>` au seuil | ADR-190 (cumul), ADR-195 et OP-N128 (lecture sous verrou), journée UTC (§2.2) | Inclure le guichet de retour (change un comportement existant) ; cumul par portefeuille |
| D4 : aucun code d'erreur nouveau, `reason` distinct dans `REFUND_NOT_ALLOWED` | Énumération gelée par le test de gel | Code `PARTIAL_CASH_REFUND_DISABLED` (ajout au contrat de plus) |
| D5 : `POST /media/{media_id}/partial-cash-refunds`, `refundPartialCash` | Même famille que `cash-due-refunds` et `release` | Paramètre `amount` sur `releaseMedia` (change une route) |
| D6 : amender `SPECIFICATION.md` §8.5 et §17, ADR-233 | Règle de priorité §0.3 ; réalise ADR-53 point 3 | — |

## Dette de sécurité et fichiers à faire relire (prévu)

Aucun écart qui affaiblit la sécurité n'est prévu au plan ; si l'un apparaît au code, il est soumis au porteur avant d'être codé (`CLAUDE.md`, règle 1). Limites à consigner (`docs/POINTS_OUVERTS.md`, ADR-233) : L1 (cumul qui suit le bracelet), L2 (espèces dues hors de ce rendu). À faire relire par une personne : migration 0100 et règle croisée du validateur de bornes, lecture du cumul sous verrou, usage du jeton sur place.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Détail par mission » et « Décisions notables ». Vue C4 inchangée (aucun conteneur nouveau).

## Nécessaire pour cette mission ? Oui : décisions D1 à D6 et contrat à tracer, même sans conteneur nouveau (réponse proposée par l'Agent le 23/11/2026, en attente du porteur).
## Complet ? Oui pour le plan ; à recaler à la review (numéro de migration réel, fichiers à relire, limites consignées) (réponse proposée par l'Agent le 23/11/2026, en attente du porteur).
## Validé par : réponse proposée par l'Agent le 23/11/2026, en attente du porteur.
