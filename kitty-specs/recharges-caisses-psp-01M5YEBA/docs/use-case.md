# Cas d'usage — mission recharges-caisses-psp-01M5YEBA

> État : **plan finalisé le 27/10/2026** (`52bdf277`, `c3519afa`) ; rien n'est encore implémenté. Les règles ci-dessous
> sont celles du plan (`research.md`, dont R-20 fait foi). À recaler sur le code livré à l'addendum post-relecture.

## Cas d'usage propres à cette mission

### Caisse et recharge en espèces

![Cas d'usage de la caisse](diagrams/usecase-caisse.png)

Sources : [`usecase-caisse.excalidraw`](diagrams/usecase-caisse.excalidraw), [`usecase-caisse.svg`](diagrams/usecase-caisse.svg).

### Recharge en ligne par PSP

![Cas d'usage de la recharge PSP](diagrams/usecase-psp.png)

Sources : [`usecase-psp.excalidraw`](diagrams/usecase-psp.excalidraw), [`usecase-psp.svg`](diagrams/usecase-psp.svg).

| Cas d'usage | Acteur | Règle principale (planifiée) | Route |
|---|---|---|---|
| Ouvrir une session de caisse | `CASHIER` ou `SUPERVISOR`, sur un terminal `TOPUP_DESK` | Trois preuves du terminal + jeton de la personne ; compte `A-CAISSE-<série>` créé par la base ; une session `OPEN` par caisse et par terminal ; grand livre `LIVE` ou `CLOSING` ; aucune écriture | `POST /cash-sessions` |
| Compter sa caisse | Agent | Montant ≥ 0, jusqu'à 10 comptages ; réponse sans théorique ni écart | `POST /cash-sessions/{id}/counts` |
| Fermer la session | `SUPERVISOR` n'ayant fait aucun comptage (`403` sinon) | Comptage obligatoire (`409`) ; `CASH_CLOSE` à clé `cash-close:<session>`, écart au payeur `cash_diff_bearer`, `CASH_DIFF` si écart non nul ; rejeu : même réponse | `POST /cash-sessions/{id}/close` |
| Recharger en espèces | `CASHIER`, `SUPERVISOR` | `TOPUP_CASH` en ligne rattaché à la session ; au-delà du plafond `422`, rien écrit ; sans session `409` ; garde de caisse en base | `POST /topups/cash` |
| Prendre la caution due | Plateforme, après chaque crédit payé | Transaction distincte ; un échec laisse la caution `DUE`, le crédit reste acquis | (suite de la recharge) |
| Caution et espèces dues | `CASHIER` | Caution, restitution, espèces dues et libération passent par la session ouverte (lève OP-N49) ; `cash_session_id` servi | routes de la mission 4 |
| Déposer en banque | Admin back-office (deux personnes) | Demande `CASH_DEPOSIT` approuvée par une autre personne ; jamais au-delà du transit | `POST /approval-requests` |
| Configurer un PSP | `OPERATOR_ADMIN`, activation par un second | Par organisateur et par moyen ; titulaire = détenteur des fonds ; `secret_ref` (jamais un secret) ; règle de frais obligatoire ; une configuration par défaut au plus | `POST/GET /organizers/{id}/psp-configurations` |
| Choisir le PSP de l'événement | `ORGANIZER_ADMIN` | La base refuse un autre organisateur, une configuration non active ou un autre titulaire ; pendant `LIVE`, `202` et demande à deux | `PUT /events/{id}/psp-selections/{method}` |
| Demander une recharge | Agent (terminal + personne) ou festivalier (port d'identité, faux refusé en production) | Recharge `PENDING`, rien au grand livre ; 3 `PENDING` par portefeuille, 20 par terminal | `POST /topups/psp` |
| Suivre ou annuler sa recharge | Demandeur | Annulation seulement si le PSP la confirme | `GET /topups/psp/{id}`, `POST …/cancel` |
| Notifier un paiement | PSP | Signature à temps constant, ±300 s, 64 Kio ; conservée brute puis traitée une seule fois ; refus signalés sans écriture | `POST /webhooks/{provider}/{psp_config_id}` |
| Notifier une contestation | PSP | `CHARGEBACK` une fois par contestation, plafonné au montant restant ; portefeuille bloqué si le solde payé ne suffit pas ; tardive : approbation | (même route) |
| Débloquer un portefeuille | `ORGANIZER_ADMIN` + seconde personne | Demande `WALLET_UNBLOCK` | `POST /approval-requests` |

Hérité de la mission 4, **à lever** : OP-N49 (compte de caisse à l'ouverture d'une session). Reportés avec dette nommée :
adaptateurs PSP réels et coffre AWS (OP-N81, ADR-131), remboursement d'un paiement non crédité (OP-N82).

## Lien avec la synthèse globale
Contribue à : `docs/02-use-case-diagram.md`, domaines « Argent réel : PSP, caisses » (vue terrain : « Recharger en
espèces », « Recharger en ligne » ; vue administration : « Configurer un PSP », « Choisir le PSP de l'événement »,
« Déposer en banque ») et « Bracelets NFC » (caution et espèces dues).

## Nécessaire pour cette mission ? Oui — la mission introduit la caisse, la recharge espèces, la recharge PSP, les contestations et le dépôt.
## Complet ? Oui au stade plan — à recaler sur le code livré à l'addendum post-relecture (à confirmer par le porteur).
## Validé par : en attente du porteur (proposition de l'Agent, 27/10/2026)
