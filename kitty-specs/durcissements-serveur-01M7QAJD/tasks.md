# Work Packages: Durcissements serveur hérités

**Mission**: `durcissements-serveur-01M7QAJD` · **Branche**: `feat/durcissements-serveur` (planification et fusion)
**Sources**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md),
[interfaces.md](interfaces.md) (fait foi sur les noms), fiche commune `docs/passation-11a/fiche-implementation.md`.

Toutes les commandes `spec-kitty` se lancent avec `LC_ALL=C LANG=C`. Implémentation :
`spec-kitty agent action implement WPxx --agent claude --mission durcissements-serveur-01M7QAJD`.

## Subtask Index

| ID | Description | WP | Parallel |
|---|---|---|---|
| T001 | Migration `0090` : contrôle de cohérence, `UNIQUE (id, vendor_id)`, clé étrangère composite | WP01 | [P] |
| T002 | Migration `0091` : `create_media_batch`, `update_media_batch` | WP01 | |
| T003 | Migration `0091` : `set_media_batch_status`, `media_set_status`, `issue_claim_codes` en `DEFINER` ; `media_set_status` limité | WP01 | |
| T004 | pgTAP des objets de `0090` et `0091` en propriétaire (attribution incohérente 23503, fonctions de lot) | WP01 | |
| T005 | Migration `0092` : déclencheur `BEFORE INSERT` de `refund_request`, retrait de `refund_deposit_for_session(uuid, uuid)` | WP02 | [P] |
| T006 | Migration `0093` : `CHECK` IBAN chiffré `NOT VALID` sur `refund_request` et `payout` | WP02 | [P] |
| T007 | Migration `0094` : `register_edge_gateway` rend `(gateway_id, ledger_id)` | WP02 | [P] |
| T008 | Migration `0095` : `device_app_attest_key`, nouvelle `enroll_device`, `advance_app_attest_counter` | WP02 | [P] |
| T009 | pgTAP des objets de `0092` à `0095` en propriétaire ; références pgTAP de l'ancienne signature mises à jour | WP02 | |
| T010 | Rôle `cashless_pin` (`roles.sql`, `migrate.ts`, `env.sh`, workflows, `test/support/db.ts`) | WP03 | |
| T011 | `post-roles.sql` section 13 : retraits (`media_batch`, `media.status`, `refund_request`, `EXECUTE` du PIN) | WP03 | |
| T012 | `post-roles.sql` section 13 : `EXECUTE` ajoutés, `cashless_pin`, `refund_deposit(uuid, uuid)` à personne | WP03 | |
| T013 | Listes figées et suites de droits : `tests_execute_grants`, `tests_definer_trigger_writers`, `tests_media_roles`, `tests_media_api`, `tests_media_reinstate`, `tests_payment_rights`, `tests_device_rights`, `tests_edge_rights` | WP03 | |
| T014 | pgTAP `tests_11a_rights.sql` : chaque écriture directe des fiches refusée depuis `cashless_app` (42501), mutation | WP03 | |
| T015 | Réglages `VENDOR_PIN_*`, `DATABASE_URL_PIN`, `IBAN_KEYRING`, `IBAN_ACTIVE_KID`, dérivé d'idempotence du PIN | WP04 | |
| T016 | Gardes de production (secret absent, clé d'appel absente, anneau absent ou invalide) | WP04 | |
| T017 | `config.spec.ts` : chaque garde et chaque valeur par défaut | WP04 | |
| T018 | `batches.service.ts` : création et modification par les fonctions ; `FOR UPDATE` retiré | WP05 | |
| T019 | Historique de création du lot avec auteur ; mappage `CL056` | WP05 | |
| T020 | `blacklist.spec.ts` réécrit ; parcours de lot inchangés (création, modification, statut, clôture, codes) | WP05 | |
| T021 | `tools/demo-data/seed-demo.ts` vérifié sous le rôle réel | WP05 | |
| T022 | `main.vendor-pin.ts`, module du processus (pool `cashless_pin`, `DenyUnmarkedRoutesGuard`, garde de production) | WP06 | |
| T023 | Route interne d'ouverture : vérification HMAC, essai, argon2, ouverture, audits | WP06 | |
| T024 | Route interne de hachage (création et changement de PIN) | WP06 | |
| T025 | Tests du processus : signature absente ou fausse, horodatage hors fenêtre, PIN juste et faux, démarrage refusé sans secret | WP06 | |
| T026 | `architecture.spec.ts` : seul `vendor-pin` lit `VENDOR_PIN_SECRET` ; `processes.spec.ts` | WP06 | |
| T027 | `VendorPinClient` (signature, délai, refus sans repli) | WP07 | |
| T028 | `vendor-sessions.service.ts` et `vendors.controller.ts` passent par le client ; hacheur scindé | WP07 | |
| T029 | `vendor-sessions.spec.ts` réécrit (parcours inchangés, processus arrêté : refus) | WP07 | |
| T030 | Suite de latence NFR-001 (`SKIP_LATENCY`) | WP07 | |
| T031 | `redact.ts` : champ `iban` et IBAN par forme de valeur, espaces compris | WP08 | [P] |
| T032 | `iban-vault.ts` : chiffrement, ouverture, `kid`, données associées | WP08 | |
| T033 | Unitaires du masque et du coffre (aller-retour, autre prestataire refusé, altération refusée, rotation) | WP08 | |
| T034 | Demande de remboursement du back-office : IBAN chiffré, audit masqué | WP09 | |
| T035 | Réclamation tardive : `destination.iban` chiffré, `iban_mask` | WP09 | |
| T036 | `approval.mapper.ts` : `maskPaymentData` rend `iban_mask` | WP09 | |
| T037 | `limits-9b.spec.ts` inversé (insertion en `PAID` ou `CANCELLED` refusée) ; `payment-data-exposure.spec.ts`, `late-claim.spec.ts`, `create-backoffice.spec.ts` étendus | WP09 | |
| T038 | `payout-action.ts` : IBAN chiffré dans le payload et `payout.iban`, revalidation à l'exécution | WP10 | |
| T039 | Export CSV : ouverture de l'IBAN, erreur nommée sans valeur si illisible ; mesure NFR-002 | WP10 | |
| T040 | Crochet `guardDecision` (approuver et refuser) ; mauvais rôle `403` sans toucher la demande | WP10 | |
| T041 | Audit `PAYOUT_CONFIRM_REPLAYED` ; test d'auto-approbation exact `409 APPROVAL_INVALID` | WP10 | |
| T042 | Tests `payout-batch.spec.ts`, `payout-confirm.spec.ts`, `payout-export.spec.ts` | WP10 | |
| T043 | `fees.ts` : plafond aux frais bruts, `feeTotal` factorisé | WP11 | |
| T044 | Unitaires `brut` accepté, `brut + 1` refusé ; `closing-variants.spec.ts` vert | WP11 | |
| T045 | Mutation du plafond consignée | WP11 | |
| T046 | `tools/edge-admin` : `db.ts` lit `TABLE(gateway_id, ledger_id)` ; `commands.ts` refuse `--ledger` | WP12 | |
| T047 | Fichier d'enrôlement écrit avec le grand livre rendu ; `register.spec.ts` et faux `test/support.ts` | WP12 | |
| T048 | `docs/procedure-site-passerelle.md` §2 | WP12 | |
| T049 | `ios-app-attest.ts` rend la clé attestée et le keyId ; enrôlement les passe à `enroll_device` | WP13 | |
| T050 | `IosAppAttestAssertionVerifier` (CBOR, nonce, signature, `rpIdHash`, compteur) | WP13 | |
| T051 | Aide de test `appAssertion` ; unitaires (valide, autre clé, autre requête, compteur égal) | WP13 | |
| T052 | Intégration : concurrence du compteur, autre prestataire, appareil révoqué ; test d'architecture propre | WP13 | |
| T053 | `POINTS_OUVERTS.md` : 8 levées, OP-N64 « côté serveur prêt », limites résiduelles (clé de l'IBAN, PIN en transit, compteur) | WP14 | |
| T054 | `DECISIONS_ADR.md` : ADR de levée et de renforcement, décisions du porteur du 18/11/2026 | WP14 | |
| T055 | `PROMPTS-A-ENVOYER.md` et `PRD.md` : reports (mission 12 : assertions App Attest ; 12b : vrai KMS pour l'IBAN) | WP14 | |
| T056 | Matrice d'acceptation : chaque FR, NFR et SC avec sa preuve ; liste des fichiers à faire relire par une personne | WP14 | |

## Phase 1 — Base

### WP01 — Base : clé vendeur-session et lots de bracelets par fonctions

- **Prompt** : [tasks/WP01-base-vendeur-lots.md](tasks/WP01-base-vendeur-lots.md)
- **Objectif** : OP-N79 et la partie base d'OP-N60, sans toucher aux droits.
- **Sous-tâches** : T001, T002, T003, T004.
- **Test indépendant** : pgTAP de `0090` et `0091` en propriétaire.
- **Dépendances** : aucune. **Risque** : fonctions `DEFINER` sous un propriétaire superutilisateur (prestataire de
  session explicite).

### WP02 — Base : remboursements, IBAN, passerelles, App Attest

- **Prompt** : [tasks/WP02-base-remboursements-passerelles-app-attest.md](tasks/WP02-base-remboursements-passerelles-app-attest.md)
- **Objectif** : migrations `0092` à `0095`.
- **Sous-tâches** : T005, T006, T007, T008, T009.
- **Dépendances** : aucune. **Risque** : `DROP` puis `CREATE` de `register_edge_gateway` et `enroll_device` (appelants
  et droits repris par WP03).

### WP03 — Droits de la base et rôle `cashless_pin`

- **Prompt** : [tasks/WP03-droits-base.md](tasks/WP03-droits-base.md)
- **Objectif** : seul lot qui écrit `roles.sql` et `post-roles.sql` ; listes figées.
- **Sous-tâches** : T010, T011, T012, T013, T014.
- **Dépendances** : WP01, WP02, WP04. **Risque** : un droit rouvert pour faire passer un test (interdit).

### WP04 — Configuration et gardes de production

- **Prompt** : [tasks/WP04-configuration.md](tasks/WP04-configuration.md)
- **Sous-tâches** : T015, T016, T017.
- **Dépendances** : aucune.

## Phase 2 — API et processus

### WP05 — Lots de bracelets côté API (OP-N60)

- **Prompt** : [tasks/WP05-lots-bracelets-api.md](tasks/WP05-lots-bracelets-api.md)
- **Sous-tâches** : T018, T019, T020, T021. **Dépendances** : WP03.

### WP06 — Processus `vendor-pin` (OP-N76)

- **Prompt** : [tasks/WP06-processus-vendor-pin.md](tasks/WP06-processus-vendor-pin.md)
- **Sous-tâches** : T022, T023, T024, T025, T026. **Dépendances** : WP03, WP04.

### WP07 — Session de vendeur par le processus (OP-N76)

- **Prompt** : [tasks/WP07-session-vendeur-client.md](tasks/WP07-session-vendeur-client.md)
- **Sous-tâches** : T027, T028, T029, T030. **Dépendances** : WP06.

### WP08 — Coffre et masque d'IBAN (OP-N140)

- **Prompt** : [tasks/WP08-coffre-masque-iban.md](tasks/WP08-coffre-masque-iban.md)
- **Sous-tâches** : T031, T032, T033. **Dépendances** : WP04.

### WP09 — Remboursements et réclamations tardives (OP-N140, OP-N145)

- **Prompt** : [tasks/WP09-remboursements-iban.md](tasks/WP09-remboursements-iban.md)
- **Sous-tâches** : T034, T035, T036, T037. **Dépendances** : WP02, WP03, WP08.

### WP10 — Versements : IBAN chiffré et décisions gardées (OP-N140, OP-N137)

- **Prompt** : [tasks/WP10-versements-iban-decisions.md](tasks/WP10-versements-iban-decisions.md)
- **Sous-tâches** : T038, T039, T040, T041, T042. **Dépendances** : WP03, WP08.

### WP11 — Plafond de la régularisation des frais (OP-N141)

- **Prompt** : [tasks/WP11-plafond-regularisation.md](tasks/WP11-plafond-regularisation.md)
- **Sous-tâches** : T043, T044, T045. **Dépendances** : aucune.

### WP12 — Inscription des passerelles (OP-N116)

- **Prompt** : [tasks/WP12-inscription-passerelles.md](tasks/WP12-inscription-passerelles.md)
- **Sous-tâches** : T046, T047, T048. **Dépendances** : WP03.

### WP13 — App Attest côté API (OP-N64)

- **Prompt** : [tasks/WP13-app-attest.md](tasks/WP13-app-attest.md)
- **Sous-tâches** : T049, T050, T051, T052. **Dépendances** : WP03.

## Phase 3 — Preuves

### WP14 — Preuves, consignation et documentation

- **Prompt** : [tasks/WP14-preuves-consignation.md](tasks/WP14-preuves-consignation.md)
- **Sous-tâches** : T053, T054, T055, T056. **Dépendances** : WP01 à WP13.

## Parallélisme

Phase 1 : WP01, WP02, WP04, WP11 en parallèle ; WP03 après WP01, WP02 et WP04. Phase 2 : WP05, WP06, WP08, WP12, WP13 en
parallèle après WP03 (et WP04) ; WP07 après WP06 ; WP09 et WP10 après WP08. WP14 en dernier.

## Reference rows

T001 Migration 0090 (WP01)
T002 create_media_batch, update_media_batch (WP01)
T003 Fonctions de lot et de bracelet en DEFINER (WP01)
T004 pgTAP de 0090 et 0091 (WP01)
T005 Garde d'insertion de refund_request (WP02)
T006 CHECK IBAN chiffré (WP02)
T007 register_edge_gateway rend le grand livre (WP02)
T008 device_app_attest_key et fonctions (WP02)
T009 pgTAP de 0092 à 0095 (WP02)
T010 Rôle cashless_pin (WP03)
T011 Retraits de droits (WP03)
T012 EXECUTE ajoutés (WP03)
T013 Listes figées et suites de droits (WP03)
T014 tests_11a_rights.sql (WP03)
T015 Réglages nouveaux (WP04)
T016 Gardes de production (WP04)
T017 config.spec.ts (WP04)
T018 batches.service.ts par fonctions (WP05)
T019 Historique et CL056 (WP05)
T020 blacklist.spec.ts et parcours de lot (WP05)
T021 seed-demo vérifié (WP05)
T022 Processus vendor-pin (WP06)
T023 Route interne d'ouverture (WP06)
T024 Route interne de hachage (WP06)
T025 Tests du processus (WP06)
T026 Tests d'architecture et de processus (WP06)
T027 VendorPinClient (WP07)
T028 Route et hacheur scindé (WP07)
T029 vendor-sessions.spec.ts (WP07)
T030 Latence NFR-001 (WP07)
T031 redact.ts (WP08)
T032 iban-vault.ts (WP08)
T033 Unitaires masque et coffre (WP08)
T034 Remboursement back-office chiffré (WP09)
T035 Réclamation tardive chiffrée (WP09)
T036 approval.mapper.ts iban_mask (WP09)
T037 Tests remboursements et exposition (WP09)
T038 payout-action.ts chiffré (WP10)
T039 Export CSV et NFR-002 (WP10)
T040 guardDecision (WP10)
T041 Rejeu audité et code exact (WP10)
T042 Tests versements (WP10)
T043 Plafond dans fees.ts (WP11)
T044 Unitaires du plafond (WP11)
T045 Mutation du plafond (WP11)
T046 edge-admin db.ts et commands.ts (WP12)
T047 Fichier d'enrôlement et tests (WP12)
T048 Procédure de site (WP12)
T049 Clé attestée gardée à l'enrôlement (WP13)
T050 Vérificateur d'assertions (WP13)
T051 Aide de test et unitaires (WP13)
T052 Intégration App Attest (WP13)
T053 POINTS_OUVERTS (WP14)
T054 DECISIONS_ADR (WP14)
T055 PROMPTS et PRD (WP14)
T056 Matrice et relecture humaine (WP14)
