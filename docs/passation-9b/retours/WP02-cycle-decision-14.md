# WP02 — nouveau cycle (décision 14 du porteur, 17/11/2026)

Ce n'est pas un défaut de WP02 : c'est un renforcement décidé par le porteur après la relecture de WP11
(OP-N126). Lire la décision 14 de `docs/passation-9b/contexte-9b.md` et l'ordre des verrous de
`contracts/interfaces.md` (la demande de remboursement passe en tête).

## Constat 1 (bloquant, sécurité) — fenêtre de course recrédit / rapprochement

`RefundConfirmService.confirm` (WP11, lane-k, `apps/api/src/refunds/refund-confirm.service.ts`) prend
`refund_request … FOR UPDATE`, lit `external_statement_line` (ligne rapprochée à `transaction_id`, ou
même `external_ref` rapprochée à une transaction ou une anomalie) puis écrit un `REVERSAL`.
`match_statement_line` (0083) ne verrouille que la ligne de relevé : un rapprochement validé entre la
lecture et le commit du `REVERSAL` n'est pas vu (READ COMMITTED) : recrédit d'un paiement visible à la
banque. `cashless_app` n'a que `SELECT` sur `external_statement_line` : la fermeture se fait en base.

## Correction attendue (dans `0083`, pas de nouvelle migration)

1. `match_statement_line` (rapprochement à une transaction **ou** à une anomalie) et le rapprochement
   automatique d'`import_statement_lines` verrouillent **avant** la ligne de relevé, `FOR UPDATE` et par
   ordre d'identifiant, toutes les `refund_request` du même grand livre dont `transaction_id = p_tx` ou
   `external_reference = external_ref de la ligne` (référence non nulle).
2. Sous ce verrou : si une de ces demandes est `FAILED` (recréditée, `reversal_transaction_id` non nul),
   le rapprochement manuel est refusé (code d'erreur existant de la mission le plus proche, à nommer dans
   le compte rendu ; aucun code nouveau au contrat) et l'automatique laisse la ligne non rapprochée
   (elle tombera dans `statement-unmatched`). Ne rien changer d'autre à la règle de rapprochement
   (décision 7).
3. Ordre des verrous respecté partout (pas d'interblocage avec `post_transaction` ni avec la
   confirmation de WP11, qui prend `refund_request` puis le grand livre).
4. Tests pgTAP dans `tests_statements.sql` : demande `FAILED` → rapprochement manuel refusé (transaction
   et référence) ; automatique → ligne non rapprochée ; demande `PROCESSING`/`PAID` → inchangé. Preuve
   de la sérialisation (deux sessions `psql` : la confirmation tient le verrou de la demande, le
   rapprochement attend) donnée dans le compte rendu avec la commande. Suites générées intactes.
5. Aucun GRANT, aucun `.sql` généré touché, `search_path` et `assert_tenant` conservés.
