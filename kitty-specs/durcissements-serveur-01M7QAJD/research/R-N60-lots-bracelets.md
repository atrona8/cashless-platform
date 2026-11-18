# Recherche OP-N60 (ADR-97) — mission 11a

Lecture seule ; aucun fichier du dépôt modifié, aucun test lancé. Chemins relatifs à la racine du dépôt.
Dernière migration : 0089 ; la correction = nouvelle migration (0090, ou numéro attribué par le plan) + édition de
`packages/ledger-sql/post-roles.sql` (fichier rejoué, non généré ; déjà édité par les missions précédentes).

## 1. Droits actuels de `cashless_app` et RLS

### media_batch
- `packages/ledger-sql/roles.sql:14-16` : `GRANT SELECT ON ALL TABLES`, `GRANT INSERT, UPDATE ON ALL TABLES` à
  `cashless_app`. `roles.sql:38` : `REVOKE DELETE, TRUNCATE ON ALL TABLES`.
- Aucun `REVOKE`/`GRANT` sur `media_batch` dans `post-roles.sql` ni dans aucune migration (grep `GRANT|REVOKE` sur
  `migrations/*.sql` : zéro occurrence pour `media_batch`). Donc `cashless_app` a INSERT et UPDATE sur TOUTES les
  colonnes (16), SELECT sur toutes. Figé par `tests/tests_definer_trigger_writers.sql:239-253` (et 199-201).
- Autres rôles `cashless_*` : aucun droit d'écriture sur `media_batch` (même test, ligne 195-202) ; `cashless_perso`
  n'a que SELECT (`post-roles.sql:312`). Pas de `GRANT` sur `media_batch` aux rôles edge/platform.
- RLS : `schema_grand_livre_cashless.sql:893-905` : ENABLE + FORCE RLS, politique `tenant_isolation` (`USING operator_id =
  app.operator_id`, sans WITH CHECK explicite, donc USING sert aussi de WITH CHECK). Un propriétaire non superutilisateur
  y reste soumis ; un propriétaire superutilisateur (poste local) l'ignore : toute fonction DEFINER doit nommer le
  prestataire de session explicitement (règle déjà suivie par 0019).
- Déclencheurs sur `media_batch` : `media_batch_key` BEFORE INSERT OR UPDATE OF key_index,key_mode,event_id,status
  (`check_batch_key`, INVOKER, schéma:1160-1171) ; `media_batch_transition_check` BEFORE UPDATE OF status
  (`check_batch_transition`, INVOKER, schéma:1557-1566) ; `media_batch_status_log` AFTER INSERT OR UPDATE OF status
  (`log_batch_status`, DEFINER depuis 0018, `search_path = public, pg_temp` depuis 0019:107) ; `edge_ref_trigger`
  (0063:541, DEFINER).
- Table de passages `media_batch_transition` (schéma:1540-1546) : ORDERED→PERSONALIZED|CLOSED ; PERSONALIZED→DELIVERED|CLOSED ;
  DELIVERED→ACTIVE|CLOSED ; ACTIVE→SUSPENDED|CLOSED ; SUSPENDED→ACTIVE|CLOSED. Le `CLOSED` direct est donc permis par
  le déclencheur (d'où OP-N60), seul `set_media_batch_status` le refuse.

### media
- `post-roles.sql:170` `REVOKE SELECT, INSERT, UPDATE ON media FROM cashless_app` ; `:177` SELECT par colonne (toutes sauf
  `pwd_pack_enc`, `pwd_pack_dek_id`) ; `:183` `GRANT UPDATE (status, claim_code_used_at, claim_attempts) ON media TO
  cashless_app`. Pas d'INSERT (register_personalized_media, DEFINER, 0019). Figé : `tests_media_roles.sql:92-94`
  (`ARRAY['claim_attempts','claim_code_used_at','status']`) et `tests_definer_trigger_writers.sql:199`.
- `cashless_tagkeys` : UPDATE (pwd_pack_enc, pwd_pack_dek_id) (`post-roles.sql:285-286`) ; `cashless_perso` : SELECT seul.
- RLS `tenant_isolation` (FORCE). Déclencheurs : `media_transition_check` BEFORE INSERT OR UPDATE OF status
  (`check_media_transition`, INVOKER, version 0017 qui ajoute la règle BLACKLISTED→ACTIVE seulement par `reinstate_media` et
  `media_owner_session()`), `media_status_log` (`log_media_status`, DEFINER depuis 0018), `media_key_matches_batch`.
- Historiques `media_status_history`, `media_batch_status_history` : INSERT/UPDATE/DELETE retirés (`post-roles.sql:223`).
  `media_transition`, `media_batch_transition` : lecture seule (`:236`).

## 2. Chemins d'écriture de l'API vers media_batch / media

Recherche exhaustive (`INSERT INTO|UPDATE ... media[_batch]` dans `apps/api/src`, hors `*.spec.ts`) : **trois** requêtes SQL
directes seulement.

| # | Fichier:ligne | Requête | Processus / rôle |
|---|---|---|---|
| 1 | `apps/api/src/media/batches/batches.service.ts:95` | `INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index, print_order_ref, preload_promo_amount, deposit_amount, deposit_mode, key_mode, reuse_policy) VALUES ... RETURNING ${BATCH_COLUMNS}` (le fiche cite `:68`, c'est maintenant `:95`) | route `POST /media-batches` (`batches.controller.ts:96`), processus public, `cashless_app` |
| 2 | `batches.service.ts:154` | `UPDATE media_batch SET "<col>" = $n, ... WHERE id = $1 RETURNING ...` ; colonnes dynamiques ; liste blanche `BATCH_UPDATE_KEYS` (`batches.dto.ts:108-115`) : `quantity, print_order_ref, preload_promo_amount, deposit_amount, deposit_mode, reuse_policy` ; le service refuse hors `ORDERED` et refuse `quantity` si `claim_codes_issued_at` non nul (TS seulement) | route `PATCH /media-batches/:id` (`batches.controller.ts:133`), `cashless_app` |
| 3 | `apps/api/src/media/keys/reencrypt.worker.ts:169` | `UPDATE media SET pwd_pack_enc, pwd_pack_dek_id` | processus clés (`cashless_tagkeys`) ; colonnes distinctes, non concerné |

Aucun `UPDATE media SET status` direct dans l'API. Les changements de statut passent par fonctions :
- lot : `set_media_batch_status` (`batches.service.ts:195`), `close_batch` (`:277`, après `forfeit_batch_deposits` `:253`,
  `media_set_actor` `:274`, puis `invalidate_unassociated_codes` `:281`), `preload_batch` (`:298`), `issue_claim_codes`
  (`claim-codes.service.ts:72`), `associate_claim_code`.
- bracelet : `blacklist_media` (`blacklist.service.ts:77`), `suspend_media` (`loss.service.ts:23`,
  `customer-app/lost-media.service.ts:43`), et DEFINER `activate_media`, `release_media`, `recover_media`, `replace_media`,
  `reinstate_media`.
- Personnalisation (`cashless_perso`) : `register_personalized_media` (DEFINER) ; ne touche jamais `media_batch` en écriture.

### Verrous de ligne (point d'attention important)
`batches.service.ts:46` : `row(client, id, lock = true)` fait `SELECT ... FROM media_batch WHERE id = $1 FOR UPDATE` en tant
que `cashless_app` (appelé par `writable()` du contrôleur, `batches.controller.ts:283-291`, pour PATCH, status, closure,
preload-catchup, claim-code-*). PostgreSQL exige le droit UPDATE sur au moins une colonne pour FOR UPDATE / FOR SHARE.
**Si on retire tout UPDATE sur `media_batch`, ce `FOR UPDATE` échoue (42501).** Il faut le retirer côté API (les fonctions
DEFINER verrouillent elles-mêmes la ligne) ou le remplacer par un verrou consultatif.
De même pour `media` : l'API fait `FOR UPDATE OF m` (`loss.service.ts:72`, `release.service.ts:28`, `activation.service.ts:126`,
`replace.service.ts:121`, `blacklist.service.ts:51`, `blacklist-approval-actions.ts:87`, `lost-media.service.ts:29`) : cela
reste permis tant que `cashless_app` garde UPDATE (claim_code_used_at, claim_attempts) sur `media`. **Ne pas retirer ces deux
colonnes** (ni retirer tout UPDATE sur media) sans revoir ces sept requêtes.

### Écrivains tests (Jest)
Presque toutes les écritures de fixtures passent par `withOwner` (propriétaire) : `apps/api/test/support/db.ts`,
`media-fixtures.ts`, `batch-fixtures.ts`, `batches.spec.ts:482-516,627`, `claims.spec.ts:245`, `activation.spec.ts:319` : non
touchés. Seuls les cas `SET LOCAL ROLE cashless_app` sont affectés (voir §4).

## 3. Fonctions existantes

| Fonction | Signature | Sécurité | Définie | Écrit |
|---|---|---|---|---|
| `set_media_batch_status` | `(p_batch uuid, p_to text, p_reason text, p_actor uuid) RETURNS text` | **INVOKER** | `migrations/0013_media_api.sql:79-96` | `UPDATE media_batch SET status`; refuse CLOSED (CL020 `BATCH_CLOSE_VIA_CLOSURE`) et SUSPENDED sans motif (CL001) ; `SELECT ... FOR UPDATE` filtré par `media_session_operator()` ; `media_set_actor` d'abord (auteur obligatoire CL001) |
| `close_batch` | `(p_batch uuid) RETURNS integer` | **DEFINER**, `search_path = public` (sans pg_temp ; voir plus bas) | `schema_grand_livre_cashless.sql:1468-1490` | `assert_tenant(tenant_of_batch)`, cautions, `media_assignment`, `UPDATE media SET status='RETIRED'`, `UPDATE media_batch SET status='CLOSED'` |
| `media_set_status` | `(p_media uuid, p_to text, p_reason text, p_actor uuid) RETURNS text` | **INVOKER** | `0013_media_api.sql:98-110` | `UPDATE media SET status`; motif obligatoire (CL001) ; opérateur de session ; `media_set_actor` |
| `blacklist_media`, `suspend_media` | `(uuid, text, uuid) RETURNS text` | INVOKER, SQL | `0013:113-120` | appellent `media_set_status` vers BLACKLISTED / SUSPENDED |
| `log_media_status`, `log_batch_status` | triggers | **DEFINER** `search_path = public, pg_temp` | schéma:1303 / 1568 ; DEFINER par `0018_status_history_definer.sql:26-27`, `pg_temp` par `0019:106-107` | historiques ; lisent `app.user_id`, `app.reason`, `app.approved_by` |
| `check_media_transition` | trigger | INVOKER | schéma:1263, redéfini `0017:79` | refuse passages hors table ; BLACKLISTED→ACTIVE seulement via `reinstate_media` (marqueur `app.reinstate_media`) ou session propriétaire (`media_owner_session()`, `0017:73`) |
| `check_batch_transition`, `check_batch_key` | triggers | INVOKER | schéma:1557, 1160 | table de passages ; cohérence clé/mode/événement (lit `tag_key`, SELECT accordé) |
| `issue_claim_codes` | `(p_batch uuid, p_hashes bytea[]) RETURNS int` | **INVOKER** | `0010_media_claims.sql:129-153` | `INSERT claim_code`, `UPDATE media_batch SET claim_codes_issued_at` ; `FOR UPDATE` |
| `claim_media`, `confirm_media_claim`, `mark_claim_code_used` | | **INVOKER** | `0010` | `UPDATE media SET claim_code_used_at / claim_attempts` (colonnes qui restent accordées) ; `FOR UPDATE` sur media |
| `register_personalized_media` | 9 args | DEFINER `public, pg_temp` | `0019:34` | `INSERT media` ; `FOR SHARE` sur le lot + verrou consultatif `media-batch-registration:<lot>` |
| `preload_batch`, `activate_media`, `release_media`, `recover_media`, `replace_media`, `reinstate_media`, `reassign_pool_media`, `forfeit_deposit`, `deposit_accounts`, `associate_claim_code`, `retire_dedicated_key`, `edge_*` | | DEFINER | schéma / migrations | écrivent `media` ; aucun ne dépend d'un droit de `cashless_app` |

Recensement des fonctions qui font `UPDATE media` / `UPDATE media_batch` / `INSERT INTO media[_batch]` (script de balayage
de `schema_grand_livre_cashless.sql` + `migrations/*.sql`, dernière définition de chaque fonction) : seules
**INVOKER** à écrire : `set_media_batch_status` (media_batch.status), `issue_claim_codes` (media_batch.claim_codes_issued_at),
`media_set_status` (media.status), `claim_media` / `confirm_media_claim` / `mark_claim_code_used`
(media.claim_code_used_at, claim_attempts). Toutes les autres sont DEFINER. Les fonctions SQL/INVOKER qui verrouillent
`media_batch` / `media` en `FOR UPDATE|SHARE` : `set_media_batch_status`, `issue_claim_codes` (media_batch),
`media_set_status`, `claim_media`, `confirm_media_claim` (media).

Constat : `close_batch` et `preload_batch` sont DEFINER avec `SET search_path = public` seul, alors que
`tests_definer_trigger_writers.sql:229-237` affirme zéro fonction DEFINER sans `pg_temp` ; ils ont dû être corrigés par
0021 (ALTER FUNCTION ... SET search_path). À vérifier (non rouvert ici) : toute NOUVELLE fonction DEFINER doit porter
`SET search_path = public, pg_temp`.

## 4. Tests de borne actuels à inverser

pgTAP (hand-written, pas générés) :
1. `packages/ledger-sql/tests/tests_definer_trigger_writers.sql:239-253` (section 4) : liste figée de INSERT/SELECT/UPDATE
   par colonne de `cashless_app` sur `media_batch` ; à inverser : plus d'entrée `INSERT:` ni `UPDATE:` (le SELECT
   reste figé ; le test échoue si un droit ou une colonne réapparaît). Garder le test DELETE/TRUNCATE/TRIGGER (254-256).
   Mettre à jour les en-têtes (lignes 16-17, 184-185, titre de la section 4 ligne 224 : OP-N60 « levée »).
2. Même fichier, `:199-201` : chaîne attendue `cashless_app:media:UPDATE:claim_attempts,claim_code_used_at,status
   cashless_app:media_batch:INSERT:ALL cashless_app:media_batch:UPDATE:ALL cashless_tagkeys:...` devient
   `cashless_app:media:UPDATE:claim_attempts,claim_code_used_at cashless_tagkeys:media:UPDATE:pwd_pack_dek_id,pwd_pack_enc`.
3. `tests_media_roles.sql:92-94` : `ARRAY['claim_attempts','claim_code_used_at','status']` -> sans `status` ; libellé
   « deux colonnes ».
4. `tests_media_api.sql:44-46` : compte des fonctions INVOKER = 8 -> 6 (`set_media_batch_status` et `media_set_status`
   passent DEFINER) ; ajouter un test prosecdef pour ces deux fonctions et pour les nouvelles.
5. `tests_media_reinstate.sql` (section `SET LOCAL ROLE cashless_app`, lignes 77-218) : 112 (`UPDATE media SET status =
   'ACTIVE'` direct attendu CL020 -> désormais 42501), 135, 194 (`UPDATE media SET status = 'BLACKLISTED'` direct pour poser
   un épisode -> remplacer par `media_set_status(..., 'BLACKLISTED', 'motif', actor)`), 160 (`UPDATE media SET status =
   'ISSUED'` attendu CL020 -> 42501), 204 (`UPDATE media_batch SET status = 'PERSONALIZED'` direct -> `set_media_batch_status`).
   La preuve « un UPDATE direct reste refusé » reste vraie (changée en refus de droit) ; garder aussi une preuve de la
   règle de transition par le chemin fonction (media_set_status BLACKLISTED→ACTIVE, ligne 114 : toujours CL020 car le
   déclencheur tourne dans la fonction DEFINER ; `media_owner_session()` reste faux, voir §5).
6. `tests_execute_grants.sql:70-` (liste figée de EXECUTE de `cashless_app`) : ajouter les nouvelles fonctions
   (`create_media_batch(...)`, `update_media_batch(...)`) ; si on retire des EXECUTE devenus inutiles, les retirer aussi.
7. `tests_definer_search_path.sql` / test global `tests_definer_trigger_writers.sql:229-237` : passent seulement si les
   nouvelles fonctions ont `SET search_path = public, pg_temp`.
8. Vérifier (je n'ai pas pu prouver sans exécuter) les autres suites qui font `SET LOCAL ROLE cashless_app` puis
   `UPDATE/INSERT` sur ces tables : `tests_media_claims.sql`, `tests_consume_tap_claim.sql`, `tests_replace_cash_due.sql`,
   `tests_personalization_definer.sql:158-171`, `tests_media_claim_tap.sql`. Les INSERT de lots y sont avant le `SET ROLE`
   (propriétaire) d'après les numéros de ligne (23-77 contre 79+), donc a priori non touchés.

Jest :
- `apps/api/test/integration/media/blacklist.spec.ts:281-335` (`SET LOCAL ROLE cashless_app` puis `UPDATE media SET status =
  'BLACKLISTED'` puis tentative ACTIVE attendue 'CL020') ; `:381-440` (`asApp` : `UPDATE media SET status = 'ACTIVE'`
  attendu 'CL020' -> deviendra '42501') ; remplacer la pose de BLACKLISTED par `media_set_status`/`blacklist_media`.
- `batches.spec.ts` / `blacklist.spec.ts` / `closing` : pas d'autres écritures sous `cashless_app` repérées ; le test de
  création de lot reste vert si la réponse de la route est inchangée. Ajouter : tests depuis `cashless_app` de chaque refus
  de la fiche (INSERT ACTIVE/CLOSED, UPDATE status/quantity/key_index/organizer_id/event_id, UPDATE media status sans motif)
  en pgTAP principalement.

## 5. Conception proposée (migration 0090 + post-roles.sql + API interne)

### 5.1 Retraits (post-roles.sql, section 1, après les GRANT de roles.sql)
```
REVOKE INSERT, UPDATE ON media_batch FROM cashless_app;          -- plus aucune colonne
REVOKE UPDATE ON media FROM cashless_app;
GRANT  UPDATE (claim_code_used_at, claim_attempts) ON media TO cashless_app;   -- au lieu de status, claim_*
```
(le `GRANT UPDATE (status, ...)` de la ligne 183 est remplacé). `post-roles.sql` rejoué après `roles.sql` donc le retrait tient.
Aucun droit n'est ajouté à `cashless_app` (seulement EXECUTE sur deux nouvelles fonctions, en 4a).

### 5.2 Fonctions (toutes `SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE EXECUTE ... FROM PUBLIC` puis
`GRANT` à `cashless_app` dans la liste 4a de post-roles.sql ; tenant explicite via `media_session_operator()` car RLS non
fiable si propriétaire superutilisateur)
1. **`create_media_batch(p_organizer uuid, p_event uuid, p_kind text, p_quantity int, p_key_index int, p_print_order_ref
   text, p_preload_promo_amount bigint, p_deposit_amount bigint, p_deposit_mode text, p_key_mode text, p_reuse_policy text,
   p_actor uuid DEFAULT NULL) RETURNS media_batch`** (ou `uuid`, l'API relit par `row()`) :
   - n'a PAS de paramètre statut ni d'`operator_id` : opérateur = `media_session_operator()`, statut = défaut `ORDERED`
     (tout ce qui est « ACTIVE/CLOSED » est inexprimable) ;
   - contrôles explicites : `party` de kind ORGANIZER avec `operator_id = v_operator` (sinon `no_data_found`/« Objet
     introuvable », même texte que partout) ; si `p_event` non nul : `event` avec `operator_id = v_operator AND
     organizer_id = p_organizer` ; clé : laissée au déclencheur `check_batch_key` (BEFORE INSERT, vérifie existence, statut
     ACTIVE, portée SHARED/DEDICATED) ; contraintes CHECK de la table inchangées (SQLSTATE 23514 conservés pour l'API).
   - option : `media_set_actor(p_actor, 'Création du lot')` pour que l'historique `->ORDERED` porte l'auteur (aujourd'hui
     `actor_id` NULL, `tests_media_reinstate.sql:206` attend `->ORDERED:-`) : c'est un renforcement d'audit mais change
     deux assertions de tests ; ou poser `app.user_id` seul. À décider au plan.
2. **`update_media_batch(p_batch uuid, p_changes jsonb, p_actor uuid) RETURNS media_batch`** pour le PATCH : liste blanche
   des clés = `BATCH_UPDATE_KEYS` (`quantity, print_order_ref, preload_promo_amount, deposit_amount, deposit_mode,
   reuse_policy`), clé inconnue -> CL001 ; sémantique « clé présente avec null = NULL » (deposit_mode, print_order_ref) ;
   `SELECT ... FROM media_batch WHERE id = p_batch AND operator_id = v_operator FOR UPDATE` ; refus hors `ORDERED` (CL020) ;
   refus de `quantity` si `claim_codes_issued_at IS NOT NULL` (la règle n'existe aujourd'hui que dans
   `batches.service.ts:129-139` : la ramener en base) ; contraintes CHECK/déclencheurs inchangés. Option de renforcement
   (à consigner comme tel) : `quantity >= count(media du lot)`.
   Alternative écartée : garder `GRANT UPDATE (quantity, print_order_ref, preload_promo_amount, deposit_amount,
   deposit_mode, reuse_policy)` avec un déclencheur `status = 'ORDERED'` : laisse `quantity` modifiable en direct, ce que
   la condition de levée interdit explicitement (« `SET quantity = …` refusés »).
3. **`set_media_batch_status`** : `ALTER FUNCTION ... SECURITY DEFINER SET search_path = public, pg_temp` (corps identique :
   il filtre déjà `operator_id = media_session_operator()`, refuse CLOSED et exige l'auteur). Les déclencheurs de passage et
   d'historique s'exécutent dans la fonction (log_batch_status DEFINER ne change pas).
4. **`issue_claim_codes`** : passe DEFINER (corps inchangé : il filtre `operator_id = claim_session_operator()`, `b_operator`
   vient de la ligne). Sans cela il faudrait garder `UPDATE (claim_codes_issued_at)` pour l'API, qui permettrait de remettre
   la colonne à NULL (réémission de codes, contournement du gel de quantité) ou de la fixer pour geler un lot. Vérifier que
   l'INSERT `claim_code` reste autorisé (DEFINER : oui).
5. **`media_set_status`** : `SECURITY DEFINER SET search_path = public, pg_temp`, corps identique (motif obligatoire CL001,
   opérateur de session, `media_set_actor`). `blacklist_media` et `suspend_media` restent INVOKER SQL (elles appellent une
   fonction accordée). Renforcement recommandé à consigner : restreindre `p_to` à `SUSPENDED`/`BLACKLISTED` (seuls usages
   de l'API ; `tests_media_reinstate.sql:114` attend CL020 pour ACTIVE : avec `RAISE ... USING ERRCODE='CL020'` le test
   passe tel quel). Sans cela, `cashless_app` peut encore appeler `media_set_status(..., 'RETIRED'/'DESTROYED', 'x', ...)`
   avec un motif quelconque (toujours historisé, mais irréversible).
6. `close_batch` : déjà DEFINER, rien à changer. NB : elle verrouille et met `CLOSED` mais ne refuse pas explicitement une
   re-clôture (le déclencheur passe `CLOSED`→`CLOSED` sans effet, status inchangé) ; `forfeit_batch_deposits` est appelée
   avant par l'API.

### 5.3 Changements d'API interne (routes openapi inchangées, réponses identiques)
- `batches.service.ts:93-110` `create` : `SELECT * FROM create_media_batch(...)` (même liste de colonnes ; `assertShape`
  garde ses refus clairs en amont).
- `batches.service.ts:152-157` `update` : `SELECT ... FROM update_media_batch($1, $2::jsonb, $3)` à la place de l'UPDATE
  dynamique (construire le jsonb à partir de `changes`).
- `batches.service.ts:42-52` `row(..., lock)` : **retirer le `FOR UPDATE`** (le droit UPDATE disparaît) ; les fonctions
  DEFINER verrouillent la ligne elles-mêmes (set_media_batch_status, update_media_batch, close_batch, preload_batch,
  issue_claim_codes). Pour garder la sérialisation entre deux requêtes API concurrentes sur le même lot (fermeture par
  tranches), pas de besoin de verrou en TS ; si on en veut un : `pg_advisory_xact_lock(hashtextextended('media-batch:'||id,0))`
  (fonction du catalogue, EXECUTE PUBLIC, sans droit de table). `writable()` (`batches.controller.ts:283`) appelle `row(...,
  true)` : adapter.
- Les TOCTOU de `update` (status ORDERED, claim codes) deviennent atomiques en base.
- Aucune autre écriture de l'API à modifier (blacklist/suspend/activation/etc. passent déjà par des fonctions).
- `tools/demo-data/seed-demo.ts:296` (`UPDATE media SET claim_code_hash`) : tourne sous un rôle propriétaire a priori ;
  à vérifier au plan (le `claim_code_hash` n'est déjà pas accordé à `cashless_app`).

### 5.4 Cas où le déclencheur dépend de la session
`check_media_transition` (0017) appelle `media_owner_session()` : `current_setting('role') = 'none' AND pg_has_role(
session_user, owner)`. Appelé depuis la nouvelle `media_set_status` DEFINER avec `session_user = cashless_app` (production) ou
`SET ROLE cashless_app` (tests : `role` = cashless_app) : faux dans les deux cas, donc BLACKLISTED→ACTIVE reste refusé hors
`reinstate_media` (exige `app.reinstate_media`). Test à ajouter : `media_set_status(…,'ACTIVE',…)` depuis une session `cashless_app`
sur un BLACKLISTED est refusé (existe déjà, `tests_media_reinstate.sql:114`).

### 5.5 Autres chemins légitimes vérifiés (rien ne casse)
- Fonctions INVOKER appelées par `cashless_app` qui écrivent `media` : `claim_media`, `confirm_media_claim`,
  `mark_claim_code_used` -> colonnes `claim_code_used_at`, `claim_attempts` conservées ; `media_set_status` -> DEFINER.
  Aucune autre fonction INVOKER n'écrit `media.status`.
- Fonctions INVOKER écrivant `media_batch` : `set_media_batch_status`, `issue_claim_codes` -> DEFINER (seules).
- Déclencheurs INVOKER qui tournent sous `cashless_app` : plus déclenchés par `cashless_app` en direct, mais tournent dans les
  fonctions DEFINER sous le propriétaire ; `check_batch_key` lit `tag_key` (propriétaire : OK).
- Processus des clés : `cashless_tagkeys` (UPDATE pwd_pack_*), `cashless_perso` (SELECT media_batch + fonctions DEFINER) :
  non concernés ; `cashless_edge`, `cashless_platform` etc. : aucun droit d'écriture sur ces deux tables (test figé).
- Contraintes d'intégrité référentielle (media.batch_id -> media_batch, claim_code.batch_id) : verrous `FOR KEY SHARE`
  pris par le moteur avec les droits du propriétaire ; aucun droit UPDATE nécessaire pour `cashless_app`.
- Efficacité des verrous : voir §2 (`FOR UPDATE` TS sur media_batch à retirer ; ceux sur `media` restent permis).
- `batch_inventory`, lectures : SELECT inchangé.

### 5.6 Risques
1. Oubli du `FOR UPDATE` de `row()` -> 42501 sur PATCH/status/closure/preload/claim-code (tous les `writable()`).
2. Fonctions DEFINER avec propriétaire superutilisateur local : RLS ignorée, donc chaque lecture/écriture doit nommer le
   prestataire (organisateur et événement de `create_media_batch` en particulier : sans le contrôle, un organisateur d'un autre
   prestataire pourrait être référencé ; aujourd'hui l'API le contrôle via `parties.row` + RLS de `party`).
3. SQLSTATE : les erreurs de table (23514, CL020 des déclencheurs) doivent rester identiques pour l'API
   (`batchRefusal` traduit). Reprendre les messages de 0013.
4. `media_set_status` DEFINER : un EXECUTE reste accordé à `cashless_app`; sans restriction de `p_to`, la porte « motif
   obligatoire » reste, pas plus (à consigner si laissé tel quel : ce n'est pas un affaiblissement, mais ADR-97 vise « seul
   chemin du statut »).
5. Tests existants sous `SET ROLE cashless_app` à réécrire (§4) ; code d'erreur CL020 -> 42501 pour les refus directs.
6. Fichiers à faire relire par une personne (règle 4 de CLAUDE.md) : la migration 0090 (fonctions DEFINER) et `post-roles.sql`
   (droits de base) ; l'agent qui écrit ne vaut pas relecture indépendante.
7. Règle 3 : levée d'OP-N60 = mettre « levée » dans `docs/POINTS_OUVERTS.md` (fiche `### OP-N60`, ligne 41 du tableau,
   « Bloque la production : non »), ADR-97 -> statut levée (+ complément daté), report PROMPTS-A-ENVOYER.md / PRD.md,
   tests de borne inversés (ils font désormais échouer la suite si un droit INSERT/UPDATE réapparaît).

### 5.7 Alternatives écartées
- Politique RLS restrictive sur INSERT (`status = 'ORDERED'`) + UPDATE par colonne : laisse `quantity`, `key_index`,
  `organizer_id`, `event_id` modifiables ou exige un déclencheur de plus, et la condition de levée ne serait pas atteinte
  pour `quantity` ; plus fragile que le retrait de droit (une politique peut être contournée par un futur `GRANT`).
- Garder `UPDATE (status)` seul sur `media_batch` avec un déclencheur refusant CLOSED : `status` reste réécrivable (ACTIVE
  depuis ORDERED refusé par la table de passages, mais SUSPENDED/ACTIVE sans motif ni `set_media_batch_status`), et `FOR UPDATE`
  marcherait seulement par hasard ; moins strict que « UPDATE de media_batch borné / aucun ».
- Garder `UPDATE (claim_codes_issued_at)` pour `issue_claim_codes` INVOKER : cf. 5.2 point 4.
- Un déclencheur DEFINER « seul passage par fonction » via marqueur de session (`app.*`) : un marqueur posé par l'API
  est posable par un attaquant (cf. 0017 pour `app.reinstate_media`, qui n'est sûr que couplé à une demande approuvée).

## 6. Vérifications à faire à l'exécution (non faites, lecture seule)
- `psql`: `SELECT has_any_column_privilege('cashless_app','media_batch','INSERT'|'UPDATE')` = false après migration + post-roles.
- pgTAP depuis `SET LOCAL ROLE cashless_app` : INSERT lot `ACTIVE` et `CLOSED` -> 42501 ; `UPDATE media_batch SET status =
  'CLOSED'`, `SET quantity = 500`, `SET key_index`, `SET organizer_id`, `SET event_id` -> 42501 ; `SELECT ... FOR UPDATE` -> 42501 ;
  `UPDATE media SET status = 'BLACKLISTED'` -> 42501 ; `media_set_status(.., '', ..)` -> CL001 ; `create_media_batch` produit
  un lot ORDERED ; `set_media_batch_status(.., 'CLOSED', ..)` -> CL020 ; `update_media_batch` hors ORDERED -> CL020 ; lot d'un
  autre prestataire / organisateur d'un autre prestataire -> « Objet introuvable ».
- Jest d'intégration `apps/api/test/integration/media/batches.spec.ts`, `blacklist.spec.ts`, `claims*.spec.ts`,
  `closing/*` : tests en série par l'agent principal (base partagée).
