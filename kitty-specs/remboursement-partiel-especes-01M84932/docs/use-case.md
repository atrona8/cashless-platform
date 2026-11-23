# Cas d'usage : mission remboursement-partiel-especes-01M84932

> État : **relue le 23/11/2026, les six lots approuvés, non acceptée, non fusionnée** (mission 9c « Remboursement partiel en espèces au guichet ») ; code dans les lanes a à f,
> tout dans la lane `f`. Recalé sur le code de la lane `f`, `docs/passation-9c/` (preuves, note aux équipes), `docs/POINTS_OUVERTS.md` §13 (OP-N173 à OP-N184), ADR-233 et ADR-234, et les
> retours de relecture. Aucun test relancé par cette mise à jour. Les décisions du porteur du 23/11/2026 (ADR-233) ont remplacé les décisions D1 à D6 « par défaut » du plan : le cumul est **par
> portefeuille** (le plan disait par bracelet), le reste de D1 à D6 est confirmé. Diagrammes `/illustre` régénérés (bandeau « Relu le 23/11/2026 — non fusionnée »), police sans empattement, rendus relus ;
> sources et générateur dans [`diagrams/`](diagrams/) (`generate.py`).

## Cas d'usage propres à cette mission

![Cas d'usage du rendu partiel](diagrams/usecase-rendu-partiel.png)

Sources : [`usecase-rendu-partiel.excalidraw`](diagrams/usecase-rendu-partiel.excalidraw), [`usecase-rendu-partiel.svg`](diagrams/usecase-rendu-partiel.svg).

| Cas d'usage | Acteur | Règle livrée | Route ou réglage |
|---|---|---|---|
| Autoriser la fonction pour ses organisateurs | Prestataire (`OPERATOR_ADMIN`) | Refusée par défaut ; clé de cascade au niveau prestataire seul (`setBy` `OPERATOR_ADMIN`) ; retirer l'autorisation suffit à refuser le rendu suivant (relue à chaque rendu) | `cash_partial_refund_allowed` via `createOperatorConfigVersion` |
| Activer ou désactiver pour un événement | Organisateur (`ORGANIZER_ADMIN`) | Désactivée par défaut ; activer sans autorisation du prestataire : `422 VALIDATION_FAILED`, règle `operator.cash_partial_refund_allowed` (message de repli, OP-N175) ; désactiver toujours permis ; en `LIVE`, demande à deux personnes `EVENT_SETTINGS_CHANGE`, bornes revérifiées à l'approbation (demande `FAILED` si l'autorisation a été retirée) ; la création d'événement ignore le champ | `cash_partial_refund_enabled` via `updateEvent` (propriété facultative d'`Event` et d'`EventUpdate`) |
| Rendre une partie du solde payé | Caissier ou superviseur du guichet (`TOPUP_DESK`), session de caisse ouverte | Montant **débité** brut ≤ solde payé, espèces remises nettes des frais de `refund_policy` à chaque rendu ; bracelet lu, resté actif ; crédits offerts et caution inchangés ; bracelets anonymes acceptés ; rejouable par `Idempotency-Key` ; `refund_policy` fermée ou sans canal `CASH` refusée (renforcement, OP-N177) ; réponse `201` avec `cash_handed`, `fee`, `paid_balance_after`, `day_cumulative`, `approved_by` | `POST /media/{media_id}/partial-cash-refunds` (`refundPartialCash`) |
| Refus avec motif distinct | Caissier | Fonction non permise : `422 REFUND_NOT_ALLOWED`, `reason` `PARTIAL_CASH_REFUND_DISABLED`, sans code nouveau ; `422 AMOUNT_OUT_OF_RANGE` (montant nul, sous le minimum, ou inférieur ou égal aux frais), `422 INSUFFICIENT_FUNDS`, `422 WALLET_BLOCKED` (non listé dans la description de l'opération, OP-N176), `422 VALIDATION_FAILED` (phase `DRAFT`, tenue par la matrice du moteur, OP-N179), `409 CONFLICT_STATE` (pas de session ouverte), `409 DEBIT_AUTHORITY_EDGE` (coupure), `409 MEDIA_STATE_INVALID` (bracelet non actif) | idem |
| Valider le cumul du jour au-dessus du seuil | Seconde personne sur place | Cumul des rendus partiels **du portefeuille** (tous ses bracelets), jour UTC, montant demandé compris, `>` `cash_refund_single_max` : jeton d'approbation d'une autre personne, lu sous le verrou du solde payé (ADR-190, ADR-195) ; sans jeton `403 APPROVAL_REQUIRED`, jeton refusé `403 APPROVAL_INVALID`, rien d'écrit ; une annulation (`REVERSAL`) ne diminue pas le cumul (OP-N173) | en-tête `X-Approval-Token` |

Hors périmètre : espèces dues (restent rendues par `refundCashDue`, limite L2 devenue OP-N174), guichet de retour (inchangé, C-002, cumul propre), tout remboursement hors espèces (C-005), interface (l'app terminal est une autre mission), app festivalier (l'opération n'est pas ouverte aux comptes).
Limite L1 du plan (bracelet remplacé qui repart d'un cumul nul) : **non reprise**, le cumul suivant le portefeuille ; pas d'entrée OP ni d'ADR. À confirmer par le porteur (voir les réponses ci-dessous).

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, domaines « Bracelets NFC : format, clés, lots, cycle de vie » (rendu au guichet sans restitution) et « Argent réel : PSP, caisses, rapprochements, versements » (sortie d'espèces de la caisse, réglages de remboursement). Aucun renommage ni fusion de cas d'usage globaux.

## Nécessaire pour cette mission ? Oui : quatre acteurs et cinq cas d'usage livrés, dont un acteur de réglage de plus (le prestataire) ; diagramme régénéré sur le code relu (réponse proposée par l'Agent le 23/11/2026, en attente du porteur).
## Complet ? Oui pour la relecture : codes de refus réels, circuit `LIVE` des réglages et cumul par portefeuille recalés ; restent hors diagramme (en texte) les refus `WALLET_BLOCKED`, `MEDIA_STATE_INVALID` et de phase ; L1 non reprise, à confirmer (réponse proposée par l'Agent le 23/11/2026, en attente du porteur).
## Validé par : réponse proposée par l'Agent le 23/11/2026, en attente du porteur.
