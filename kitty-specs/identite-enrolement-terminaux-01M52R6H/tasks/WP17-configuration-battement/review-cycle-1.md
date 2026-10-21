# Relecture WP17, cycle 1 (configuration servie et battement de cœur)

Relecteur : claude (indépendant de l'implémenteur). Lane `lane-q`, diff `45ccc43..a2a2af7` hors `kitty-specs/`
(commits 38cefa3 et a2a2af7 ; HEAD 6815d55 n'ajoute qu'une fusion de la branche de mission et des transitions).
Prompt de relecture obtenu par `spec-kitty agent action review WP17 --mission identite-enrolement-terminaux-01M52R6H
--agent claude` (lancé sans erreur ; verdict NON enregistré par le relecteur).

Exécuté par le relecteur, sans base : `npm run typecheck -w @cashless/api` (vert), `npm run lint` (vert), contrôle
des lignes ajoutées en caractères (aucune au-delà de 100). Aucun test unitaire ajouté par le lot. Suites sur base :
résultats de l'orchestrateur (pgTAP 2010 PASS dont `tests_execute_grants` ; Jest lane-q 1574 OK + 2 échecs attendus,
voir constat 1 ; combinaison o+p+q 1618 OK, seul échec = course connue de `enrollment-codes.spec.ts`), non relancées.
Vérifié dans `.worktrees/tmp-combo-5a` : étape 6 bis présente (`real-device-identity.ts:203`) et grant
`record_config_served` conservé après fusion.

## Vérifications de sécurité (toutes tenues)

- **Nouveau droit `EXECUTE record_config_served(uuid,uuid)` → `cashless_app`** (`packages/ledger-sql/post-roles.sql:474-477`,
  liste figée `tests/tests_execute_grants.sql:89`). Prévu : la route doit servir `config_id` = `device_config_served.id`
  (openapi `DeviceConfig.config_id`), seule `record_config_served` écrit cette table (INSERT/UPDATE/DELETE retirés à
  `cashless_app`, `post-roles.sql:230-232`), et le report WP07 impose d'accorder en section 4a toute fonction appelée.
  La fonction (`schema_grand_livre_cashless.sql:2445`) est `SECURITY DEFINER`, `search_path` ramené à
  `public, pg_temp` par la migration 0021 (et TEMPORARY retiré à tous les rôles, `post-roles.sql:28, 518`), ouvre par
  `assert_tenant(tenant_of_device(p_device))` : un terminal d'un autre prestataire ou inconnu → `no_data_found`, rien
  écrit ; `operator_id` de la ligne pris sur `device`, pas sur l'appelant ; table sous RLS forcée (`:2875`). Elle ne
  contrôle PAS le statut du terminal : un appel direct par `cashless_app` peut enregistrer une configuration pour un
  terminal révoqué de son propre prestataire (voir N3, défense en profondeur ; la route, elle, refuse).
- **`@DeviceAuth({ allowSuspended: true })`** : deux seules occurrences, `device-config.controller.ts:19` et
  `heartbeat.controller.ts:27` (grep sur `apps/api/src`). Le défaut reste strict ; le test « suspendu » vérifie aussi
  qu'une route sans l'option (`/taps`) rend `403 DEVICE_SUSPENDED`.
- **R-14, statut relu et verrouillé dans la transaction** : configuration — `SELECT … FROM device … FOR NO KEY UPDATE`
  AVANT `record_config_served` (`device-config.service.ts:112-121`), révoqué → `403 DEVICE_REVOKED`, rollback ;
  NO KEY UPDATE entre en conflit avec le `FOR UPDATE` de `set_device_status`. Battement de cœur —
  `record_device_heartbeat` prend `FOR UPDATE` et lève 42501 (→ `DEVICE_REVOKED`) avant l'UPDATE, puis la même
  transaction relit via `build`. Tests de course (`commitWhileWaiting`) : retirer le verrou ou le contrôle fait écrire
  une ligne `device_config_served` / avancer `last_seen_at` → les tests `config.spec.ts:328` et `heartbeat.spec.ts:172`
  échouent.
- **Nonce / écriture absents sur refus** : terminal révoqué → 403 de l'étape 6 bis (WP16), test qui compte nonces ET
  lignes servies (`config.spec.ts:313-326`) et l'état complet du terminal (`heartbeat.spec.ts:159-170`). Corps de
  battement invalide → 400 avant la transaction, `last_seen_at` inchangé (test).
- **Aucun secret dans `DeviceConfig`** : corps construit champ par champ, sans clé, certificat, empreinte ni jeton ;
  `snapshot_keys = []`. `contractViolations` (`test/support/contract-schema.ts`) signale toute propriété hors contrat :
  un champ ajouté (secret compris) ferait échouer le test de conformité.
- **ETag** (`configEtag`, `device-config.service.ts:80-87`) : SHA-256 du JCS du corps hors `server_time`, rendu au seul
  terminal authentifié dont il résume la configuration : aucune fuite. Stable sans changement réel (test : deux appels,
  battements successifs), change avec un réglage de l'événement (test) et avec le statut (test « suspendu » : sans
  cela un `304` masquerait la suspension). `If-None-Match` liste, forme faible, `*` testés.
- **Battement sans numéro de séquence** : `last_seq`, `contiguous_acked_seq`, `next_seq_floor` inchangés et aucune ligne
  `device_seq_registry` après trois battements avec `last_local_seq` croissant (test) ; le DTO ne transmet que
  `app_version` et `device_time`.
- **Isolation** : terminal de B servi sur l'événement et le grand livre de B, ligne servie au prestataire B ; certificat
  de A avec le jeton de B → 401. Le terminal servi vient toujours de la garde (aucun identifiant fourni par le client).
- **R-10, rien d'inventé** : `snapshot_keys` vide, autorité relue sur le grand livre (CENTRAL, époque 0), catalogue
  `{items: []}` pour CATALOG_POS et `null` sinon, `latest_snapshot_version: null`, `sync_requested: false`, politique par
  défaut (hors ligne interdit), téléphone personnel jamais hors ligne même avec une politique qui le demande (test).

## Constats

1. **Non bloquant (coordination, pas un écart de sécurité).** Les tests « révoqué → 403 DEVICE_REVOKED »
   (`config.spec.ts:313`, `heartbeat.spec.ts:159`) échouent dans lane-q seule (401) car l'étape 6 bis vit dans lane-p
   (WP16, approuvé), qui n'est pas une dépendance déclarée de WP17 ; ils passent sur la combinaison o+p+q. Dans lane-q
   seule le refus est total (401, famille révoquée, ni nonce ni écriture) : aucun affaiblissement, seul le code de
   réponse diffère d'ADR-115. Les tests suivent le report de relecture de WP16 et le code converge à la fusion de la
   mission. Options : (a) **recommandée** — garder tel quel, note de coordination dans le `move-task`, et WP18 (qui
   dépend de tous les lots) relance la suite complète sur la fusion ; (b) déclarer WP17 → WP16 dans les dépendances :
   recalcul des lanes et rebase après coup, sans gain de sécurité. Pas de décision du porteur requise (pas un
   affaiblissement), mais à signaler.
2. **Non bloquant (report de relecture WP16 partiellement suivi).** Le report demandait de tester la révocation et la
   suspension faites **par la route du back-office** ; les tests posent le statut par `set_device_status` en
   propriétaire (`TestTerminal.setStatus`), justification en tête de fichier (route absente de la lane). Effet couvert
   au niveau base, pas de bout en bout. → report WP18.
3. **Non bloquant (défense en profondeur, fichier « droits de la base »).** `record_config_served` ne refuse pas un
   terminal `REVOKED` et accepte `p_config_version` sans vérifier que la `config_version` appartient au prestataire du
   terminal (clé étrangère seule). Aujourd'hui sans effet : l'API ne passe jamais le second paramètre, relit le statut
   sous verrou avant l'appel, et `policy_in_force` lie la configuration au terminal. Mais le droit accordé porte sur la
   signature à deux paramètres : un `cashless_app` compromis pourrait enregistrer une configuration pour un terminal
   révoqué de son prestataire ou référencer la `config_version` d'un autre. Options : (a) report vers la mission qui
   commencera à passer `p_config_version` / la mission 7 (lots hors ligne) : contrôle du statut et
   `assert_tenant` sur la `config_version` dans une migration (0029 réservée à WP17 n'est pas nécessaire maintenant) ;
   (b) ajouter dès WP18 un test pgTAP par `gen_tests.py` : `record_config_served` d'un terminal d'un autre prestataire
   sous `cashless_app` → `no_data_found`, aucune ligne (le refus inter-prestataires n'est aujourd'hui prouvé par aucun
   test de cette fonction).
4. **Non bloquant (contradiction de sources à consigner, règle 3).** Prompt T079 : « `config_id` = empreinte SHA-256 …
   hors `server_time` » ; `contracts/device-lifecycle.md` : « ETag = `config_id` » ; `openapi.yaml` : `config_id` entier
   = `device_config_served.id`. L'implémentation suit `openapi.yaml` (priorité §0.3) : `config_id` = id de ligne, ETag =
   SHA-256 JCS hors `server_time`. Choix plus sûr (un ETag = `config_id` ne changerait pas avec le statut et un `304`
   masquerait une suspension). À corriger dans `device-lifecycle.md` (texte proposé ci-dessous).
5. **Non bloquant.** `409 CONFLICT_STATE` (terminal sans événement, événement ou grand livre absent,
   `device-config.service.ts:78, 122, 153, 163`) n'est pas déclaré dans `openapi.yaml` pour ces deux routes, et pour le
   battement de cœur il annule aussi la dernière présence. Chemin inatteignable aujourd'hui (tout code d'enrôlement porte
   un événement, `0022:107`), donc report de contrat seulement.
6. **Non bloquant.** Plafonds `bigint` convertis par `Number()` (`device-config.service.ts:196-199`, `seq`) : perte de
   précision au-delà de 2^53 ; sans effet pour des montants réalistes (même choix que le contrat `int64` côté JS).
7. **Coordination de fusion (anti-pattern 7).** Fichiers partagés : `post-roles.sql` section 4a et la liste figée de
   `tests_execute_grants.sql` (lanes n, o, p y touchent : conflit textuel trivial, garder toutes les signatures ; déjà
   résolu dans `tmp-combo-5a`) ; `devices.module.ts` (une ligne par module, demandé par le prompt).
   `apps/api/test/support/contract-schema.ts` est hors `owned_files` (nouveau fichier de support de test, réutilisable) :
   retouche hors carte justifiée.

## Liste anti-patterns

1. Code mort : PASS (`DeviceConfigService` utilisé par les deux contrôleurs, modules importés par `devices.module.ts`,
   `configEtag`/`etagMatches` appelés).
2. Fixture synthétique : PASS (tout passe par HTTPS, identité réelle, base réelle ; schéma relu dans `openapi.yaml`).
3. Retour vide silencieux : PASS (`return undefined` du `304` documenté ; `pos = rows[0] ?? null` : clé étrangère).
4. Couverture des FR : PASS (FR-018, FR-019, NFR-009 — latence écartée en passe parallèle, lancée seule).
5. Surface figée : PASS (aucun `.sql` généré ni `schema_grand_livre_cashless.sql` modifié).
6. Décision verrouillée : PASS (R-14, R-10, ADR-115 respectés).
7. Fichiers partagés : PASS avec note (constat 7).
8. Fragilité en production : PASS (`!` sur des lignes toujours rendues ; refus = `ProblemException` documentées).

## Reports proposés

- **WP18** : test de bout en bout révocation et suspension par `POST /v1/devices/:id/revoke|suspend` puis configuration
  et battement de cœur (403 `DEVICE_REVOKED` / 200) — constat 2 ; suite complète sur la fusion des lanes (constat 1) ;
  test pgTAP inter-prestataires de `record_config_served` via `gen_tests.py` (constat 3 b).
- **Mission 7 (ou celle qui passera `p_config_version`)** : `record_config_served` refuse un terminal `REVOKED` et vérifie
  le prestataire de la `config_version` (constat 3 a).
- **Contrat** : `device-lifecycle.md` § `GET /v1/device/config`, remplacer « ETag = `config_id` » par : « `config_id` =
  `device_config_served.id` (openapi) ; `ETag` = SHA-256 du contenu canonique (JCS) hors `server_time`, qui change aussi
  avec le statut du terminal » ; déclarer `409 CONFLICT_STATE` ou le retirer (constat 5).

## Texte de point ouvert proposé (constat 3, si l'orchestrateur le consigne)

> **OP-N?? — `record_config_served` sans contrôle de statut ni de prestataire de `config_version`.** Risque : un
> `cashless_app` compromis enregistre une configuration pour un terminal révoqué de son prestataire ou référence la
> `config_version` d'un autre prestataire. Atténuation actuelle : la route relit le statut sous verrou avant l'appel et
> ne passe jamais `p_config_version` ; `assert_tenant` sur le terminal. Levée : mission 7 (ou première mission qui passe
> `p_config_version`), migration qui ajoute les deux contrôles et tests pgTAP associés.
(Pas un écart accepté au sens de la règle 3 de CLAUDE.md : aucun contrôle prévu n'a été retiré ; ADR non nécessaire.)

## Fichiers à faire relire par une personne

- `packages/ledger-sql/post-roles.sql:470-477` (droit EXECUTE nouveau de `cashless_app`).
- `packages/ledger-sql/tests/tests_execute_grants.sql:58-90` (liste figée des droits).
- Pour contexte de ce droit : `record_config_served` dans `packages/ledger-sql/schema_grand_livre_cashless.sql:2445-2471`
  (non modifié par le lot).

VERDICT: APPROVE
