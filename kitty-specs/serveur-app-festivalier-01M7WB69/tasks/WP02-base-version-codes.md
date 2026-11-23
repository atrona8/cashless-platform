---
work_package_id: WP02
title: Base de données — version du secret des codes, réémission, numéro imprimé
dependencies: []
requirement_refs:
- FR-007
- FR-008
- FR-009
- NFR-002
- C-007
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-serveur-app-festivalier-01M7WB69
base_commit: e352d8c0234508620260c83c9b0ba2750eb53a9a
created_at: '2026-11-20T14:47:22.224085+00:00'
subtasks: [T006, T007, T008, T009, T010]
phase: Phase 1 - Base de données
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/
create_intent:
- packages/ledger-sql/migrations/0097_claim_code_key_version.sql
- packages/ledger-sql/tests/tests_claim_key_version.sql
execution_mode: code_change
model: sonnet
owned_files:
- packages/ledger-sql/migrations/0097_claim_code_key_version.sql
- packages/ledger-sql/tests/tests_claim_key_version.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 : Base de données, version du secret des codes (OP-N47)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` de la mission (lignes « Colonnes de version », « Fonctions versionnées »,
  `claim_key_version_max`, `reissue_claim_codes`, `media.printed_number`, codes `CL064` et `CL065`)
  ; `contracts/claim-code-rotation.md` et `contracts/printer-file-printed-number.md` ; `plan.md`
  IC-03, IC-04, IC-05 ; `spec.md` FR-007 à FR-009, NFR-002 ;
- `packages/ledger-sql/migrations/0010_media_claims.sql` : l. 19-27 (colonnes de `media`, index
  unique `media_claim_code_hash_key`), l. 34-66 (`claim_code`, `media_claim`), l. 129-153
  (`issue_claim_codes`), l. 156-177 (`associate_claim_code`, version d'origine), l. 206-262
  (`claim_media`), l. 267-307 (`confirm_media_claim`), l. 318-362 (`public_balance_lookup`) ;
- `0019_personalization_definer.sql` l. 34-78 (`register_personalized_media`, dernière version) et
  l. 81-103 (`associate_claim_code`, **dernière version**, `DEFINER`) ;
  `0091_media_batch_functions.sql` l. 88-92 (`issue_claim_codes` passée `DEFINER`) ;
  `0058_edge_gateway_admin.sql` l. 125-130 (écriture d'audit depuis une fonction `DEFINER`) ;
- `packages/ledger-sql/tests/tests_media_claims.sql` (fixtures de codes, helpers `pg_temp.h`,
  `pg_temp.m`, `pg_temp.q`, `pg_temp.k`) et `tests_media_batch_functions.sql` l. 1-50 (en-tête
  pgTAP).

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi ; contradiction ou manque : tu
la signales dans ta note, tu ne la tranches pas en silence (plusieurs cas ci-dessous).

## Objective

Chaque empreinte d'un code de rattachement porte la **version du secret** qui l'a calculée ; une
empreinte d'une autre version compte comme **absente** partout (même réponse qu'un code inconnu).
Ajouter la réémission contrôlée après rotation (`reissue_claim_codes`, rôle d'exploitation, WP04) et
`media.printed_number`. Ce lot **n'accorde ni ne retire aucun droit** ; il prouve ses fonctions en
propriétaire.

## Context

- Dernière migration existante : `0095` ; WP01 prend `0096`, WP03 `0098` et `0099`. La tienne :
  `0097`. Aucune migration existante, aucun `.sql` généré ne se retouche.
- **Décisions du porteur (20/11/2026)** : rotation immédiate, pas de double empreinte ; version sur
  chaque empreinte ; réémission par commande d'exploitation sous `cashless_claimadmin`, jamais
  `cashless_app` ; `printed_number` en troisième colonne facultative du fichier de l'imprimeur.
- **Cinq** fonctions changent de signature : `issue_claim_codes`, `associate_claim_code`,
  `claim_media`, `confirm_media_claim`, `public_balance_lookup`. `register_personalized_media` est
  **inchangée** (elle n'écrit aucune empreinte, 0019 l. 72-75) : ne la touche pas. L'ancienne
  signature est **retirée** (`DROP FUNCTION`, puis `CREATE`). Modes conservés : `issue_claim_codes`,
  `associate_claim_code`, `public_balance_lookup` en `SECURITY DEFINER SET search_path = public,
  pg_temp` ; `claim_media` et `confirm_media_claim` restent `SECURITY INVOKER`
  (`tests_media_claims.sql` l. 87-89 compte quatre fonctions INVOKER).
- **Décisions de l'orchestrateur (`interfaces.md`, 20/11)** : `associate_claim_code(p_hash, p_media,
  p_printed_number text, p_key_version smallint)` **sans** défaut (NULL permis) ;
  `claim_key_version_max()` est `DEFINER` ; nouvelle `reissuable_media` (T008) ; l'ancienne ligne
  `claim_code` est libérée à la réémission et à l'association ; `media.claim_key_version smallint
  NOT NULL DEFAULT 1` **sans** `CHECK` de cohérence ; **tu commites** la mise à jour des lignes de
  `post-roles.sql` qui nomment les signatures retirées (retouche hors carte, déclarée dans ta note).

## Subtasks

### T006 : colonnes de version

- `ALTER TABLE media ADD COLUMN claim_key_version smallint NOT NULL DEFAULT 1 CHECK
  (claim_key_version >= 1)` (existant : 1 ; **pas** de `CHECK` liant la colonne à `claim_code_hash`
  : les fixtures qui posent l'empreinte restent valides).
- `ALTER TABLE claim_code ADD COLUMN key_version smallint NOT NULL DEFAULT 1 CHECK (key_version >=
  1)` ; idem `media_claim` (version du secret de `confirmation_hash`).

### T007 : cinq fonctions versionnées, anciennes signatures retirées

Ajoute `p_key_version smallint` en **dernier** paramètre ; nul ou `< 1` : `CL001`. Repars du corps
de la **dernière** version de chacune (0010, sauf `associate_claim_code` : 0019) :
- `issue_claim_codes(p_batch, p_hashes, p_key_version)` : insère `claim_code.key_version =
  p_key_version`. Une seconde commande reste refusée comme aujourd'hui : `claim_codes_issued_at IS
  NOT NULL` lève `CL020 CLAIM_CODES_ALREADY_ISSUED` (0010 l. 141) : **ne touche pas** à ce refus (la
  réémission est la seule voie après rotation).
- `claim_media(..., p_key_version)` : la recherche du bracelet ajoute `AND m.claim_key_version =
  p_key_version` ; la demande créée porte `key_version = p_key_version`. Code d'ancienne version :
  `REFUSED`, comme un inconnu (et `claim_attempts` compté comme pour un inconnu : rien de plus).
- `confirm_media_claim(..., p_key_version)` : lit la demande avec `AND key_version = p_key_version`
  ; absente : `REFUSED` (retour texte, jamais d'exception, sans changer d'état).
- `public_balance_lookup(p_hash, p_address_ref, p_key_version)` : `AND m.claim_key_version =
  p_key_version` dans la sélection du bracelet ; reste `REFUSED` sans distinction.
- `associate_claim_code` : voir T009 (elle porte aussi le numéro imprimé).
- Après `DROP`, `CREATE` : refais `REVOKE ALL ON FUNCTION <nouvelle signature> FROM PUBLIC` pour les
  cinq. **Aucun `GRANT`.** Les `GRANT` de `post-roles.sql` : voir « Tests ».

### T008 : `claim_key_version_max` et `reissue_claim_codes`

- `claim_key_version_max() RETURNS smallint`, `STABLE SECURITY DEFINER SET search_path = public,
  pg_temp` : plus haute version présente dans `media.claim_key_version`, `claim_code.key_version`,
  `media_claim.key_version` ; `0` si aucune ligne ne porte de version (`coalesce`).
- `reissue_claim_codes(p_operator uuid, p_batch uuid, p_media uuid[], p_hashes bytea[],
  p_key_version smallint) RETURNS int`, `DEFINER`, **sans** `app.operator_id` (le rôle n'a pas de
  session de prestataire) : tout filtre porte `p_operator`. Ordre :
  1. paramètres : tout nul, tableaux vides ou de tailles différentes, doublons, empreinte qui n'a
     pas 32 octets : `CL001` ;
  2. lot : `SELECT kind FROM media_batch WHERE id = p_batch AND operator_id = p_operator FOR UPDATE`
     ; absent : `no_data_found` ; `kind <> 'PUBLIC'` : `CL020`. **Lot clos admis.**
  3. bracelets : `SELECT ... FROM media WHERE id = ANY(p_media) ORDER BY id FOR UPDATE` ; chacun
     doit être de `p_operator` et de `p_batch`, et soit sans code (`claim_code_hash IS NULL`), soit
     au code d'une version `< p_key_version` **jamais utilisé** (`claim_code_used_at IS NULL`) ; un
     seul qui ne l'est pas (ou un compte différent) : `CL064`, **rien d'écrit** (tout ou rien) ;
  4. ancien rattachement : `UPDATE claim_code SET media_id = NULL, associated_at = NULL,
     invalidated_at = clock_timestamp() WHERE media_id = ANY(p_media)` (les `CHECK`
     `claim_code_association` et `claim_code_invalidated`, 0010 l. 43-44, l'imposent dans cet ordre
     de colonnes ; sans cela l'index unique `claim_code_media_key` refuse le nouveau rattachement :
     décision de l'orchestrateur) ; puis les `claim_code` du lot non associés, d'ancienne version,
     passent `invalidated_at` (sans écraser une date déjà posée) ;
  5. `INSERT INTO claim_code (operator_id, batch_id, code_hash, key_version, media_id,
     associated_at)` une ligne par bracelet (`unnest ... WITH ORDINALITY`), puis `UPDATE media SET
     claim_code_hash, claim_key_version = p_key_version` ; `claim_codes_issued_at` **inchangé** ;
  6. audit : `INSERT INTO audit_log (operator_id, actor_id, actor_role, action, object_type,
     object_id, after, origin)` avec `action = 'CLAIM_CODES_REISSUED'`, `actor_role =
     session_user::text`, `origin = 'claim-admin'`, `after = {count, key_version}` (modèle 0058 l.
     125-130) ; **jamais** une empreinte ni un code ;
  7. renvoie le nombre de bracelets réémis.
- `reissuable_media(p_operator uuid, p_batch uuid, p_key_version smallint) RETURNS TABLE (media_id
  uuid, rank int)`, `STABLE SECURITY DEFINER SET search_path = public, pg_temp` : lot absent
  `no_data_found`, non `PUBLIC` `CL020` ; renvoie les bracelets du lot qui satisfont **exactement**
  le point 3 ci-dessus (même prédicat : partage-le dans le SQL pour qu'ils ne divergent pas),
  ordonnés par `rank` (1, 2, ... dans l'ordre stable de `media.id`). Seule voie de lecture de
  `cashless_claimadmin` (WP08).
- `REVOKE ALL ... FROM PUBLIC` sur les trois fonctions. WP04 accorde `EXECUTE`.

### T009 : `media.printed_number` et `associate_claim_code` étendue

- `ALTER TABLE media ADD COLUMN printed_number text CONSTRAINT media_printed_number CHECK
  (printed_number ~ '^[A-Z0-9-]{1,32}$')` ; `CREATE UNIQUE INDEX media_printed_number_key ON media
  (operator_id, printed_number) WHERE printed_number IS NOT NULL`.
- `associate_claim_code(p_hash, p_media, p_printed_number, p_key_version)` : mêmes contrôles que
  0019 l. 81-103, avec : code recherché `AND key_version = p_key_version` (un code d'une autre
  version est `CLAIM_CODE_UNKNOWN`) ; le bracelet peut porter un code d'**une autre version** si ce
  code n'a pas servi : l'ancienne association est libérée comme en T008 point 4 ; bracelet au code
  de la version courante, ou dont le code a servi (`claim_code_used_at` non nul) :
  `MEDIA_ALREADY_HAS_CODE` (le texte d'`interfaces.md` ne dit rien du code déjà utilisé : refus
  retenu, à signaler). Pose `claim_code_hash` **et** `claim_key_version`.
- Numéro : `upper(p_printed_number)` ; nul : colonne intacte. Déjà pris par un autre bracelet du
  prestataire : `CL065` (contrôle explicite, plus un bloc `EXCEPTION WHEN unique_violation` autour
  de l'`UPDATE` pour la course) ; bracelet qui porte **déjà un autre numéro** : `CL065` aussi (choix
  à signaler) ; même numéro : sans effet. Format invalide : la `CHECK` lève `23514` (l'API valide
  avant, WP07).

### T010 : pgTAP `tests_claim_key_version.sql`

Modèle : `tests_media_claims.sql` (fixtures), `tests_media_batch_functions.sql` (en-tête). Deux
prestataires, un lot `PUBLIC`, un lot `STAFF`, un lot clos, bracelets `ACTIVE` avec portefeuille.
Simule la rotation avec les versions 1 et 2. Cas, **tous avec contrôle positif** :
- colonnes : défaut 1 sur les trois ; `claim_key_version_max()` vaut la version la plus haute
  insérée (compare à un calcul direct, jamais à une constante dépendant de la base) ;
- **ancienne version absente**, une assertion par fonction : `claim_media` (code v1, appel v2 :
  `REFUSED`, aucun `media_claim`, aucun rattachement), `confirm_media_claim` (demande v1, appel v2 :
  `REFUSED`, demande inchangée), `public_balance_lookup` (`REFUSED`), `associate_claim_code`
  (`CLAIM_CODE_UNKNOWN`) ; et le même appel en v1 réussit (le test n'est pas vide) ;
- `issue_claim_codes` pose `key_version` ; une seconde commande : `CL020 CLAIM_CODES_ALREADY_ISSUED`
  ;
- **réémission** : bracelet sans code, bracelet au code v1 non utilisé (nouveau code v2 posé,
  ancienne ligne libérée et invalidée, `claim_codes_issued_at` inchangé), lot **clos** admis,
  `claim_code` non associés d'ancienne version invalidés ; bracelet au code utilisé : `CL064` ;
  bracelet déjà en v2 : `CL064` ; bracelet d'un autre lot ou d'un autre prestataire : `CL064` ; un
  seul bracelet inéligible dans la liste : `CL064` et **aucun** autre changé ; lot `STAFF` : `CL020`
  ; lot inconnu ou d'un autre prestataire : `no_data_found` ; l'audit porte le nombre, et **aucun
  octet des empreintes** (`after::text` ne contient pas leur hexadécimal) ; le code v1 d'un bracelet
  réémis est refusé partout ;
- **numéro imprimé** : posé par `associate_claim_code` ; doublon dans le prestataire : `CL065` ;
  même numéro chez l'autre prestataire : accepté ; deux colonnes seulement (`NULL`) : colonne
  intacte ;
- **`reissuable_media`** : même prédicat que la réémission (jamais un bracelet qu'elle refuserait),
  rangs consécutifs, lot non `PUBLIC` `CL020`, lot inconnu `no_data_found`.
- **forme** : les cinq nouvelles signatures existent, les cinq anciennes **non**,
  `register_personalized_media` inchangée (`to_regprocedure`), `prosecdef` et `search_path=public,
  pg_temp` pour les `DEFINER`, `PUBLIC` sans `EXECUTE`.

## Tests et preuves

Base `cashless_wp02`, serveur 5433, depuis la lane. `post-roles.sql` accorde `EXECUTE` sur les
anciennes signatures (l. 186, 310-311, 427, 437, 439) et `migrate.ts` l'applique dans la même
transaction que les migrations : **corrige et commite** ces lignes (signatures versionnées des cinq
fonctions, rien d'autre, aucun droit ajouté ni retiré) ; c'est la retouche hors carte déclarée dans
ta note. WP04 ne les réécrit pas.

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp02
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh && cd packages/ledger-sql
pg_prove -d cashless_wp02 tests/tests_claim_key_version.sql tests/tests_media_claims.sql \
  tests/tests_personalization_definer.sql tests/tests_media_api.sql tests/tests_media_roles.sql \
  tests/tests_definer_trigger_writers.sql tests/tests_media_batch_functions.sql \
  tests/tests_definer_search_path.sql
```

**Retouches hors carte permises, listées dans la note de lane** : les suites pgTAP existantes qui
**appellent** les cinq fonctions passent à la nouvelle signature (version `1` partout, `NULL` pour
le numéro) : `tests/tests_media_claims.sql` (l. 104-124, 170-199, 209-225, 242-256 ; signatures l.
93, 206), `tests_personalization_definer.sql` (l. 59, 140-169, listes de signatures l. 195-199),
`tests_media_api.sql` (l. 38, 78-86), `tests_media_roles.sql` (l. 98-100, 148),
`tests_definer_trigger_writers.sql` (l. 94), `tests_media_batch_functions.sql` (l. 190-191). Aucun
`.sql` **généré** n'appelle ces fonctions (vérifié par `grep` : `tests_grand_livre_cashless.sql` et
`scenario_reference_test.sql` n'en contiennent aucune) ; si tu en trouves un, il faut modifier son
générateur (`gen_tests.py`, `gen_golden.py`), **jamais le `.sql`** : signale-le. Ne touche **pas**
`tests_execute_grants.sql` ni `tests_11a_rights.sql` (WP04). Les Jest qui appellent les fonctions
(`media-isolation.spec.ts`, `claim-code-order.spec.ts`, `personalization.spec.ts`) échouent jusqu'à
WP07 : liste-les.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`. Worktree de lane calculé par
  `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP02 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Definition of Done

- [ ] `0097` : trois colonnes de version, `printed_number` et son index, cinq fonctions versionnées
      (anciennes retirées), `claim_key_version_max`, `reissuable_media`, `reissue_claim_codes` ;
      `REVOKE ... FROM PUBLIC` sur chaque nouvelle fonction ; aucun `GRANT`.
- [ ] `tests_claim_key_version.sql` vert ; suites retouchées vertes ; aucun `.sql` généré modifié.
- [ ] **Mutations vérifiées**, rejouées puis rétablies, résultat noté : (a) retirer le filtre de
      version de `claim_media` ; (b) idem `confirm_media_claim` ; (c) idem `public_balance_lookup` ;
      (d) retirer `claim_code_used_at IS NULL` de la réémission ; (e) retirer la libération de
      l'ancienne ligne `claim_code` ; (f) retirer le contrôle explicite de `CL065` : le test
      correspondant échoue à chaque fois (identifiant du test noté).
- [ ] `post-roles.sql` : seules les lignes de signatures corrigées, commitées. Note de lane :
      signatures réelles, retouches hors carte, mutations.

## Risks

- Un appelant oublié de l'une des cinq fonctions casse en `42883` : relis le résultat du `grep`.

## Ce que le relecteur doit casser

- Pour chacune des cinq fonctions : un code d'ancienne version réussit-il quelque part
  (rattachement, confirmation, consultation anonyme, association, import) ? Une ancienne signature
  subsiste-t-elle ?
- Réémission : code utilisé, lot d'un autre prestataire, doublons dans `p_media`, tailles
  différentes, même version deux fois, lot `STAFF`, atomicité ; empreinte ou code dans `audit_log` ;
  `claim_codes_issued_at` changé. Numéro imprimé : minuscules, 33 caractères, doublon, course.
- Un droit accordé dans `0097` ou dans `post-roles.sql`, un `.sql` généré modifié, `search_path`
  sans `pg_temp`, test qui ne lit pas la valeur écrite, mutation notée mais jamais rejouée.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0097_claim_code_key_version.sql` : fonctions `SECURITY DEFINER`
  (isolation des prestataires, empreintes de codes, `reissue_claim_codes` hors session de
  prestataire).
