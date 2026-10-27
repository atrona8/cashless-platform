# Contrat : caisses, recharges espèces, dépôt

Références : SPECIFICATION §5.3, §7.9, §11.2, §12.2 ; ADR-63, ADR-89, ADR-113 ; research R-01 à R-06, R-15 et **R-20 (fait foi)**.

## Règles

1. **Une caisse = un terminal `TOPUP_DESK`** : compte `A-CAISSE-<série>` du grand livre de l'événement, créé par
   `open_cash_session` s'il n'existe pas.
2. **Aucune espèce sans session `OPEN`** du terminal (garde en base sur `posting`, R-02). Opérations concernées :
   `createCashTopup`, `takeDeposit` (espèces), `refundDeposit` (espèces), `refundCashDue`, `releaseMedia` (espèces
   rendues). Sans session : `409 CONFLICT_STATE` (message existant d'ADR-89). `cash_session_id` fourni : doit être la
   session ouverte du terminal, sinon `409`.
3. **Ouverture** (`openCashSession`) : terminal (trois preuves, mode `TOPUP_DESK`, actif) + personne `CASHIER` ou
   `SUPERVISOR` de l'événement ; grand livre `LIVE` ou `CLOSING` (`409` sinon). Une session `OPEN` par caisse et par terminal (`409`). Aucune écriture comptable.
   `cash_account_id` facultatif ; fourni, doit être la caisse du terminal.
4. **Comptage** (`countCashSession`) : même authentification ; montant ≥ 0 ; plusieurs comptages ; la réponse ne
   contient jamais le théorique ni l'écart.
5. **Lecture** (`getCashSession`, `listCashSessions`) : `CASHIER` (ses sessions, sans théorique tant que `OPEN`),
   `SUPERVISOR` et `ORGANIZER_ADMIN` de l'événement (théorique et écart après fermeture).
6. **Fermeture** (`closeCashSession`) : `SUPERVISOR` de l'événement n'ayant fait aucun comptage de la session (`403
   FORBIDDEN`) ; comptage obligatoire (`409`) ; une transaction : verrou de la session et de la caisse, théorique =
   solde, `CASH_CLOSE` (clé `cash-close:<session>`), `CASH_DIFF` si écart ≠ 0 (montant = |écart|, signe dans la
   note), caisse ramenée à 0, session `CLOSED`. Rejeu avec la même clé d'idempotence : même réponse. Terminal
   suspendu ou révoqué : la fermeture reste possible (back-office).
7. **Recharge espèces** (`createCashTopup`) : terminal + `CASHIER`/`SUPERVISOR` ; `TOPUP_CASH` source `ONLINE`,
   `occurred_at` = heure de la base ; au-delà du plafond : `422 WALLET_LIMIT_EXCEEDED` /
   `MONTHLY_TOPUP_LIMIT_EXCEEDED`, rien d'écrit ; transaction rattachée à la session ; caution due ensuite (transaction
   distincte, résultat dans `deposit`). Clé d'écriture `<série>:<seq>` (registre des numéros de la 5b).
8. **Découpage hors ligne** (moteur, sources `OFFLINE_SYNC`/`EDGE_SYNC` seulement) : marge au portefeuille, reste sur
   `L-ESP-A-RENDRE`, anomalie `CASH_TOPUP_OVER_LIMIT` (bracelet, montant) dans la même transaction.
9. **Dépôt en banque** (`createApprovalRequest` action `CASH_DEPOSIT`, `{ledger_id, amount, bank_reference}`) :
   `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` de l'événement ; exécution à l'approbation d'une autre personne :
   `CASH_DEPOSIT` source `BACKOFFICE` ; au-delà du solde de `A-TRANSIT` : refus de la base, demande `FAILED`.
10. **Audit** : ouverture, comptage, fermeture, dépôt (auteur, terminal, montants).

## Écritures

| Opération | Débit | Crédit |
|---|---|---|
| `TOPUP_CASH` | `A-CAISSE-<série>` | `L-WAL-P` |
| `CASH_CLOSE` (manque) | `A-TRANSIT` (compté) + pertes du payeur `cash_diff_bearer` (écart) | `A-CAISSE-<série>` (théorique) |
| `CASH_CLOSE` (surplus) | `A-TRANSIT` (compté) | `A-CAISSE-<série>` (théorique) + pertes du payeur `cash_diff_bearer` (écart, sens inverse ; constructeur existant `buildCashClose`, dont l'exigence d'un théorique > 0 est levée) |
| `CASH_DEPOSIT` | `A-BANQUE` | `A-TRANSIT` |
