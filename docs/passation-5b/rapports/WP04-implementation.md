# Compte rendu du lot WP04 — Paiement, annulation, approbation sur place (migration 0033)

- Lane : lane-d, commit `f46a5d2b` (`feat(WP04): …`), fichiers du lot seulement :
  `packages/ledger-sql/migrations/0033_payments.sql`, `packages/ledger-sql/tests/tests_payments.sql`.
- Sous-tâches T016 à T020 marquées `done` (accepté par le runtime). `move-task` non fait (consigne).
- Aucune retouche hors carte. Aucun fichier généré touché. Aucun `GRANT`.

## Signatures finales (pour WP05, WP07, WP08, WP11, WP12)

| Fonction | Signature | Erreurs |
|---|---|---|
| `record_sale_attribution` | `(p_tx uuid, p_vendor_session uuid, p_channel text, p_actor_user uuid DEFAULT NULL) RETURNS void` | P0002, CL032, CL001, 23505 |
| `assert_tap_payable` | `(p_tap bigint, p_device uuid) RETURNS TABLE(media_id uuid, wallet_id uuid)` | CL022, CL038, P0002 (sans prestataire) |
| `assert_wallet_payable` | `(p_wallet uuid) RETURNS void` | P0002, CL039 |
| `consume_tap` | `(p_tap bigint, p_tx uuid) RETURNS void` (inchangée) | + CL022 si le terminal diffère |
| `assert_reversible` | `(p_tx uuid, p_mode text, p_device uuid DEFAULT NULL, p_vendor_session uuid DEFAULT NULL, p_jti text DEFAULT NULL, p_approval_request uuid DEFAULT NULL) RETURNS TABLE(ledger_id uuid, event_id uuid, wallet_id uuid, media_id uuid)` | CL001, P0002, CL036, CL035, CL040 |

Modes : `VENDOR`, `SUPERVISOR_DEVICE`, `BACKOFFICE`. Les paramètres manquants pour un mode, ou ceux d'un autre mode, donnent `CL001`.
Ordre des contrôles : forme (CL001) → vente du prestataire (P0002) → `PURCHASE` (CL036) → non annulée
(CL035) → événement `LIVE`/`CLOSING` (CL001) → contrôles du mode (CL036) → fenêtre en dernier, mode
`VENDOR` seulement (CL040, ADR-123).

## Écarts au plan (sens)

1. **Renforcement** (arbitrage du 22/10) : les deux paramètres `p_jti` et `p_approval_request` sont ajoutés à `assert_reversible`, ce qui
   change la signature du prompt T018.
   - `SUPERVISOR_DEVICE` exige une ligne `approval_token_use` qui remplit toutes ces conditions :
     - jeton `p_jti` du prestataire ;
     - `operation_id = 'reversePayment'` ;
     - `caller_id` nul, appelant = ce terminal et cette session ;
     - `target_id = p_tx` ;
     - consommée dans cette transaction (`used_at >= now()`) ;
     - valideur : personne `ACTIVE` du prestataire, avec `SUPERVISOR` non retiré sur l'événement de la vente ou sur son
       organisateur.
   - `BACKOFFICE` exige une demande `SALE_REVERSAL` qui remplit toutes ces conditions :
     - `APPROVED`, du prestataire ;
     - `target_id = p_tx` et `payload.transaction_id = p_tx` ;
     - auteur ≠ valideur ;
     - auteur et valideur : personnes `ACTIVE`, avec `SUPERVISOR` ou `ORGANIZER_ADMIN` non retiré sur
       l'événement ou sur l'organisateur.
2. **Renforcement** : nouvelle colonne `approval_token_use.target_id` (uuid nul, sans clé étrangère). Elle porte le
   « lié à la vente » de l'arbitrage, que la table de 0005 ne pouvait pas exprimer. **WP12** doit la remplir
   (`target_id` = vente) à l'insertion du jeton terminal, et consommer le jeton **avant**
   d'appeler `assert_reversible`.
3. **Renforcement** : annulation seulement si l'événement de la vente est `LIVE` ou `CLOSING` (SPECIFICATION §12.1),
   sinon `CL001`. Le contrôle vaut pour tous les modes. Une vente sans événement est refusée de la même façon.
4. **Renforcement** : en mode `VENDOR`, le vendeur doit aussi être `ACTIVE` et non bloqué, relu `FOR SHARE`. C'est une défense en profondeur
   en plus d'`assert_vendor_session`, refus en `CL036`. La session est relue avec `expires_at > clock_timestamp()`.
5. **Renforcement** : verrou consultatif `media-tap-use:` pris tôt, avant toute lecture, dans `assert_tap_payable`. La
   lecture est donc sérialisée avec `consume_tap` et `consume_tap_for_claim` jusqu'à la fin de la transaction.
6. **Renforcement** : `REVOKE ALL ON FUNCTION consume_tap(bigint, uuid) FROM PUBLIC` reposé dans la migration ; 0024 et 0026 ne
   l'avaient pas fait. `consume_tap` : corps de 0026 à l'identique, plus le contrôle A18. Ce contrôle est placé
   avant le rejeu : `tx.device_id` non nul et `IS DISTINCT FROM media_tap.device_id` → `CL022`, donc une lecture sans terminal est
   refusée pour une écriture de terminal. Une écriture sans terminal garde le comportement d'avant (testé).
7. **Renforcement**, `record_sale_attribution` :
   - avec une session, une personne n'est admise que pour une `REVERSAL` dont elle est le
     valideur (`approved_by`) : c'est le cas du `SUPERVISOR` au terminal ;
   - une vente dont l'annulation n'a pas d'attribution exige un canal ;
   - `channel` est `NOT NULL` dans la table.
8. **Renforcement** : `sale_attribution` porte une clé composite `(vendor_session_id, device_id, operator_id)` vers
   `vendor_session (id, device_id, operator_id)`, et `actor_user_id` référence `app_user`. Aucun déclencheur
   `SECURITY DEFINER`.
9. Arbitrages appliqués tels quels : `CL038` (bracelet bloqué), `CL039` (portefeuille bloqué), `CL040` (ADR-123),
   contrainte `UNIQUE (id, device_id, operator_id)` sur `vendor_session`, liste des actions de 0011 + `SALE_REVERSAL`.
10. Sans effet de sécurité : `assert_tap_payable` rend `CL022` (et non `P0002`) pour une lecture inconnue ou d'un autre
    prestataire, comme le prompt le demande.

## Décisions sur les deux points à trancher

- SQLSTATE de `MEDIA_BLOCKED` et `WALLET_BLOCKED` : `CL038` et `CL039`, selon l'arbitrage. Leur traduction est à faire par WP08.
- Preuve d'approbation dans `assert_reversible` : retenue et codée, voir les écarts 1 et 2.

## Points soumis à l'orchestrateur ou au porteur (aucun affaiblissement codé)

- **À tenir par WP07 (droits)** : `roles.sql` accorde `INSERT, UPDATE ON ALL TABLES` à `cashless_app`. La nouvelle
  table `sale_attribution` hérite donc d'un INSERT direct, qui contournerait `record_sale_attribution`. WP07 doit
  retirer `INSERT` et `UPDATE` sur `sale_attribution` à `cashless_app` et accorder les cinq fonctions. Sans ce retrait,
  l'attribution A11 n'est garantie que par l'API.
- Limite connue, de même nature que 0017 : la base n'authentifie personne. Une session `cashless_app` compromise peut
  insérer elle-même une ligne `approval_token_use` (INSERT gardé pour l'API) au nom d'un vrai `SUPERVISOR` de
  l'événement. La preuve `SUPERVISOR_DEVICE` exige alors l'insertion dans la même transaction, la vente exacte, un
  valideur réel avec le bon rôle et l'usage unique (clé primaire `jti`). Ce n'est pas un affaiblissement par rapport
  au plan, mais la limite reste à consigner.
- WP12 :
  - remplir `target_id` à l'insertion du jeton terminal ;
  - consommer le jeton avant `assert_reversible` ;
  - le valideur doit être `approved_by` de la `REVERSAL` pour `record_sale_attribution(..., p_actor_user)` ;
  - le valideur d'une demande `SALE_REVERSAL` doit lui aussi détenir `SUPERVISOR` ou `ORGANIZER_ADMIN` sur
    l'événement, sinon la base refuse (`CL036`) ;
  - le WP12 parle encore de `403 REVERSAL_NOT_ALLOWED` : ADR-123 dit `422` (déjà reporté).
- Contradiction signalée (§0.3) : le prompt T018 cite une signature à quatre paramètres, alors que l'arbitrage exige une
  preuve en base. J'ai appliqué l'arbitrage (deux paramètres optionnels en fin de liste) : les appels à quatre
  paramètres restent valides pour le mode `VENDOR`.
- Concurrence (NFR-005, deux connexions) : impossible en pgTAP seul, laissée aux tests Jest de WP11, WP12 et WP14. En
  base, l'unicité vient de l'index `journal_transaction_reverses_once`, testé.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0033_payments.sql` : droits (fonctions `SECURITY DEFINER`), preuve d'approbation,
  `consume_tap` remplacée (à comparer ligne à ligne avec 0026 : seul le bloc « 0033 (A18) » est ajouté).

## Critères couverts et leurs preuves

Base `cashless_wp04` (Docker 127.0.0.1:5433), supprimée à la fin.

- `pg_prove -d cashless_wp04 tests/tests_payments.sql` : **105/105 PASS**.
- `reset-db.sh` puis `bash scripts/test-pgtap.sh` (PGDATABASE=cashless_wp04) : **36 fichiers, 2521 tests, PASS**.
  Ce lot comprend `tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`, `tests_consume_tap_claim.sql`,
  `tests_media_claim_tap.sql`, `tests_approvals.sql`, `tests_execute_grants.sql`,
  `tests_definer_search_path.sql` et `tests_definer_trigger_writers.sql`. Aucun scénario du kit n'annule deux fois
  une vente.
- `reset-db` puis `npx jest --runInBand test/integration/approval test/integration/media
  test/integration/transverse/migrate-rights.spec.ts` : **20 suites, 283 tests, PASS**. Cette batterie couvre la
  non-régression des dépôts, des cautions dues, de l'approbation sur place et des lectures.
- Ni la suite Jest complète, ni lint, ni typecheck n'ont été rejoués : aucun fichier TypeScript n'a été modifié.

Les cas de `tests_payments.sql` qui prouvent chaque critère :

| Critère | Preuve |
|---|---|
| FR-006 | « FR-006 : vente attribuée au vendeur de la session (v001) et au terminal de la session » |
| FR-006 | refus `CL032` : session close, expirée, d'un autre terminal, d'un autre prestataire |
| FR-010 (base) | section 2 : `assert_tap_payable` (autre terminal, consommée, demande, hors fenêtre, SUSPENDED/BLACKLISTED → CL038, témoin) |
| FR-010 (base) | section 3 : `assert_wallet_payable` (BLOCKED, CLOSED → CL039 ; autre prestataire → P0002) |
| FR-010 (base) | section 4 : `consume_tap` (A18 et non-régression) |
| FR-016 | section 6, mode `VENDOR` : autre vendeur, autre terminal, session close ou d'un autre terminal → CL036 |
| FR-016 | « ADR-123 : bon vendeur, bon terminal, hors fenêtre (recorded_at) : CL040 » |
| FR-016 | « ADR-123 : autre vendeur hors fenêtre : CL036, jamais CL040 » ; témoin qui rend grand livre, événement, portefeuille, bracelet |
| FR-017 (base) | mode `SUPERVISOR_DEVICE` : autre vendeur et hors fenêtre acceptés ; terminal d'un autre événement refusé |
| FR-017 (base) | mode `SUPERVISOR_DEVICE` : jeton d'une autre vente, ancien, sans rôle, d'un autre événement, inconnu, d'un autre terminal → CL036 |
| FR-017 (base) | mode `BACKOFFICE` : demande approuvée acceptée ; en attente, autre vente, valideur sans rôle → CL036 ; avec terminal → CL001 |
| FR-017 (base) | section 7 : appelant terminal (un appelant exactement, clé composite, `distinct_people` intacte, usage unique), `SALE_REVERSAL` accepté, action inconnue refusée |
| NFR-005 (unicité par la base) | « NFR-005 : seconde annulation d'une vente refusée par journal_transaction_reverses_once » (23505 et nom de la contrainte) |
| NFR-005 (unicité par la base) | « index unique partiel journal_transaction_reverses_once » (`pg_indexes`) |
| NFR-005 (unicité par la base) | CL035 dans les trois modes |
| NFR-006 (refus sans écriture) | « NFR-006 : refus sans écriture » (aucune attribution après sept refus) |
| NFR-006 (refus sans écriture) | « A18 : la lecture refusée ne porte aucune écriture » |
| Convention | « cinq fonctions de 0033 : SECURITY DEFINER, search_path = public, pg_temp, aucun droit PUBLIC » |
| Convention | « assert_reversible : VOLATILE » ; « aucun déclencheur SECURITY DEFINER » ; liste des actions = 0011 + SALE_REVERSAL (25, aucune autre) |
