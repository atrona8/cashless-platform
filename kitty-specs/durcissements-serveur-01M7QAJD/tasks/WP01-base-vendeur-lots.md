---
work_package_id: WP01
title: Base de données — clé vendeur-session et lots de bracelets par fonctions
dependencies: []
requirement_refs: [FR-001, FR-002, FR-003, FR-008, C-004]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-durcissements-serveur-01M7QAJD
base_commit: 3c32cc18d0eee3fc4206b64628b37af697d5f105
created_at: '2026-11-18T15:11:28.793094+00:00'
subtasks: [T001, T002, T003, T004]
phase: Phase 1 - Base
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/
create_intent:
- packages/ledger-sql/migrations/0090_sale_attribution_vendor_key.sql
- packages/ledger-sql/migrations/0091_media_batch_functions.sql
- packages/ledger-sql/tests/tests_vendor_session_key.sql
- packages/ledger-sql/tests/tests_media_batch_functions.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0090_sale_attribution_vendor_key.sql
- packages/ledger-sql/migrations/0091_media_batch_functions.sql
- packages/ledger-sql/tests/tests_vendor_session_key.sql
- packages/ledger-sql/tests/tests_media_batch_functions.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 : Base de données, clé vendeur-session et lots de bracelets par fonctions

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` de la mission (table « Base de données » : noms, codes `CL056`) ; `plan.md` IC-01 et IC-02 ; `spec.md`
  FR-001 à FR-003, FR-008, C-004 ;
- `research/R-N60-lots-bracelets.md` : §1 (droits actuels), §3 (fonctions existantes), §5.2 et §5.4, §5.6 ;
  `research/R-N76-N79-pin-vendeurs.md` §3 (OP-N79, conception de la migration) ;
- `packages/ledger-sql/migrations/0031_vendors.sql` l. 84-101 (`vendor_session`) ; `0033_payments.sql` l. 62-86
  (`sale_attribution`, `sale_attribution_session_fk`) ;
- `packages/ledger-sql/migrations/0013_media_api.sql` l. 70-110 (les trois fonctions à passer `DEFINER`) ;
  `0010_media_claims.sql` l. 129-153 (`issue_claim_codes`) ; `0019_*` l. 100-110 (modèle de `SET search_path`) ;
- `packages/ledger-sql/schema_grand_livre_cashless.sql` l. 232-259 (colonnes et `CHECK` de `media_batch`), l. 1160-1171
  (`check_batch_key`), l. 1557-1580 (`check_batch_transition`, `log_batch_status`) : lecture seule ;
- `apps/api/src/media/batches/batches.service.ts` l. 40-60 et 93-165 (appelants actuels, ce que WP05 branchera) ;
  `apps/api/src/media/batches/batches.dto.ts` l. 100-120 (`BATCH_UPDATE_KEYS`) ;
- `packages/ledger-sql/tests/tests_media_api.sql` et `tests_payment_rights.sql` l. 100-140 (modèles de fixtures pgTAP).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi sauf sur le point
signalé dans « Context » (paramètres `kind` et `key_mode`).

## Objective

Poser en base ce que seule la couche API garantissait : (1) une attribution de vente ne peut plus désigner un vendeur
qui n'est pas celui de la session (OP-N79) ; (2) toute écriture d'un lot de bracelets et du statut d'un bracelet passe
par une fonction `SECURITY DEFINER` étroite (OP-N60, partie base). Ce lot **n'accorde ni ne retire aucun droit** :
WP03 (seul propriétaire de `post-roles.sql`) retire ensuite `INSERT`/`UPDATE` de `cashless_app`. Les fonctions sont
prouvées **en propriétaire** ; `cashless_app` ne les exécute pas encore (sauf celles qu'il exécute déjà).

## Context

- Dernière migration existante : `0089`. Les tiennes : `0090` (clé) et `0091` (fonctions). Aucune migration ni `.sql`
  généré ne se retouche (C-004) ; aucun fichier du dépôt hors `owned_files`.
- OP-N79 et OP-N60 sont des **renforcements** : on fait puis on consigne (WP14). Aucune décision du porteur à attendre.
- **Contradiction à signaler (interfaces.md)** : la signature de `create_media_batch` y omet `kind` et `key_mode`, qui
  sont des colonnes `NOT NULL` insérées par `batches.service.ts:95`. Sans elles la fonction ne peut pas créer de lot.
  Utilise l'ordre de R-N60 §5.2 :
  `create_media_batch(p_organizer uuid, p_event uuid, p_kind text, p_quantity int, p_key_index int, p_print_order_ref
  text, p_preload_promo_amount bigint, p_deposit_amount bigint, p_deposit_mode text, p_key_mode text, p_reuse_policy
  text, p_actor uuid) RETURNS uuid`.
  Dis-le dans ta note de lane : l'orchestrateur corrige `interfaces.md` (WP05 appelle cette signature).
- Fonctions possédées : `create_media_batch`, `update_media_batch` ; modifiées (même signature) :
  `set_media_batch_status`, `media_set_status`, `issue_claim_codes`. Contraintes possédées :
  `vendor_session_id_vendor_key`, `sale_attribution_session_vendor_fk`. Code d'erreur nouveau : `CL056`.
- Le propriétaire des fonctions est superutilisateur en local : la RLS est **ignorée** dans une fonction `DEFINER`.
  Chaque lecture ou écriture doit donc nommer le prestataire de session explicitement (règle de 0019).
- Fiche commune : toute fonction nouvelle `REVOKE ALL … FROM PUBLIC` (dans la migration),
  `SET search_path = public, pg_temp`, prestataire de session vérifié. Aucun `GRANT` ici.

## Subtasks

### T001 : migration `0090_sale_attribution_vendor_key.sql`

But : la base refuse `sale_attribution (vendor_session_id = S, vendor_id = V)` quand `S` appartient à un autre vendeur.
1. Un bloc `DO $$ … $$` compte les lignes incohérentes
   (`SELECT count(*) FROM sale_attribution a JOIN vendor_session s ON s.id = a.vendor_session_id WHERE a.vendor_id IS
   DISTINCT FROM s.vendor_id`)
   et lève une exception nommée (`RAISE EXCEPTION '0090 : % attributions incohérentes' USING ERRCODE = 'CL001'`) si le
   compte est non nul.
2. `ALTER TABLE vendor_session ADD CONSTRAINT vendor_session_id_vendor_key UNIQUE (id, vendor_id);`
3. `ALTER TABLE sale_attribution ADD CONSTRAINT sale_attribution_session_vendor_fk FOREIGN KEY (vendor_session_id,
   vendor_id) REFERENCES vendor_session (id, vendor_id);`
   (sans `ON DELETE`).
- **Ne remplace pas** `sale_attribution_session_fk` (0033) : `approval_token_use` imite sa cible (R-N76-N79 §3).
- Les attributions de back-office ont `vendor_id` et `vendor_session_id` nuls (`CHECK` « tout ou rien ») : la clé
  composite à `MATCH SIMPLE` ne les contrôle pas ; ne touche pas à ce `CHECK`.
- Aucun `GRANT`, aucun `REVOKE`. Commentaire d'en-tête : OP-N79, mission 11a, WP01.
- Validation : `pg_prove … tests/tests_vendor_session_key.sql` (T004).

### T002 : migration `0091`, `create_media_batch` et `update_media_batch`

Début de `0091_media_batch_functions.sql` ; plan.md IC-02, R-N60 §5.2 points 1 et 2.
- **`create_media_batch`** (signature dans « Context ») : `SECURITY DEFINER SET search_path = public, pg_temp`.
  Prestataire = `media_session_operator()` (jamais un paramètre). **Aucun paramètre de statut** : le défaut `ORDERED` de
  la table s'applique, un lot `ACTIVE` ou `CLOSED` est inexprimable. Contrôles explicites, même message
  `'Objet introuvable'` (`no_data_found`) que partout : `p_organizer` est une `party` de type ORGANIZER dont
  `operator_id` est le prestataire de session ; si `p_event` n'est pas nul, l'`event` appartient au prestataire **et** à
  cet organisateur. Vérifie le nom exact du type de `party` dans le schéma avant de l'écrire. `check_batch_key` et les
  `CHECK` de la table font le reste : leurs SQLSTATE (`23514`, `CL020`…) doivent sortir **inchangés** (`batchRefusal` de
  l'API les traduit). Renvoie l'`id`.
- **Auteur de l'historique de création** (décision d'ingénierie, plan « auteur posé ») :
  `PERFORM media_set_actor( p_actor, 'Création du lot')` avant l'`INSERT`, pour que la ligne `→ORDERED` de
  `media_batch_status_history` porte l'auteur (aujourd'hui `actor_id` nul : `tests_media_reinstate.sql` l. ~206 attend
  `->ORDERED:-`, c'est WP03 qui ajuste ce test). Vérifie que `media_set_actor` accepte un acteur nul sans lever ; sinon
  pose seulement `app.user_id`. C'est un renforcement d'audit : consigne-le dans la note de lane.
- **`update_media_batch(p_batch uuid, p_changes jsonb, p_actor uuid) RETURNS void`** : `DEFINER`, mêmes règles. Liste
  blanche exacte : `quantity`, `print_order_ref`, `preload_promo_amount`, `deposit_amount`, `deposit_mode`,
  `reuse_policy`. Toute autre clé (statut, `key_index`, `organizer_id`, `event_id`, `kind`, `key_mode`, `operator_id`,
  `claim_codes_issued_at`…) : `RAISE EXCEPTION … USING ERRCODE = 'CL056'`. Un jsonb vide ou non objet : `CL056`.
  Sémantique : clé présente avec `null` JSON = `NULL` en base (`deposit_mode`, `print_order_ref`) ; clé absente =
  colonne inchangée. Verrou : `SELECT … FROM media_batch WHERE id = p_batch AND operator_id = v_operator FOR UPDATE` ;
  introuvable : `no_data_found`. Refus hors `ORDERED` : `CL020`. Refus de `quantity` si
  `claim_codes_issued_at IS NOT NULL` (règle aujourd'hui dans `batches.service.ts` l. 129-139 : la ramener en base),
  `CL020`. `media_set_actor` puis un seul `UPDATE` ; les `CHECK` et déclencheurs de la table restent juges des valeurs.
- Piège : `jsonb_populate_record`/`->>` perdent la différence « absent » et « null » : teste `p_changes ? 'clé'`.
- Validation : `tests_media_batch_functions.sql` (T004).

### T003 : `0091`, passage en `DEFINER` des fonctions existantes

Même fichier `0091`. Les corps ne changent pas, sauf pour `media_set_status`.
- `ALTER FUNCTION set_media_batch_status(uuid, text, text, uuid) SECURITY DEFINER SET search_path = public, pg_temp;`
  idem `issue_claim_codes(uuid, bytea[])`. Leurs corps filtrent déjà par `media_session_operator()` et
  `claim_session_operator()` ; relis-les pour confirmer qu'**aucune lecture** n'y dépend de la RLS (propriétaire
  superutilisateur : la RLS est ignorée). Note-le dans la note de lane.
- `media_set_status(uuid, text, text, uuid)` : `CREATE OR REPLACE` (même signature, même retour) avec
  `SECURITY DEFINER SET search_path = public, pg_temp`, corps de `0013` + **limite** : `p_to` ∈ {`SUSPENDED`,
  `BLACKLISTED`}, sinon `RAISE EXCEPTION … USING ERRCODE = 'CL020'` **avant** tout verrou. Garde le motif obligatoire
  (`CL001`), l'opérateur de session et `media_set_actor`. `blacklist_media` et `suspend_media` restent `INVOKER` SQL,
  sans changement.
- Dans la même migration, `REVOKE ALL ON FUNCTION create_media_batch(...), update_media_batch(...) FROM PUBLIC` (types
  complets). Pour les trois fonctions passées `DEFINER`, ne modifie aucun droit existant (WP03 les reprend).
- Piège : `media_owner_session()` (0017) vaut vrai si `current_setting('role') = 'none'` **et** `session_user` est
  membre du propriétaire. Sous `SET ROLE cashless_app` ou connexion `cashless_app` il est faux, donc
  `BLACKLISTED→ACTIVE` reste refusé hors `reinstate_media` ; **en propriétaire il serait permis** : le test
  correspondant se fait sous `SET LOCAL ROLE cashless_app` (R-N60 §5.4).
- Mutation (NFR-004) : retire la limite de `p_to` ; le test « `media_set_status(…, 'RETIRED', …)` refusé `CL020` » doit
  échouer. Remets-la, note les deux résultats.

### T004 : pgTAP `tests_vendor_session_key.sql` et `tests_media_batch_functions.sql`

Modèle : `tests_media_api.sql`, `tests_payment_rights.sql` (`BEGIN`, plan libre `no_plan`, fixtures en propriétaire,
`ROLLBACK`). Écris à la main (ne touche aucun fichier généré).
- **Clé vendeur-session** : (a) contrôle positif : `INSERT` d'attribution `(session de A, vendeur A)` passe ; (b)
  `(session de A, vendeur B)` : `throws_ok … '23503'` avec le nom `sale_attribution_session_vendor_fk` dans le message ;
  (c) attribution de back-office (vendeur et session nuls, `actor_user_id` posé) passe ; (d) `record_sale_attribution`
  et `record_sale_attribution_at` toujours verts (appelle-les sur une fixture) ; (e) existence des deux contraintes
  (`pg_constraint`), qui échoue si elles disparaissent. Mutation :
  `ALTER TABLE … DROP CONSTRAINT sale_attribution_session_vendor_fk` dans une transaction de test, (b) doit alors
  échouer ; note le résultat.
- **Lots** : `create_media_batch` rend un lot `ORDERED` quels que soient les arguments ; organisateur d'un autre
  prestataire et événement d'un autre organisateur : `no_data_found` ; clé inconnue ou inactive : SQLSTATE de
  `check_batch_key` inchangé ; `deposit_amount` > 0 sans mode : `23514`. `update_media_batch` : chaque clé permise
  change la colonne ; `{"status":"CLOSED"}`, `{"key_index":1}`, `{"organizer_id":…}`, `{"event_id":…}`,
  `{"operator_id":…}` : `CL056` ; lot hors `ORDERED` : `CL020` ; `quantity` après `claim_codes_issued_at` : `CL020` ;
  lot d'un autre prestataire : `no_data_found` ; `null` JSON efface `deposit_mode` ; clé absente ne touche pas.
- **Statuts** : `set_media_batch_status(…,'CLOSED',…)` : `CL020` ; `SUSPENDED` sans motif : `CL001` ;
  `issue_claim_codes` toujours fonctionnel et `prosecdef` vrai pour les cinq fonctions avec `proconfig` contenant
  `search_path=public, pg_temp` ; `media_set_status` : `RETIRED`, `ACTIVE`, `DESTROYED` refusés `CL020`, `SUSPENDED` et
  `BLACKLISTED` passent, motif vide `CL001`, et (sous `SET LOCAL ROLE cashless_app`) `BLACKLISTED→ACTIVE` refusé
  `CL020`.
- **Historique** : la ligne `→ORDERED` créée par `create_media_batch` porte `actor_id = p_actor`.
- Commande : voir « Tests et preuves » ci-dessous.

## Tests et preuves

Base `cashless_wp01` (jamais `cashless_test`), serveur 5433, depuis la lane (`cd <lane> || exit 1`) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp01
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp01 tests/tests_vendor_session_key.sql tests/tests_media_batch_functions.sql
pg_prove -d cashless_wp01 tests/tests_media_api.sql tests/tests_vendors.sql tests/tests_payments.sql \
  tests/tests_offline_device_vendor.sql tests/tests_media_claims.sql
```

`tests_media_api.sql` compte les fonctions `INVOKER` : il échoue tant que WP03 ne l'a pas mis à jour (8 devient 6) ;
ne le touche pas, signale-le. Les suites de droits figées échouent sur les nouvelles fonctions : normal (fiche).

## Branch Strategy

- Planification et fusion : `feat/durcissements-serveur`. Worktree de lane calculé par `lanes.json`.
- Commande :
  `LC_ALL=C LANG=C spec-kitty agent action implement WP01 --agent claude --mission durcissements-serveur-01M7QAJD`.

## Definition of Done

- [ ] `0090` : contrôle `DO`, `UNIQUE (id, vendor_id)`, clé étrangère composite ; ancienne clé conservée.
- [ ] `0091` : `create_media_batch` (sans paramètre de statut, auteur historisé), `update_media_batch` (liste blanche,
      `CL056`), trois fonctions en `DEFINER` à `search_path` fixé, `media_set_status` limité ; `REVOKE … FROM PUBLIC`.
- [ ] Aucun `GRANT`/`REVOKE` hors `FROM PUBLIC` ; aucun fichier hors `owned_files` ; migrations antérieures intactes.
- [ ] Les deux suites pgTAP vertes sur `cashless_wp01`, avec contrôles positifs et mutations notées.
- [ ] Note de lane : signature réelle de `create_media_batch` (écart à `interfaces.md`), choix de l'auteur d'historique,
      relecture des corps `DEFINER` sans dépendance à la RLS, mutations et résultats.

## Risks

- Fonction `DEFINER` sous propriétaire superutilisateur : un prestataire oublié dans un `WHERE` fuit entre locataires.
- `create_media_batch` mal alignée sur `media_batch` : WP05 casse en `42883`/`23502`. Compte les colonnes de l'`INSERT`
  d'origine (douze) et compare.
- `ALTER FUNCTION` sur une fonction `INVOKER` qui contient un `FOR UPDATE` : devient valide sous le propriétaire ; ce
  n'est pas un risque, mais vérifie qu'aucun appelant n'attendait une erreur de droit.

## Ce que le relecteur doit casser

- Appeler `create_media_batch` avec un organisateur ou un événement d'un autre prestataire (session A, objets B), avec
  `p_kind` hors liste, avec `p_quantity` nul ; chercher un chemin vers un lot non `ORDERED`.
- `update_media_batch` : clé hors liste blanche (`status`, `claim_codes_issued_at`), objet jsonb imbriqué, jsonb `null`,
  tableau ; lot clos ; changement de `quantity` après les codes.
- `media_set_status` vers `RETIRED`/`DESTROYED`/`ACTIVE`, motif d'espaces, bracelet d'un autre prestataire.
- Attribution de vente `(session A, vendeur B)` par `INSERT` direct en propriétaire : doit lever `23503`.
- Un test qui ne prouve rien : fixture qui insère déjà un état final, `lives_ok` sans contrôle de la valeur écrite,
  mutation non rejouée. Un `search_path` absent ou sans `pg_temp` sur une des cinq fonctions.
- Un droit accordé ou retiré dans ces migrations (interdit : WP03), ou une migration existante retouchée.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0091_media_batch_functions.sql` (fonctions `SECURITY DEFINER`, isolation des
  prestataires) ; `0090_sale_attribution_vendor_key.sql` (sans risque cryptographique).
