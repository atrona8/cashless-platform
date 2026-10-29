# Cas d'usage — mission recharges-caisses-psp-01M5YEBA

> État : **relue le 29/10/2026, 14 lots approuvés** (WP14 en deux cycles), accept/merge à venir. Recalé sur le code
> livré de la lane `kitty/mission-recharges-caisses-psp-01M5YEBA-lane-m` (plan du 27/10/2026 : `52bdf277`, `c3519afa` ;
> `research.md` R-20 fait foi). Les écarts avec le plan sont dans la colonne « Écart au plan » et en bas de page.

## Cas d'usage propres à cette mission

### Caisse et recharge en espèces

![Cas d'usage de la caisse](diagrams/usecase-caisse.png)

Sources : [`usecase-caisse.excalidraw`](diagrams/usecase-caisse.excalidraw), [`usecase-caisse.svg`](diagrams/usecase-caisse.svg).

### Recharge en ligne par PSP

![Cas d'usage de la recharge PSP](diagrams/usecase-psp.png)

Sources : [`usecase-psp.excalidraw`](diagrams/usecase-psp.excalidraw), [`usecase-psp.svg`](diagrams/usecase-psp.svg).

| Cas d'usage | Acteur | Règle principale (livrée) | Route |
|---|---|---|---|
| Ouvrir une session de caisse | `CASHIER` ou `SUPERVISOR`, sur un terminal `TOPUP_DESK` | Trois preuves du terminal + jeton de la personne ; compte `A-CAISSE-<série>` créé par la base ; une session `OPEN` par caisse et par terminal ; grand livre `LIVE` ou `CLOSING` ; aucune écriture | `POST /cash-sessions` |
| Compter sa caisse | Agent | Montant ≥ 0, jusqu'à 10 comptages ; réponse sans théorique ni écart ; `counted_at` du corps validé mais non retenu (heure de la base) | `POST /cash-sessions/{id}/counts` |
| Consulter une session | Agent (vue sans `cash_diff_anomaly_id`, comptage à l'aveugle) ou personne habilitée | Liste par événement ajoutée (`listCashSessions`) | `GET /cash-sessions/{id}`, `GET /events/{id}/cash-sessions` |
| Fermer la session | `SUPERVISOR` n'ayant fait aucun comptage (`403` sinon) ; au terminal (preuves + personne) ou à la personne seule | Comptage obligatoire (`409`) ; `CASH_CLOSE` à clé `cash-close:<session>`, écart au payeur `cash_diff_bearer`, `CASH_DIFF` si écart non nul ; rejeu : même réponse ; verrous pris dans l'ordre terminal, session, solde (migration `0040`, plus d'interblocage avec une recharge espèces) | `POST /cash-sessions/{id}/close` |
| Recharger en espèces | `CASHIER`, `SUPERVISOR` | `TOPUP_CASH` en ligne rattaché à la session ; au-delà du plafond `422`, rien écrit ; sans session `409` ; garde de caisse en base | `POST /topups/cash` |
| Prendre la caution due | Plateforme, après chaque crédit payé | Transaction distincte ; un échec laisse la caution `DUE`, le crédit reste acquis | (suite de la recharge) |
| Caution et espèces dues | `CASHIER` | Caution, restitution, espèces dues et libération passent par la session ouverte (lève OP-N49) ; `cash_session_id` servi ; le moteur n'accepte plus de compte d'argent désigné par la commande, et `cashless_app` n'a plus les anciennes fonctions à compte libre (OP-N84 levé, `0041`) | routes de la mission 4 |
| Déposer en banque | Admin back-office (deux personnes) | Demande `CASH_DEPOSIT` approuvée par une autre personne ; jamais au-delà du transit | `POST /ledgers/{id}/cash-deposits/approval-requests`, puis approbation (`POST /approval-requests/{id}/approve`) |
| Configurer un PSP | `OPERATOR_ADMIN`, activation par un second | Par organisateur et par moyen ; titulaire = détenteur des fonds ; `secret_ref` (jamais un secret) ; règle de frais obligatoire ; une configuration par défaut au plus ; changement d'état par demande liée à la version | `POST/GET /organizers/{id}/psp-configurations`, `GET /psp-configurations/{id}`, `POST /psp-configurations/{id}/approval-requests` |
| Choisir le PSP de l'événement | `ORGANIZER_ADMIN` | La base refuse un autre organisateur, une configuration non active ou un autre titulaire ; pendant `LIVE`, `202` et demande à deux | `PUT /events/{id}/psp-selections/{method}` |
| Demander une recharge | Agent (terminal + personne) ou festivalier (port d'identité, faux refusé en production) | Recharge `PENDING`, rien au grand livre ; 3 `PENDING` par portefeuille, 20 par terminal ; trois temps (base, appel au PSP hors transaction, référence du PSP) dont le dernier est l'`IdempotentTx` de la route (garde RISK-2 tenu, décision du porteur du 29/10/2026) | `POST /topups/psp` |
| Suivre ou annuler sa recharge | Demandeur | Annulation seulement si le PSP la confirme (même schéma, dernière transaction sous `IdempotentTx`) ; un succès notifié ensuite est crédité s'il est recevable (R-20, à confirmer par le porteur) | `GET /topups/psp/{id}`, `POST …/cancel` |
| Notifier un paiement | PSP | Signature à temps constant, ±300 s, 64 Kio ; conservée brute puis traitée une seule fois ; refus signalés sans écriture | `POST /webhooks/{provider}/{psp_config_id}` |
| Notifier une contestation | PSP | `CHARGEBACK` une fois par contestation, plafonné au montant restant ; portefeuille bloqué si le solde payé ne suffit pas, sans jamais s'attribuer un blocage d'une autre cause (`wallet.other_block`, `0039`, `0042`, OP-N83) ; introuvable après 24 h : `PSP_MISMATCH` | (même route) |
| Accepter une contestation tardive | `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` (demande), seconde personne (approbation) | Après verrouillage du grand livre : demande `LATE_CHARGEBACK`, écriture à l'approbation seulement | `POST /chargebacks/{id}/approval-requests` |
| Débloquer un portefeuille | `ORGANIZER_ADMIN` + seconde personne | Demande `WALLET_UNBLOCK` ; refus (`409` à la demande, `CL029` en base) si le blocage a une autre cause | `POST /wallets/{id}/unblock/approval-requests` |

Hérité de la mission 4 : OP-N49 (compte de caisse à l'ouverture d'une session) **levé**. Dette nommée : adaptateurs PSP
réels et coffre AWS (OP-N81, ADR-131 : aucune recharge en ligne en production avant la mission 6b), remboursement d'un
paiement non crédité (OP-N82), reprise de la caution due après un arrêt entre COMMIT et `afterCommit` (OP-N85, mission 13).
Levés en cours de mission : OP-N83 (cause d'un blocage, `0042`), OP-N84 (anciennes fonctions de caution, `0041`).

## Écarts entre le plan et le code livré
- Demandes à deux ajoutées (hors plan, routes de demande pour `CASH_DEPOSIT`, `WALLET_UNBLOCK`, `LATE_CHARGEBACK`,
  changement d'état d'une configuration PSP) : 12 opérations ajoutées au contrat au lieu des 8 prévues.
- Annulation d'une recharge : un succès notifié après `CANCELLED` est crédité s'il est recevable (plan et `contracts/psp.md` :
  non crédité). Arbitrage R-20 contre `openapi.yaml`, **à confirmer par le porteur**.
- `LATE_CHARGEBACK` ouvert à `OPERATOR_ADMIN` (confirmé par le porteur le 29/10/2026) ; `WALLET_UNBLOCK` à `ORGANIZER_ADMIN` seul.
- `WALLET_BLOCKED` reste `422` (`CL039`), le contrat écrit `409` (contradiction signalée, ADR-135).
- Défaut de déblocage de la migration `0038` (blocage d'une autre cause) corrigé en deux temps (`0039`, `0042`).

## Lien avec la synthèse globale
Contribue à : `docs/02-use-case-diagram.md`, domaines « Argent réel : PSP, caisses » (vue terrain : « Recharger en
espèces », « Recharger en ligne » ; vue administration : « Configurer un PSP », « Choisir le PSP de l'événement »,
« Déposer en banque ») et « Bracelets NFC » (caution et espèces dues).

## Nécessaire pour cette mission ? Oui — la mission introduit la caisse, la recharge espèces, la recharge PSP, les contestations et le dépôt.
## Complet ? Oui, recalé sur le code livré (review du 29/10/2026) ; les diagrammes n'ont pas été refaits (voir la liste « à revoir » du compte rendu : demandes à deux de contestation tardive et de déblocage non dessinées).
## Validé par : en attente du porteur (proposition de l'Agent, 29/10/2026)
