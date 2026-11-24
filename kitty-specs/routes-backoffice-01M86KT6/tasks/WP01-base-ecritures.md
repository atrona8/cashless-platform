---
work_package_id: WP01
title: "Base : classement des anomalies, modèles de téléphone, modèle du terminal"
dependencies: []
requirement_refs:
- FR-009
- FR-010
- FR-015
- FR-016
- FR-017
- NFR-001
- NFR-003
- NFR-005
- C-002
- C-005
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003, T004, T005]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0101_anomaly_classification_phone_models.sql
create_intent:
- packages/ledger-sql/migrations/0101_anomaly_classification_phone_models.sql
- packages/ledger-sql/tests/tests_backoffice_writes.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0101_anomaly_classification_phone_models.sql
- packages/ledger-sql/tests/tests_backoffice_writes.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 : Base : classement des anomalies, modèles de téléphone, modèle du terminal

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md` (démarrage, règles, base de données,
fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement :

- `kitty-specs/routes-backoffice-01M86KT6/interfaces.md` §2 « WP01 » (signatures **exactes**, codes CL066 à CL069) ;
- `research.md` D1, D4, D9 ; `data-model.md` (invariants du classement) ;
- `packages/ledger-sql/roles.sql` l. 26-50 (droits de `cashless_app`, dont l. 39 `UPDATE (status, resolution_tx_id) ON
  anomaly`, et `REVOKE UPDATE ON device` l. 31-33) ; comment `roles.sql` est rejoué par `reset-db.sh` / `migrate()` ;
- fonctions à imiter : `packages/ledger-sql/migrations/0038_psp_topups.sql` l. 848 et 1187 (clôture d'anomalie par
  fonction), `0047_offline_anomalies.sql` l. 166-209, `0082_replace_media_cash_due.sql` (UPDATE anomaly dans une fonction
  DEFINER) ; `0022_device_enrollment.sql` (`record_device_heartbeat`), `0095_device_app_attest_key.sql` (dernière version
  d'`enroll_device`) ; `apps/api/src/devices/enrollment/enrollment.service.ts` l. 170-190 ;
- `packages/ledger-sql/tests/tests_execute_grants.sql` et `_grants_for_tests.sql` (liste des fonctions et de leurs
  EXECUTE : à tenir juste sans les modifier hors carte, voir plus bas) ; un pgTAP existant de fonction DEFINER comme modèle.

## Objective

Poser dans la base, en une migration `0101` et un fichier pgTAP, les règles d'écriture de la mission : classement d'une
anomalie par une fonction qui tient la liste des 10 types (D1), droit direct de clore une anomalie retiré (D4,
renforcement), table de plateforme des modèles de téléphone (D9), modèle déclaré par le terminal sans droit de colonne
nouveau, index de la limite de débit. **Aucune écriture au grand livre.** Aucun `.sql` généré, aucune migration existante
modifiée, aucun `GRANT` nouveau à `cashless_app` hormis `SELECT` sur `phone_model` et `EXECUTE` des fonctions listées
dans `interfaces.md` (déjà décidés).

## Subtasks

### T001 — Colonnes de classement, `anomaly_classifiable`, `classify_anomaly`

1. `ALTER TABLE anomaly` : trois colonnes et `CHECK` de `interfaces.md` §2 (tout nul ou tout non nul ; motif 1 à 500 ;
   `classified_by` non nul ⇒ `RESOLVED`, `resolution_tx_id IS NULL`, `kind` parmi les 10 types de D1). Écris la liste des
   10 types **une seule fois** dans `anomaly_classifiable(p_kind)` (`IMMUTABLE`) et fais-la utiliser par le `CHECK`.
2. `classify_anomaly(p_anomaly, p_reason, p_actor)` : `SECURITY DEFINER SET search_path = public` (jamais `pg_temp`), sous
   la RLS de l'appelant ; `SELECT … FOR UPDATE` ; codes dans l'ordre : CL069 (motif vide ou > 500 après `btrim`), CL066
   (introuvable ou autre prestataire), CL067 (type non classable), CL068 (statut ≠ `OPEN`). Écris `status = 'RESOLVED'`,
   les trois colonnes, **jamais** `resolution_tx_id`, aucune ligne `journal_transaction`/`posting`.
3. `REVOKE EXECUTE … FROM PUBLIC` ; `GRANT EXECUTE` à `cashless_app` seulement.
4. Validation : pgTAP (T005). **Mutations** : retirer le test de type (CL067) ; retirer `FOR UPDATE` (le test de deux
   sessions doit échouer) ; retirer la contrainte `CHECK` sur `kind` (un `UPDATE` direct par le propriétaire d'un type
   non classable avec `classified_by` doit être refusé).

### T002 — Droit direct de clore une anomalie : preuve d'usage puis retrait (D4)

1. **D'abord la preuve.** Dans la lane : `grep -rnE "UPDATE +(public\.)?anomaly" apps/api/src` et
   `grep -rn "anomaly" apps/api/src | grep -i "status\|resolution_tx_id"`. Liste dans la note de lane **chaque
   chemin qui clôt une anomalie aujourd'hui** : `waive_seq_gap` (schéma de référence), fonctions PSP de `0038` (l. 848,
   1187), `0047` (hors ligne), et toute fonction DEFINER trouvée par `grep -n "UPDATE anomaly" packages/ledger-sql/migrations/*.sql`.
   Conclus : usage direct par `cashless_app` (hors fonction) oui ou non.
2. Si **non** : `REVOKE UPDATE (status, resolution_tx_id) ON anomaly FROM cashless_app` dans `0101`. Vérifie que les
   fonctions DEFINER ci-dessus restent valides (elles s'exécutent sous leur propriétaire) en relançant leurs pgTAP, et que
   `roles.sql` ne **ré-accorde** pas le droit après la migration (si `roles.sql` est rejoué après les migrations,
   le retrait doit tenir : vérifie par `has_column_privilege` après `reset-db.sh`).
3. Si **oui** : déclencheur `anomaly_resolve_guard` qui refuse `OPEN → RESOLVED` sans `resolution_tx_id` et sans
   `classified_by` hors des fonctions habilitées (identifie-les par le contexte, comme `anomaly_cash_due_guard`). Signale
   dans la note que le retrait complet reste à faire.
4. C'est un **renforcement** : à consigner dans la note (WP11 en fera l'ADR). Ne rouvre aucun droit.
5. **Mutation** : remettre le `GRANT` (ou retirer le déclencheur) : le test `has_column_privilege(...) = false` /
   `UPDATE` direct refusé doit échouer.

### T003 — Table `phone_model`, normalisation, fonctions d'écriture

1. `normalize_phone_model(text)` `IMMUTABLE` : `lower(btrim(...))`, espaces internes réduits ; `NULL` reste `NULL`.
2. Table et `CHECK` de `interfaces.md` §2 (clé `(manufacturer, model)`, 1 à 100 caractères, `nfc_level` fermé). Pas de RLS
   par prestataire (donnée de plateforme, sans donnée personnelle). `GRANT SELECT` à `cashless_app` seulement.
3. `upsert_phone_model` / `delete_phone_model` : normalisent leur entrée, écrivent `updated_by/updated_at`,
   `delete` renvoie `false` si absent. `EXECUTE` au **rôle de plateforme seul** (relis dans `roles.sql` le nom exact du
   rôle de plateforme utilisé par `PlatformTx` ; **pas** `cashless_app`). `REVOKE … FROM PUBLIC`.
4. **Mutations** : donner `EXECUTE` à `cashless_app` (le test « refusé » doit échouer) ; retirer la normalisation (le test
   `Samsung ` / `samsung` doit échouer).

### T004 — `device.manufacturer` / `model` : chemin d'écriture sans droit nouveau

1. `ALTER TABLE device ADD COLUMN manufacturer text, ADD COLUMN model text` + `CHECK` (1 à 100 caractères quand
   non nuls, déjà normalisés par `normalize_phone_model`).
2. **Constate le chemin existant** (preuve dans la note) : l'enrôlement passe par la fonction `enroll_device` (dernière
   version dans `0095`, appelée à `enrollment.service.ts` l. 179) et le signal de vie par `record_device_heartbeat`
   (`0022`) ; `cashless_app` n'a **pas** `UPDATE` large sur `device` (`roles.sql` l. 31-33, liste de colonnes seulement).
   Donc : nouvelles versions de ces fonctions **dans `0101`** avec un paramètre `p_manufacturer text DEFAULT NULL, p_model
   text DEFAULT NULL` (ou signature voisine : vérifie que l'ancienne signature est supprimée ou conservée sans ambiguïté
   de surcharge, et que `tests_execute_grants.sql` reste vert). Corps repris **à l'identique** de la dernière version,
   plus l'écriture des deux colonnes si fournies (une valeur absente n'efface pas la valeur connue).
3. Si, contrairement à ce constat, un chemin passe par un droit de colonne : **n'élargis pas** ce droit ; crée
   `set_device_model(p_device, p_manufacturer, p_model)` `SECURITY DEFINER`, `EXECUTE` à `cashless_app`, et signale-le.
4. Aucun `GRANT UPDATE` sur `manufacturer`/`model`. **Mutation** : accorder `UPDATE (model)` à `cashless_app` : le test
   `has_column_privilege('cashless_app','device','model','UPDATE') = false` doit échouer.
5. Signale à WP09 (note de lane) la signature finale des deux fonctions, car WP09 les appelle depuis l'API.

### T005 — Index de débit et pgTAP `tests_backoffice_writes.sql`

1. `CREATE INDEX IF NOT EXISTS … ON audit_log (actor_id, action, occurred_at)` (vérifie d'abord `\d audit_log` : colonnes
   réelles ; adapte les noms et note-le). `EXPLAIN` de la requête « 20 dernières 60 s » dans la note.
2. pgTAP, un bloc par fonction : classement nominal (3 colonnes, grand livre inchangé : compte les
   `journal_transaction` **de l'événement du test**), CL066 à CL069, double classement (CL068), type non classable pour
   chacun des 13 autres types (boucle sur la liste fermée), isolement entre prestataires (CL066), droits (`EXECUTE`,
   `has_column_privilege`), modèles (normalisation, upsert idempotent, delete, EXECUTE refusé à `cashless_app`),
   colonnes `device`, enrôlement et signal de vie avec et sans modèle.
3. `pg_prove -d cashless_wp01 tests/tests_backoffice_writes.sql` et `tests/tests_execute_grants.sql` verts ; relance
   les pgTAP des fonctions PSP et hors ligne touchées par T002.

## Retouches hors carte permises

Aucune par défaut. Si `tests_execute_grants.sql` énumère explicitement les fonctions et échoue sur les nouvelles :
**ne le modifie pas** (fichier généré ou partagé) ; signale-le dans la note, l'orchestrateur tranche.

## Definition of Done

- [ ] Signatures et codes identiques à `interfaces.md` §2 ; migration idempotente sur base vierge (`reset-db.sh`).
- [ ] Preuve du grep (T002) et du chemin d'écriture du terminal (T004) dans la note de lane.
- [ ] pgTAP vert ; mutations de T001 à T004 notées avec leur résultat.
- [ ] Aucun `GRANT` nouveau hors `SELECT phone_model` et `EXECUTE` listés ; aucun fichier hors carte modifié.
- [ ] Renforcement D4 signalé ; fichier à faire relire par une personne : `0101` (droits, `SECURITY DEFINER`).

## Ce que le relecteur doit casser

- Classer un type hors des 10 (`PSP_TOPUP_NOT_CREDITED`, `CASH_TOPUP_OVER_LIMIT`) par SQL direct ou par la fonction.
- `UPDATE anomaly SET status='RESOLVED'` par `cashless_app` hors fonction (doit être refusé) ; clôture PSP encore valable.
- Deux sessions classant la même anomalie : une seule gagne, l'autre CL068.
- `search_path` contenant `pg_temp`, `EXECUTE` resté à `PUBLIC`, `upsert_phone_model` appelable par `cashless_app`.
- Un droit de colonne sur `device.model`, ou un enrôlement qui efface le modèle connu par `NULL`.
- Une ligne `journal_transaction` créée par `classify_anomaly` ; un test qui compte toute la base.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP01 --agent claude --mission routes-backoffice-01M86KT6`
