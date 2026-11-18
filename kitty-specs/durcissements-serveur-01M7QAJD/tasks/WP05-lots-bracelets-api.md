---
work_package_id: WP05
title: Lots de bracelets côté API (OP-N60)
dependencies: [WP03]
requirement_refs: [FR-004, SC-002]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/durcissements-serveur. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
subtasks: [T018, T019, T020, T021]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/batches/batches.service.ts
create_intent: []
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/media/batches/batches.service.ts
- apps/api/src/errors/sqlstate-map.ts
- apps/api/test/integration/media/blacklist.spec.ts
- apps/api/test/integration/media/batches.spec.ts
- tools/demo-data/seed-demo.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 : Lots de bracelets côté API (OP-N60)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- les notes de lane de WP01 et WP03, la migration `0091` **telle que fusionnée** (signatures réelles : elles font
  foi sur ce prompt et sur `interfaces.md`) et la section 13 de `post-roles.sql` ;
- `research/R-N60-lots-bracelets.md` §2 (chemins d'écriture, verrous de ligne), §3 (fonctions), §4 points 1 à 5
  (tests à inverser), §5.3 (changements d'API interne), §5.6 (risques) ;
- `apps/api/src/media/batches/batches.service.ts` en entier (l. 36-215 : `row`, `create`, `update`, `setStatus` ;
  `closure`, `preload`, `assertShape` plus bas) et `batches.controller.ts:283-291` (`writable()`, qui appelle
  `row(..., true)`) ; `batches.dto.ts:108-115` (`BATCH_UPDATE_KEYS`) ; `claim-codes.service.ts:72` ;
- `apps/api/src/errors/sqlstate-map.ts` (fin du tableau : `CL055`, puis `P0002`, `42501`) et son test
  `apps/api/test/unit/errors/sqlstate-map.spec.ts` ;
- `apps/api/test/integration/media/blacklist.spec.ts` l. 200-470 (cas `SET LOCAL ROLE cashless_app`) et
  `batches.spec.ts` (parcours création, modification, statut, clôture, codes) ; `tools/demo-data/seed-demo.ts:280-300`.

Priorité des sources (SPECIFICATION §0.3). Contradiction ou manque : tu le signales, tu ne tranches pas en silence.

## Objective

Faire passer toute écriture de lot de bracelets de l'API par les fonctions de la base (`create_media_batch`,
`update_media_batch`, `set_media_batch_status`, `issue_claim_codes`, `close_batch`, `preload_batch`) maintenant que
`cashless_app` n'a plus `INSERT` ni `UPDATE` sur `media_batch` (WP03), sans qu'aucune réponse de route ne change
(FR-004, SC-002). Réécrire les tests qui posaient un statut en direct sous `cashless_app` : le refus est désormais
`42501`, et la preuve que la limite ne revient pas est un test qui échoue si le droit réapparaît.

## Context

- **Point ouvert levé** : OP-N60 (ADR-97). Aucune décision du porteur du 18/11/2026 ne s'y applique : tout y est
  renforcement (`EXECUTE` de `create_media_batch` et `update_media_batch` en remplacement de droits retirés, plan.md
  « Écarts de sécurité »). Tu fais puis tu consignes dans la note de lane.
- **Interfaces consommées** (`interfaces.md`, tables « Base de données ») : `create_media_batch(p_organizer, p_event,
  p_quantity, p_key_index, p_print_order_ref, p_preload_promo_amount, p_deposit_amount, p_deposit_mode,
  p_reuse_policy, p_actor) RETURNS uuid` ; `update_media_batch(p_batch uuid, p_changes jsonb, p_actor uuid) RETURNS
  void` (six clés permises, toute autre : `CL056`) ; `media_set_status` limitée à `SUSPENDED`/`BLACKLISTED`
  (sinon `CL020`). **Écart à vérifier** : la recherche R-N60 §5.2 prévoyait `p_kind`, `p_key_mode` et un retour
  `media_batch` ; `interfaces.md` n'a ni `p_kind` ni `p_key_mode` et rend `uuid`. Lis `0091` : si `kind` et
  `key_mode` sont déduits par la base, l'API ne les passe pas et relit la ligne par `row()` ; si la base ne les
  déduit pas et que la ligne diffère de l'entrée, **signale-le** (ne contourne pas).
- **Interface possédée** : le mappage HTTP de `CL056` dans `errors/sqlstate-map.ts` (une ligne, **sans code exposé
  nouveau** : même code et même statut que ce que `batches.service.ts` rend aujourd'hui pour un lot non modifiable,
  helper `conflict(...)`). `CL057`, `CL058`, `CL059` : lignes ajoutées par WP09, WP12 et WP13, hors carte.
- **Contrat** : `openapi.yaml` inchangé ; `node tools/contract-stability/check.mjs` reste à 0 refus.

## Subtasks

### T018 : `batches.service.ts` passe par les fonctions ; `FOR UPDATE` retiré

But : plus aucun `INSERT INTO media_batch`, `UPDATE media_batch` ni `SELECT … FOR UPDATE` sur `media_batch` dans
l'API.

1. `create` (l. 93-110) : `SELECT create_media_batch($1, …, $n) AS id` avec les arguments de `interfaces.md` (le
   prestataire n'est **pas** un argument : la fonction le lit de la session). L'auteur est `actor.actorId`
   (T019). Puis `const created = batchDto(await this.row(client, id))`. L'audit `MEDIA_BATCH_CREATED` reste
   identique (même `after`).
2. `update` (l. 125-170) : construire l'objet jsonb à partir de `changes` (clés déjà bornées par
   `BATCH_UPDATE_KEYS`) et appeler `update_media_batch($1, $2::jsonb, $3)`, puis relire par `row()`. Sémantique à
   garder : une clé présente avec `null` vaut `NULL` (`deposit_mode`, `print_order_ref`). Garde les contrôles
   TypeScript d'avant (statut `ORDERED`, quantité figée après l'émission des codes, `assertShape`) : ils donnent
   les messages actuels ; la base les refait de façon atomique, et un `CL056` ou `CL020` venant de la base se
   traduit par la même réponse (T019).
3. `row(client, id, lock)` (l. 46) : retirer `FOR UPDATE` (il exige un droit `UPDATE`, sinon `42501` sur tous les
   `writable()` : PATCH, statut, clôture, rattrapage de précharge, codes). **Garde la signature** : `writable()`
   (`batches.controller.ts`, non possédé) passe encore `true`. Quand `lock` est vrai, prends à la place
   `SELECT pg_advisory_xact_lock(hashtextextended('media-batch:' || $1, 0))` avant la lecture, pour garder la
   sérialisation de deux requêtes concurrentes sur le même lot (clôture par tranches). Vérifie par un test que
   `cashless_app` peut l'appeler (fonction du catalogue, `EXECUTE` à `PUBLIC` ; si un `REVOKE` le lui retire,
   **n'accorde rien**, signale et supprime le verrou en le consignant).
4. `setStatus`, `closure`, `preload`, codes : déjà par fonctions. Vérifie qu'aucun autre `UPDATE media_batch` ou
   `UPDATE media SET status` direct ne subsiste : `grep -rnE "UPDATE\s+media(_batch)?\b|INSERT INTO media_batch"
   apps/api/src` (hors `reencrypt.worker.ts`, rôle `cashless_tagkeys`, colonnes distinctes) ne rend rien de
   `cashless_app`.

Validation : `grep` ci-dessus ; `npx tsc -p tsconfig.json --noEmit` ; `batches.spec.ts` vert.

Pièges : (a) `FOR UPDATE` oublié dans `claim-codes.service.ts` ou ailleurs : cherche `FOR UPDATE` sous
`src/media` et `src/closing` ; ceux sur `media` (`FOR UPDATE OF m`) restent permis tant que `cashless_app` garde
`UPDATE (claim_code_used_at, claim_attempts)` : ne les touche pas ; (b) les erreurs de table (`23514`, `CL020`)
doivent rester identiques pour `batchRefusal` ; (c) ne jamais compenser un refus de droit par un nouveau `GRANT`
(règle 1 : tu décris, tu t'arrêtes sur ce point).

### T019 : historique de création avec auteur ; mappage `CL056`

1. L'historique `->ORDERED` de `media_batch_status_history` porte l'auteur : passe `actor.actorId` comme `p_actor`.
   C'est un renforcement d'audit (aujourd'hui `actor_id` NULL) : fais-le et consigne-le. Les pgTAP qui attendaient
   `->ORDERED:-` (`tests_media_reinstate.sql`) sont à WP01/WP03 : si un test Jest que tu possèdes l'attendait,
   mets-le à jour.
2. `errors/sqlstate-map.ts` : ajoute `CL056` avec un commentaire « mission 11a (migration 0091) : changement de lot
   non permis » ; même `code` et `status` que le helper `conflict()` du service. Complète
   `test/unit/errors/sqlstate-map.spec.ts` **seulement si** ce test énumère les codes `CL` (sinon, signale-le :
   il n'est pas dans ta carte, retouche hors carte à lister dans la note).
3. Prouve par un test (T020) que `PATCH` d'un lot hors `ORDERED` et de `quantity` après l'émission des codes rend
   exactement la réponse d'avant, qu'elle vienne du contrôle TypeScript ou du `CL056`/`CL020` de la base (insère
   l'état en propriétaire pour atteindre la base sans passer par le contrôle TypeScript).

Validation : `SKIP_LATENCY=1 npx jest test/unit/errors/sqlstate-map.spec.ts --runInBand --forceExit`.

### T020 : `blacklist.spec.ts` réécrit ; parcours de lot inchangés

Contexte (R-N60 §4, Jest) : `blacklist.spec.ts:281-335` pose `BLACKLISTED` par `UPDATE media SET status` sous
`SET LOCAL ROLE cashless_app`, puis attend `CL020` pour un retour `ACTIVE` ; `:381-440` (`asApp`) attend `CL020`
pour `UPDATE media SET status = 'ACTIVE'` direct.

1. Remplace la pose de `BLACKLISTED` par `SELECT media_set_status($1, 'BLACKLISTED', 'motif', $2)` (ou
   `blacklist_media`). Le retour `ACTIVE` par `media_set_status` reste refusé `CL020` (limite de `p_to`) : garde cette
   preuve.
2. Les `UPDATE media SET status = …` directs sous `cashless_app` attendent maintenant `42501` (droit retiré). Écris
   un test nommé « OP-N60 levée » qui, sous `SET LOCAL ROLE cashless_app` : `INSERT INTO media_batch` (statut
   `ACTIVE`, puis `CLOSED`) → `42501` ; `UPDATE media_batch SET status|quantity|key_index|organizer_id|event_id` →
   `42501` ; `SELECT … FROM media_batch FOR UPDATE` → `42501` ; `UPDATE media SET status` → `42501` ;
   `media_set_status(…, 'RETIRED', 'x', …)` → `CL020` ; `media_set_status` sans motif → `CL001`.
3. `batches.spec.ts` : parcours création, modification, statut, clôture, codes, suspension, avec les **mêmes
   attentes de réponse qu'avant** (contrôle positif de FR-004 : mêmes fixtures, réponses comparées ; ne change
   aucune attente de corps ou de statut). Ajoute : création d'un lot d'un organisateur d'un autre prestataire →
   même réponse qu'avant (introuvable) ; deux `PATCH` concurrents sur le même lot → un seul gagnant, pas de `500`.
4. **Mutation NFR-004** (obligatoire) : dans ta base `cashless_wp05`, exécute en propriétaire `GRANT UPDATE (status)
   ON media TO cashless_app`, constate que le test « OP-N60 levée » **échoue**, puis `REVOKE`. Refais de même avec
   `GRANT INSERT ON media_batch TO cashless_app`. Note les deux mutations et leur résultat dans la note de lane.

Validation (même appel Bash, voir la fiche) : `export PGDATABASE=cashless_wp05; source ../../tools/dev-db/env.sh;
env | grep DATABASE_URL`, puis `SKIP_LATENCY=1 npx jest test/integration/media/batches.spec.ts
test/integration/media/blacklist.spec.ts --runInBand --forceExit`. Puis `reset-db`.

Pièges : `claim-order`, `claims*.spec.ts` et `closing/*` ne sont pas à toi : ne les édite pas, mais lance
`claims.spec.ts` et `closing` pour vérifier que `issue_claim_codes` en `DEFINER` ne change rien ; un échec se signale.

### T021 : `tools/demo-data/seed-demo.ts` sous le rôle réel

1. Lis `seed-demo.ts` (l. 280-300 : `UPDATE media SET claim_code_hash`) et repère, par la chaîne de connexion
   utilisée, le rôle sous lequel il tourne. Attendu : propriétaire, donc inchangé. Si le script écrit `media_batch`
   ou `media.status` sous `cashless_app`, passe-le par les fonctions ; sinon **ne modifie rien** et dis-le.
2. Preuve : lance-le contre `cashless_wp05` fraîchement recréée (commande du `package.json` racine ou du fichier ;
   `grep -n "seed" ../../package.json`) et colle le résultat. Aucune écriture sur la base partagée du porteur.

## Branch Strategy

- Planification et fusion : `feat/durcissements-serveur`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP03 (donc WP01 et WP02).
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP05 --agent claude --mission
  durcissements-serveur-01M7QAJD`.

## Definition of Done

- [ ] `grep` : aucun `INSERT INTO media_batch`, `UPDATE media_batch`, `UPDATE media SET status` ni `FOR UPDATE`
      sur `media_batch` dans `apps/api/src` (hors `reencrypt.worker.ts`).
- [ ] `create` et `update` passent par `create_media_batch` et `update_media_batch` ; `row()` sans `FOR UPDATE`.
- [ ] `CL056` mappé sur un code existant, sans code exposé nouveau ; `check.mjs` à 0 refus.
- [ ] `blacklist.spec.ts` et `batches.spec.ts` verts sur `cashless_wp05`, mêmes réponses qu'avant (FR-004, SC-002).
- [ ] Test « OP-N60 levée » échoue sous les deux mutations, puis passe ; mutations consignées.
- [ ] `seed-demo.ts` vérifié, lancé, résultat dans la note.
- [ ] Note de lane : retouches hors carte, écarts à `interfaces.md`, fichiers à faire relire (aucun de cette lane
      ne contient clé ni droit ; `post-roles.sql` et `0091` sont à relire par une personne, lots WP01 et WP03).
- [ ] `git status` propre après commit ; lignes de 100 caractères au plus.

## Risks

1. `FOR UPDATE` oublié quelque part : `42501` à l'exécution, pas à la compilation. Cherche-le à la main.
2. `create_media_batch` ne déduit pas `kind` ou `key_mode` comme l'API le faisait : réponse différente. Compare.
3. Un test lent ou instable (`claim-code-order.spec.ts`) n'est pas un signal sur ton travail : signale-le sans le
   corriger.
4. Tentation de rouvrir un `GRANT` pour une suite en échec : interdit ; décris et attends le porteur.

## Ce que le relecteur doit casser

- Depuis `cashless_app` (`SET ROLE`) : insérer un lot `ACTIVE` ou `CLOSED`, changer `quantity`, `key_index`,
  `organizer_id`, `event_id`, `status` en direct, verrouiller la ligne (`FOR UPDATE`), appeler `media_set_status`
  avec `RETIRED`/`DESTROYED`/`ACTIVE`, sans motif : tout doit être refusé (et le test doit le prouver, pas seulement
  l'affirmer). Retirer le contrôle d'un test et voir s'il échoue encore.
- Créer un lot avec l'organisateur ou l'événement d'un autre prestataire : refus identique à avant.
- Comparer, route par route, les réponses de `POST/PATCH /media-batches`, statut, clôture, codes avant et après
  (corps, statut, en-têtes) : un seul écart non signalé est un constat bloquant.
- Chercher un chemin d'écriture oublié (`grep` sur `UPDATE media`, `INSERT INTO media_batch`, `FOR UPDATE`).
- Vérifier que `CL056` n'a créé aucun code d'erreur exposé nouveau et que `contract-baseline.json` n'a pas bougé.
- Vérifier que le verrou consultatif ne tient pas la ligne plus longtemps que la transaction et ne bloque pas
  la lecture de liste.
