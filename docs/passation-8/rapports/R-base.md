# R-base : état réel de la base pour la passerelle (mission 8)

Lecture seule, 05/11/2026. `S` = `packages/ledger-sql/schema_grand_livre_cashless.sql`,
`PR` = `packages/ledger-sql/post-roles.sql`, `RO` = `packages/ledger-sql/roles.sql`, `SP` = `docs/sync_protocol.md`,
`OA` = `packages/contracts/openapi.yaml`. Dernière migration : `0057` (`packages/ledger-sql/migrations/`) ; il n'y a pas de `0028`
(trou). Prochaine migration libre : **`0058`** (`migrate.ts:47-49`, tri par nom).

## 1. Inventaire S12 / S13

Toutes dans le schéma de référence `S`; aucune migration 0001-0057 ne les modifie (0008 et 0045 lisent `debit_authority` /
`edge_gateway_id`). Toutes `SECURITY DEFINER`, `search_path = public, pg_temp` (`migrations/0021_definer_search_path.sql:12`).

| Fonction (S) | Signature | Contrôles | Codes |
|---|---|---|---|
| `grant_edge_authority` S:2547-2577 | `(ledger, gateway, actor) -> debit_authority_handover` | `assert_tenant` ledger et passerelle ; verrou consultatif exclusif puis `ledger FOR NO KEY UPDATE` ; passerelle `ACTIVE` et `PRIMARY` ; même événement si ledger `EVENT` ; aucun handover ouvert et ledger `CENTRAL` ; appelle `set_debit_authority`, filigrane W = `max(posting.id)` ; insère `GRANTED` | CL013 |
| `ack_edge_handover` S:2579-2600 | `(handover, epoch, replicated_posting_id)` | tenant ; handover `TO_EDGE` et `GRANTED` ; époque = époque du handover = époque du ledger ; `replicated >= W` ; met à jour `last_replicated_posting_id`, `last_seen_at` ; `GRANTED -> ACTIVE` | CL013, CL015, CL014 |
| `fail_edge_grant` S:2602-2615 | `(handover, actor, reason)` | tenant ; `TO_EDGE` et `GRANTED` ; `set_debit_authority(CENTRAL)` ; `-> FAILED`. `p_actor` n'est pas utilisé (pas de trace de l'auteur) | CL013 |
| `request_edge_release` S:2617-2634 | `(ledger, actor)` | tenant ; un `TO_EDGE ACTIVE` existe ; pas de retour déjà demandé ; insère `TO_CENTRAL RELEASE_REQUESTED` (ledger reste `EDGE`) | CL013 |
| `complete_edge_release` S:2638-2667 | `(handover, epoch, final_edge_seq, last_chain_hash)` | tenant ; `TO_CENTRAL` en `RELEASE_REQUESTED` ou `RELEASING` ; époques ; `contiguous_edge_seq >= final` (sinon CL014) ; `contiguous = final` et chaîne = `last_chain_hash` (sinon CL017) ; `set_debit_authority(CENTRAL)` ; les deux handovers `COMPLETED` | CL013, CL015, CL014, CL017 |
| `force_central_authority` S:2670-2704 | `(ledger, actor, approver, reason)` | tenant ; acteur et approbateur non nuls et distincts, motif non vide (`check_violation`) ; ledger `EDGE` ; passerelle `REVOKED` ; `CENTRAL` ; handovers `FORCED`. Le contrôle « deux personnes » n'est que de distinction d'identifiants : la preuve d'approbation vient de l'API (`approval_request`) | CL013 |
| `set_debit_authority` S:1937-1951 | `(ledger, 'CENTRAL'/'EDGE', gateway?) -> epoch` | interne ; verrou exclusif ; époque +1 ; EDGE exige une passerelle | - |
| `record_edge_seq` S:2726-2756 | `(gateway, edge_seq, origin_key, content_sha256, outcome, tx?, reason?) -> (replayed, outcome, transaction_id, chain_hash)` | tenant ; `edge_gateway FOR UPDATE` ; rejeu identique renvoyé (`replayed`), contenu ou clé d'origine différents = CL002 ; `edge_seq <> contiguous+1` = CL016 ; chaîne `chain_step(last ou genèse, content)` ; met à jour `contiguous_edge_seq`, `last_chain_hash`, `last_seen_at`. **Ne contrôle ni le statut de la passerelle (une `REVOKED` passe), ni l'existence d'un handover `ACTIVE`/`RELEASING`, ni l'époque** | CL002, CL016 |

Tables : `edge_gateway` S:726-745, `debit_authority_handover` S:2491-2516 (7 statuts, CHECK direction/statut, index `handover_one_open`,
transitions S:2519-2528, trigger S:2541-2544, aucune suppression), `edge_sync_registry` S:2707-2724 (immuable, `UNIQUE (gateway_id,
origin_key)`, issues `ACCEPTED/ACCEPTED_WITH_SHORTFALL/DUPLICATE/REJECTED`). RLS activée et forcée sur les trois (S:2873-2882, S:899-906).

**Droits réels (après `RO` puis `PR`, rejoués par `migrate.ts`).**
- EXECUTE : `PR:22-23` retire tout à PUBLIC puis à `cashless_app` ; la liste nommée de `cashless_app` (`PR:413-516`, `PR:705-734`,
  `PR:841-873`) ne cite **aucune** fonction de bascule ni `record_edge_seq` (le commentaire `PR:407-412` le dit : « passerelle... n'est
  pas accordée : la mission qui l'appelle l'ajoute ici »). `tests/tests_execute_grants.sql` fige la liste exacte
  (`tests_execute_grants.sql:~195-200`) : tout ajout fait échouer la suite tant qu'elle n'est pas mise à jour.
  `set_debit_authority` et `tenant_of_gateway` sont explicitement refusées (`RO:45-50`, `S:2894-2901`).
- Tables : `RO:19-22` retire INSERT/UPDATE à `cashless_app` sur `edge_sync_registry` et `debit_authority_handover` ; `handover_transition`
  fermée (`PR:237`). **`edge_gateway` n'est dans aucune liste** : `RO:14-15` laisse à `cashless_app` SELECT, INSERT et UPDATE sur toutes
  les colonnes (grep `edge_gateway` dans `PR` = 0 ; `tests_offline_rights.sql:84-86` ne fait que lister la table). Voir §5, point 1.
  Aucun autre rôle `cashless_*` n'a de droit sur ces objets (`PR:100-114`, listes nommées).

**Tests pgTAP existants.** Seulement la suite du kit `tests_grand_livre_cashless.sql:495-545` (générée par `gen_tests.py`) : cycle grant,
ack, `record_edge_seq` (ordre, rejeu, contenu différent, clé d'origine dupliquée), release (CL014, CL017, succès), transition interdite,
force, fail, cloisonnement (535). Elle tourne sous le propriétaire ; l'assertion « fonctions de bascule exposées » (`:539-542`) utilise un
rôle `app_probe`, donc ne prouve rien sur `cashless_app`. Aussi `tests_event_ledger.sql:244-254` (RECONCILING refusé si EDGE, CL019).

**États et codes vs protocole §9 et contrat.**
- Conformes : GRANTED/ACTIVE/RELEASE_REQUESTED/RELEASING/COMPLETED/FORCED/FAILED = `OA:14649-14665` ; CL013 à CL017 mappés
  (`apps/api/src/errors/sqlstate-map.ts:23-27`) ; époque +1 par bascule = SP:578-579 et OA:6827-6859 ; filigrane = SP:596-606.
- **RELEASING jamais posé par la base** : SP:640-650 (« à réception, avant toute vérification, passe en `RELEASING` ») et
  OA:14657-14659 (« posé par l'API ») exigent un état persisté même quand la vérification échoue. `complete_edge_release` lève CL014 ou
  CL017 : la transaction s'annule, et aucune fonction n'écrit `RELEASING` (la transition existe dans `handover_transition`, S:2519-2528,
  mais `cashless_app` n'a pas UPDATE sur la table). Il faut une fonction dédiée (voir §2).
- **`TO_CENTRAL -> FAILED`** permis par la table de transitions mais sans fonction (SP:~671) ; statuts `ISOLATED` / `CATCHING_UP` (S:731)
  jamais posés (seul `force_central_authority` écrit `REVOKED`) ; `last_seen_at` n'est touché que par ack et `record_edge_seq`, alors que
  OA:6836-6838 fait du long-polling le battement de cœur.
- `edge_sync_registry.outcome` n'admet pas `VOID` ni `WAIVED` alors que `device_seq_registry` les admet (S:2003) et que
  `EdgeSyncOperation` hérite de `OfflineOperationType` (`VOID`, `ONLINE_REF` : OA:~14120-14127, 14416-14418).
## 2. Rôle de base pour les routes `/edge/*`

- Seul rôle applicatif public : `cashless_app` (`RO:8-11`). Les rôles de processus (`PR:254-262`, `PR:775-795`) sont dédiés, à liste
  d'EXECUTE figée par test. Aucun rôle `cashless_edge`. Le contrat place `/edge/*` sous `edgeMtls` (OA:6827-7040) ; aucun code
  ne retrouve une passerelle par certificat (`apps/api/src` ne cite `edge_gateway` que dans `devices/config/device-config.service.ts`).
- Lacunes de droits si l'on réutilise `cashless_app` : (a) EXECUTE à accorder sur `grant_edge_authority`, `request_edge_release`,
  `force_central_authority`, `fail_edge_grant` (routes humaines `POST /ledgers/{id}/debit-authority`, OA:6754-6826) et sur
  `ack_edge_handover`, `complete_edge_release`, `record_edge_seq` (routes passerelle) ; (b) mise à jour de `tests_execute_grants.sql` ;
  (c) retrait des INSERT/UPDATE directs sur `edge_gateway` ; (d) `tenant_of_gateway` reste refusée (bien).
- Lacunes fonctionnelles (nouvelles fonctions, migration 0058 ou suivantes, `SECURITY DEFINER`, `search_path = public, pg_temp`, EXECUTE
  retiré à PUBLIC, liste nommée dans `PR`) :
  1. identification d'une passerelle par `cert_sha256` avant toute session de prestataire (équivalent de ce que fait l'identité des
     terminaux) : `app.operator_id` doit venir de la passerelle ; aucune fonction n'existe ;
  2. `begin_edge_release(handover, epoch)` : pose `RELEASING` dans sa propre transaction, idempotente, avant `complete_edge_release` ;
  3. `fail_edge_release` (TO_CENTRAL -> FAILED) si le protocole l'exige (SP:~671) ;
  4. lien et battement : `touch_edge_gateway`, passage `ACTIVE/ISOLATED/CATCHING_UP` ;
  5. liaison passerelle/handover : `ack_edge_handover` et `complete_edge_release` ne reçoivent pas l'identité de la passerelle ; toute
     passerelle du même prestataire peut accuser ou rendre le handover d'une autre si seul le certificat TLS la distingue. Ajouter
     `p_gateway` (nouvelles signatures) ou des enveloppes qui comparent `h.edge_gateway_id` ;
  6. `edge_sync_batch` (table + fonctions) pour l'idempotence par `batch_id` et le stockage des résultats par `edge_seq` : les tables
     existantes sont liées à un terminal (`offline_batch.device_id` S:2121, `offline_op_result(batch_id)` `0046:193-200`) ;
  7. fonctions de lecture du flux de réplication (soldes paid/promo, statuts, bracelets, PWD chiffrés), absentes ; la lecture de
     `posting.id > after` devrait passer par une fonction étroite et non par un SELECT direct ;
  8. rôle séparé : voir §5, point 4 (recommandé : `cashless_edge`, EXECUTE limité aux fonctions ci-dessus plus celles d'écriture
     `EDGE_SYNC`).
## 3. Écriture `EDGE_SYNC`

- `post_transaction` (S:510-) : `source` admet `EDGE_SYNC` (S:444) ; sous `EDGE`, seuls les débits `EDGE_SYNC` sont admis (S:573-578) ;
  `CLOSING` ne refuse que la source `ONLINE` (S:566), donc `EDGE_SYNC` passe en `CLOSING`/`RECONCILING` comme voulu (SPEC:1223-1224).
  **Mais** la base n'impose rien d'autre à `EDGE_SYNC` : pas de `origin_key` / `origin_occurred_at` / `origin_mode` obligatoires en
  métadonnées (SPEC:413 le dit DOIT ; la fonction ne contrôle pas `p_metadata`), pas de lien avec une passerelle, un handover ou une
  époque. La source `EDGE_SYNC` est écrivable par tout appelant d'`post_transaction` (accordée à `cashless_app`, `PR:421`), y compris
  quand le ledger est `CENTRAL` ou après `FORCED`.
- Côté moteur TS (`apps/api/src/ledger/`) : `EDGE_SYNC` est reconnu (`types.ts:39`, matrice `status-matrix.ts:42`, découpage espèces
  `ledger-engine.service.ts:92`). Le constructeur de vente traite toute source ≠ `ONLINE` en mode hors ligne (`builders/festival/purchase.ts`,
  `mode: command.source === 'ONLINE' ? ...`), avec `coveredCap` (`purchase.ts:20`) : c'est l'attache naturelle de
  `edge_decision.charged_to_wallet`. **Manques** : le retour du manque (`shortfall`) n'est calculé que pour `OFFLINE_SYNC`
  (`ledger-engine.service.ts:231`) ; l'écrivain `offline-sale.writer.ts:95` code `source: 'OFFLINE_SYNC'` en dur et prend sa décision
  (`decide()`) de la table de conflit du central, pas de `edge_decision` ; aucun code ne lit `edge_decision`, `origin_key`, `authorized_mode`.
- Mission 7 : `complete_offline_batch` (`0046:390-414`), `offline_batch_retry` (`0046:143-177`), `record_offline_op_result` (`0046:475-495`)
  sont indexés par terminal et lot de terminal ; `received_via = 'EDGE'` (`0046:124`) désigne un lot de terminal relayé, pas un lot
  `EDGE_SYNC`. Le rejeu d'un `EdgeSyncBatch` doit donc écrire `edge_sync_registry` (par `edge_seq`) **et** `device_seq_registry` (canal
  `EDGE`, S:2006, `record_device_seq` `PR:502`), plus les lots de terminal relayés ; rien de cela n'est assemblé. Aucune table ne retient
  les résultats d'un lot de passerelle. `offline_batch_one_in_flight` (S:2143) peut faire entrer en conflit (CL010) un lot relayé et un lot direct.
  La trace RETRY (ADR-139) ne vaut que pour un CL007 de lot de terminal.
- `activate_media` (S:1336-1360) : ni source ni clé d'origine ; n'écrit au grand livre que `preload_media` (source `BATCH`, S:1110-1128) ;
  contrôle `activation_modes` (CL020). Le rejeu d'un bracelet déjà actif dépend des triggers de transition (à vérifier au plan).
- `take_deposit` (S:1596-1620) : source `'ONLINE'` codée en dur, clé `deposit:<media>:<n>`, `now()` comme heure. `take_deposit` n'est
  **plus accordée** à `cashless_app` ; l'API passe par `take_deposit_for_session(media, session)` (`0036:640-657`, `PR:710`), qui exige
  `cash_session_usable` (session `OPEN` du même ledger, `0036:177-194`) puis `cash_session_attach_own`. Contradit SP:745-751 (« écriture
  `DEPOSIT_TAKEN`, source `EDGE_SYNC`, clé d'origine ») et SPEC:413 (`origin_*`). Mode `FROM_BALANCE` : refusé sous EDGE par CL006 (cohérent
  avec SP:752-758).
- **Garde de caisse** (`posting_cash_desk_guard`, `0036:500-529`, ADR-132 `DECISIONS_ADR.md:1908-1914`) : pour tout `posting` sur un
  compte de `cash_desk`, exige une session `OPEN` de ce compte et, si la transaction porte un `device_id`, le même terminal que la session ;
  `CLOSING` n'admet que `CASH_CLOSE`. Elle ne lit aucune variable de session, vaut pour toutes les sources et tous les rôles. **Si la
  session d'origine a été fermée entre la décision de la passerelle et le rejeu, toute écriture `EDGE_SYNC` qui touche la caisse
  (recharge espèces, caution) est refusée par CL029**, et aussi l'écriture de repli de SP:744-751 qui « débite la caisse de la station »
  (elle plante pour la même raison). `finish_cash_close` / `begin_cash_close` (`0040:19-60`) ne regardent pas `debit_authority` ni les
  files `EDGE_SYNC` en attente : un superviseur peut fermer une session pendant `EDGE`, avec `expected_amount` qui ignore les espèces
  encore dans la file de la passerelle (écart `CASH_DIFF` artificiel, rejeu impossible après). La décision du porteur (sessions ouvertes
  avant la bascule) ne suffit donc pas sans garde supplémentaire.

## 4. Base locale de la passerelle

Source : SPEC:80 « Même moteur d'écritures, base PostgreSQL locale » ; SPEC:100 `apps/gateway` réutilise les modules de l'API.

**Rejouer tel quel les 57 migrations + `roles.sql` + `post-roles.sql` en local.** Pour : même `post_transaction` et mêmes gardes, moteur TS
inchangé (`ledger-queries.ts:63,199`). Contre (bloquants) :
1. Le flux de réplication ne porte que des soldes (SP:682-690, OA:~14690, contrat stable) : ni `posting`, ni `journal_transaction`, ni
   invariants reconstituables ; amorcer `account_balance` est interdit hors fonctions. Les `posting.id` (filigrane W) divergeraient.
2. `debit_authority` aurait deux sens : localement `EDGE` pour débiter, mais `post_transaction` (S:573) n'admet alors que `EDGE_SYNC`.
3. Surface (identité, audit, KMS, PSP, FK vers `party`, `event`, `device`, `vendor`) non alimentée (spec.md:305) ; chaîne de migrations à égaler
   sans internet ; RLS multi-tenant inutile pour un prestataire et un événement.

**Schéma local réduit (recommandé).** Une base PostgreSQL 17 locale (conforme SPEC:80 et pile `docs/08-pile-logicielle.md:14-20`) mais avec
une série de migrations propre `edge-NNNN`, sans `post_transaction`. Tables minimales :
- `edge_op` : `edge_seq` (clé, continu), `origin_key` (unique), `type`, `content_sha256`, `chain_hash`, décision (`status`,
  `charged_to_wallet`, `shortfall_amount`, raisons), `authorized_mode`, `device_batch_id`, `edge_guichet`, `occurred_at`, état d'envoi,
  résultat central ; écrite avant toute réponse au terminal (FR-014) ;
- `edge_wallet_balance` : `wallet_id`, `paid`, `promo`, `status`, `last_posting_id` ; `edge_media` (état, PWD chiffré) ;
- `edge_handover_state` : handover, direction, statut, époque, `RELEASING` persisté, `watermark` (FR-012, FR-021) ;
- `edge_replication_cursor` ; `edge_device_batch` (en-têtes et signatures relayés) ; copies de catalogue, sessions, terminaux selon
  l'ajout `/edge/*` choisi ; clés de signature locales (`snapshot_signing_key.owner = EDGE`).
Règles partagées : la logique pure (`spendSplit`, plafonds, `coveredCap`) est déjà en TS (`apps/api/src/ledger/money`, builders) ; mêmes
scénarios de référence sur les deux.
- Avantages : pas de double comptabilité (la décision est ce que le central reprend, SP:714-716) ; cohérent avec le contrat stable.
- Risques : (1) **divergence de règles** (frais, plafonds, ordre `spend_order`) : mitigée parce que le central recalcule frais et
  commissions et que seule la répartition portefeuille/attente vient de la passerelle ; tests de conformité communs obligatoires ;
  (2) **double vérité des soldes** : bornée par SP:686-690 (le solde local est toujours ≤ central), mais une vente `DUPLICATE` doit corriger
  le solde local via la réplication ; (3) perte de l'invariant SQL local : le central reste l'unique filet ; (4) « même moteur » de SPEC:80
  devient « mêmes modules TS », à acter (contradiction 1 ci-dessous).
## 5. Écarts de sécurité potentiels à soumettre au porteur (CLAUDE.md, règle 1)

1. **Existant, à corriger (renforce, donc à faire puis consigner)** : `cashless_app` peut INSERT/UPDATE `edge_gateway` (toutes colonnes)
   via `RO:14-15`, jamais retiré par `PR`. Il peut réécrire `contiguous_edge_seq`, `last_chain_hash`, `status` (annuler `REVOKED`),
   `cert_sha256`, `public_key`, `agreement_public_key`, donc faire passer `complete_edge_release` sans que les opérations aient été
   reçues, ou réactiver une passerelle révoquée. À ouvrir en OP + ADR même si on le ferme tout de suite (règle 3 : écart accepté
   seulement s'il reste ouvert ; ici il se ferme dans la mission). Inscription d'une passerelle « hors API publique » (décision du porteur)
   = rôle d'administration distinct, à créer.
2. `ack_edge_handover`, `complete_edge_release`, `record_edge_seq` sans liaison à l'identité de la passerelle appelante dans la base
   (§2 point 5) ; `record_edge_seq` accepte une passerelle `REVOKED` ou sans handover. Renforcer : refuser `REVOKED` et exiger
   un handover `ACTIVE`/`RELEASING` de la même passerelle.
3. `post_transaction` n'impose pas `origin_*` ni lien à une passerelle pour `EDGE_SYNC` et l'accorde à `cashless_app` : source la plus
   puissante (seule à débiter sous `EDGE`) écrivable par tout code de l'API publique. Option : rôle `cashless_edge` et fonction
   enveloppe `edge_post_transaction` (vérifie handover, époque, `origin_*`), `post_transaction` EDGE_SYNC refusée à `cashless_app`.
   Ne pas le faire est un contrôle reporté : à décider. Fichiers à faire relire par une personne : `0058`, `post-roles.sql`, `roles.sql`.
4. **Sessions de caisse** : garde ADR-132 refuse le rejeu après fermeture (CL029) et la fermeture n'attend pas la file. Écart par
   rapport à la décision du 05/11 (« sessions ouvertes avant la bascule ») si on laisse faire : option de renforcement = refuser
   `begin_cash_close` quand un `TO_EDGE` est ouvert ou la file `EDGE_SYNC` non vide ; touche `0036`/`0040` (relecture humaine).
5. Faux gardés en production (règle 2) : stockage matériel simulé (C-007, FR-032), identité de passerelle, KMS local : chacun doit
   refuser le démarrage en production avec un test. Dette 12b à consigner (OP + ADR + `PROMPTS-A-ENVOYER.md` + `PRD.md`).

## Contradictions entre sources (sans trancher)

1. SPEC:80 et 100 (« même moteur d'écritures, base PostgreSQL locale ») vs contrat de réplication stable (soldes et bracelets seuls,
   OA:14690 sq., SP:682-690) : le moteur SQL local ne peut pas être alimenté en écritures.
2. SP:640-650 et OA:14657-14659 (`RELEASING` posé avant vérification) vs `complete_edge_release` S:2638-2667 (exception = annulation) et
   absence de fonction qui écrit `RELEASING`.
3. SP:744-751 (`DEPOSIT_TAKEN` en `EDGE_SYNC`, clé d'origine, débit de la caisse) vs `take_deposit` S:1596-1620 (source `ONLINE`,
   clé `deposit:<media>:<n>`, `now()`) et `take_deposit_for_session` `0036:640-657` ; le repli débite une caisse que la garde `0036:500-529`
   refuse quand la session est fermée.
4. SP:696-697 et SPEC:1035 (recharges en espèces dans la file de la passerelle) vs ADR-137 (`DECISIONS_ADR.md:~2002-2006`, `TOPUP_CASH` hors
   ligne retiré, « contredit `sync_protocol.md` §5.4, §7.5, §8 ») et `OfflineOperationType` (OA:~14120, `TOPUP_CASH` « toujours rejeté ») : le
   mode `EDGE_ONLINE` n'est pas dit explicitement.
5. SP:700-705 (états de lien) et S:731 vs aucune fonction qui les écrit ; `edge_sync_registry.outcome` S:2715 (4 issues) vs `VOID`, `ONLINE_REF` de `EdgeSyncOperation`.
6. SPEC:1239 (SETTLING attend « terminaux et passerelles ») vs `event_device_sync_status` (terminaux seuls).
7. SP:714-716 (« reprend la décision `edge_decision`, ne recalcule que frais et commissions ») vs moteur TS : `shortfall` seulement pour
   `OFFLINE_SYNC` (`ledger-engine.service.ts:231`), `source: 'OFFLINE_SYNC'` en dur (`offline-sale.writer.ts:95`).
8. Test du kit `tests_grand_livre_cashless.sql:539-542` (« fonctions de bascule exposées » au rôle applicatif) vs `PR:22-23, 407-412` (non accordées
   à `cashless_app`).
9. SPEC:413 (`origin_key`, `origin_occurred_at`, `origin_mode` : DOIT) vs `post_transaction` S:510- (aucun contrôle de `p_metadata`).

## Points à décider

1. Base locale : schéma réduit `edge-NNNN` (recommandé) ou rejeu des migrations avec mode local ; et libellé de « même moteur » (SPEC:80).
2. Rôle des routes `/edge/*` : `cashless_app` étendu ou `cashless_edge` (et processus séparé) ; enveloppe `edge_post_transaction`.
3. Fermer l'écriture directe sur `edge_gateway` (écart 1), outil d'inscription hors API (rôle, droits), liaison passerelle/handover
   (`p_gateway` ou enveloppes), refus d'une passerelle `REVOKED` dans `record_edge_seq`.
4. Fonctions à créer : `begin_edge_release`, `fail_edge_release`, battement et états de lien, identification par `cert_sha256`, table
   `edge_sync_batch`, lecture du flux de réplication, rejeu `ACTIVATION`/`DEPOSIT_CASH` avec source `EDGE_SYNC` et clé d'origine.
5. Sessions de caisse : garde contre la fermeture pendant `EDGE`/file non vide ; comportement du repli SP:744-751 sur session fermée.
6. Issues du registre pour `VOID` / `ONLINE_REF` ; traitement des recharges espèces `EDGE_ONLINE` (contradiction 4).
7. Statut de `edge_decision` : fidélité totale (central écrit tel quel) et plafonds de sécurité côté central (borne par le solde central).
8. Numéro de la migration : `0058`, une ou plusieurs ; extension de `tests_execute_grants.sql`, `tests_offline_rights.sql` (liste figée
   des tables) et d'un test pgTAP sous `cashless_app` pour la bascule.
