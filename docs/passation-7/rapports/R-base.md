# R-base — État réel de la base pour la mission 7 (hors ligne, snapshots, lots)

Lecture seule. Chemins relatifs à `packages/ledger-sql/` sauf mention. Rien exécuté (pas de pgTAP, pas de reset-db).
`S:` = `schema_grand_livre_cashless.sql` (schéma de référence, jamais modifié à la main).

## 0. Résumé en dix lignes

1. Tous les objets hors ligne existent déjà dans le schéma de référence (section 18, S:1952-2480). Aucune migration 0022..0042 ne les a remplacés, sauf `record_config_served` (0029).
2. Aucun objet hors ligne n'est accordé à `cashless_app` en EXECUTE, sauf `record_device_seq` et `record_config_served` (`post-roles.sql:499-501, 477`). Tout le reste (lots, trous, snapshots, politique effective) est à accorder par la mission.
3. La version d'un snapshot n'est PAS calculée par la base : le déclencheur `check_offline_snapshot` vérifie seulement `version > max` (S:2319). L'application choisit la version (OP-N57). Aucune fonction d'inscription n'existe.
4. L'historique des politiques est écrit par un déclencheur AUX DROITS DE L'APPELANT (`log_offline_policy`, non DEFINER, S:2411). `cashless_app` a INSERT et UPDATE sur `offline_policy_history` (OP-N58).
5. Aucune table ne stocke le CONTENU d'un snapshot (entrées, retraits, mots de passe enveloppés par terminal). `offline_snapshot` ne garde que l'en-tête + signature. Un DELTA ne peut donc pas être reconstruit à partir de la base actuelle (voir 1.3).
6. `anomaly` n'a aucune colonne pour la « partie porteuse de la perte » ni pour un détail libre. Les 12 types de la mission figurent déjà dans le CHECK `anomaly_kind_check` (0038).
7. La garde de caisse (0036) n'est PAS datée : elle exige une session OPEN actuelle sur le compte, pas une session qui couvrait `occurred_at`. La couverture à une heure est à écrire.
8. Dernière migration : `0042_wallet_block_causes.sql`. `0028` n'existe pas (réservé libre). Prochaine : `0043`.
9. Colonnes `seq` : toutes `bigint` (`S:1998-2002`, `device.last_seq`, `contiguous_acked_seq`, `anomaly.seq`). Le côté API retient déjà `MAX_DEVICE_SEQ = 2^63-1` en `bigint` JS (`apps/api/src/idempotency/device-key.ts:13`). Risque 2^53 côté JSON et côté `pg` (renvoie les `bigint` en texte).
10. Pas de `ALTER DEFAULT PRIVILEGES` nulle part (confirmé par grep). 34 suites pgTAP sur 41 font `SET [LOCAL] ROLE`, dont 25 utilisent des fonctions `pg_temp.*` : le passage au droit par défaut global (FR-038) casse ces suites tant qu'elles ne sont pas adaptées.

---

## 1. Schéma de référence et migrations : mécanique et objets

### 1.1 Comment tout est appliqué

- `package.json` : `"migrate": "tsx src/migrate.ts"`, `"reset-db": "bash scripts/reset-db.sh"`, `"test:pgtap": "bash scripts/test-pgtap.sh"`.
- `src/migrate.ts:1-12` : exécuté par le propriétaire (`DATABASE_URL_OWNER`). La série des migrations non appliquées, puis `roles.sql`, puis `post-roles.sql`, s'exécutent dans UNE seule transaction, sous un verrou consultatif (`migrate.ts:68`). Somme de contrôle par migration (refus si une migration appliquée change). Directive `-- @include <chemin>` pour inclure un fichier.
- `migrations/0001_schema_reference.sql` inclut le schéma de référence par `@include` (le schéma est donc la migration de base ; ne jamais modifier le `.sql` : modifier les générateurs).
- Conséquence pour la mission : toute fonction créée en migration 0043+ reçoit EXECUTE de PUBLIC à la création, puis `post-roles.sql §0` (`REVOKE EXECUTE ON ALL FUNCTIONS … FROM PUBLIC`, `post-roles.sql:20`) le retire dans la même transaction. Aucune fonction n'est donc exécutable par défaut ; chaque fonction nouvelle doit être listée dans un `GRANT EXECUTE` nominatif de `post-roles.sql` (section 4a ou 7c, ou une nouvelle section 8) ET dans la liste figée de `tests/tests_execute_grants.sql`.
- Règle de `0021` : toute fonction SECURITY DEFINER fixe `SET search_path = public, pg_temp` ; `CREATE OR REPLACE` efface ce réglage, il faut le reposer. Test : `tests/tests_definer_search_path.sql`.

### 1.2 Objets, un par un (signature, effet réel, manques)

**`offline_policy`** (S:747-762). Colonnes : `scope_type IN ('OPERATOR_CEILING','ORGANIZER','EVENT','DEVICE')`, `scope_id`, `offline_enabled`, `max_per_sale`, `max_per_media_per_device`, `max_total_per_device`, `max_snapshot_age interval`, `cash_topup_offline`, `updated_by`, `updated_at`, `version int default 1`, `UNIQUE (scope_type, scope_id)`. RLS `tenant_isolation` forcée (S:896-905). Écriture : `cashless_app` a INSERT/UPDATE direct (roles.sql:17, rien ne le retire). Aucun contrôle de portée (qu'un `scope_id` EVENT/DEVICE/ORGANIZER appartienne au prestataire, que `OPERATOR_CEILING.scope_id = operator_id`) : aucune CHECK, aucun déclencheur.
- Manque FR-001/FR-002 : pas de contrôle « la politique d'un organisateur ne dépasse pas le plafond du prestataire à l'écriture » (la base ne fait que `least()` à la lecture) ; pas de contrôle de cohérence de portée ; pas de fonction d'écriture.

**`effective_offline_policy(p_device uuid)`** (S:766-798), SQL STABLE, SECURITY INVOKER, non accordée à l'app. Retourne `(offline_enabled, max_per_sale, max_per_media_per_device, max_total_per_device, max_snapshot_age, cash_topup_offline, capped)`. Priorité DEVICE > EVENT > ORGANIZER > défauts (`false`, 0, 0, 0, `interval '15 minutes'`, `false`), puis `least()` avec la ligne `OPERATOR_CEILING` du prestataire. Force `offline_enabled` et `cash_topup_offline` à `false` si `device.personal_phone`. `capped` = un plafond numérique a réduit le choix. Il lit `device JOIN event` : un terminal sans `event_id` ne rend AUCUNE ligne (JOIN interne) ; `record_config_served` ferait alors `pol = NULL`.
- Écart : `capped` ne tient pas compte de `max_snapshot_age` ni des booléens plafonnés (seulement les trois montants). Conforme à FR-002 (« plafond »), à confirmer au plan.
- Écart : FR-003 « risque maximal = somme des `max_total_per_device` de l'événement » n'a aucune fonction : à écrire (somme des `effective_offline_policy(d).max_total_per_device` sur les terminaux `POS` non révoqués de l'événement, hors `personal_phone`).

**`offline_snapshot`** (S:355-373) + **`check_offline_snapshot()`** (S:2314-2351). Colonnes : `id bigserial`, `operator_id`, `ledger_id`, `event_id`, `kind FULL|DELTA`, `version bigint >= 1`, `base_version`, `generated_at`, `valid_until`, `entries int`, `content_sha256 bytea(32)`, `authority_epoch`, `key_id` (FK `snapshot_signing_key`), `header jsonb`, `signature bytea`, `UNIQUE (ledger_id, version)`. Déclencheur BEFORE INSERT : prestataire = celui du grand livre ; `version > max(version)` du grand livre (CL001) ; DELTA exige une `base_version` existante ; `authority_epoch = ledger.authority_epoch` (CL015) ; clé `ACTIVE`, `owner='CENTRAL'`, prestataire cohérent ; en-tête = colonnes (format `CASHLESS-SNAPSHOT/v1`, `kind`, ids, `currency`, `version`, `base_version`, dates, `entries`, `content_sha256` en hexa, `authority_epoch`, `key_id`). Immuable (`forbid_mutation`). RLS `tenant_isolation`.
- NE FAIT PAS : calcul de la version (OP-N57 : l'appelant la choisit, un `bigint` géant bloque tout) ; vérification de la signature (impossible en SQL, juste `bytea NOT NULL`) ; vérification de `entries`/`removed` contre un contenu ; contrôle de `valid_until` (seulement `> generated_at`) ; unicité d'un DELTA par `base_version`.
- Le déclencheur lit `max(version)` sans verrou : deux inscriptions concurrentes sur le même grand livre peuvent calculer la même « dernière + 1 ». La fonction d'inscription doit prendre un verrou (`pg_advisory_xact_lock` sur `ledger_id`, ou `SELECT … FOR UPDATE` du grand livre) AVANT de lire le max. `UNIQUE (ledger_id, version)` fait échouer le second (23505) au lieu de l'écraser.
- Droits réels (post-roles.sql n'y touche pas) : `cashless_app` INSERT+UPDATE (UPDATE refusé par déclencheur). Borne actuelle : `tests/tests_definer_trigger_writers.sql:162-188`.

**Contenu : vue `offline_snapshot_rows`** (S:2362-2376). Existe, `security_invoker = true`. Une ligne par `media_assignment` ouvert (`released_at IS NULL`) : `operator_id, ledger_id, currency, media_id, token_hash, nfc_uid, key_index, status, batch_event_id, batch_status, wallet_id, wallet_status, spendable, last_counter, pwd_pack_enc, pwd_pack_dek_id, originality_sig_sha256`. `cashless_app` n'y a AUCUN droit (`post-roles.sql:196`, `REVOKE ALL`) : il faudra une fonction DEFINER de lecture, ou un rôle dédié.
- Manques : (a) la vue ne rend que l'état COURANT ; les bracelets retirés (assignment libéré, bracelet `REPLACED`, `RETIRED`) disparaissent de la vue, donc `removed_token_hashes` d'un DELTA ne se déduit pas de la vue ; (b) `spendable` est calculé à la volée, coûteux à 50 000 lignes (seuil FULL 30 s) : vérifier les index/plans ; (c) la vue n'expose pas `other_block` du portefeuille (0042, `wallet.other_block`) : voir 1.4, point ouvert ; (d) un bracelet à deux portefeuilles produit une ligne par grand livre (voulu).

**`snapshot_signing_key`** (S:2291-2309). `key_id` PK, `operator_id` (NULL = plateforme), `owner CENTRAL|EDGE`, `edge_gateway_id`, `algorithm IN ('ECDSA_P256_SHA256','Ed25519')`, `public_key`, `kms_key_ref`, `status PENDING|ACTIVE|RETIRED|REVOKED`, `created_at`, `retired_at`. Index unique partiel : une seule clé ACTIVE par signataire (owner, operator, gateway). RLS : lecture des clés de la plateforme (operator NULL) par tous, écriture limitée au prestataire. `cashless_app` a INSERT/UPDATE direct sur cette table (non retiré) : il peut donc créer/retirer des clés de son prestataire. FR-009 « au plus deux clés publiques valides par signataire » : NON garanti (index = une ACTIVE ; une ACTIVE + plusieurs RETIRED/PENDING non bornées ; rien ne dit qu'une RETIRED reste « valide »). `kms_key_ref NOT NULL` pour CENTRAL : le faux KMS simulé doit fournir une référence.
- À faire : fonction de rotation DEFINER (PENDING -> ACTIVE, ancienne ACTIVE -> RETIRED) et retrait de l'écriture directe ; borne « 2 clés valides » en contrainte/déclencheur.

**`offline_policy_history`** (S:2381-2398) + **`bump_offline_policy_version()`** (S:2402) + **`log_offline_policy()`** (S:2411-2421). Historique : `id bigserial`, `policy_id`, `scope_type`, `scope_id`, `version`, `deleted`, valeurs, `updated_by`, `valid_from`; `UNIQUE (policy_id, version)`; immuable. `bump_offline_policy_version` (BEFORE UPDATE, INVOKER) fait `NEW.version := OLD.version + 1; NEW.updated_at := now()` : donc l'application ne choisit pas la version de la politique, mais elle choisit l'historique. `log_offline_policy` (AFTER INSERT/UPDATE/DELETE, INVOKER, `search_path` non fixé) écrit la ligne avec les droits de l'appelant ; sur DELETE écrit `version + 1` avec `deleted=true`.
- C'est exactement OP-N58 : `cashless_app` a INSERT/UPDATE sur `offline_policy_history`, peut y planter `(policy_id, version)` en avance. Condition de levée : passer `log_offline_policy` en DEFINER (`SET search_path = public, pg_temp`), retirer INSERT/UPDATE à `cashless_app`. Un `CREATE OR REPLACE FUNCTION log_offline_policy()` en migration suffit (les déclencheurs gardent leur lien). Un DEFINER qui écrit sans `assert_tenant` est correct ici (le déclencheur s'exécute sur une ligne déjà visible par RLS) ; mais le propriétaire ignore la RLS : vérifier que `NEW.operator_id` est celui de la session, sinon une ligne `offline_policy` d'un autre prestataire (impossible sous RLS pour l'app) ne pose pas de problème.
- Bémol : `valid_from` = `clock_timestamp()` du moment de l'écriture, pas `updated_at` : cohérent.
- Test existant à inverser : `tests_definer_trigger_writers.sql:187` (`NOT prosecdef` de `log_offline_policy`).

**`device_config_served`** (S:2427-2442) + **`record_config_served(p_device, p_config_version)`** (S:2447 ; REMPLACÉ par 0029). Table : `id bigserial` (c'est le `config_id`, entier), `device_id`, `config_version_id`, `policy jsonb`, `policy_sha256`, `authority_epoch`, `next_seq_floor`, `terminal_settings jsonb`, `served_at`. Immuable. Écrit uniquement par la fonction (`post-roles.sql:232`, INSERT/UPDATE retirés à l'app). La fonction renvoie la dernière ligne si la politique, l'époque, le plancher, la version de configuration et les réglages sont identiques : `config_id` stable (FR-005). Elle est accordée à l'app (`post-roles.sql:477`) et déjà appelée par `apps/api/src/devices/config/device-config.service.ts` (qui sert `offline_policy` à `:232`).
- **`0029_config_served_guard.sql`** (75 lignes) : remplace la fonction à signature identique. Ajoute : (1) terminal `REVOKED` -> 42501 ; `SUSPENDED` garde sa configuration ; (2) `p_config_version` non NULL : `assert_tenant` sur son prestataire (inconnue / autre prestataire / PLATFORM -> `no_data_found`) ; (3) ligne du terminal relue `FOR SHARE` ; `search_path = public, pg_temp`. Corps du reste identique.
- Écart : la comparaison de la dernière ligne se fait sur `policy` (jsonb) : si `effective_offline_policy` renvoie un champ nouveau (la mission en ajoute), tous les terminaux reçoivent un nouveau `config_id` au premier battement : acceptable mais à savoir. `policy_sha256 = sha256(pol::text)` : `jsonb::text` est canonique PostgreSQL, pas RFC 8785 ; ne pas l'exposer comme empreinte de protocole sans accord avec `sync_protocol.md`.
- FR-005 (« la politique effective de chaque configuration servie ») : couvert. Manque : lier la configuration à la VERSION du snapshot (non nécessaire à `policy_in_force`).

**`policy_in_force(p_device uuid, p_config_id bigint) -> jsonb`** (S:2474-2483), DEFINER STABLE. Lit `device_config_served WHERE id = p_config_id AND device_id = p_device` ; rend le `policy` jsonb ; configuration inconnue ou d'un autre terminal -> `no_data_found` (P0002). **Non accordée à l'app.** Elle fait `assert_tenant(tenant_of_device(...))`. Pas de retour de `authority_epoch`/`served_at`, qui seront utiles pour le contrôle « snapshot connu, âge ».

**`device_seq_registry`** (S:1998-2018). PK `(device_id, seq)`, `seq bigint >= 1`, `content_sha256 bytea(32) | NULL`, `outcome IN ('ACCEPTED','ACCEPTED_WITH_SHORTFALL','DUPLICATE','REJECTED','VOID','WAIVED')`, `reason`, `transaction_id`, `channel IN ('ONLINE','BATCH','EDGE','WAIVER')`, `batch_id` (FK `offline_batch`), `created_by`, `approved_by`, `recorded_at`. CHECK : `WAIVED` <=> `channel WAIVER` <=> `content_sha256 NULL`, deux personnes distinctes et motif pour WAIVED ; `REJECTED` exige `reason` ; `ACCEPTED_WITH_SHORTFALL`/`DUPLICATE` exigent `transaction_id` ; `REJECTED/VOID/WAIVED` interdisent `transaction_id`. Immuable. INSERT/UPDATE retirés à l'app (`roles.sql:21-24`).
- Écart avec le protocole : l'issue `ACCEPTED` avec effet `NONE` (VOID, ONLINE_REF, FR-018) est une valeur `VOID` ici : `outcome='VOID'` existe. `ONLINE_REF` n'a pas d'issue propre (rangé sous `VOID` ou `ACCEPTED` sans `transaction_id` ? `ACCEPTED` n'interdit pas `transaction_id NULL` : OK). À trancher au plan : mapping outcome <-> « ACCEPTED, effet NONE » de l'API.

**`record_device_seq(p_device, p_seq, p_content, p_outcome, p_channel, p_tx, p_reason, p_batch)`** (S:2040-2074). DEFINER. Retourne `(replayed, outcome, reason, transaction_id, contiguous_acked_seq)`. Prend le terminal `FOR UPDATE` ; `assert_tenant` ; si le numéro existe : même `content_sha256` -> résultat mémorisé (`replayed=true`), autre empreinte -> **RAISE CL002** ; interdit `WAIVED`/`WAIVER` (CL001) ; `p_seq > contiguous + max_seq_jump()` -> CL021 ; vérifie le prestataire de `p_tx` ; INSERT ; `last_seq = greatest(...)`, `last_seen_at = now()` ; clôt `SEQ_GAP` ouvert du numéro ; appelle `advance_device_seq`. Accordée à l'app. Déjà appelée par les routes de paiement (5b) via `apps/api/src/payments/device-seq-registry.ts`.
- Piège FR-016 : l'exception CL002 annule la transaction de l'appelant. Pour « autre empreinte => REJECTED + anomalie `IDEMPOTENCY_CONFLICT` » (qui doit ÊTRE écrite), il faut soit une transaction séparée (modèle de `reject` côté 5b), soit une nouvelle fonction non levante (`record_device_seq_conflict` ou un paramètre). À trancher au plan.
- Piège « clé déjà écrite en ligne => DUPLICATE » : le registre mémorise `channel='ONLINE'` ; un rejeu par lot trouve `replayed=true` avec l'issue d'origine. Le mapping `DUPLICATE` est à faire côté lot, la base renvoie l'issue mémorisée (le CHECK `DUPLICATE` exige un `transaction_id`).
- Piège `p_seq` proche de 2^63 : `d.contiguous_acked_seq + max_seq_jump()` ne déborde pas, mais `open_offline_batch` calcule `p_seq_from + n - 1` : débordement `bigint` -> SQLSTATE 22003 (500). À borner côté API/DTO (voir 7).

**`advance_device_seq(p_device) -> bigint`** (S:2024-2038), INVOKER, **interne** (REVOKE à PUBLIC S:2897 et à `cashless_app` roles.sql:44). Avance `device.contiguous_acked_seq` à la fin de la plage continue. Appelant : verrou sur le terminal. Requête `min(r.seq) … NOT EXISTS (r2.seq = r.seq+1)` : coût proportionnel au nombre de lignes du registre > curseur ; correct mais à surveiller pour NFR-003 (500 opérations) : chaque `record_device_seq` rappelle `advance_device_seq`, soit 500 appels par lot.

**`device_missing_seqs(p_device, p_limit=1000) -> SETOF bigint`** (S:2077-2087). DEFINER STABLE. `generate_series(contiguous+1, last_seq)` sans ligne au registre. Non accordée à l'app. Bornée par `max_seq_jump` indirectement (un `last_seq` ne dépasse jamais contiguous + 10 000 + lots). Note : `generate_series` sur `bigint` hors plage : OK tant que la borne tient.

**`waive_seq_gap(p_device, p_seq, p_actor, p_approver, p_reason) -> bigint`** (S:2089-2112). DEFINER. Prend le terminal `FOR UPDATE`. CL012 si le numéro n'est pas un trou : `p_seq <= contiguous` OU `p_seq > last_seq` OU déjà au registre. CL010 si un lot `PROCESSING` couvre `p_seq`. Insère `WAIVED` (deux personnes, motif non nul par CHECK), ferme l'anomalie `SEQ_GAP`, appelle `advance_device_seq` et `advance_device_chain`. Retourne le nouveau curseur. Non accordée à l'app. NE FAIT PAS : vérifier que `p_actor`/`p_approver` sont `SUPERVISOR` (rôle, périmètre) ; vérifier le motif >= 10 caractères ; lier à une `approval_request` APPROVED ; refuser un terminal non lié (tout est par l'API) ; contrôler que `p_actor <> p_approver` autrement que par la CHECK du registre (qui l'applique : `approved_by <> created_by`). La condition `p_seq > last_seq` -> CL012 : un numéro « laissé sans ligne » par un corps non-objet (FR-033) n'est un trou que si un numéro plus grand a été reçu ensuite ; sinon il faut attendre. À confirmer par un test.

**`max_seq_jump()`** (S:1990) : IMMUTABLE, retourne `10000`. Utilisée par `record_device_seq` et `open_offline_batch`.

**`offline_batch`** (S:2119-2142). PK `id uuid` (choisi par le terminal), `device_id`, `ledger_id`, `received_via CENTRAL|EDGE`, `seq_from`, `seq_to`, `op_hashes bytea[]`, `prev_chain_hash`, `last_chain_hash`, `signature`, `status PROCESSING|COMPLETED|REJECTED`, `reject_reason`, `chain_status VERIFIED|PENDING|RESENT|UNVERIFIABLE|BROKEN`, `missing_seqs bigint[]`, `results jsonb`, `received_at`, `completed_at`. CHECK : `seq_to = seq_from + cardinality - 1`, 1 à 500 opérations, `REJECTED <=> reject_reason`, `COMPLETED <=> completed_at ET results`. Index unique partiel `offline_batch_one_in_flight (device_id) WHERE status='PROCESSING'` (un seul lot en vol, NFR-013 : garanti par la base). INSERT/UPDATE retirés à l'app (`roles.sql:21-24`).
- Manques : aucune colonne pour la taille en octets (1 Mio, FR-013) ; aucune colonne pour l'identité de l'importateur/`DEVICE_JOURNAL_IMPORT` (FR-035), ni pour distinguer un lot importé d'un lot reçu (`received_via` ne connaît que CENTRAL/EDGE) ; aucune colonne `ledger_id` vs terminal/événement cohérents.

**`open_offline_batch(p_batch, p_device, p_ledger, p_seq_from, p_prev_chain_hash, p_op_hashes, p_last_chain_hash, p_signature, p_via='CENTRAL') -> offline_batch`** (S:2183-2268). DEFINER. Ce qu'elle fait, dans l'ordre :
1. `assert_tenant` terminal et grand livre ; terminal `FOR UPDATE` ; REVOKED -> 42501 ; SUSPENDED non refusé.
2. Renvoi idempotent : le lot existe -> même terminal/`seq_from`/`op_hashes`/`prev_chain_hash` sinon CL002 ; sinon le lot tel quel (même `PROCESSING`).
3. CL011 si moins de 1 ou plus de 500 empreintes ; empreinte d'opération de longueur 32 sinon CL001.
4. **CL021** : `p_seq_from + n - 1 > contiguous + max_seq_jump()`.
5. **Abandon 15 min** : `UPDATE offline_batch SET status='REJECTED', reject_reason='ABANDONED' WHERE device_id = X AND status='PROCESSING' AND received_at < clock_timestamp() - 15 min` ; ensuite, s'il reste un lot `PROCESSING` -> **CL010** (BATCH_IN_PROGRESS). C'est donc géré (FR-030) mais : (a) l'abandon est AVANT la vérification du renvoi idempotent ? Non, après (2). Un renvoi du même `batch_id` PROCESSING plus vieux de 15 min retourne la ligne PROCESSING sans l'abandonner ; (b) l'abandon ne s'exécute QUE si un nouveau lot arrive (conforme au protocole) ; (c) les résultats déjà inscrits au registre sont conservés (le registre est immuable).
6. **Chaîne** : recalcule `hs[]` par `chain_step`, compare à `p_last_chain_hash` -> `BROKEN` ; `k = last_chain_seq - seq_from + 1` ; `k<0` -> `PENDING` ; `k >= n` -> `RESENT` ; sinon `expected` (dernière empreinte connue, ou `device_chain_genesis` si `last_chain_seq = 0`, NULL après un trou levé -> `UNVERIFIABLE`) comparée à `hs[k+1]`. Un lot `BROKEN` est inséré `REJECTED/CHAIN_BROKEN` + anomalie `CHAIN_BROKEN` (montant 0, `seq` = `seq_from`) SANS erreur SQL : l'API répond 409 CHAIN_BROKEN (FR-014). Aucune vérification de la SIGNATURE du lot (stockée telle quelle ; l'API la vérifie : `400 BATCH_SIGNATURE_INVALID`).
7. **Trous avant `seq_from`** : anomalies `SEQ_GAP` insérées (unicité `anomaly_seq_gap_once`), `missing_seqs` rempli (FR-031).
8. Insère le lot `PROCESSING`; si `VERIFIED/UNVERIFIABLE`, avance `last_chain_seq/last_chain_hash`, puis `advance_device_chain`.
- NE FAIT PAS : vérifier que `p_ledger` est un grand livre de l'événement du terminal ; fixer `last_seen_at` ; borner à 1 Mio ; refuser SUSPENDED (le protocole : à confirmer) ; comparer l'`authority_epoch` ; compter l'abandon dans une trace d'audit ; vérifier que `p_seq_from >= 1` autrement que par la CHECK de table (`seq_from >= 1`, erreur 23514 non traduite) ; protéger `p_seq_from + n - 1` d'un débordement `bigint` (22003).
- Anomalies de `CHAIN_BROKEN` : `ledger_id = p_ledger`, `amount 0`. Aucun lien vers le lot (pas de colonne `batch_id`).

**`complete_offline_batch(p_batch, p_results jsonb) -> offline_batch`** (S:2270-2286). DEFINER. `assert_tenant` sur le prestataire du lot (lot inconnu -> P0002 par `assert_tenant(NULL)`), verrou, déjà COMPLETED -> renvoi ; non `PROCESSING` -> CL001 ; refuse si un numéro du lot n'a pas de ligne au registre (invariant I2) ; passe `COMPLETED` avec `results`. Pas de contrôle de la forme de `results`.

**`advance_device_chain(p_device)`** (S:2149-2178), INVOKER interne : rattrape la chaîne, passe `PENDING` en `VERIFIED/UNVERIFIABLE/BROKEN` (+ anomalie `CHAIN_BROKEN` à `seq_from`), saute un numéro `WAIVED` en posant `last_chain_hash = NULL`.

**`event_sync_deadline(p_event) -> timestamptz`** (S:3062). DEFINER STABLE : `coalesce(event.ends_at, max(changed_at) du passage CLOSING) + sync_deadline_hours` (colonne `event.sync_deadline_hours`, défaut 72, 1 à 720, S:73). NULL tant que l'événement n'a ni fin ni CLOSING. Non accordée à l'app.

**`event_device_sync_status(p_event)`** (S:3079-3095). DEFINER STABLE. Retourne `(device_id, serial, caught_up, reason)`. Raisons : `NOT_SEEN_SINCE_CLOSING`, `SEQ_GAP` (curseur < last_seq, ou anomalie `SEQ_GAP` ouverte), `BATCH_IN_PROGRESS`. Exclut REVOKED et `personal_phone`. Utilisée par `set_event_status` (CL019, avant SETTLING) et 0008 `event_transition_conditions`.
- Lien FR-024 : « SETTLING ou au-delà => SYNC_DEADLINE_PASSED + LATE_OFFLINE_SYNC » : rien en base ne le fait. Il faut une fonction qui lit `event.status` du grand livre/événement (pas `event_sync_deadline` seul).
- FR-034 (alerte trous > 24 h) : aucune requête ni vue. `anomaly` a `created_at` : une vue/fonction sur `anomaly WHERE kind='SEQ_GAP' AND status='OPEN' AND created_at < now() - 24 h` suffit ; « une fois par trou » exige une colonne `alerted_at` ou une table d'alertes (non existantes).

### 1.3 Contenu de snapshot, FULL/DELTA : lacune structurelle

- La base ne contient pas : (a) le contenu par version (entrées, retraits) ; (b) les mots de passe de bracelet enveloppés par terminal (FR-010) ; (c) la liste des terminaux/clés d'accord ayant reçu une version ; (d) l'accusé par terminal hors du seul `device.last_snapshot_version`.
- `device.last_snapshot_version bigint` : seul suivi, `UPDATE` direct de l'app (voir 3.3), sans CHECK de monotonie, sans lien vers `offline_snapshot`.
- Choix à faire au plan : stocker par version une table de contenu (`offline_snapshot_entry(ledger_id, version, media_id, entry_sha256, removed bool)`) pour calculer un DELTA = différence entre deux versions, ou recalculer à partir de la vue en comparant des empreintes d'entrée tenues par version. Sans l'un des deux, un DELTA n'est pas faisable de façon fiable. Le DELTA doit aussi inclure les retirés (voir 1.2, vue).
- Les mots de passe enveloppés par terminal ne doivent pas être stockés en clair ; les générer à la demande (clé de contenu par version, enveloppée pour la clé d'accord du terminal, `device.agreement_public_key`, `bytea(65)`).

### 1.4 Autres points de la base utiles
- `wallet.other_block` (0042) : cause de blocage « autre » ; la vue `offline_snapshot_rows` expose `wallet_status` seulement. À vérifier : un portefeuille bloqué pour cause autre figure bien `BLOCKED` dans `wallet_status` (voir 0042 et `wallet_block_cause_guard`).
- Table des types d'anomalies : voir 4.

---

## 2. Migrations ultérieures qui ont touché ces objets

Recherche `grep` sur `migrations/` (hors 0001) des noms d'objets hors ligne :
- `0029_config_served_guard.sql` : seule migration qui REMPLACE un objet de la liste (`record_config_served`), détaillée en 1.2.
- `0008_event_ledger.sql:105,129-130` : utilise `event_sync_deadline` et `event_device_sync_status` dans `event_transition_conditions` (condition `DEVICES_CAUGHT_UP`). Rien d'autre à reprendre.
- `0022_device_enrollment.sql:424-429` et `0035_enrollment_event_state.sql:210-215` : `enroll_device` (ré-enrôlement) recopie `last_seq`, `contiguous_acked_seq`, `next_seq_floor`, `last_chain_seq`, `last_chain_hash` depuis l'ancien terminal du même `serial`, avec un saut pour que `device_missing_seqs` ne liste pas de faux trous et que `max_seq_jump` ne bloque pas. À connaître : un terminal ré-enrôlé garde sa chaîne.
- `0022` : `record_device_heartbeat(uuid, text, timestamptz)` (DEFINER) écrit `last_seen_at = now()` et `app_version` : c'est déjà le chemin légitime de présence (mais le droit direct sur `last_seen_at` n'est pas retiré, voir 3.3).
- `0023_device_tokens_nonces.sql:309-340` : `assert_device_active` (DEFINER) ; règle d'ordre des verrous : appeler APRÈS `record_device_seq`/`waive_seq_gap`/`open_offline_batch` (qui prennent le terminal `FOR UPDATE`), sinon interblocage 40P01. `0023:31` précise que `open_offline_batch` renvoie 42501 pour un terminal révoqué (traduit `DEVICE_REVOKED`, `apps/api/src/errors/sqlstate-map.ts:65`).
- `0023` : `purge_device_request_nonces(int)` (lot 1 à 10000, `expires_at < now() - margin`, `FOR UPDATE SKIP LOCKED`).
- `0009`, `0011`, `0033`, `0038:1292-1300` : redéfinissent la CHECK `approval_request_action_check` (liste d'actions) : voir 5.
- `0038:1280-1288` : redéfinit `anomaly_kind_check` (liste des types) : voir 4.
- `0033_payments.sql:298` : `consume_tap(bigint, uuid)` remplacée (voir 6).
- `0036/0040` : sessions de caisse, garde de caisse (voir 6).
- Mission 5b, registre des numéros : aucune migration n'a modifié `device_seq_registry`/`record_device_seq` ; la logique est dans `apps/api/src/payments/device-seq-registry.ts` (`contentSha256`, forme canonique RFC 8785 via `canonicalize`, champs chaînés `occurred_at, amount, currency, tap, lines`). Le fichier dit : « La forme devra être celle des lots hors ligne (mission 7) ».
- Aucun `ALTER DEFAULT PRIVILEGES` dans aucune migration ni dans `roles.sql`/`post-roles.sql` (le mot n'apparaît que dans des commentaires, `post-roles.sql:16`).

Il n'y a pas de migration `0028` ; `0029:3` note « 0028 reste libre ».

---

## 3. Droits réels et dettes OP-N57, N58, N68, N69, N75

### 3.1 Rôles
- `roles.sql` (60 lignes) crée `cashless_app` (NOSUPERUSER, NOBYPASSRLS), accorde SELECT/INSERT/UPDATE sur toutes les tables et séquences, puis retire : INSERT/UPDATE/DELETE/TRUNCATE sur `journal_transaction, posting, account_balance, ledger_seal, device_seq_registry, edge_sync_registry, offline_batch, debit_authority_handover, event_status_history, media_tap` (`roles.sql:21-24`) ; UPDATE de `approval_request` (colonnes `status, executed_tx_id, failure_code, failure_reason`), de `ledger`, de `account` (sauf `is_active, hot`), de `anomaly` (sauf `status, resolution_tx_id`) ; DELETE/TRUNCATE partout ; EXECUTE sur toutes les fonctions puis retrait de 17 fonctions internes (`roles.sql:44-48`) dont `advance_device_seq` et `advance_device_chain`. Durées : `statement_timeout 30s`, `lock_timeout 5s`, `transaction_timeout 60s` (PG17).
- `post-roles.sql` (755 lignes) : §0 retire EXECUTE à PUBLIC et à `cashless_app` sur TOUTES les fonctions et TEMPORARY ; §1 `cashless_platform` ; §4a liste nommée d'EXECUTE pour `cashless_app` (lignes 266-505) ; §4b terminaux (lignes 515-548) ; §5 rôles des clés (`cashless_tagkeys, cashless_perso, cashless_tagcheck, cashless_keyadmin`, NOINHERIT) ; §6 mission 5b ; §7 mission 6 (7c EXECUTE, 7d REVOKE internes). Aucun rôle de maintenance n'existe.

### 3.2 Droits de `cashless_app` sur les objets hors ligne (état réel)
| Objet | Table/Fonction | Droit de `cashless_app` |
|---|---|---|
| `offline_policy` | table | SELECT, INSERT, UPDATE (RLS prestataire) ; DELETE retiré |
| `offline_policy_history` | table | SELECT, INSERT, UPDATE (OP-N58) |
| `offline_snapshot` | table | SELECT, INSERT, UPDATE (UPDATE refusé par le déclencheur) (OP-N57) |
| `snapshot_signing_key` | table | SELECT, INSERT, UPDATE (RLS écriture limitée au prestataire) |
| `offline_snapshot_rows` | vue | AUCUN (`REVOKE ALL`, post-roles.sql:196) |
| `device_config_served` | table | SELECT seulement (post-roles.sql:232) |
| `device_seq_registry`, `offline_batch` | tables | SELECT seulement |
| `anomaly` | table | SELECT, INSERT (non borné !), UPDATE (status, resolution_tx_id). Constat repris en fin de post-roles.sql:754-755 |
| `approval_request` | table | INSERT, UPDATE (status, executed_tx_id, failure_*, result) |
| `record_device_seq`, `record_config_served` | fonctions | EXECUTE |
| `open_offline_batch`, `complete_offline_batch`, `waive_seq_gap`, `device_missing_seqs`, `policy_in_force`, `effective_offline_policy`, `event_sync_deadline`, `event_device_sync_status`, `check_offline_snapshot`, `log_offline_policy` | fonctions | AUCUN EXECUTE (donc `grep` de `tests_media_roles.sql:68` confirme `open_offline_batch` refusée aux rôles des clés) |
| `advance_device_seq`, `advance_device_chain`, `set_debit_authority`, `tenant_of_*` | internes | REVOKE explicite |

`cashless_app` garde un INSERT direct non borné sur `anomaly` : une session compromise peut fabriquer des anomalies (fausses alertes) ; à fermer dans la mission si on veut que « toute anomalie vient d'une fonction » (voir 4).

### 3.3 État précis des cinq dettes

**OP-N57** (`POINTS_OUVERTS.md:325`). État : `INSERT` direct sur `offline_snapshot` non retiré. Rien dans `apps/api/src` n'écrit la table. Levée = fonction DEFINER `publish_offline_snapshot(...)` qui calcule `version = max+1` sous verrou et `REVOKE INSERT, UPDATE ON offline_snapshot FROM cashless_app` dans `post-roles.sql` ; test : un INSERT direct est refusé (42501) et une version « géante » ne peut plus être posée. Test à étendre/inverser : `tests_definer_trigger_writers.sql:162-188` (liste exacte INSERT/UPDATE de `cashless_app` -> doit devenir vide).

**OP-N58** (`:349`). État : `log_offline_policy` INVOKER, INSERT/UPDATE sur `offline_policy_history` de l'app. Levée = `CREATE OR REPLACE FUNCTION log_offline_policy() ... SECURITY DEFINER SET search_path = public, pg_temp` + `REVOKE INSERT, UPDATE ON offline_policy_history FROM cashless_app` ; test : ligne insérée directement refusée ; une modification de politique écrit toujours son historique (y compris sous le rôle `cashless_app`, ce qui prouve que le DEFINER fonctionne). Test à inverser : `tests_definer_trigger_writers.sql:187`. Remarque : `bump_offline_policy_version` reste INVOKER (écrit seulement la ligne modifiée) : correct.

**OP-N68** (`:594`). État : aucun `ALTER DEFAULT PRIVILEGES`. Seule la première assertion de `tests_execute_grants.sql` §4 (lignes 227-250, `wp07_future_probe`) borne la limite : elle affirme que la fonction créée à la main EST exécutable par PUBLIC jusqu'au rejeu ; elle doit s'inverser. Levée (FR-038) : `ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (forme GLOBALE, sans `IN SCHEMA`), posée dans `post-roles.sql` (dynamique : `FOR ROLE current_user` dans un `DO`/`format`) ou en migration 0043. Impacts réels vérifiés :
  - Les suites créent `pgtap` par `CREATE EXTENSION IF NOT EXISTS pgtap` AVANT les assertions, sous le propriétaire ; avec le défaut global, les fonctions de pgtap (schéma `public`) perdent EXECUTE pour PUBLIC. 34 des 41 fichiers de `tests/` font `SET [LOCAL] ROLE cashless_*` ; elles appellent `is()`, `ok()`, `throws_ok()` après le changement de rôle : elles échouent (42501) sans `GRANT EXECUTE` explicite.
  - 25 de ces suites créent des fonctions `pg_temp.*` (`pg_temp.id()`, `pg_temp.a()`…) appelées sous le rôle : le défaut global les atteint aussi (schéma `pg_temp` du propriétaire).
  - Stratégie à évaluer (non testée ici) : après `CREATE EXTENSION pgtap`, un `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC` ne convient pas (casserait les assertions du §1 de `tests_execute_grants.sql`) ; plutôt accorder pgtap nommément aux rôles de test, ou factoriser un fichier `tests/_helpers.sql` inclus par `\ir` qui accorde `pg_temp` + pgtap. À mesurer avant de figer. Le commentaire du porteur (20/10/2026) mentionne exactement ces deux dépendances (`post-roles.sql:14-18`).
  - Le test `apps/api/test/integration/transverse/migrate-rights.spec.ts` couvre déjà « série et droits dans une même transaction » ; il restera valable.

**OP-N69** (`:621`). Colonnes de `device` modifiables aujourd'hui par `cashless_app` : `GRANT UPDATE (station_name, last_snapshot_version, last_seen_at, next_seq_floor)` (`post-roles.sql:533-535`, après `REVOKE INSERT, UPDATE ON device`). Test borne : `tests/tests_device_rights.sql §1` (« liste exacte »). Usage réel dans `apps/api/src` : AUCUNE écriture directe sur `device` (grep `UPDATE device` vide) ; `last_seen_at` est écrit par `record_device_heartbeat` (DEFINER, 0022:521), `station_name` et `next_seq_floor` par `enroll_device`/`create_device_enrollment_code`/`set_device_status` (DEFINER). `last_snapshot_version` n'a aucun écrivain. Donc les quatre `UPDATE` peuvent être retirés SANS casser l'API actuelle ; la mission ajoute :
  - `ack_offline_snapshot(device, version)` : écrit `last_snapshot_version` seulement si `version <= max(offline_snapshot.version)` du grand livre du terminal ET `version >= last_snapshot_version` (jamais de baisse) ;
  - `set_device_next_seq_floor(device, floor)` : plancher qui ne descend jamais (`greatest`), borne haute `<= last_seq + max_seq_jump()`, ou calcul interne à `record_config_served`/`enroll_device` ;
  - présence : réutiliser `record_device_heartbeat` (heure de la base), retirer `UPDATE last_seen_at` ;
  - `set_device_station_name(device, text, actor)` (borne de longueur 200, `assert_tenant`, terminal non révoqué) ;
  - `personal_phone` et `app_mode` : déjà non modifiables (5b WP07) ; FR-039 les cite : à vérifier que leur écrivain légitime existe (les ré-écrit `enroll_device` seul).
  - `REVOKE UPDATE ON device FROM cashless_app` complet, `tests_device_rights.sql §1` passe à liste vide ; `tests_media_roles.sql`/`tests_enrollment_*` : revérifier. Note : `cashless_tagkeys` a UPDATE de colonnes de `device` (`post-roles.sql:294`, liste « cert_sha256, os, nfc_enabled… ») : hors périmètre mais à relire.
  - Interblocage : la fonction qui lit puis écrit `device` doit prendre le terminal `FOR UPDATE` en premier (règle de 0023).

**OP-N75** (`:764`). Purges : `purge_device_request_nonces(integer)` et `purge_device_enrollment_attempts()` (DEFINER, sans prestataire, heure de la base) sont accordées à `cashless_app` (`post-roles.sql:472`). Appelant unique : `DevicePurgeWorker` (`apps/api/src/device-identity/device-maintenance.ts:32-72`), via `tx.withoutTenant` sur la connexion de l'API publique (`DATABASE_URL_APP`) ; le module `DeviceMaintenanceModule` est importé par `devices.module.ts:6,17` ; intervalle `DEVICE_PURGE_INTERVAL_SECONDS`, lot `NONCE_PURGE_BATCH`. Levée (FR-040) :
  - Nouveau rôle `cashless_maint` (LOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT) créé dans `post-roles.sql` (comme les rôles des clés, §5, ligne 260) avec `GRANT EXECUTE` sur ces deux purges SEULEMENT (+ `TEMPORARY` retiré, ajout à la liste de la boucle ligne 578) ;
  - `REVOKE EXECUTE` des deux purges à `cashless_app` (retirer de la liste §4a) ;
  - `config.ts` : nouvelle URL `DATABASE_URL_MAINT` (modèle : `DATABASE_URL_TAGKEYS`, `apps/api/src/config/config.ts:168`) ; un point d'entrée de processus dédié (modèle : `main.tag-check.ts`) ; le travailleur `device-purge` quitte le registre de l'API publique ; test unitaire qui refuse la production sans l'URL ;
  - pgTAP : `tests_execute_grants.sql` (liste figée de `cashless_app` sans les purges + liste du nouveau rôle) ; `tests_device_purge_window.sql` doit s'exécuter sous `cashless_maint` (aujourd'hui sous `cashless_app`) ; garder les bornes de fenêtre ; `tests_media_roles.sql` (le rôle ne fait rien d'autre).
  - La purge s'exécute sans `app.operator_id` : DEFINER + RLS FORCE : à confirmer que le propriétaire ignore la RLS (même hypothèse que 0022/0036).
  - OP-N78 (essais de PIN sans purge, `vendor_pin_check`) relève du même rôle de maintenance mais est reportée à la mission 13 : ne pas l'ajouter sans accord.

### 3.4 Tests de droits existants à étendre
- `tests/tests_execute_grants.sql` : listes figées par rôle (§2 ; `record_device_seq` ligne 115) ; §4 (limite OP-N68) à inverser. Ajouter : les nouvelles fonctions de la mission et le rôle de maintenance.
- `tests/tests_device_rights.sql` : §1 colonnes de `device` (OP-N69) ; nonces/essais.
- `tests/tests_definer_trigger_writers.sql` : §3 (`offline_snapshot`, `offline_policy_history`, lignes 162-188) -> inverser ; §4 (`search_path` des déclencheurs DEFINER) couvrira `log_offline_policy`.
- `tests/tests_definer_search_path.sql` : toute fonction DEFINER de la mission.
- `tests/tests_device_purge_window.sql` : rôle `cashless_maint`.
- `tests/tests_media_roles.sql:68` : liste des fonctions de l'API refusées aux rôles des clés : y ajouter les nouvelles.
- `tests/tests_config_served_guard.sql` : `record_config_served`.
- `tests/tests_cash_psp_rights.sql`, `tests_payment_rights.sql` : modèle de « liste exacte » de droits par colonne/fonction.

---

## 4. Anomalies

### 4.1 Types existants
`anomaly.kind` est une CHECK (pas un enum, pas une table de types), redéfinie en dernier par `0038:1280-1288`. Liste actuelle : `OFFLINE_SHORTFALL, COUNTER_DUPLICATE, COUNTER_TIME_INVERSION, UID_MISMATCH, RETIRED_IDENTITY, SEQ_GAP, CHAIN_BROKEN, CLOCK_SKEW, VOID_CONFLICT, ONLINE_CONFIRMED_MISSING, IDEMPOTENCY_CONFLICT, NON_COMPLIANT_OPERATION, PERIOD_CLOSED_OPERATION, LATE_OFFLINE_SYNC, SIGNATURE_MISMATCH, CASH_TOPUP_OVER_LIMIT, CASH_DIFF, PSP_MISMATCH, PSP_TOPUP_OVER_LIMIT, EDGE_REPLAY_FAILED, LATE_CHARGEBACK, CARD_VELOCITY, PSP_TOPUP_NOT_CREDITED`.
Les 12 types demandés (OFFLINE_SHORTFALL, SEQ_GAP, CHAIN_BROKEN, CLOCK_SKEW, SIGNATURE_MISMATCH, NON_COMPLIANT_OPERATION, PERIOD_CLOSED_OPERATION, LATE_OFFLINE_SYNC, CASH_TOPUP_OVER_LIMIT, IDEMPOTENCY_CONFLICT, VOID_CONFLICT, ONLINE_CONFIRMED_MISSING) y sont TOUS. Aucun type n'est à ajouter pour la liste de la spec. À examiner : une recharge espèces hors ligne REJETÉE faute de session (FR-028) « porte le montant » : quel type ? Le plus proche est `NON_COMPLIANT_OPERATION` (montant > 0, partie porteuse) ; sinon un type nouveau (ex. `CASH_TOPUP_NO_SESSION`) : décision du plan. Un nouveau type = `DROP/ADD CONSTRAINT anomaly_kind_check` en migration (modèle 0038).

### 4.2 Colonnes de `anomaly` (S:837-866)
`id, operator_id, ledger_id (NULL permis), kind, media_id, device_id, seq, created_at, transaction_id, amount NOT NULL, status OPEN|RESOLVED, resolution_tx_id`. CHECK : `amount = 0 OR ledger_id IS NOT NULL` ; `CASH_TOPUP_OVER_LIMIT` exige `media_id` et `amount > 0`. Index unique `anomaly_seq_gap_once (device_id, seq) WHERE kind='SEQ_GAP'`. Déclencheur `anomaly_cash_due_guard` (CL020). 0038 ajoute `anomaly_psp_topup_not_credited`.
- Il n'y a PAS de colonne : partie porteuse de la perte, raison/détail, lot d'origine, `occurred_at` de l'opération, ni `metadata`. Pour FR-020/FR-023 (« partie porteuse »), FR-025 (original dans `metadata.device_occurred_at` — c'est sur la TRANSACTION, `journal_transaction.metadata` existe, S:455), FR-028 (montant à régulariser), il faut au minimum : `loss_bearer text CHECK (loss_bearer IN ('PLATFORM','OPERATOR','ORGANIZER','MERCHANT'))` et idéalement `detail jsonb`/`batch_id uuid`. Recommandation : une migration `ALTER TABLE anomaly ADD COLUMN loss_bearer …, ADD COLUMN detail jsonb`. `cashless_app` n'aurait pas de GRANT UPDATE sur ces colonnes (seuls `status, resolution_tx_id`).

### 4.3 Comment trouver la partie porteuse
- Terminal : `device.provided_by IN ('PLATFORM','OPERATOR','ORGANIZER','MERCHANT')`, défaut `OPERATOR` (S:158) — « désigne qui porte la perte d'une opération non conforme (ADR-58) ».
- Contrat : `contract.offline_loss_bearer IN ('ORGANIZER','OPERATOR')` pour `OPERATOR_ORGANIZER` (S:106, 113 : obligatoire pour ce type de contrat). S:517 (commentaire de `post_transaction`/scénario transaction 25) : la part non couverte suit « le porteur de perte contractuel ». Deux sources : `provided_by` (non-conformité) et `offline_loss_bearer` (déficit de solde). À ne pas fusionner sans lire `sync_protocol.md` §7.2 ; le moteur de référence (`moteur_ecritures_reference.py`) et le scénario 25 font foi.
- Aucune fonction d'ouverture d'anomalie hors ligne n'existe (liste des `INSERT INTO anomaly` : `register_tap` S:984-1056, `open_offline_batch` / `advance_device_chain` S:2160-2253, 0036:476 et 0036:627 (`open_cash_due_anomaly`, DEFINER, accordée), 0038:944 et 1132). Hors `open_cash_due_anomaly`, aucune fonction accordée à l'app ne crée une anomalie : l'app le ferait par INSERT direct.
- Recommandation : `open_offline_anomaly(p_ledger, p_kind, p_device, p_media, p_seq, p_tx, p_amount, p_bearer, p_detail)` DEFINER, idempotente (clé : type + terminal + numéro + transaction), liste fermée des types permis, `assert_tenant`, puis `REVOKE INSERT ON anomaly FROM cashless_app` (ferme le constat de fin de `post-roles.sql`).
- Pour clore : `anomaly.status` seul modifiable par l'app (`UPDATE (status, resolution_tx_id)`); la réduction d'une anomalie liée par une annulation hors ligne (FR-021) n'est pas possible aujourd'hui (pas de colonne montant modifiable : `amount` n'est pas dans le GRANT) : une fonction DEFINER est nécessaire.

---

## 5. Approbation à deux : ajouter une action

- Table `approval_request` (S:2907-2929) : colonne `action text` avec une CHECK **nommée** `approval_request_action_check` (liste fermée). Les deux actions de la mission, `WAIVE_SEQ_GAP` et `DEVICE_JOURNAL_IMPORT`, sont DÉJÀ dans la liste depuis le schéma de référence (et recopiées par 0009, 0011, 0033, 0038). La dernière redéfinition est `0038_psp_topups.sql:1291-1300` (liste étendue : EVENT_GO_LIVE, EVENT_SETTINGS_CHANGE, … CASH_DEPOSIT). Aucune migration n'est nécessaire pour ces deux actions.
- Pour ajouter une autre action : `ALTER TABLE approval_request DROP CONSTRAINT approval_request_action_check; ADD CONSTRAINT … CHECK (action IN (… liste complète …))` en migration, en recopiant TOUTE la liste courante (0038) ; une liste incomplète supprime des actions silencieusement.
- Contrôles en base : `approval_request_guard` (CL023 : contenu figé ; passages PENDING -> APPROVED|REJECTED|EXPIRED ; APPROVED -> EXECUTED|FAILED) ; `decide_approval_request(p_id, p_approver, p_approve, p_note)` (DEFINER ; `assert_tenant` ; demandeur différent de l'approbateur ; expiration 24 h). La base NE contrôle PAS le rôle (`SUPERVISOR`), le périmètre ni le contenu du `payload` : c'est le travail de l'API (module `apps/api/src/approval/`). L'exécution de l'action (appel de `waive_seq_gap`) est faite par l'API après approbation, et marque `EXECUTED/FAILED` (`result jsonb`, colonne ajoutée par `post-roles.sql:47` — vérifier la migration d'origine).
- FR-032 « contrôles CL010 et CL012 à la demande et à l'exécution » : à la demande, il faut une fonction de PRÉ-VÉRIFICATION sans effet (`waive_seq_gap` écrit, elle ne peut pas servir). Recommandation : `check_seq_gap_waivable(p_device, p_seq)` DEFINER STABLE qui reprend les deux tests de `waive_seq_gap` (CL012, CL010), accordée à l'app.
- FR-035 `DEVICE_JOURNAL_IMPORT` : le `payload` contient le journal (jusqu'à plusieurs lots de 500) ; `approval_request.payload jsonb` n'a pas de borne de taille : à surveiller. Le seul garde-fou « terminal REVOKED » est à écrire (fonction `assert_device_revoked` ou contrôle dans `import_device_journal`).
- Test de modèle : `tests/tests_approvals.sql` ; `tests/tests_cash_psp_rights.sql` pour les actions de la mission 6.

---

## 6. Garde de caisse (ADR-132, 0036), `post_transaction`, passages, plafond

### 6.1 Trouver la session qui couvre une heure
- Table `cash_session` (0036:97-130) : `cash_session_id, operator_id, ledger_id, event_id, device_id, cash_account_id, opened_by, opened_at, status OPEN|CLOSING|CLOSED, closed_by, closed_at, counted_amount, expected_amount, close_tx_id, cash_diff_anomaly_id`. Index uniques partiels : une session `OPEN|CLOSING` par caisse (`cash_account_id`) et par terminal (`device_id`). Une session passée reste en table (`CLOSED`, `closed_at`).
- Requête de couverture à écrire : `WHERE device_id = $1 AND opened_at <= $t AND (closed_at IS NULL OR $t < closed_at)`. Décision du porteur (fiche) : session « encore ouverte » -> rattacher ; si fermée ou absente -> REJECTED. `CLOSING` : la garde accepte seulement `CASH_CLOSE` (0036:508-513) : une recharge hors ligne dont la session est `CLOSING` est donc refusée par la garde (CL029) ; le plan doit dire si c'est un REJECTED (anomalie portant le montant) — recommandé, il n'y a pas d'autre cas. Il n'existe AUCUNE fonction « session couvrant `t` » aujourd'hui (`cash_session_usable(session, ledger)` prend un identifiant et exige `OPEN` et le même grand livre ; INTERNE, jamais accordée).
- Pas d'index sur `(device_id, opened_at)` : seulement `cash_session_list_idx (operator_id, event_id, opened_at)` et l'unique partiel sur `device_id` pour OPEN|CLOSING. La requête sur sessions fermées d'un terminal est un balayage sur l'index (operator, event, opened_at) : acceptable (peu de sessions) mais à vérifier.
- Heure de la session : `opened_at` = `clock_timestamp()` de la base. L'heure `occurred_at` du terminal est corrigée avant (FR-025). Si `occurred_at` < `opened_at` (horloge avancée du terminal, ou opération faite avant l'ouverture en ligne), pas de session couvrante : REJECTED. Décision du porteur : conforme.
- `posting_cash_desk_guard` (0036:500-527, BEFORE INSERT ON `posting`, DEFINER) : pour tout `posting` sur un compte inscrit dans `cash_desk` : cherche la session `OPEN|CLOSING` du compte (heure courante, pas datée) ; OPEN : transaction autre que `CASH_CLOSE` ET (`t.device_id IS NULL OR t.device_id = s.device_id`) ; CLOSING : seulement `CASH_CLOSE` de clé `cash-close:<session>` ; sinon CL029. Conséquence : une recharge hors ligne dont la session couvrante est FERMÉE mais dont le terminal a ouvert UNE AUTRE session depuis passerait la garde et serait rattachée à la mauvaise session. La couverture à `occurred_at` doit donc être vérifiée PAR LA FONCTION de la mission (le DEVICE_ID de la transaction est vérifié, l'heure non). C'est l'écart central de FR-028 / NFR-014.
- `attach_cash_tx(p_session, p_tx)` (0036:554) : exige session `OPEN`, même grand livre, transaction avec ligne sur la caisse de la session ; idempotent ; autre session -> CL029. Accordée à l'app. Pas de variante « pour la session couvrant `t` ».
- `open_cash_due_anomaly(p_ledger, p_media, p_amount, p_tx)` (0036:589) : DEFINER, accordée : crée `CASH_TOPUP_OVER_LIMIT` (`media_id` obligatoire, `amount > 0`, transaction `TOPUP_CASH` du grand livre), idempotente par transaction (verrou consultatif). Utilisable pour la part en `L-ESP-A-RENDRE` du découpage (FR-027).

### 6.2 `post_transaction` et `OFFLINE_SYNC`
- Signature (S:510) : `post_transaction(p_ledger, p_type, p_key, p_occurred, p_source, p_lines jsonb, p_event, p_reverses, p_created_by, p_approved_by, p_config_version, p_device, p_media, p_metadata)`; DEFINER; **jamais remplacée** par une migration (grep).
- `p_source` : CHECK de table `journal_transaction.source IN ('ONLINE','OFFLINE_SYNC','EDGE_SYNC','PSP_WEBHOOK','BATCH','BACKOFFICE')` (S:444). `OFFLINE_SYNC` et `BATCH` existent tous deux : le plan doit choisir celui du protocole (la spec FR-019 dit `OFFLINE_SYNC`). La fonction : `assert_tenant`; idempotence par `(ledger_id, idempotency_key)` avec `request_hash` (CL002 si contenu différent) ; **`CLOSING` ne refuse que `p_source = 'ONLINE'`** pour `TOPUP, TOPUP_CASH, PURCHASE` (S:~571) : un `OFFLINE_SYNC` passe donc en CLOSING (voulu) ; `LOCKED` refuse tout sauf réclamations tardives `BACKOFFICE` ; **`locked_until` : `p_occurred <= lg.locked_until` -> CL005 PERIOD_CLOSED**, y compris `OFFLINE_SYNC` (FR-024 : OK, mais pas de `PERIOD_CLOSED_OPERATION` : l'anomalie est à ouvrir par la mission, et l'écriture de `post_transaction` lève une exception qui annule la transaction : appeler `post_transaction` dans un sous-bloc ou tester la période avant) ; autorité `EDGE` : refuse les débits de portefeuille si `p_source <> 'EDGE_SYNC'` (CL006, y compris pour `OFFLINE_SYNC`) ; contrôle des soldes (CL007 = `INSUFFICIENT_FUNDS`, sert au recalcul « au plus trois fois » de FR-019) ; plafonds réglementaires (`check_wallet_limits`, CL008, CL009).
- `idempotency_key` d'une opération : le protocole la veut `<série>:<numéro>`. `post_transaction` n'écrit pas dans le registre (`record_device_seq`) : l'appelant le fait dans la même transaction (NFR-011).
- `SYNC_DEADLINE_PASSED` (FR-024) : rien dans `post_transaction`. L'état de l'événement (SETTLING ou après) se lit sur `event.status`; `set_event_status` empêche le passage à SETTLING tant que des terminaux ne sont pas à jour AVANT `event_sync_deadline` (donc APRÈS la date, il autorise SETTLING même si des terminaux manquent) : c'est l'origine de `LATE_OFFLINE_SYNC`.
- `journal_transaction.metadata jsonb` existe : place pour `device_occurred_at`, `config_id`, etc. (FR-025). `journal_transaction` n'a pas de colonne `batch_id` ni `seq` : le lien se fait par la clé d'idempotence et `device_seq_registry.transaction_id`.

### 6.3 `register_tap` / `consume_tap` en source hors ligne
- `register_tap(p_operator, p_token_hash, p_uid, p_counter, p_occurred, p_device, p_mode, p_tx, p_online_tap, p_signature) -> (result, tap_id)` (S:964). `p_mode` : `media_tap.mode IN ('ONLINE','OFFLINE')` (S:346). En `OFFLINE` : `SIGNATURE_MISSING` n'est pas renvoyé en refus ; il ouvre une anomalie `SIGNATURE_MISMATCH` et GARDE l'opération (FR-026, première moitié) ; une signature différente met le bracelet en liste noire et ouvre `SIGNATURE_MISMATCH` (retour `SIGNATURE_MISMATCH`, deuxième moitié) ; UID différent : liste noire + `UID_MISMATCH` ; copie (même compteur) : `COUNTER_DUPLICATE`/`CLONE_SUSPECTED` ; lot inactif `BATCH_INACTIVE`, autre événement `WRONG_EVENT`. Elle réutilise une lecture déjà enregistrée en ligne (`p_online_tap`) ou répétée (même terminal/compteur/UID, jamais utilisée) : tap_id renvoyé. Accordée à l'app, déjà appelée.
- Elle n'applique pas la règle « bracelet bloqué APRÈS la vente » : elle renvoie `OK` ou `BLOCKED` selon l'état ACTUEL du bracelet (`m.status`). La comparaison à l'heure de la vente (FR-020 : blocage avant/après) est à faire par la mission avec `media_status_history` (existe, écrit par `log_media_status`, 0018) et `occurred_at`. À vérifier : colonnes de `media_status_history` (non lues ici).
- Elle ne contrôle pas le statut du terminal : appeler `assert_device_active` avant (0023:324). Elle fait `UPDATE media SET status='BLACKLISTED'` (liste noire) : ces `UPDATE` sont dans un DEFINER.
- `consume_tap(p_tap, p_tx)` : version courante = `0033_payments.sql:298` (corps 0026 + contrôle : un `device_id` de transaction différent de celui de la lecture -> CL022). Verrou consultatif par passage ; une lecture déjà utilisée par une autre écriture -> CL022 ; **expiration de `tap_replay_window_seconds` appliquée seulement si `tx.source = 'ONLINE'`** (0033:~330) : une opération `OFFLINE_SYNC` ou `BATCH` consomme son passage quel que soit le délai (conforme FR-019). EXECUTE retiré à PUBLIC; accordée à l'app.

### 6.4 `wallet_topup_headroom(p_wallet, p_occurred) -> bigint`
S:1848 ; DEFINER; accordée (`post-roles.sql:~290`); appelée par `apps/api/src/ledger/db/ledger-queries.ts:98`. Calcule la marge au regard du plafond de solde et du plafond mensuel du profil de législation (NULL = aucun plafond), selon le niveau KYC à la date `p_occurred`. VERROUILLE le solde du portefeuille jusqu'à la fin de la transaction (DB-I10) : à appeler dans la même transaction que l'écriture découpée. `p_occurred` = date corrigée de l'opération. Le découpage de FR-027 (portefeuille jusqu'à la marge, reste en `L-ESP-A-RENDRE`) est un travail du moteur côté API (la base fournit la marge et `open_cash_due_anomaly`).

---

## 7. Type des colonnes `seq` et grands numéros

- `device.last_seq bigint`, `device.contiguous_acked_seq bigint`, `device.next_seq_floor bigint CHECK >= 1`, `device.last_chain_seq bigint`, `device_seq_registry.seq bigint CHECK >= 1`, `offline_batch.seq_from/seq_to bigint`, `offline_batch.missing_seqs bigint[]`, `anomaly.seq bigint`, `device_config_served.next_seq_floor bigint`, `device_missing_seqs` rend `SETOF bigint`. Aucune colonne `integer` pour un numéro.
- Valeur maximale de la base : `2^63 - 1 = 9223372036854775807`. Le code applique cette borne : `MAX_DEVICE_SEQ = 9223372036854775807n` dans `apps/api/src/idempotency/device-key.ts:13` ; la clé `<serial>:<seq>` est lue par regex et `BigInt`, donc sans perte pour la clé d'idempotence en ligne.
- Où la précision se perd (FR-033, « > 2^53 sans perte ») : (1) `pg` renvoie les `bigint` en CHAÎNE : bon tant qu'on ne les convertit pas par `Number(...)` (voir `device-config.service.ts:246` qui fait `Number(s.next_seq_floor)` : à corriger) ; (2) le corps JSON d'un lot (`seq_from`, `seq` de chaque opération, `contiguous_acked_seq` en réponse) : `JSON.parse` convertit en `number` et perd la précision au-dessus de 2^53. Le contrat OpenAPI (`openapi.yaml`, `seq`) doit dire `integer` + `format: int64` et le serveur doit lire le texte brut du nombre (analyseur JSON qui garde les entiers non sûrs en texte/`BigInt`) ou refuser un numéro > 2^53 avec une erreur claire. Le fait que le registre passe `seq` en `bigint` jusqu'à `$2` est déjà acquis ; la voie d'entrée JSON est le point faible. (3) JCS (RFC 8785) : un nombre > 2^53 se sérialise par la conversion IEEE-754 : le `content_sha256` calculé sur un `seq` perdu serait faux ; décision à prendre avec `sync_protocol.md` §3.3 (le numéro est dans les champs chaînés `{seq, type, …}`).
- Dans SQL : `p_seq_from + n - 1` (`open_offline_batch`, S:2204 et insertion) et `d.contiguous_acked_seq + max_seq_jump()` peuvent déborder au voisinage de 2^63 (22003, 500). Ajouter un contrôle `p_seq_from <= 9223372036854775807 - 500` (ou la borne `contiguous + max_seq_jump`, déjà vérifiée sur le dernier numéro seulement après le calcul) AVANT l'addition.
- Le trou hérité (FR-033) : un corps en ligne non-objet laisse un numéro sans ligne (commentaire de `payments/device-seq-registry.ts:48` : `contentSha256` renvoie `null`). Ce numéro devient un trou dès qu'un numéro plus grand est reçu ; `waive_seq_gap` le traite (CL012 sinon). Aucun besoin de migration.

---

## 8. Dernier numéro de migration et nommage des tests

- Dernière migration : `migrations/0042_wallet_block_causes.sql` (liste : 0001 à 0027, 0029 à 0042 ; **0028 absent**, réservé libre selon `0029:3`). Mission 7 : `0043` et suivantes. Format : `00NN_<slug_snake>.sql`, en-tête de commentaire en français citant la mission, les FR, les ADR, les erreurs (modèle : `0036`, `0038`). Une migration ne doit contenir aucune instruction interdite en transaction (CREATE INDEX CONCURRENTLY, VACUUM, ALTER TYPE ADD VALUE suivi d'usage) car la série tourne dans une seule transaction.
- Tests pgTAP : `tests/tests_<sujet>.sql` (écrits à la main), lancés par `npm run test:pgtap -w @cashless/ledger-sql` (= `pg_prove` sur `tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`, puis `tests/*.sql`). Gabarit : `\set ON_ERROR_STOP 1; \set QUIET 1; BEGIN; SET LOCAL client_min_messages = warning; \ir ../roles.sql; \ir ../post-roles.sql; CREATE EXTENSION IF NOT EXISTS pgtap; SELECT no_plan(); … SELECT * FROM finish(); ROLLBACK;` avec helpers `pg_temp.id(text)` (UUID à partir d'un suffixe, préfixe propre à la suite) et `pg_temp.a()` (pose `app.operator_id`). Les suites rejouent `roles.sql` puis `post-roles.sql` dans leur transaction. Deux suites instables connues (mémoire locale) ; la base de test est `cashless_test` (Docker local, 5433).
- Suites de la mission précédente à imiter : `tests_cash_sessions.sql`, `tests_cash_psp_rights.sql`, `tests_psp_topups.sql`. Tests de l'API : `apps/api/test/integration/transverse/migrate-rights.spec.ts`.

---

## 9. Contradictions entre sources (à ne pas trancher ici)

1. `FR-009` « au plus deux clés publiques valides par signataire » vs schéma : une seule ACTIVE (index), ni borne ni notion de « valide » pour RETIRED.
2. `FR-004` (« l'historique par un déclencheur aux droits du propriétaire ») vs schéma de référence (INVOKER) : voulu, c'est la levée d'OP-N58.
3. Source `OFFLINE_SYNC` (FR-019) vs `BATCH` : les deux existent dans la CHECK de `journal_transaction.source` ; `device_seq_registry.channel` utilise `BATCH`. Le plan doit fixer qui est écrit où (fiche : `OFFLINE_SYNC` pour la transaction, `BATCH` pour le registre).
4. FR-018 « effet NONE, résultat ACCEPTED » vs registre `outcome='VOID'` : mapping à fixer.
5. FR-013 « 1 Mio » : aucune colonne/contrôle côté base ; seule la limite de 500 est dans la base (CHECK + CL011).
6. `OP-N69` (POINTS_OUVERTS) parle de « quatre colonnes » ; le code du `GRANT` correspond (station_name, last_snapshot_version, last_seen_at, next_seq_floor) : cohérent. `FR-039` ajoute `personal_phone` et `app_mode` : déjà non modifiables depuis 5b (WP07) ; vérifier le libellé de la spec.
7. `record_device_seq` lève CL002 en cas d'autre empreinte (S:2051), alors que FR-016 demande un `REJECTED (IDEMPOTENCY_KEY_REUSED)` écrit avec anomalie : incompatible avec une seule transaction.
8. Valeur par défaut du plafond d'âge : `effective_offline_policy` = 15 minutes (S:785) ; FR-001 : 900 s : identique.

---

## 10. Ce que la mission doit ajouter en base

Ordre proposé (une migration par thème ; chaque migration reposant `SET search_path = public, pg_temp` pour toute fonction DEFINER, `REVOKE ALL … FROM PUBLIC`, et ses GRANT dans `post-roles.sql`).

**0043 — snapshots : inscription par la base (OP-N57, FR-006/FR-009/FR-011)**
- `publish_offline_snapshot(...)` DEFINER : verrou sur le grand livre, `version = max+1`, mêmes contrôles que `check_offline_snapshot`, `assert_tenant`. Retourne la ligne.
- `ack_offline_snapshot(device, version)` DEFINER : `last_snapshot_version` seulement croissant, version existante pour le grand livre du terminal ; traite le terminal `FOR UPDATE` en premier.
- Table(s) de contenu par version (entrées, retraits, ou empreintes d'entrée par version) pour servir un DELTA ; fonction de lecture DEFINER de `offline_snapshot_rows` (la vue est fermée à l'app) incluant les retirés ; index pour 50 000 lignes (30 s).
- Rotation de clés de signature `rotate_snapshot_signing_key(...)` DEFINER, borne « deux clés valides » (FR-009), `REVOKE INSERT, UPDATE ON snapshot_signing_key FROM cashless_app`.
- `REVOKE INSERT, UPDATE ON offline_snapshot FROM cashless_app`.

**0044 — politiques hors ligne (OP-N58, FR-001 à FR-005)**
- `CREATE OR REPLACE log_offline_policy()` en SECURITY DEFINER (`search_path`).
- Fonction d'écriture `set_offline_policy(scope_type, scope_id, valeurs, actor)` DEFINER : contrôle de portée (organisateur/événement/terminal du prestataire), plafond du prestataire (`OPERATOR_CEILING` seul à écrire par la plateforme/prestataire), `capped`, suppression ; `REVOKE INSERT, UPDATE ON offline_policy, offline_policy_history FROM cashless_app`. (ou garder l'écriture directe de `offline_policy` si le plan l'accepte, avec CHECK/déclencheur de portée.)
- `offline_max_exposure(event)` (FR-003, risque maximal).
- Éventuellement `effective_offline_policy` : rendre lisible pour l'app (EXECUTE) ou exposer par une fonction DEFINER.

**0045 — lots, registre, trous (FR-013 à FR-016, FR-030 à FR-033)**
- Accorder (post-roles) : `open_offline_batch`, `complete_offline_batch`, `waive_seq_gap`, `device_missing_seqs`, `policy_in_force`, `effective_offline_policy`, `event_sync_deadline`, `event_device_sync_status` — ou les envelopper.
- `check_seq_gap_waivable(device, seq)` (pré-contrôle sans effet, FR-032).
- Variante non levante de `record_device_seq` pour l'autre empreinte (REJECTED + `IDEMPOTENCY_CONFLICT`) ou usage d'une transaction séparée (décision de plan).
- Correctifs de `open_offline_batch` si le plan les veut : protéger `p_seq_from + n - 1` du débordement ; refus du terminal SUSPENDED ; cohérence `p_ledger` / événement du terminal ; trace (audit) des lots reçus/refusés (FR-043) ; colonne `bytes`/contrôle de taille si la base doit porter le 1 Mio ; `received_via` + marque d'import (`IMPORT`) pour `DEVICE_JOURNAL_IMPORT` (FR-035) — attention : modifier une fonction du schéma de référence se fait par `CREATE OR REPLACE` en migration (jamais dans le `.sql` de référence) ET impose de reposer `SET search_path`.
- Fonction d'import `import_device_journal(...)` (FR-035) : terminal `REVOKED` exigé, sans `open_offline_batch`, une seule fois (clé = hachage du journal).
- Vue ou fonction `seq_gaps_older_than(interval)` + colonne/table d'alerte unique (FR-034).

**0046 — anomalies (FR-020, FR-023, FR-028)**
- `ALTER TABLE anomaly ADD COLUMN loss_bearer …, detail jsonb` (et éventuellement `batch_id`) ; type pour recharge rejetée sans session si le plan le veut (`DROP/ADD anomaly_kind_check`, liste complète de 0038 + nouveau).
- `open_offline_anomaly(...)` DEFINER idempotente ; `reduce_offline_anomaly(...)` pour FR-021 ; `REVOKE INSERT ON anomaly FROM cashless_app`.

**0047 — recharge espèces hors ligne et session couvrante (FR-027, FR-028, NFR-014)**
- `cash_session_covering(device, at)` DEFINER STABLE (OPEN couvrant) et une variante d'écriture qui rattache la transaction à CETTE session (comme `*_for_session`) ; index `cash_session (device_id, opened_at)` ; renforcer `posting_cash_desk_guard` pour qu'un `OFFLINE_SYNC` n'écrive que si `occurred_at` est couvert par la session OPEN (écart central, voir 6.1) ; test que la garde refuse une écriture hors couverture.

**0048 — terminal : écritures par fonctions (OP-N69, FR-039)**
- Fonctions listées en 3.3 ; `REVOKE UPDATE ON device FROM cashless_app` (et suppression du `GRANT UPDATE (…)` de `post-roles.sql:534`).

**0049 — maintenance et droits par défaut (OP-N75, OP-N68, FR-038, FR-040)**
- Rôle `cashless_maint` (dans `post-roles.sql`, pas en migration, comme les rôles des clés) ; `GRANT EXECUTE` des deux purges ; retrait à `cashless_app` ; `DATABASE_URL_MAINT` et processus dédié côté API.
- `ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (forme globale), après avoir adapté les 34 suites qui font `SET ROLE` (pgtap + `pg_temp`).
- Inverser `tests_execute_grants.sql §4`, `tests_definer_trigger_writers.sql §3`, `tests_device_rights.sql §1`, `tests_device_purge_window.sql` ; ajouter pour chacune des cinq dettes un test qui échoue si le droit s'élargit (FR-041). `docs/POINTS_OUVERTS.md` et `docs/DECISIONS_ADR.md` : consigner les levées.

**Fichiers à faire relire par une personne** (règle du porteur n°4) : `publish_offline_snapshot`, `rotate_snapshot_signing_key`, tout code touchant `snapshot_signing_key` et `kms_key_ref`, `post-roles.sql` (rôle de maintenance, `ALTER DEFAULT PRIVILEGES`), la fonction de chiffrement/enveloppe des mots de passe de bracelet (FR-010), `import_device_journal`.

**Faux en production** (règle n°2) : le faux de port de clés de signature doit être refusé au démarrage en production, test à l'appui (NFR-008). Côté base rien à ajouter ; côté `apps/api/src/kms/` voir le garde existant.
