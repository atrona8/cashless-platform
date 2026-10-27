# Contrat : droits de la base

Principe (C-004) : `cashless_app` lit ce qu'il sert et n'écrit que par fonctions SECURITY DEFINER à `search_path`
fixé, `REVOKE ALL … FROM PUBLIC`, `EXECUTE` accordé nommément. `post-roles.sql` rejoue les retraits ;
`tests_execute_grants.sql` (liste figée) et une suite de droits (`tests_cash_psp_rights.sql`) échouent si un droit
s'élargit. Fichiers à faire relire par une personne : migrations de cette mission et `post-roles.sql`.

## Tables nouvelles

| Table | SELECT `cashless_app` | INSERT/UPDATE/DELETE |
|---|---|---|
| `cash_session`, `cash_session_count`, `cash_session_tx` | oui (RLS) | aucun |
| `psp_configuration` | oui, sauf `secret_ref` (droit par colonne ; lu par la fonction qui sert l'adaptateur) | aucun |
| `event_psp_selection` | oui | aucun |
| `psp_topup` | oui | aucun |
| `psp_event` | colonnes sans `body` | aucun |
| `psp_chargeback` | oui | aucun |
| `cash_desk` | oui | aucun |
| `psp_webhook_rejection` | oui | aucun (écrit par `record_webhook_rejection`, compteur borné par minute) |

## Fonctions accordées à `cashless_app`

`open_cash_session`, `count_cash_session`, `begin_cash_close` (verrou du solde, théorique, contrôles, `CLOSING`),
`take_deposit_for_session`, `refund_deposit_for_session`, `refund_cash_due_for_session`, `psp_webhook_context`,
`psp_poll_candidates`, `record_webhook_rejection`, `complete_card_topup`, `read_psp_event_body` (audité),
`finish_cash_close` (vérifie la transaction `CASH_CLOSE` et l'anomalie), `attach_cash_tx`, `open_cash_due_anomaly`,
`create_psp_configuration`, `activate_psp_configuration` (appelée par l'exécution d'approbation seulement : vérifie
une demande `PSP_CONFIGURATION` `APPROVED` non exécutée), `set_event_psp_selection`, `resolve_psp_configuration`,
`psp_configuration_secret_ref`, `create_psp_topup`, `mark_psp_topup_initiated`, `record_psp_event`,
`complete_psp_topup`, `fail_psp_topup`, `expire_psp_topups`, `cancel_psp_topup`, `record_chargeback`,
`block_wallet_after_chargeback`, `unblock_wallet` (vérifie une demande `WALLET_UNBLOCK` approuvée),
`card_topups_today`, `wallet_card_count`.

## Garde de caisse

Déclencheur `posting_cash_desk_guard` (`BEFORE INSERT` sur `posting`) : compte inscrit dans `cash_desk` ⇒ session
`OPEN` de ce compte (même terminal si la transaction en porte un), ou session `CLOSING` avec la transaction
`CASH_CLOSE` de clé `cash-close:<session>` (état de ligne, jamais une variable de session). Déclencheur
`account_purpose_guard` (`BEFORE INSERT` sur `account`) : `current_user = 'cashless_app'` et `purpose` `CASH_DESK`
ou `PSP` → refus. Fonction du
déclencheur SECURITY DEFINER, `search_path` fixé, non exécutable par `cashless_app` directement.
