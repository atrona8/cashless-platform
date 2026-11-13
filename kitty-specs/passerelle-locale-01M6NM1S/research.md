# Research: Passerelle locale de site

Décisions du plan, avec leur justification et les options écartées. Sources : `docs/passation-8/contexte-m8.md` (décisions
du porteur du 05/11/2026, qui font foi sur les rapports `docs/passation-8/rapports/R-base.md`, `R-api.md`, `R-protocole.md`),
`spec.md`, `docs/sync_protocol.md` (SP), `docs/SPECIFICATION.md` (SPEC), `packages/contracts/openapi.yaml` (OA). `S:` =
`packages/ledger-sql/schema_grand_livre_cashless.sql`, jamais modifié à la main : toute évolution passe par une migration
(`0058` et suivantes, la dernière existante étant `0057`). Les références de lignes ont été revérifiées dans le code ;
quand un rapport se trompait, la référence corrigée est donnée ici.

**Passe contradictoire du 05/11/2026** : les 29 constats A01 à A29 de `docs/passation-8/rapports/plan-adversarial.md` sont traités dans ce
fichier, dans `data-model.md`, `contracts/` et `plan.md` ; le suivi constat par constat est `research-adversarial.md`. Les décisions 11 à 18 du
porteur (`docs/passation-8/contexte-m8.md`) y sont appliquées. Le schéma du flux de réplication est UNIQUE et vit dans
`contracts/replication-page-additions.yaml` ; ce fichier ne le redéfinit pas.

Vocabulaire : « renforcement » = plus strict que les sources, fait puis consigné (règle 1 de `CLAUDE.md`) ; « écart » = plus
faible que le plan ou les sources, soumis au porteur avant d'être codé sauf mention d'une décision déjà prise ;
« À SOUMETTRE AU PORTEUR » = non décidé ici, rien ne se code sur ce point avant sa réponse (le reste continue).

---

## R-01 Base locale : PostgreSQL 17 au schéma réduit (décision 1 du porteur)

- **Décision** : la passerelle tient une base PostgreSQL 17 locale (même moteur que le central, SPEC §1.2, pile
  `docs/08-pile-logicielle.md` §1), avec une **série de migrations propre `apps/gateway/db/migrations/edge-NNNN.sql`**, jouée
  par un `migrate` propre à la passerelle. Elle ne rejoue ni les 57 migrations du central, ni `roles.sql`, ni `post-roles.sql`,
  et ne porte pas `post_transaction`. Les règles de calcul sont partagées en TypeScript (R-02) et prouvées par les mêmes
  scénarios de référence (`packages/ledger-sql/scenario_reference.json`, générés par `gen_golden.py`, lus par un test de la
  passerelle). Le central seul tient la comptabilité ; la passerelle tient des décisions numérotées et des soldes dérivés.
- **Justification** (vérifiée) : (1) `ReplicationPage` ne porte que `wallets[{wallet_id,status,paid,promo}]` et `media[]`
  (OA:14690-14728) : on ne peut reconstituer ni `posting`, ni `journal_transaction`, ni leurs invariants, et `account_balance`
  n'est écrivable que par les fonctions de la base ; les `posting.id`, donc le filigrane W, divergeraient. (2) `post_transaction`
  refuse tout débit de portefeuille hors source `EDGE_SYNC` quand `ledger.debit_authority = 'EDGE'` (`S:573-578`, CL006) : une
  base locale rejouant le schéma central devrait porter `CENTRAL` pour débiter, ou écrire sa première décision en `EDGE_SYNC`,
  ce qui n'a pas de sens. (3) Les services de l'API appellent des fonctions SQL (`TenantTx`, aucun ORM, pile §1) liées à des
  tables sans objet sur un site (identité, audit, KMS, PSP, clés étrangères vers `party`, `event`, `device`, `vendor`) ; la chaîne de
  migrations est à égaler sans Internet ; la RLS multi-prestataire est inutile pour un seul prestataire et un seul événement.
  (4) La décision de la passerelle est ce que le central reprend (SP:714-716) : une seconde comptabilité locale serait une double
  vérité sans bénéfice.
- **Conséquence de texte** : « même moteur d'écritures » (SPEC:80, SPEC:100) devient « mêmes modules » (R-02). Écart de texte consigné :
  `OP-N109` et `ADR-164` (voir « Écarts de sécurité »), à reporter dans `SPECIFICATION.md` au prochain passage de la mission 13. Voir « Contradictions de
  sources » n° 1.
- **Alternatives écartées** : (a) rejouer tout le schéma central en local avec un mode local : bloquants 1 à 3 ci-dessus, et une
  seconde chaîne de migrations de 57 fichiers à maintenir ; (b) SQLite : écarte la parité de types (`bigint`, `bytea`, `jsonb`) et
  le moteur de la pile, aucune raison de s'en écarter ; (c) base embarquée dans le processus : pas de reprise propre après arrêt
  brutal (NFR-004), pas d'outillage de sauvegarde.
- **Relecture humaine** : `edge-0001` (tables `edge_op`, `edge_authority`) et la transaction « décision + effet local + entrée de
  file » (R-16).

## R-02 Partage de code : un paquet `@cashless/shared-rules` extrait de `apps/api` (porte sur la logique pure seulement)

- **Décision** : créer le paquet workspace `packages/shared-rules` (`@cashless/shared-rules`, `"main": "src/index.ts"` comme
  `@cashless/tag-format`, `@cashless/contracts`), ajouté à `workspaces` (`package.json:5-10`), `npm ci --ignore-scripts`
  (`.npmrc`). On y **déplace** (git mv, imports mis à jour, aucun comportement changé, tests déplacés avec eux) uniquement du
  code vérifié sans dépendance à Nest, `pg`, ni au système de fichiers :
  - `apps/api/src/ledger/money/*` (`fee`, `rounding`, `spend`, `split`, `tax` : aucun import hors du dossier) ;
  - `apps/api/src/payments/chained-content.ts` (aucun import) : les onze champs chaînés (SP:112-122) ;
  - `apps/api/src/offline/rules/*` (`compliance`, `conflict-outcome`, `loss-bearer`, `offline-time`, `period`, `types` ; seul
    import : `@cashless/contracts`) ;
  - la vérification de chaîne de terminal et d'en-tête de lot (`offline/batches/batch-chain.ts`) **après** séparation de ce qui
    touche `device-seq-registry` (qui dépend de la base) : la partie pure (`chain_step`, genèse, hachage de l'en-tête JCS) passe
    dans le paquet, le reste reste dans l'API ;
  - le contrôle des preuves de requête de terminal (`device-identity/request-signature.ts`, RFC 9421, profil R-04) si la lecture
    au plan confirme qu'il est pur ; sinon il reste dans l'API et la passerelle écrit un adaptateur sur les mêmes vecteurs.
  `@cashless/tag-format` (scellement du mot de passe pour un destinataire) est déjà un paquet : la passerelle l'utilise tel quel.
  Les nouveautés pures de la mission (contenu et chaîne d'une opération de passerelle, R-12) naissent dans ce paquet.
- **Garde** : un test d'architecture pour `packages/shared-rules` interdit tout import de `@nestjs/*`, `pg`, `node:fs`,
  `node:net`, `node:http(s)` et de tout chemin de `apps/` (les tests d'architecture de l'API ne lisent que `apps/api/src`,
  `architecture.spec.ts:214-293`). `apps/gateway` a ses propres tests équivalents (un seul pool de base, démarrage commun).
- **Justification** : la base locale a un schéma réduit (R-01), donc les services de l'API (qui appellent des fonctions SQL
  absentes) ne sont pas réutilisables ; seule la logique pure l'est. C'est aussi ce qui évite la divergence de règles (frais,
  plafonds, ordre `spend_order`, `coveredCap`) : un seul code, deux consommateurs, les mêmes scénarios de référence.
- **Alternatives écartées** : (a) imports directs `../../api/src/...` : couplage fragile, `tsconfig` de l'API avec
  `rootDir: "../.."`, build `tsc -p tsconfig.build.json` de l'API qui ne compile pas la passerelle, aucun test d'architecture
  commun (ce serait un prototype) ; (b) extraire tout le moteur (`@cashless/server-core` de R-api §6, option 1) : suppose une
  base au schéma central, écartée par R-01 ; coût et risque de régression de l'API sans contrepartie ; (c) copier le code :
  divergence silencieuse.
- **Risque et preuve** : régression de l'API par un déplacement mal fait. Preuve : la suite unitaire de l'API reste verte sans
  autre changement que les chemins d'import ; l'ordre du déplacement (paquet d'abord, passerelle ensuite) est dans les lots.

## R-03 Processus central `/edge/*` et rôle `cashless_edge` (décision 5)

- **Décision** : un **processus dédié** `edge` (`apps/api/src/main.edge.ts`, module racine `processes/edge.module.ts` sur le
  modèle de `processes/tag-keys.module.ts` : `ProcessBaseModule`, `DenyUnmarkedRoutesGuard`, un seul pool), qui sert exactement
  les routes `/edge/*` et `GET /ledgers/{id}/debit-authority` côté passerelle. Il se connecte avec le rôle **`cashless_edge`**
  (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`, mot de passe `CASHLESS_EDGE_PASSWORD` posé par
  `migrate.ts` comme les rôles de la section 2 de `post-roles.sql:254-262`, connexion `DATABASE_URL_EDGE`). Les routes
  humaines `POST /ledgers/{id}/debit-authority` et `GET` (humanBearer) restent dans le processus public (`cashless_app`).
- **Droits de `cashless_edge`** (liste nommée dans `post-roles.sql`, figée par `tests_execute_grants.sql` et son pendant sur les
  tables) : EXECUTE sur les seules enveloppes R-06 et R-07 ; aucun droit direct sur les tables (`REVOKE ALL ... FROM
  cashless_edge`), sauf lecture des vues étroites listées en R-08. Il n'exécute **ni** `post_transaction`, **ni**
  `set_debit_authority`, **ni** les fonctions S12 brutes (`ack_edge_handover`, `complete_edge_release`, `record_edge_seq`) :
  uniquement leurs enveloppes, qui reçoivent l'identité de la passerelle (R-06).
- **Droits de `cashless_app` accordés pour les routes humaines** : EXECUTE sur `grant_edge_authority`, `request_edge_release`,
  `fail_edge_grant` (toutes `assert_tenant`), sur `get_debit_authority(ledger)` (nouvelle lecture) et sur
  `force_central_authority_approved(ledger, approval_request)` (R-06) ; **pas** sur `force_central_authority` brute ni sur
  `set_debit_authority` (refusée, `roles.sql:45-50`). Le commentaire de `post-roles.sql:407-412` prévoit exactement cet ajout.
- **Justification** : `cashless_app` n'a ni `EXECUTE` ni `UPDATE` sur ces objets (`roles.sql:20-28`, `post-roles.sql`) et
  l'application NE DOIT PAS appeler `set_debit_authority` (SPEC:1043). Un processus et un rôle séparés suivent le principe « un
  port par droit » déjà appliqué aux clés (`cashless_tagkeys`, snapshots) et permettent une seconde autorité de certificats
  sur son propre écouteur TLS (R-04).
- **Alternatives écartées** : étendre `cashless_app` (donne à tout le code de l'API publique le droit d'écrire en `EDGE_SYNC` et
  de rendre l'autorité : écarté, voir R-09) ; routes `/edge/*` dans le processus public (une seule `ca` par écouteur,
  `bootstrap.ts:80-95`, mélange des deux autorités de certificats).
- **Relecture humaine** : `0058`, `post-roles.sql`, `roles.sql`, `main.edge.ts`, la garde `edgeMtls`.

## R-04 Identification `edgeMtls` : autorité propre, empreinte `cert_sha256`, seconde CA

- **Décision** :
  1. **Autorité qui délivre** : une **autorité des passerelles**, distincte de l'autorité des terminaux (`DEVICE_CA`,
     `device-ca.port.ts:21-29`). Un nouveau port `EDGE_CA` (comme `DEVICE_CA` : faux de développement refusé en production,
     adaptateur réel en mission 12b) émet le certificat client de la passerelle à l'inscription (R-05). Il n'émet jamais pour un
     terminal et inversement.
  2. **Quoi comparer** : l'empreinte SHA-256 du certificat client (DER) est comparée à `edge_gateway.cert_sha256` (colonne
     existante, `S:742`), comme `device.cert_sha256` pour les terminaux. `edge_gateway.public_key` n'est **pas** la clé du
     certificat : c'est la clé de signature ECDSA P-256 de la passerelle, qui signe chaque `EdgeSyncBatch` (`signature`,
     OA:14493 et 14540, vérifiée par le central : `400 BATCH_SIGNATURE_INVALID`). Voir « Contradictions » n° 3.
  3. **Seconde CA sur le serveur TLS** : l'écouteur du processus `edge` a `ca` = `EDGE_CA_CERT_FILE` seule, TLS 1.3 minimum,
     certificat demandé (`requestCert`) ; l'écouteur public garde `ca` = `DEVICE_CA_CERT_FILE` seule. Un certificat de terminal ne
     passe donc jamais sur `/edge/*`, et réciproquement. Le processus `edge` écoute sur un port propre (`EDGE_PORT`) ; l'aiguillage
     par nom d'hôte ou par port est de l'exploitation (le contrat décrit un serveur « Passerelle locale » séparé, OA:119, et le central
     reçoit `/edge/*` sur sa propre adresse : à consigner dans la procédure de déploiement, non testable ici).
  4. **Résolution** : fonction `identify_edge_gateway(cert_sha256 bytea)` (SECURITY DEFINER, STABLE, accordée à `cashless_edge`
     seule) qui renvoie `(gateway_id, operator_id, event_id, ledger_id, role, status)` ; refuse `REVOKED`. La garde pose ensuite
     `app.operator_id` et `app.gateway_id` pour la transaction (modèle de l'identité des terminaux). **Le prestataire, l'événement
     et le grand livre viennent de cette ligne, jamais de la requête.**
  5. **Révocation** : relue en base à chaque requête (aucun cache > 0 s), donc effective immédiatement ; pas de fichier de CRL
     (une passerelle révoquée est aussi refusée par la base, FR-031, SP:804).
- **Justification** : la garde `edgeMtls` n'existe pas (`bootstrap.ts:80-95` n'a qu'une CA) ; le contrat dit « certificat client
  (`edge_gateway.public_key`) » (OA:10997) mais le schéma porte aussi `cert_sha256` ; l'empreinte est le mécanisme déjà éprouvé
  pour les terminaux et n'impose pas de lire la clé publique du certificat.
- **Alternatives écartées** : faire confiance à `DEVICE_CA` (un terminal compromis pourrait se présenter comme passerelle si
  son empreinte était inscrite par erreur) ; authentifier par `public_key` seule (obligerait à comparer la clé du certificat à celle
  de signature des lots, deux usages mêlés) ; une CA publique (aucune raison, hors périmètre).
- **Preuves** : NFR-011 (certificat d'une autre passerelle, d'un autre événement, d'un autre prestataire, révoqué, d'un terminal :
  401 ou 403 ou 404 sans fuite, sur chacune des 5 routes `/edge/*` et sur la lecture de l'autorité) ; NFR-009 (faux `EDGE_CA`
  refusé en production).

## R-05 Inscription et révocation d'une passerelle hors API publique (FR-002, décision de contexte)

- **Décision** : un outil d'administration `tools/edge-admin` (commande `npm run edge-admin -w ...`, sur le modèle de
  `tools/export`), qui se connecte par un rôle **`cashless_edgeadmin`** (même forme que les rôles de `post-roles.sql:254-262`,
  `CASHLESS_EDGEADMIN_PASSWORD`, `DATABASE_URL_EDGEADMIN`, jamais utilisé par un processus de service) dont le seul droit est
  `EXECUTE` sur :
  - `register_edge_gateway(operator, event, serial, role, lan_url, cert_sha256, public_key, agreement_public_key,
    snapshot_public_key, actor_label)` : crée la ligne (statut `ACTIVE`), vérifie l'événement du prestataire, un seul `PRIMARY`
    non révoqué par événement (contrôle de la fonction sous verrou par événement, **pas d'index unique** : il casserait les suites générées
    du kit, A04, voir data-model A.2), longueurs (32 octets, 65 octets P-256 non compressé),
    inscrit la clé publique de snapshot (`snapshot_signing_key`, `owner = 'EDGE'`, `S:2295-2308`), écrit une ligne d'audit et **lève une alerte
    immédiate** (A16) ;
  - `revoke_edge_gateway(gateway, reason, actor_label)` : `status = REVOKED` si aucun handover ouvert (sinon refus : on passe par
    la reprise forcée, R-06) ; audit ;
  - `rotate_edge_gateway_cert(gateway, new_cert_sha256, actor_label)` : remplace l'empreinte (rotation du certificat, ancienne
    empreinte refusée aussitôt) ; audit.
  `swap_edge_gateway_roles(old, new)` : échange atomique de `PRIMARY` et `STANDBY` pour la promotion (A25), refusé tant qu'un handover est
  ouvert, alerte immédiate, repart le délai des colis. **Inscription par UNE personne** (choix du porteur contre la recommandation de
  la passe contradictoire, décision 16) : aucune approbation à deux ; compensée par l'alerte immédiate et par un **délai avant l'envoi des
  mots de passe** (`EDGE_PACK_DELAY` = 30 minutes, porteur, 05/11/2026) ; rien n'est servi à une `STANDBY` non promue.
  Écart accepté, dette nommée (`OP-N105`, `ADR-160`), test de borne : inscription par une personne, alerte levée, aucun colis avant le délai,
  aucun colis à une `STANDBY`.
  L'outil ne fait que demander le certificat au port `EDGE_CA` (R-04), calculer l'empreinte et appeler la fonction ; il écrit le
  matériel de la passerelle (certificat, clé de signature, clé d'accord : leurs clés privées naissent dans le port de stockage
  matériel de la passerelle, jamais ici, R-19/R-27) dans un fichier d'enrôlement à usage unique pour le site.
- **Justification** : décision du porteur (aucune route d'inscription dans le contrat, pas d'ajout aux équipes clientes) ;
  `edge_gateway` n'a ni `registered_by` ni audit (`S:726-745`) ; `cashless_app` peut aujourd'hui insérer et modifier la table
  entière (R-06), ce qui est précisément ce qu'on ferme.
- **Alternatives écartées** : route `/admin/edge-gateways` (change le contrat, C-002) ; `INSERT` direct par un administrateur de
  base (aucune trace, aucun contrôle).
- **Relecture humaine** : l'outil, le rôle, les trois fonctions.

## R-06 Droits : écriture directe fermée, liaison passerelle/handover, reprise forcée prouvée

Renforcements, à faire puis consigner (règle 1, décision 6 du porteur) :

1. **Retrait de l'écriture directe** : `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON edge_gateway FROM cashless_app` dans `0058`
   (aujourd'hui `roles.sql:14-15` lui laisse INSERT et UPDATE sur toutes les colonnes ; `edge_gateway` n'est dans aucune liste
   de `post-roles.sql`, vérifié par grep). Elle pouvait réécrire `contiguous_edge_seq`, `last_chain_hash`, `status` (annuler
   `REVOKED`), `cert_sha256`, `public_key`. Fermé dans la mission : OP + ADR ouverts puis clos, test pgTAP sous
   `cashless_app` (rejet des écritures) et mise à jour de `tests_offline_rights.sql` (liste figée des tables).
2. **Liaison passerelle/handover** par **enveloppes** `SECURITY DEFINER` (les fonctions S12 gardent leur signature, C-003) :
   `edge_ack_handover(p_gateway, p_handover, p_epoch, p_replicated)`, `edge_complete_release(p_gateway, p_handover, p_epoch,
   p_final_seq, p_last_hash, p_ops_count)`, `edge_record_seq(p_gateway, ...)`, chacune vérifiant `p_gateway =
   current_setting('app.gateway_id')`, statut non `REVOKED`, rôle `PRIMARY`, et `h.edge_gateway_id = p_gateway`. Les S12 brutes
   ne sont accordées à aucun rôle applicatif.
3. **`record_edge_seq` renforcé** (via `edge_record_seq`, la fonction S12 elle-même n'étant plus joignable) : refuse une passerelle
   `REVOKED` ou `STANDBY`, et exige un handover `TO_EDGE ACTIVE`, ou `TO_CENTRAL RELEASE_REQUESTED/RELEASING`, de cette passerelle
   pour le grand livre. Aujourd'hui elle accepte une passerelle révoquée ou sans handover (`S:2726-2756`, vérifié).
4. **Reprise forcée avec preuve** : `force_central_authority_approved(ledger, approval_request, reason)` lit
   `approval_request` (action `FORCE_CENTRAL_AUTHORITY`, statut `APPROVED`, demandeur et valideur distincts, tous deux
   `OPERATOR_ADMIN` du prestataire, jamais exécutée) puis appelle `force_central_authority`. Aujourd'hui celle-ci ne contrôle
   que la distinction de deux identifiants (`S:2670-2704`) : la preuve d'approbation vient de l'API ; la déplacer dans la base
   est un renforcement. Appelée par l'API (jamais par la passerelle).
5. **`fail_edge_grant`** : sa trace d'auteur manque (`p_actor` inutilisé) ; l'enveloppe humaine écrit l'audit côté API
   (`AuditService`), l'enveloppe ne change pas la fonction.
- **Alternatives écartées** : ajouter `p_gateway` aux S12 par nouvelles signatures (casse C-003 et les tests générés du kit,
  `tests_grand_livre_cashless.sql:495-545`) ; se contenter du certificat TLS (une passerelle `PRIMARY` d'un autre événement du
  même prestataire pourrait accuser ou rendre le handover d'une autre, vérifié : les S12 ne reçoivent pas l'identité).

## R-07 Fonctions SQL manquantes (liste fermée)

Toutes `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC`, accordées nommément (jamais `ALL
FUNCTIONS`), `assert_tenant` en tête, ordre de verrous C-012 : verrous consultatifs d'abord (celui de `post_transaction`,
`S:537`), puis lignes, dans l'ordre ledger, passerelle, handover.

| Fonction | Rôle | Accordée à |
|---|---|---|
| `identify_edge_gateway(cert)` | R-04 | `cashless_edge` |
| `touch_edge_gateway(gateway)` | `last_seen_at` à chaque appel authentifié (le long-polling vaut battement de cœur, OA:6836-6838), `ISOLATED -> CATCHING_UP` (R-15) | `cashless_edge` |
| `get_current_edge_handover(gateway)` | lecture d'UN handover par priorité (A13) : le `TO_CENTRAL` ouvert l'emporte sur le `TO_EDGE ACTIVE` ; à défaut le dernier `TO_CENTRAL` `FAILED` du `TO_EDGE` actif ; à défaut le `TO_EDGE` `GRANTED`/`ACTIVE`, avec époque et filigrane | `cashless_edge` |
| `get_debit_authority(ledger)` | autorité, époque, passerelle désignée, `edge_base_url` (`lan_url`) | `cashless_app`, `cashless_edge` |
| `begin_edge_release(gateway, handover, epoch, final_seq, last_hash, ops_count)` | **pose `RELEASING` dans sa propre transaction, committée, avant toute vérification** (SP:645-648, OA:6916) ; idempotente ; `RELEASE_REQUESTED -> RELEASING` seulement ; ne vérifie rien d'autre que l'appartenance | `cashless_edge` |
| `edge_complete_release(...)` | R-06 : appelle `complete_edge_release`, plus `ops_count = final_edge_seq - edge_seq_at_activation` du cycle (A05, la numérotation ne repart jamais de zéro ; renforcement : `operations_count` n'est vérifié nulle part aujourd'hui, `S:2638-2667`) ; erreurs CL014 (avec `missing_edge_seqs`) et CL017 ; **la ligne `RELEASING` posée avant reste** parce que la pose est une transaction distincte | `cashless_edge` |
| `fail_edge_release(handover, actor)` | `TO_CENTRAL RELEASE_REQUESTED/RELEASING -> FAILED` (transition permise par `S:2519-2528`, SP:651-652, sans fonction aujourd'hui) ; l'autorité reste à la passerelle ; humaine | `cashless_app` |
| `edge_ack_handover(...)`, `edge_record_seq(...)` | R-06 ; `edge_ack_handover` est **idempotente** (A17 : déjà `ACTIVE`, même passerelle et même époque, rend `200` sans écrire) et refuse (`CL014`) tant que le curseur de référence appliqué n'a pas atteint celui de l'accord (A03) | `cashless_edge` |
| `swap_edge_gateway_roles(old, new)` | A25, échange atomique des rôles | `cashless_edgeadmin` |
| `edge_record_staff_token_audit(...)` | décision 18, audit de la tolérance versé par le lot | `cashless_edge` |
| `edge_post_transaction(...)`, `edge_activate_media(...)`, `edge_take_deposit(...)`, `edge_topup_cash(...)` | R-09, R-10 | `cashless_edge` |
| `edge_sync_batch_begin / edge_sync_batch_result(...)` | R-08 | `cashless_edge` |
| `edge_replication_page(gateway, after_posting, after_change, limit)` | R-08, R-24 ; horizon de postings et journal `change_seq` | `cashless_edge` |
| `mark_edge_gateways_silent(threshold)` | `ISOLATED` et retour au calme (R-15) | processus de maintenance existant |
| `register_edge_gateway`, `revoke_edge_gateway`, `rotate_edge_gateway_cert` | R-05 | `cashless_edgeadmin` |
| `force_central_authority_approved(...)` | R-06 | `cashless_app` |

- **Pas d'expiration automatique de `GRANTED`** : aucune fonction du schéma n'en prévoit (`S:2547-2616`), et un accord perdu
  laisse le grand livre sans autorité qui débite (les terminaux passent en hors ligne avec plafonds, spec Edge Cases). Décision :
  l'abandon est une action d'admin (`fail_edge_grant`), la procédure de site le dit ; une alerte « accord sans accusé depuis
  plus de 120 s » (FR-034) prévient. Pas d'écart (rien n'est affaibli) ; une expiration automatique serait un confort,
  jugé hors périmètre.
- **Transition `RELEASE_REQUESTED -> COMPLETED` directe** (permise par la table `S:2523`) : `edge_complete_release` la refuse
  si le handover n'est pas passé par `RELEASING` (renforcement, évite un `COMPLETED` sans la pose exigée par SP:648).
  Voir « Contradictions » n° 2.

## R-08 Table d'idempotence des lots et lecture du flux

- **Table `edge_sync_batch`** (centrale, nouvelle, `0059`) : `batch_id` (clé d'idempotence = en-tête `Idempotency-Key`),
  `operator_id`, `gateway_id`, `ledger_id`, `epoch`, `edge_seq_from`, `edge_seq_to`, `request_sha256` (empreinte JCS du corps sans
  la signature), `status` (`RECEIVED`, `PROCESSING`, `DONE`, `ABANDONED`), `received_at`, `completed_at` ; **`edge_sync_batch_result`**
  `(batch_id, edge_seq)` -> issue, `transaction_id`, `reason`, `detail`, `retryable`. Les tables du lot de terminal
  (`offline_batch.device_id`, `S:2121` ; `offline_op_result(batch_id)`, `0046:193-200`) sont liées à un terminal : on ne les
  détourne pas. Un rejeu du même `batch_id` avec le même `request_sha256` renvoie les résultats mémorisés ; avec un autre :
  `422 IDEMPOTENCY_KEY_REUSED`. **Un seul lot en vol par passerelle** (index unique partiel sur `status IN ('RECEIVED',
  'PROCESSING')`), calqué sur `offline_batch_one_in_flight` (`S:2143`). Abandon après 15 minutes de traitement interrompu
  (même règle que le lot de terminal, SP §6.2-6). **Lot `ABANDONED` (A29)** : ses résultats sont partiels (`abandoned: true`, OA:14409-14412) ;
  la passerelle n'en redemande pas la lecture : elle renvoie le reste dans un **nouveau `batch_id`**, avec `edge_seq_from` = premier numéro non
  enregistré. Test : lot abandonné, reprise sous un autre `batch_id`.
- **Traitement** : opération par opération, chacune dans **UNE seule transaction** (SP:408-446, A06) qui contient l'écriture ET l'appel à
  `record_edge_seq` (aucune exception possible après lui, voir data-model A.4 bis) : (1) écriture (R-09/R-10) ou `DUPLICATE` si la clé d'origine
  existe déjà, (2) `record_edge_seq` (ordre strict, CL016) avec la transaction écrite, (3) résultat mémorisé. Reprise après arrêt du central :
  le lot est repris à la première opération sans résultat (la même chaîne de reprise que la mission 7).
- **Issues du registre** : `edge_sync_registry.outcome` n'admet que quatre issues (`S:2715`) alors que `EdgeSyncOperation` hérite de `VOID` et `ONLINE_REF` (OA:14416-14418) ; la migration ajoute `VOID` (numéro consommé sans effet comptable) par remplacement de la contrainte, la table restant immuable. `WAIVED` n'est pas ajoutée (levée de trou de terminal, hors file de passerelle).
- **Lecture du flux** : `edge_replication_page(gateway, after_posting, after_change, limit)` renvoie la page par une fonction étroite, jamais par
  `SELECT` direct sur `posting`, `media` ou `tag_data_key`. Contenu : voir `contracts/replication-page-additions.yaml` (seule définition). En
  substance : soldes `paid`/`promo` des portefeuilles dont une écriture a un `posting.id > after`, plus `edge_seq_applied` ; état des bracelets,
  statuts de portefeuilles, sessions, terminaux, personnes, catalogue et réglages par le journal `change_seq` (`reference`) ; mots de passe
  chiffrés sous une clé de contenu **par passerelle** scellée pour sa clé d'accord (`pwd_pack_key`), seulement pour une passerelle `PRIMARY` non
  `REVOKED` passé le délai d'inscription (A16, `STANDBY` : rien). Aucune clé maître ne quitte le central (C-009) : le colis est produit par le
  processus qui détient déjà l'accès aux clés de données (`tag-keys`, modèle `getMediaAuthKey`), qui dépose les colis chiffrés dans `edge_pwd_pack`
  (data-model) ; la fonction SQL ne lit que cette table.
  La page est lue dans **une transaction `REPEATABLE READ`** pour que `edge_seq_applied` soit cohérent avec les soldes.
  **Pas de saut d'écriture validée hors ordre (A18)** : les `posting.id` sont attribués avant la validation, un `id` 100 peut valider après un
  `id` 101 déjà lu. Le central borne donc `to_posting_id` à un **horizon** : un verrou exclusif de l'autorité de débit, très bref (`lock_timeout`
  200 ms), attend la fin des écritures en vol (elles tiennent le verrou partagé jusqu'à leur validation) le temps de lire `max(posting.id)`, puis est
  relâché ; aucune écriture d'`id` inférieur à l'horizon n'est encore en vol. En cas d'échec d'obtention, l'horizon précédent est servi. Test à deux
  sessions concurrentes, validation retardée volontairement.
  **Blocages et état de service (A03)** : un blocage ne crée aucun `posting`. Le statut des bracelets et des portefeuilles est livré par le journal
  `change_seq` (`reference.media_refs[].status`, `reference.wallet_states`), pas par `posting.id`. **L'accusé de bascule est refusé** tant que le
  curseur `change_seq` appliqué par la passerelle (consigné par le central à chaque requête, `reference_applied_seq`) n'a pas atteint le curseur
  pris à l'accord (`reference_watermark_seq`, sous le verrou exclusif de `grant_edge_authority`). Comme le grand livre ne débite plus au central
  depuis le commit de `GRANTED`, cette lecture est exacte. Test : bracelet bloqué sans écriture une seconde avant la bascule, vente refusée dès la
  première requête après l'accusé.
- **Plafond de page** : `limit` est le paramètre partagé `Limit` du contrat (valeur par défaut et maximum à lire dans
  `components/parameters/Limit` au moment du codage) ; le serveur borne aussi la taille en octets (2 Mio) et met `has_more`.

## R-09 Écriture `EDGE_SYNC` : enveloppe, garde, reprise de `edge_decision`, bornes de sécurité (décision 5)

- **Enveloppe** : `edge_post_transaction(p_gateway, p_epoch, p_origin_key, p_origin_occurred_at, p_origin_mode, p_media, p_amount, p_type,
  p_decision, ...)` (accordée à `cashless_edge` seule). **Elle construit elle-même les lignes** du portefeuille et de l'attente (A06) au lieu de
  recevoir `p_lines` libres. Elle vérifie : passerelle non `REVOKED`, `PRIMARY`, `app.gateway_id` ; un handover
  `TO_EDGE ACTIVE` de cette passerelle pour le grand livre, **ou** `TO_CENTRAL RELEASE_REQUESTED/RELEASING` de la même
  époque (vidange, OA:7027-7029) ; `p_epoch` égal à l'époque du handover (sinon `STALE_AUTHORITY_EPOCH`, CL015) ;
  `origin_key`, `origin_occurred_at`, `origin_mode` présents et bien formés (SP:710-713, SPEC:413 « DOIT » : la fonction
  `post_transaction` ne contrôle pas `p_metadata` aujourd'hui) ; ces trois valeurs sont écrites dans `journal_transaction.metadata`.
- **Garde dans `post_transaction`** (`CREATE OR REPLACE` en `0058`, signature et corps inchangés sauf une garde) : une écriture de
  source `EDGE_SYNC` est refusée quand `session_user` est le rôle de connexion `cashless_app` (la source la plus puissante, seule
  à débiter sous `EDGE`, n'est plus écrivable par le code de l'API publique). On teste `session_user` parce que la fonction est
  `SECURITY DEFINER` (`current_user` y est le propriétaire) ; l'écriture directe en propriétaire reste permise pour ne pas
  casser les tests générés du kit (`tests_grand_livre_cashless.sql:118`, `gen_tests.py:166`, qui appellent `post_transaction` en
  `EDGE_SYNC` sous le propriétaire et qu'on ne modifie pas, C-010). Forme exacte (liste d'autorisation `cashless_edge` +
  propriétaire contre liste de refus `cashless_app`) à trancher à l'écriture : la liste d'autorisation est préférée ; la preuve
  exige **une connexion réelle** sous `cashless_app` (un `SET ROLE` ne change pas `session_user`) en pgTAP via un test d'intégration
  Jest dont c'est la mission (un test de pgTAP seul ne prouverait rien, constat identique pour `tests_grand_livre_cashless.sql:539-542`).
  Fichier à faire relire par une personne : `0058`, `post-roles.sql`.
- **Reprise de `edge_decision`** (SP:714-716) : le central écrit la répartition portefeuille / attente **telle quelle**
  (`status`, `charged_to_wallet`, `shortfall_amount`, `shortfall_reason`, `reject_reason`) et ne recalcule que frais et
  commissions. Le moteur actuel ne le fait pas : le manque (`shortfall`) n'est calculé que pour `OFFLINE_SYNC`
  (`ledger-engine.service.ts:231`), l'écrivain `offline-sale.writer.ts:95` code `source: 'OFFLINE_SYNC'` en dur et décide par la
  table de conflit du central ; aucun code ne lit `edge_decision` (grep : zéro occurrence dans `src/`). On ajoute un écrivain
  `edge-sync.writer.ts` qui prend la décision de la passerelle et passe par `coveredCap` (`purchase.ts:20`) avec
  `charged_to_wallet`, source `EDGE_SYNC`, comme point d'attache. La part de manque va en `S-ATTENTE`, anomalie
  `OFFLINE_SHORTFALL` (le type existe, `S:852`).
- **Bornes de sécurité côté central, EN SQL, dans l'enveloppe, sous verrou de compte** (renforcements, A06, A07, A08 ; liste complète et
  ordre dans `data-model.md` A.4 bis, qui fait foi) : (1) liste blanche de types ; (2) comptes de la forme attendue pour le type (portefeuille du
  bracelet désigné, compte marchand du point de vente du terminal d'origine lu en base, caisse de la session, `S-ATTENTE`) ; (3) plafond de rejeu
  par vente ; (4) `charged_to_wallet` rogné à la borne sous verrou (solde central, `spend_order`), l'excédent en `S-ATTENTE` avec la raison
  `INSUFFICIENT_FUNDS` ; (5) `CL007` : voir ci-dessous ; (6) preuve du bracelet au rejeu (objet `tap` : compteur strictement croissant, UID,
  signature vérifiée par le processus des clés, `token_hash` désignant le portefeuille débité) ; (7) plafond par terminal et par heure, avec alerte ;
  (8) `REVERSAL` : mêmes contrôles qu'en ligne et crédit au plus égal au `charged_to_wallet` écrit au central ; (9) activation : portefeuille
  inexistant ; (10) caution : compte de caisse de la session du terminal ; (11) recharge espèces : deux parts, jamais de rejet pour un plafond.
  Une décision incohérente (`charged + shortfall <> amount`, montants négatifs, `shortfall_reason` absente) est `REJECTED` avec la raison
  **`MALFORMED_OPERATION`** et le détail dans `detail` (valeur existante d'`OfflineRejectReason`, A11), anomalie `NON_COMPLIANT_OPERATION`, rien
  d'écrit. `edge_decision` est obligatoire pour tout type qui porte un montant (`PURCHASE`, `REVERSAL`, `TOPUP_CASH`, `DEVICE_OFFLINE`) bien qu'il
  soit absent de `required` (OA:14420) : l'opération sans décision est `REJECTED`, jamais devinée (« Contradictions » n° 7). Une opération de
  passerelle ne touche jamais un autre grand livre que celui du handover ; un `edge_seq` ne sert qu'une fois (registre immuable, `UNIQUE
  (gateway_id, origin_key)`, `S:2707-2724`).
- **Traitement de `CL007` en `EDGE_SYNC` (A06)** : la borne (4) lit le solde sous verrou, donc `CL007` ne doit pas survenir. Si elle survient, la
  transaction de l'opération est annulée en entier (numéro non consommé), rejouée une fois ; en cas de nouvel échec, une seconde transaction
  enregistre le numéro avec `REJECTED` / `INSUFFICIENT_FUNDS_RETRY` (`retryable`, valeur existante) et une anomalie. Le vidage ne se bloque jamais et un
  numéro n'est jamais consommé sans résultat.
- **Risque résiduel `EDGE_ONLINE` et perte maximale chiffrée (A07, décision 13, accepté par ADR)** : aucune signature du terminal n'est relayée pour
  `EDGE_ONLINE` (`device_batches` n'existe que pour `DEVICE_OFFLINE`) et la passerelle ne détient aucune clé de bracelet. Une passerelle compromise ne
  peut donc pas inventer de passage de bracelet : elle ne peut que réutiliser des passages réels (chacun une fois, compteur croissant). Perte maximale
  pendant un cycle `EDGE` :
  `P_max = min( Σ des soldes centraux des portefeuilles de l'événement ; T × H × plafond_terminal_heure ; N_passages_réels × plafond_vente )`
  où `T` = nombre de terminaux de l'événement, `H` = durée en heures du cycle `EDGE`, `N_passages_réels` = passages de bracelet réellement lus pendant le
  cycle. Les termes 2 et 3 dépendent des plafonds, **fixés par le porteur le 05/11/2026 : 50 000 XOF par vente, 500 000 XOF par terminal et par heure, réglables côté plateforme, proposition à revoir en recette ; exemple : 20 terminaux, coupure de 5 h, `T × H × plafond` = 50 M XOF** (la décision 13 ne les chiffre pas ; ordre de
  grandeur illustratif seulement : 40 terminaux, 6 h, 150 000 XOF par terminal et par heure donneraient 36 000 000 XOF au plus, borné aussi par la somme
  des soldes de l'événement). Au-delà des plafonds : part en `S-ATTENTE`, alerte, rien n'est perdu pour le commerçant. Écart accepté : `OP-N104`,
  `ADR-159`. Test de borne : vente au rejeu sans `tap` valide, avec compteur non croissant, ou au-delà du plafond horaire : refusée ou rognée avec alerte ; la
  perte maximale se mesure sur un scénario de passerelle hostile (2 000 ventes fictives).
- **Alternatives écartées** : laisser `post_transaction` ouvert à `cashless_app` en `EDGE_SYNC` (écarté : contrôle reporté,
  règle 1) ; recalculer la décision au central (écarté : contredit SP:714-716 et rendrait deux autorités) ; refuser un
  `charged_to_wallet` supérieur au solde central par un rejet pur (écarté : l'argent a été donné au terminal, la perte
  doit aller en compte d'attente, pas disparaître).

## R-10 `take_deposit`, `activate_media` et recharge espèces en `EDGE_SYNC`

- **Constat** : `take_deposit` code la source `'ONLINE'`, la clé `deposit:<media>:<n>` et `now()` (`S:1596-1620`) ; elle n'est plus
  accordée à `cashless_app` (l'API passe par `take_deposit_for_session`, `0036:640-657`, qui exige `cash_session_usable` : session
  `OPEN` du même grand livre) ; `activate_media` n'a ni source ni clé d'origine et n'écrit au grand livre que `preload_media`
  (`BATCH`, `S:1336-1360`). SP:745-751 et SPEC:413 exigent `EDGE_SYNC` et la clé d'origine : contradiction signalée (n° 5).
- **Décision** : trois fonctions nouvelles, sans toucher aux existantes (leur comportement en ligne est inchangé et couvert par
  leurs tests) :
  - `edge_activate_media(gateway, origin_key, media, wallet, event, channel, occurred_at)` : mêmes contrôles que
    `activate_media` (dont `activation_modes`, CL020) **et, pour une activation anonyme, un portefeuille inexistant créé par l'enveloppe, jamais
    rattaché à un portefeuille existant** (A24), puis écriture de `preload_media` en source `EDGE_SYNC` avec la clé
    d'origine et les métadonnées `origin_*` ; rejeu d'un bracelet déjà actif : résultat `DUPLICATE` si c'est la même clé
    d'origine, sinon `REJECTED EDGE_REPLAY_FAILED` (SP:738-753).
  - `edge_take_deposit(gateway, origin_key, media, cash_session, occurred_at)` : mode `SEPARATE` espèces seulement, **compte de caisse tiré de
    la session du terminal d'origine, jamais de la requête** (A24), clé
    d'idempotence `origin_key`, source `EDGE_SYNC` ; passe par la garde de caisse (R-11). `FROM_BALANCE` : refusé (CL006,
    cohérent avec SP:752-758).
  - `edge_topup_cash(gateway, origin_key, media, cash_session, amount, occurred_at)` : recharge espèces décidée par la
    passerelle (décision du 05/11), source `EDGE_SYNC`, session de caisse `OPEN` de ce terminal et de ce grand livre, rattachement à
    `cash_session_tx` (`cash_session_attach_own`). **Sur la passerelle**, les plafonds réglementaires sont contrôlés avec les données répliquées
    (`kyc_verified`, `topup_month_paid`, `wallet_limits`) comme en ligne (`422 WALLET_LIMIT_EXCEEDED`, `422 MONTHLY_TOPUP_LIMIT_EXCEEDED`).
    **Au rejeu (A09, décision 14), la recharge n'est jamais rejetée pour un plafond** : écrite en deux parts par `wallet_topup_headroom`
    (portefeuille jusqu'à la marge, reste en `L-ESP-A-RENDRE`), `ACCEPTED` et anomalie `CASH_TOPUP_OVER_LIMIT` (protocole §8, cas 22, ADR-63),
    résolue à deux ; toute autre cause de rejet (session fermée par un chemin non couvert, bracelet retiré) ouvre une anomalie portant montant, terminal
    et clé d'origine, et les ventes qui en dépendent sont traitées comme un manque. **À signaler au juriste** : entre la recharge locale et son rejeu,
    le solde local peut dépasser temporairement un plafond réglementaire que l'état central a entre-temps rendu plus strict (`OP-N108`, `ADR-163`).
- **Rejeu impossible** (SP:738-753, FR-020) : résultat `REJECTED`, raison `EDGE_REPLAY_FAILED`, `detail` = code, aucun
  `transaction_id` (le registre l'interdit, `S:2723`), anomalie `EDGE_REPLAY_FAILED` (le type existe, `0038:1286`). Pour les
  espèces d'une caution : l'écriture d'attente de SP:746-750 (débit de la caisse, crédit `SUSPENSE`, `metadata.replay_failed`)
  **n'est écrite que si la session d'origine est encore `OPEN`** ; sinon la garde de caisse la refuserait (CL029) et l'ensemble
  de l'opération planterait. Dans ce cas : aucune écriture, anomalie portant le montant, le terminal et la clé d'origine, résolution
  à deux (`ANOMALY_RESOLUTION`) ; les espèces sont comptées au comptage de fermeture comme écart expliqué par l'anomalie. Aucune
  perte silencieuse. Voir « Contradictions » n° 6.
- **Clé d'origine (A10)** : toutes les opérations de guichet (`ACTIVATION`, `DEPOSIT_CASH`, `TOPUP_CASH`) utilisent comme `origin_key`
  l'`Idempotency-Key` de la requête du terminal, `<device_serial>:<seq>` (le contrat la déclare pour `activateMedia`, `takeDeposit` et
  `createCashTopup`), et `seq` de l'opération est ce `seq` de terminal. `edge_seq` ne sert qu'à l'ordre. Quand une requête produit deux opérations
  (activation avec caution), la caution porte `<serial>:<seq>#deposit`. Conséquences : (a) le journal que renvoie un terminal après une reprise forcée
  porte des clés que le central retrouve parmi celles déjà rejouées (pas d'anomalie `EDGE_REPLAY_FAILED` pour des opérations réussies) ; (b) une requête
  envoyée au central puis rejouée sur la passerelle porte la même clé : `edge_activate_media` cherche aussi la clé dans le registre d'idempotence de la
  route en ligne et rend `DUPLICATE`. Tests : même requête au central puis à la passerelle ; journal après reprise forcée.
- **Alternatives écartées** : modifier `take_deposit` pour lui passer une source (change une fonction éprouvée et ses gardes pour
  un cas d'usage de la passerelle) ; réutiliser `take_deposit_for_session` (source `ONLINE` : refusée en `CLOSING`, et aucune
  clé d'origine).

## R-11 Garde de caisse ADR-132, `begin_cash_close` et session (décision 6)

- **Constat** : `posting_cash_desk_guard` (`0036:500-529`, ADR-132) exige, pour tout `posting` sur un compte de `cash_desk`, une session
  `OPEN` de ce compte (et le même terminal si la transaction porte un `device_id`) ; elle vaut pour toutes les sources et tous
  les rôles. `begin_cash_close` (`0036`, rempli en `0040:19-60`) ne regarde ni `debit_authority`, ni les files `EDGE_SYNC` en attente.
- **Décision** :
  1. Garde de caisse **inchangée**, sans exemption (C-005). Un rejeu `EDGE_SYNC` qui touche la caisse exige la session `OPEN` ;
     le cas contraire est le « rejeu impossible » de R-10.
  2. **`begin_cash_close` refusé (`409 CONFLICT_STATE`, SQLSTATE `CL029`)** tant que (a) l'autorité du grand livre est `EDGE` ou un
     handover `TO_EDGE`/`TO_CENTRAL` est ouvert, ou (b) la file de la passerelle contient une opération non rejouée pour ce terminal
     (le central ne le sait que par `edge_seq` reçus : il refuse tant que la passerelle n'est pas revenue à `CENTRAL`, ce qui suffit
     puisque le rendu exige la file vide, R-07). `CREATE OR REPLACE` de `begin_cash_close` en `0058`, ordre de verrous de `0040`
     conservé (terminal, session, solde), garde ajoutée **après** les verrous. Code d'erreur déjà déclaré par le contrat
     (OA:2577), mais c'est un changement de comportement hors `/edge/*` : couvert par la décision 6 du porteur, **pas** par la règle de
     contrat de la décision 7 ; à consigner (ADR, `PRD.md`) comme comportement nouveau.
  3. `grant_edge_authority` (via l'enveloppe humaine, R-03) refuse la bascule (`CL013`) si une session de caisse du grand livre est en
     `CLOSING` (un comptage en cours serait faussé par les recharges de la passerelle).
  4. Les ouvertures de session et les relèves restent au central (C-005) ; la passerelle ne les sert pas (`x-edge-available` ne
     les prévoit pas, OA:2451, 2535). Une session ouverte après la bascule n'est jamais répliquée comme utilisable (R-24 : seules
     les sessions ouvertes **avant** la bascule portent `usable_on_edge = true`).
  5. Session fermée au central pendant `EDGE` par un chemin que la garde ne couvre pas (reprise forcée, suppression par un
     opérateur) : la fermeture répliquée met fin aux recharges (US 3, Edge Cases) ; les recharges déjà faites sur le site mais non
     rejouées tombent dans le cas de rejeu impossible (R-10) ou, pour `TOPUP_CASH`, dans la décision 4 (R-23).
- **Alternatives écartées** : exempter les écritures `EDGE_SYNC` de la garde (affaiblit ADR-132) ; rattacher a posteriori à une
  session fermée (option (b) de R-protocole §3.5 : modifie un comptage déjà signé) ; « caisse complémentaire » (option (c) : état
  nouveau sans source).
- **Relecture humaine** : `begin_cash_close`, `grant_edge_authority` (garde ajoutée), `0036`/`0040` touchés par remplacement.

## R-12 `content_sha256`, chaîne de la passerelle et vecteurs

- **Décision** (fixée ici, SP:701 ne la fixait pas) : pour une opération de passerelle de numéro `n`,
  `content_sha256(n) = SHA-256(JCS(edge_content(op)))` où `edge_content(op)` est l'objet JSON (RFC 8785, `canonicalize` déjà
  présent) formé de :
  1. les onze champs chaînés de l'opération, obtenus **par la même fonction** `chainedContent` (`CHAINED_FIELDS` :
     `seq, type, occurred_at, amount, currency, tap, lines, reverses_seq, reverses_transaction_id, online_operation,
     void_reason`, champs absents omis, valeurs prises telles quelles, `payments/chained-content.ts:10-22`) ;
  2. `edge_seq` (entier sûr, comme `seq`) ; `device_serial` ; `authorized_mode` ;
  3. `device_batch_id` s'il est présent ; `edge_guichet` s'il est présent (objet entier, champs absents omis) ;
  4. `edge_decision` s'il est présent (objet entier : `status`, `charged_to_wallet`, `shortfall_amount`, `shortfall_reason`,
     `reject_reason`, absents omis).
  `edge_decision` est **inclus** : la décision est ce que le central reprend, la chaîne doit la protéger (si elle était exclue, un
  maillon altéré en transit changerait le résultat sans rompre la chaîne). Le central calcule `p_content` de la même façon à
  partir de l'opération reçue et le donne à `edge_record_seq` (qui attend une empreinte déjà faite, `S:2726`).
- **Chaîne** : `chain_hash(0) = SHA-256("CASHLESS/EDGE-CHAIN/v1" ‖ uuid_send(gateway_id))` (`edge_chain_genesis`, `S:1979-1981`,
  UUID en 16 octets bruts) ; `chain_hash(n) = SHA-256(chain_hash(n-1) ‖ content_sha256(n))` (`chain_step`, `S:1973`). La
  passerelle recalcule avec le même code (paquet partagé, R-02), le central avec `chain_step`.
- **Cas des opérations de guichet** : `ACTIVATION` et `DEPOSIT_CASH` sont hachées par la même règle (champs chaînés présents :
  `seq`, `type`, `occurred_at`, `amount` = caution ou 0, `currency`, `tap` si lu), plus `edge_guichet` et `edge_seq`. Le hachage
  qu'enverrait plus tard un terminal en `ONLINE_REF` pour une activation ou une caution (SP:415-419) n'est **pas** le même objet :
  la passerelle n'a donc pas à le reproduire au bit près ; en revanche la CLÉ d'origine est la même (`<serial>:<seq>`, R-10, A10), ce qui permet au
  central de reconnaître une opération déjà rejouée ; la décision 4 (R-23) traite la reprise forcée sans supposer d'autre égalité.
- **Sens de `chain_hash` dans `EdgeSyncOperation`** : `OfflineOperation.chain_hash` est requis (OA:14129) et l'exemple de la
  spec lui donne tantôt la chaîne du terminal, tantôt celle de la passerelle (OA:14550 contre 14623). Décision : `authorized_mode =
  EDGE_ONLINE` : `chain_hash` = la chaîne de la **passerelle** au `edge_seq` (le terminal n'a pas de maillon pour une opération
  que la passerelle seule a décidée) ; `DEVICE_OFFLINE` : `chain_hash` = le maillon de la chaîne du **terminal** (celui du lot
  d'origine), vérifié contre `device_batches[].header` ; la chaîne de la passerelle est portée par `prev_chain_hash` /
  `last_chain_hash` du lot et par `edge_record_seq`. Voir « Contradictions » n° 8.
- **Vecteurs à fixer (références)** : générés par un script indépendant, jamais par le code testé (méthode de
  `apps/api/test/fixtures/offline-vectors/gen_vectors.py` et `vectors.json`, 10 cas) : nouveau fichier
  `apps/api/test/fixtures/edge-vectors/gen_edge_vectors.py` + `vectors.json`, lu par les tests de l'API, du paquet partagé et de la
  passerelle. Cas : (a) genèse pour un UUID donné ; (b) trois maillons `EDGE_ONLINE` `PURCHASE` puis `VOID` puis `REVERSAL` ;
  (c) un `DEVICE_OFFLINE` relayé avec `device_batch_id` ; (d) `ACTIVATION` ; (e) `DEPOSIT_CASH` ; (f) `TOPUP_CASH` ;
  (g) `edge_seq` = 2^32 et `edge_seq` = 2^53 - 1 ; (h) le même contenu avec et sans `edge_decision` (empreintes différentes) ;
  (i) une propriété inconnue dans `tap` (conservée telle quelle) ; (j) `edge_seq` 2^53 refusé. Aucun vecteur « EDGE » n'existe
  aujourd'hui hors `EG = edge_chain_genesis(...)` de `gen_tests.py:662` (vérifié).
- **Alternatives écartées** : exclure `edge_decision` (voir ci-dessus) ; hacher le corps JSON brut de l'opération (la
  canonicalisation JCS est la règle du projet, SP §3.3) ; réutiliser tel quel le hachage d'une opération de terminal (il n'a pas
  `edge_seq`, ne lie pas la position dans la file).

## R-13 Signature du lot par la passerelle

- **Décision** : `EdgeSyncBatch.signature` = ECDSA P-256 / SHA-256 de la passerelle (clé privée dans le port de stockage matériel,
  R-19) sur `JCS(lot sans le champ signature)`, en base64 (format de la signature du terminal, OA:14541-14543). Le central
  vérifie avec `edge_gateway.public_key` avant tout traitement : invalide -> `400 BATCH_SIGNATURE_INVALID`, lot non traité,
  alerte. Les signatures d'origine des lots de terminal relayés (`device_batches`) sont vérifiées avec `device.public_key` et la
  chaîne du terminal recalculée jusqu'à `header.last_chain_hash` (`CHAIN_BROKEN` sinon, OA:14489-14492).
- **Justification** : donne un sens à `public_key` (R-04) et protège le contenu d'un lot contre une altération sur le lien, en plus
  de TLS.

## R-14 Horloge de la passerelle (A14)

- **Décision** : (1) la passerelle tient un décalage `central_offset = heure du central - heure système`, mesuré à chaque échange réussi avec le
  central par l'en-tête HTTP `Date` (précision d'une seconde, suffisante contre la tolérance de 120 s, SP:529-535). (2) Elle persiste un **plafond
  d'heure** `time_floor` : le maximum jamais observé, central ou système, écrit dans chaque transaction qui écrit une heure (au plus une fois par
  seconde). **Elle ne sert jamais une heure inférieure à ce plafond.** (3) La valeur monotone n'est PAS persistée (une horloge monotone n'a de sens que dans
  un seul démarrage) : au démarrage `t0 = max(heure système, time_floor)`, puis l'heure servie est `t0 + temps monotone écoulé depuis le démarrage`, recalée
  sur l'heure centrale à chaque échange. L'heure servie aux terminaux (`server_time`, signature de requête `created` à plus ou moins
  `clock_tolerance_seconds`, OA:10987) est celle-là ; si l'écart entre l'heure système et l'heure servie dépasse 120 s, alerte `GATEWAY_CLOCK_SKEW`.
  (4) Un écart de plus de 24 h entre l'heure servie et une mesure centrale : la passerelle **refuse l'accusé de bascule** (état local `ARMED`, alerte) et,
  après redémarrage, refuse l'accusé si l'écart avec le plafond dépasse la tolérance. (5) `origin_occurred_at` = heure du terminal corrigée (SP:523-528) ;
  `recorded_at` = heure de la passerelle servie. (6) NTP : procédure de site. Tests : corrections de plus et moins 2 h sur le chemin passerelle (SP §13-6,
  SP:912) ; **redémarrage avec horloge reculée de 2 h puis de 13 h ; jeton à 12 h + 1 s refusé ; heure jamais inférieure au plafond**.
- **Limite consignée (ADR de la tolérance, `OP-N103`)** : une horloge système reculée PENDANT un arrêt de la machine fait perdre la durée de l'arrêt (le plafond
  reprend à la dernière heure observée). Les fenêtres de 12 h (tolérance de jeton, sessions vendeur) se comptent alors en temps de fonctionnement tant
  qu'aucune mesure centrale ni horloge cohérente n'existe. Bornée par la durée de l'arrêt ; un avance d'horloge, elle, raccourcit les fenêtres (sans danger).
- **Alternatives écartées** : se fier à l'heure système seule ; persister la valeur monotone (incomparable après redémarrage) ; service d'heure externe
  (dépendance réseau).

## R-15 États de lien `ISOLATED` et `CATCHING_UP`

- **Décision** : ils n'ont **aucun effet sur un droit** : seuls `REVOKED`, le rôle et `ACTIVE`/`PRIMARY` à la bascule (`S:2560`)
  comptent pour une autorité. Le central les écrit ainsi : `ISOLATED` par `mark_edge_gateways_silent` (travailleur du processus de
  maintenance, toutes les 15 s) quand `last_seen_at` a plus de 75 s (trois cycles de long-polling de 25 s) ; `CATCHING_UP` par
  `touch_edge_gateway` au premier appel authentifié après `ISOLATED` ; retour à `ACTIVE` par le même travailleur quand la
  passerelle est vue et qu'aucun lot n'a été reçu depuis 60 s (file considérée vidée côté central). Chaque passage est audité
  (FR-034) ; l'alerte « passerelle muette » part au passage à `ISOLATED` si la passerelle a un handover ouvert. Côté passerelle
  l'état de lien est un sous-état local (R-16), non une source de vérité.
- **Justification** : rien dans `S`, SP ni OA ne dit qui les écrit (SP:706-709 les cite sans les définir, `S:731`) ; l'absence se
  constate par le central seul (silence), la reprise par le premier appel.
- **Alternatives écartées** : la passerelle déclare son état (un champ de plus sur une requête : changement de contrat, C-002) ;
  les ignorer (la colonne existe, FR-034 demande une alerte).

## R-16 Machine d'état de la passerelle et persistance avant réponse

Voir le diagramme dans `data-model.md`. Décisions :

- **États locaux persistés** (table `edge_authority`, une ligne) : `STANDBY`, `ARMED`, `GRANTED_PENDING`, `ACTIVE`, `RELEASING`,
  `RELEASED`, `STALE`, `REVOKED`. `ISOLATED`/`CATCHING_UP` sont un sous-état du lien dans `ACTIVE`.
- **Avant de répondre à un terminal** : l'entrée `edge_op` (numéro, chaîne, clé d'origine, décision) **et** son effet local
  (delta de solde dans `edge_op_delta`, entrée de nonce, entrée d'idempotence, tap consommé) sont écrits dans **une seule
  transaction locale commitée** (`synchronous_commit = on`, `fsync` laissé à la valeur par défaut) ; la réponse HTTP part après le
  `COMMIT`. Un arrêt brutal avant le commit : aucune réponse partie, le terminal rejoue avec la même clé (idempotence locale) ;
  après le commit avant la réponse : le rejeu rend le même résultat (idempotence). Preuve NFR-004.
- **Attribution du numéro** : `edge_seq = dernier + 1` sous verrou de ligne (`edge_chain_head FOR UPDATE`) dans la même
  transaction que l'écriture ; pas de séquence PostgreSQL (qui laisse des trous après un arrêt brutal).
- **`RELEASING` persisté avant d'agir** : à la réception de `RELEASE_REQUESTED`, la passerelle écrit `RELEASING` (commit), puis
  seulement refuse les débits (`409 DEBIT_AUTHORITY_MOVING`) et les nouveaux lots. Au redémarrage elle lit l'état : `RELEASING`
  n'en sort jamais vers `ACTIVE` sauf si le central signale `FAILED` du handover `TO_CENTRAL` de la **même époque** (SP:651-652,
  FR-023) ; elle lit alors `get_current_edge_handover` et compare l'identifiant. **Lecture non ambiguë (A13)** : pendant le rendu deux handovers
  sont ouverts en même temps (`TO_EDGE ACTIVE` et `TO_CENTRAL RELEASE_REQUESTED`/`RELEASING`, `handover_one_open` est par `(ledger, direction)`) ;
  `get_current_edge_handover` rend UN handover par priorité écrite : le `TO_CENTRAL` ouvert l'emporte ; à défaut le dernier `TO_CENTRAL` du `TO_EDGE`
  actif s'il est `FAILED` (fenêtre bornée à l'époque détenue) ; à défaut le `TO_EDGE`. Une passerelle redémarrée en `RELEASING` lit donc `RELEASING`,
  jamais « ACTIVE, même époque » ; après un vrai `fail_edge_release` elle lit `FAILED` et reprend. Quatre cas testés : redémarrage pendant
  `RELEASING`, avec `RELEASE_REQUESTED` toujours ouvert, avec `FAILED`, avec `COMPLETED`.
- **`STALE` persistant, avec garde contre l'époque forgée (A12, décision 15)** : l'en-tête `X-Authority-Epoch` d'un terminal ne peut pas être vérifié
  hors du central ; un terminal défectueux ou volé (certificat, jeton et signature valides) pouvait envoyer l'époque 9999 et arrêter le site. Règle : une
  époque supérieure vue dans une requête de terminal ne persiste `STALE` (et `highest_epoch_seen`) que si elle est **confirmée** par le canal de
  contrôle du central (long-polling) ou **plausible** (au plus l'époque détenue + 2, comme le protocole `e+2` au rendu). Sinon la requête reçoit `409
  STALE_AUTHORITY_EPOCH`, **sans persister et sans arrêter les débits**, avec une ligne d'audit `STALE_EPOCH_UNCONFIRMED` et une alerte. Une époque
  supérieure vue au long-polling (source fiable) persiste `STALE` comme avant. On sort de `STALE` par un nouvel accord complet sur une époque supérieure à
  celle vue, **ou** par une **levée locale à deux personnes** (ordre signé de deux personnes distinctes, audité `LOCAL_UNSTALE`, refusé si le central a
  confirmé l'époque supérieure) quand le lien est coupé. Limite acceptée (`OP-N110`, `ADR-165`) : un en-tête forgé à `epoch + 1` ou `epoch + 2` est
  « plausible » et provoque encore un `STALE` jusqu'à la levée locale (disponibilité, pas sécurité). Test : en-tête forgé à 9999 sans arrêt, à `epoch + 1`
  avec arrêt et levée à deux.
- **Débit permis** seulement si l'état est `ACTIVE`, `X-Authority-Epoch` égale l'époque détenue **quand l'en-tête est déclaré par le
  contrat pour la route** (paiement, annulation, lots : R-29), et l'accusé `200` a été reçu (SP:590-592, OA:6868).
- **`STANDBY`** : refuse tout débit ; réplique l'état de service (le bloc `reference`) mais **ne reçoit aucun mot de passe de bracelet** tant qu'elle n'est pas
  promue (A16) et ne reçoit jamais d'accord (le central refuse `grant_edge_authority` sur un rôle `STANDBY`, `S:2560`) ; la promotion est un handover normal
  (C-008) : `EDGE` sur la primaire, `CENTRAL`, puis changement de rôle par `swap_edge_gateway_roles(old, new)`, **atomique** (A25 : deux instructions séparées
  laisseraient l'événement sans primaire, et l'unicité de la primaire ne s'exprime pas par index, A04), refusé tant qu'un handover est ouvert, puis `EDGE`
  sur la nouvelle primaire. La passerelle apprend son rôle par `reference.gateway.role`, relu à chaque passe ; elle repasse alors `STANDBY -> ARMED`, reprend
  une copie complète et attend le délai des colis avant tout accord. Sûreté : elle ne débite jamais sans l'accusé `200`, ce qui limite le risque à la
  disponibilité.
- **Accusé de bascule** : la passerelle ne l'envoie qu'après avoir appliqué le flux jusqu'à `last_replicated_posting_id >=
  watermark` ; le central refuse un accusé incomplet (`CL014`).

## R-17 Attente longue et réveil immédiat (NFR-007)

- **Décision** : `GET /edge/handovers/current?wait=<=25>` : le processus `edge` interroge `get_current_edge_handover`, et si rien
  n'a changé attend sur un `LISTEN edge_handover_changed` (une connexion dédiée par processus, ouverte avec le rôle
  `cashless_edge`, qui n'exige aucun droit particulier). Un déclencheur `AFTER INSERT OR UPDATE ON debit_authority_handover`
  (SECURITY DEFINER, créé en `0058`) émet `pg_notify('edge_handover_changed', gateway_id::text)` : l'identifiant seul, jamais
  d'autre donnée. Le réveil est donc immédiat. **Repli** : une revérification de la base toutes les 2 s dans la boucle d'attente
  (une notification perdue, une connexion à rétablir), et reconnexion de l'écoute avec revérification complète. `touch_edge_gateway`
  est appelée à l'entrée de chaque attente (battement de cœur) et à sa sortie. La réponse d'une attente expirée est le handover
  inchangé (`200`, ou `204` si le contrat le déclare pour « rien d'ouvert » : à lire dans OA:6827 au codage).
- **Côté passerelle** : une boucle d'attente par lien, relancée aussitôt ; un changement d'état passe en file locale persistée avant
  action (R-16).
- **Justification** : sans réveil immédiat, le premier tirage de la passerelle peut attendre 25 s et NFR-007 (accusé en 30 s) est
  tangent (R-protocole §4.3). Le coût est un déclencheur et une connexion d'écoute.
- **Alternatives écartées** : sonder toutes les 1 s (charge inutile sur le central pour N passerelles) ; faire de `wait` un
  simple `sleep` (le défaut décrit ci-dessus).

## R-18 `tap_id` : locaux à la passerelle

- **Décision** : `POST /taps` servi par la passerelle écrit `edge_tap` (identifiant local `bigserial`, compteur et empreinte du
  passage, anti-clone par le compteur répliqué), consommé une fois par l'opération qui le cite (`consume_tap` local). Un `tap_id`
  émis par le central n'est pas valable sur la passerelle (et réciproquement) : `409 TAP_UNUSABLE`, le terminal relit le
  bracelet (cas 12, SP:846). Le `tap_id` n'entre pas dans le hachage (champ d'état, SP:112-122) et n'est jamais envoyé au
  central ; au rejeu, le central enregistre le passage depuis l'objet `tap` de l'opération (compteur, UID, signature) exactement
  comme pour un lot hors ligne de la mission 7 (à confirmer au plan en lisant `offline-operation.processor.ts`), sans `tap_id`.
- **Justification** : la réplication ne porte pas `media_tap` ; répliquer des identifiants de passage n'a pas de sens, l'anti-clone
  repose sur le compteur de bracelet.
- **Alternatives écartées** : répliquer `media_tap` (volume, hors contrat stable).

## R-19 Jetons d'appareil sur la passerelle (décisions 2 et 11 ; A01)

- **Décision 2** : clé propre à la passerelle, jetons valables sur elle seule, refusés au central (test). Détails :
  - **Clé** : ECDSA P-256 (ES256, `DEVICE_TOKEN_ALG`) générée dans le port de stockage matériel (R-27) ; `kid` = `edge:<gateway_id>:<n>` (`n`
    incrémenté à chaque rotation de clé) ; `aud` = `cashless-edge/<gateway_id>` (le jeton du central porte `DEVICE_TOKEN_AUDIENCE`, constante partagée) ;
    `iss` = identifiant de la passerelle ; mêmes `typ`, `exp` (900 s au plus), `cnf.jkt`, `fid`.
  - **Vérification sur la passerelle** : le vérificateur de la passerelle n'accepte que ses propres `kid` ; **les clés publiques du central ne sont pas
    répliquées** (contradiction levée entre `research.md` et `contracts/` : A01). Un terminal qui présente encore un jeton émis par le central reçoit `401` et
    rafraîchit sur la passerelle (la route `refreshDeviceToken` est servie, 1 des 16). À confirmer avec l'équipe terminal (C-013) : un `401 UNAUTHENTICATED`
    sur le jeton déclenche bien un rafraîchissement.
  - **Refus au central** : le vérificateur central compare **déjà** le `kid` à son seul `kid` avant toute cryptographie
    (`device-token.service.ts:118`) et contrôle l'audience (`:124`, `DEVICE_TOKEN_AUDIENCE`). Aucun contrôle n'est ajouté au central, qui n'est pas
    modifié ; la mission **prouve** le refus (jeton signé par la clé de la passerelle refusé par `kid` ; jeton forgé avec le `kid` du central refusé par
    signature, puis par audience) : test, pas code.
- **Décision 11 (porteur, 05/11/2026) : renouvellement SANS rotation sur la passerelle.** Un jeton d'accès de la passerelle dure au plus 900 s ; sans
  renouvellement, le site entier s'arrêtait 15 minutes après la coupure (A01). Mécanisme : (a) le central réplique l'**empreinte courante** du jeton de
  rafraîchissement de chaque terminal et son certificat (`devices[].token_family`, `devices[].cert_sha256`), seulement à la passerelle `PRIMARY` ; (b) pour
  `refreshDeviceToken`, la passerelle vérifie le certificat du terminal (mTLS), la **preuve de possession** (signature de requête) et que
  l'empreinte SHA-256 du jeton de rafraîchissement présenté égale l'empreinte courante répliquée ; (c) elle émet un jeton d'accès court, valable sur elle
  seule ; (d) **elle ne consomme ni ne fait tourner** le jeton de rafraîchissement, qui reste valable ; (e) **rotation forcée au retour** : au rendu
  (`COMPLETED`), le central marque les familles dont l'empreinte a été répliquée (`edge_exposed`) ; la première utilisation d'un jeton de rafraîchissement au
  central après le retour le fait tourner comme d'habitude, et la **détection de réutilisation est retrouvée** : si un jeton copié sur le site est présenté
  après la rotation, la famille est révoquée et le terminal se ré-enrôle. Les jetons d'accès de la passerelle tombent à leur `exp` (900 s au plus).
- **Écart accepté, dette nommée** (`OP-N101` et `OP-N102`, `ADR-156` et `ADR-157`) : (1) clé de signature de jetons sur un mini-PC de site, exposée hors du KMS central
  jusqu'à la 12b ; (2) **pendant `EDGE`, plus de détection de réutilisation d'un jeton de rafraîchissement volé**, et des empreintes de jetons de
  rafraîchissement stockées sur le site (un secret dérivé de plus). Lève : mission 12b (clé en matériel) pour (1) ; pour (2), la condition est un
  renouvellement avec rotation et un canal d'inscription du nouveau jeton au central (changement de contrat, hors décision 7), à décider par le porteur.
  Tests de borne : (i) la clé de jeton de la passerelle ne signe que des jetons `aud = cashless-edge/<gateway_id>` et un tel jeton est refusé par le
  vérificateur central ; (ii) un jeton de rafraîchissement dont l'empreinte diffère de l'empreinte courante est refusé sur la passerelle ; (iii) la
  passerelle ne répond jamais avec un nouveau jeton de rafraîchissement ; (iv) après le rendu, la rotation au central est forcée et la réutilisation d'un
  jeton copié révoque la famille ; (v) l'empreinte n'est servie qu'à la `PRIMARY` (jamais à une `STANDBY`, jamais en clair).

## R-20 Jetons de personne au guichet : tolérance d'expiration, règle exacte (décision 3)

- **Décision du porteur** : un jeton de personne expiré est toléré sur la passerelle seulement, avec les conditions suivantes,
  **toutes** exigées, vérifiées dans cet ordre, la première qui échoue refuse (`401`) :
  1. signature valide (ES256 ou algorithme de la clé), `kid` présent dans la copie répliquée des clés publiques du serveur
     d'identité (copie tenue par la passerelle, rafraîchie tant que le serveur d'identité est joignable : `edge_identity_key`), `iss` et `aud` attendus ; un jeton non expiré suit la règle normale (aucune tolérance) ;
  2. `sub` + `iss` égalent la personne qui a **ouvert** la session de caisse citée (`cash_session.opened_by`, répliqué) ;
  3. le terminal de la requête est celui de la session (`cash_session.device_id`) ;
  4. la session est `OPEN` et `usable_on_edge` dans l'état répliqué (R-11, R-24) ;
  5. `iat <= activated_at` du handover courant (le jeton a été émis avant la bascule : un serveur d'identité hors réseau n'en émet
     plus), **`exp >= activated_at` (le jeton était encore valable à l'instant de la bascule : seul un jeton dont l'expiration tombe PENDANT la
     coupure est toléré ; renforcement de la passe contradictoire, A15, consigné dans l'ADR de la tolérance)** et `maintenant <= activated_at + 12 h`
     (borne fixe, `edge_authority.token_tolerance_until`, posée à l'accusé `200` et jamais prolongée par un autre événement) ;
  6. l'affectation de la personne (rôle `CASHIER` ou `SUPERVISOR` de l'événement, répliquée) est `ACTIVE` dans l'état répliqué ;
  7. **chaque usage est audité** (`edge_audit`, ligne `STAFF_TOKEN_TOLERATED` avec `sub`, `jti`, secondes de dépassement, route,
     terminal, `edge_seq` de l'opération) avant la réponse, dans la même transaction que l'opération.
  La tolérance ne vaut que pour les routes `CounterAuth` (`activateMedia`, `takeDeposit`, `createCashTopup`). Elle ne s'applique
  jamais au central.
- **Risque** : un compte révoqué ou désactivé pendant une coupure continue d'agir au guichet jusqu'à 12 h, tant qu'aucune
  réplication n'arrive. Borné par : la même session, le même terminal, la même personne, `exp >= activated_at` (un jeton expiré avant la bascule, volé
  d'un journal, n'est pas toléré, même sur une session laissée ouverte plusieurs jours), le plafond de 12 h, et la réplication dès que le lien existe
  (NFR-008). Dette nommée (`OP-N103`, `ADR-158`, test de borne qui échoue si la limite s'élargit : jeton à 12 h + 1 s refusé ; `exp` antérieur à la
  bascule refusé ; une autre personne, un autre terminal, une session fermée ou ouverte après la bascule refusés).
- **Audit versé au central (décision 18)** : chaque usage écrit une ligne `edge_audit` `STAFF_TOKEN_TOLERATED` sur la passerelle, versée au central au
  lot suivant par le champ facultatif `staff_token_audit` d'`EdgeSyncBatch` (sous `/edge/*`, `contracts/replication-page-additions.yaml`), couvert par la
  signature du lot, rangé dans `edge_staff_token_audit` et recopié dans l'audit de la plateforme (`edge_record_staff_token_audit`). La ligne locale
  reste, chaînée, jusqu'à la purge.
- **Alternatives écartées** : refuser tout jeton expiré (bloque les guichets au bout de quelques minutes, contraire à la
  décision du porteur) ; lever la borne de 12 h (sessions vendeur ont la même durée, 12 h, `0031:96`).

## R-21 Sessions vendeur, nonces et jeton de personne pour les ventes

- Les ventes et annulations n'exigent pas de jeton de personne (`@DeviceAuth`) ; elles exigent une session vendeur ouverte sur le
  terminal, valide et non expirée (`vendor_session_id`, OA:1945-1948) : répliquée (`vendor_session`, `vendor` sans PIN ni
  empreinte). **Aucune ouverture de session vendeur sur la passerelle** (spec, hypothèses ; `openVendorSession` n'est pas
  `x-edge-available`). Une session ouverte à `t0` expire à `t0 + 12 h` même si la coupure dure plus (`vendor_session_ttl`,
  `0031:96`) : fin des ventes sous ce vendeur, comportement voulu.
- **Nonces et séparation des autorités (A20)** : `consume_device_nonce` est tenu dans une table locale `edge_device_nonce` ; fenêtre = tolérance d'horloge
  (`CLOCK_TOLERANCE_SECONDS` <= 300, `nonce-store.ts:13`). Le central et la passerelle ont deux registres de nonces séparés, mais le rejeu d'une requête
  signée d'un côté vers l'autre est **empêché par `@authority`** (`request-signature.ts:133-137` : égalité exacte, ou `host:*` hors production), à condition
  que les deux listes soient **disjointes et sans joker**. Le central refuse donc une requête signée pour l'adresse de la passerelle et inversement. Conditions :
  `DEVICE_REQUEST_AUTHORITIES` du central ne contient JAMAIS l'adresse de la passerelle (le tableau de variables du quickstart est corrigé) ; la passerelle
  n'accepte que sa propre adresse (`GATEWAY_REQUEST_AUTHORITY`) ; aucun joker, ni en production (déjà refusé, `config.ts:706`) ni dans le test d'intégration (le
  défaut de test `localhost:*,127.0.0.1:*` accepterait toute autre adresse locale). Test : requête signée pour A refusée par B, dans les deux sens. L'ancien
  écart « nonces séparés » (rejeu possible une fois) disparaît avec cette condition ; si une configuration les recouvre, le test échoue.

## R-22 Snapshots locaux (FR-027)

- **Décision** : la passerelle produit ses propres snapshots, au format de la mission 7 (`FULL` ou `DELTA` de la version
  précédente, en-tête signé, `content_sha256`, entrées avec mots de passe chiffrés par une clé de contenu `K_v` enveloppée
  par terminal), à partir de ses tables locales. Signés par la **clé propre de la passerelle** (ECDSA P-256 dans le port
  matériel), dont la clé publique est déclarée à l'inscription (`snapshot_signing_key`, `owner = 'EDGE'`) et publiée dans
  `config.snapshot_keys` par `getDeviceConfig` (à vérifier au plan que `snapshot_public_keys`, `0045:277`, renvoie les clés
  `EDGE` de la passerelle de l'événement ; sinon la passerelle les sert dans sa propre configuration). Deux clés au plus par
  signataire (rotation, OA:12640). Cadence : 60 s en régime courant, 5 s après un blocage (SP:889).
- **Mots de passe** : le flux apporte la clé de contenu `pwd_pack_key` (scellée pour la clé d'accord de la passerelle) et, pour chaque bracelet, son
  `pwd_pack_enc` chiffré sous cette clé ; la passerelle descelle la clé de contenu en mémoire (le port matériel fait l'ECDH, la clé d'accord privée ne
  sort pas), ouvre le colis et le rescelle pour chaque terminal
  avec `@cashless/tag-format` (`sealForRecipient`). **Aucun mot de passe en clair en base ni dans les journaux** (NFR-010,
  canari). `getMediaAuthKey` sur la passerelle sert le même colis rescellé, sans KMS (voir R-25).
- **Fraîcheur** : NFR-008 (5 s) ne couvre que « appliqué sur la passerelle » ; le délai jusqu'au terminal ajoute la génération
  du snapshot (5 s après un blocage) et le battement de cœur (60 s, SP:895). À préciser dans la recette pour ne pas être lu comme un
  délai de bout en bout (« Contradictions » n° 11).
- **Alternatives écartées** : relayer les snapshots du central (inutile pendant la coupure, et ils seraient périmés) ; signer
  avec la clé du central (clé d'un site dans le KMS central, jamais).

## R-23 `ONLINE_REF` inconnue à la reprise forcée, passerelle perdue avant rejeu (décision 4)

- **Décision du porteur** : pas de changement de contrat. Un terminal n'envoie que `ONLINE_REF` pour une activation ou une caution
  (`OfflineOperationType`) ; le central reconnaît une référence à une opération qu'il n'a jamais reçue et ouvre
  `EDGE_REPLAY_FAILED` ; un `TOPUP_CASH` du journal suit le refus existant (`OFFLINE_NOT_ALLOWED`, C-006), avec une anomalie portant
  le montant. Aucune perte silencieuse ; rétablissement manuel ; résolution à deux.
- **Mise en oeuvre** : dans le traitement du journal importé après une reprise forcée (FR-029, `journal-import.service.ts`) et du lot
  hors ligne, une entrée `ONLINE_REF` dont `online_operation` est `ACTIVATION` ou `DEPOSIT` (valeurs à lire dans le schéma
  `OfflineOperation`, OA:14416-14418) et dont la clé n'existe pas au central donne : résultat `VOID` /
  `ONLINE_NOT_EXECUTED` comme aujourd'hui (`offline-operation.processor.ts:149,235`) **et** une anomalie `EDGE_REPLAY_FAILED`
  (bracelet, terminal, clé d'origine, `amount` = caution connue du terminal si présente) ; un `TOPUP_CASH` donne
  `REJECTED OFFLINE_NOT_ALLOWED` et une anomalie `NON_COMPLIANT_OPERATION` portant le montant. La différence avec le cas courant
  (une `ONLINE_REF` d'une opération vraiment faite en ligne au central, qui est reconnue par sa clé) est le critère « opération
  inconnue du central et passerelle `REVOKED`/`FORCED` pour ce terminal ». Comme la clé d'origine des opérations de guichet est
  l'`Idempotency-Key` du terminal `<serial>:<seq>` (R-10, A10), une activation DÉJÀ rejouée avant la perte de la passerelle est retrouvée sous la même clé
  et ne provoque aucune anomalie ; seules les opérations non rejouées en provoquent.
- **Reprise forcée** (FR-028) : passerelle `REVOKED`, époque `e+2`, handover `FORCED`, certificat refusé ensuite (FR-031) ; les
  terminaux renvoient tout leur journal non `ACKED` en `OFFLINE_SYNC` (SP:774-779) ; I1 garanti par les clés uniques.
  Le risque résiduel de la passerelle zombie (SP:780-785) est accepté par le protocole.

## R-24 `ReplicationPage` : champs facultatifs, pagination, reprise (A02, A03, A18)

Décision 7 du porteur : **seuls des champs facultatifs sur `ReplicationPage`**, sous `/edge/*`, plus, par les décisions 12 et 18, le paramètre facultatif
`after_change_seq` de `getEdgeReplicationFeed` et la propriété facultative `staff_token_audit` d'`EdgeSyncBatch`. `required` inchangé (OA:14692) ;
`ReplicationPage` et `EdgeSyncBatch` ne sont référencés que par les deux routes `/edge/*` (OA:7000 et 7058, vérifié). **Le schéma complet est UNIQUE : il
est dans `contracts/replication-page-additions.yaml` et nulle part ailleurs.** La version antérieure de cette section (`service_state`,
`service_state_version`, `device_token_keys` répliquées, `after_change_cursor` « à soumettre ») est supprimée.

Ce que porte la page, en bref (le yaml fait foi) : `edge_seq_applied` (chaque page, même transaction `REPEATABLE READ` que les soldes) ; `device_seq_acked`
(dernière page d'une passe) ; `pwd_pack_key` ; sur `wallets[]`, `kyc_verified` et `topup_month_paid` ; et, si la requête porte `after_change_seq`, le bloc
`reference` (journal `change_seq` : passerelle elle-même et son rôle, états de portefeuille, réglages de l'événement, terminaux avec leur famille de jetons,
configurations, sessions de caisse et de vendeur, vendeurs, personnes habilitées, catalogues, références de bracelets avec leur statut, bracelets non
attachés). Le périmètre est limité à l'événement et au prestataire de la passerelle (NFR-011).

- **Pagination** : trois curseurs indépendants. `wallets` et `media` par `posting.id` (`after_posting_id`, `from_posting_id`, `to_posting_id`, `has_more`),
  sans trou ni doublon, `to_posting_id` ne dépassant jamais l'**horizon** des écritures validées (R-08, A18) ; un doublon est inoffensif (état absolu), un
  trou est interdit. Le bloc `reference` par `change_seq` (numéros dans l'ordre de validation, R-08), borné par `Limit` ; la passerelle boucle tant que
  l'un des `has_more` est vrai. Les entités sans `posting.id` ne dépendent donc plus de la cadence de la passerelle pour un blocage : le blocage entre dans le
  journal à sa validation et est servi à la passe suivante (2 s en lien sain, NFR-008 : 5 s au p95).
- **Reprise** : `last_replicated_posting_id`, `last_change_seq` et `last_edge_seq_applied` sont persistés dans la même transaction locale que
  l'application de la page (R-16) ; après coupure, chaque curseur repart de sa valeur. `edge_seq_applied` sert au calcul de solde : solde effectif d'un
  portefeuille = solde central répliqué + somme des deltas locaux des opérations de numéro supérieur à `edge_seq_applied` ; les débits locaux le tiennent au
  plus égal au solde réel sans double comptage (US 5) ; les recharges espèces non encore rejouées le relèvent au-dessus du solde central (A09, corrigé :
  c'est la borne de `charged_to_wallet` au rejeu qui protège le central).
- **Sort d'un delta local selon l'issue du central (A26)** : la phrase « un `DUPLICATE` se corrige d'elle-même par la réplication » était fausse (un
  `DUPLICATE` n'écrit aucune ligne nouvelle, le portefeuille n'apparaît dans aucune page, `edge_seq_applied` ne le couvre pas). Règle : `ACCEPTED` et
  `ACCEPTED_WITH_SHORTFALL` : delta purgé quand une page porte `edge_seq_applied >= edge_seq` ; `DUPLICATE` : delta gardé (solde sous-estimé, sans danger)
  jusqu'à une passe de réplication commencée après la réception du résultat, puis annulé ; `REJECTED` et `VOID` : delta annulé dès le résultat. Preuves dans
  les deux sens (delta supprimé trop tôt : jamais ; gardé trop longtemps : borné).

## R-25 Les 16 opérations `x-edge-available` : ce qui est servi, ce qui est écrit à part

Verdicts (R-api §1 revérifiés, lignes d'`openapi.yaml` : 429, 496, 630, 711, 1184, 1261, 1350, 1486, 1965, 2066, 2124, 2586,
4360, 4505, 4602, 4764) :

| Opération | Sur la passerelle |
|---|---|
| `refreshDeviceToken` | écrite à part, **sans rotation** (décision 11, R-19) : certificat, preuve de possession et empreinte courante répliquée ; jeton d'accès court valable sur la passerelle |
| `getDeviceConfig` | écrite à part sur l'état répliqué ; `etag` et `config_id` du central ; `edge_base_url` = `lan_url` |
| `postDeviceHeartbeat` | écrite à part ; `latest_snapshot_version` = celle du snapshot local |
| `getDeviceSeqStatus` | écrite à part : renvoie le `contiguous_acked_seq` **du central** (SP:709-712, FR-026), dernière valeur connue répliquée avec sa date (périmée plutôt que provisoire), jamais un accusé local ; le terminal ne marque « acquitté » que sur cette valeur. Valeur obtenue par le champ facultatif `device_seq_acked` de la dernière page de chaque passe (champ de `ReplicationPage`, par terminal de l'événement, seul porteur de cette donnée) |
| `getMediaAuthKey` | écrite à part : colis `pwd_pack_enc` ouvert avec `pwd_pack_key` puis rescellé pour le terminal (R-22), sans KMS ni clé maître |
| `createTap` | locale (R-18) |
| `activateMedia`, `takeDeposit`, `createCashTopup` | locales, file `ACTIVATION` / `DEPOSIT_CASH` / `TOPUP_CASH` (R-10) ; `FROM_BALANCE` refusé (`DEBIT_AUTHORITY_EDGE`) ; frais d'activation prélevés sur le solde : refusés par la même règle (SPEC:1038 les liste, le code ne testait que la caution, « Contradictions » n° 13 : la passerelle refuse, par prudence) |
| `createPayment`, `getPayment`, `reversePayment` | locales ; QR client et QR commerçant : `409 DEBIT_AUTHORITY_EDGE` |
| `getOfflineSnapshot`, `ackOfflineSnapshot` | écrites à part (R-22) |
| `submitOfflineBatch`, `getOfflineBatchResult` | pipeline de la mission 7 avec la règle d'autorité **inversée** (`batch-intake.ts:192-195` refuse sous `EDGE` ; la passerelle exige `EDGE` actif) et mise en file `edge_seq` |

- Toute opération hors liste, ou liste mais indisponible (restitution, remboursement, caution sur solde, paiement par QR) :
  `409 DEBIT_AUTHORITY_EDGE`, `retryable: false`, sans `edge_base_url` (la passerelle est déjà l'adresse indiquée) mais avec l'époque (FR-011, `contracts/gateway-served-operations.md`). **Exception nommée** : la restitution d'un bracelet (`releaseMedia`)
  n'est pas servie (non `x-edge-available`) mais un refus nommé répond `409 DEBIT_AUTHORITY_EDGE` (contrat 1350, 1486), sans rien écrire (A27.6 : un seul
  comportement). Les routes de session (ouverture, relève, fermeture de caisse, ouverture vendeur) ne sont pas servies : `404` (route absente,
  `DenyUnmarkedRoutesGuard`).

## R-26 Points d'arrêt, relais TCP, deux processus et deux bases (décision 10)

- **Relais TCP coupable** : `apps/gateway/test/support/tcp-relay.ts`, en `node:net` seul (aucune dépendance), entre la passerelle
  et le central, transparent pour l'mTLS (le certificat client voyage jusqu'au central). Commandes : `pause()` (retient les
  octets), `drop()` (ferme les connexions et refuse les nouvelles), `resume()`, `delayMs(n)`. Aucun changement de la
  configuration réseau du poste ; l'API qui écoute sur le port 80 n'est pas touchée (ports libres sur `127.0.0.1`).
  Toxiproxy et équivalents : absents de `docs/08-pile-logicielle.md`, non retenus (C-011).
- **Points d'arrêt** : `EDGE_FAILPOINT=<nom>[:<n>]` lu par un module `failpoints.ts` ; **actifs seulement si le démarrage est en configuration `development`
  ou `test` ET `EDGE_ALLOW_FAILPOINTS=1`** ; en production, la présence de `EDGE_FAILPOINT` ou de `EDGE_ALLOW_FAILPOINTS` **refuse le démarrage** (faux au sens
  de la règle 2, prouvé par un test, NFR-009). La configuration de la passerelle réutilise la même énumération stricte que l'API (`production`,
  `development`, `test` ; `nodeEnv()` de `apps/api/src/config/config.ts:335-341`, extraite dans `@cashless/shared-rules` ou recopiée à l'identique avec un test
  d'égalité) : `NODE_ENV` absent, `prod` ou `staging` refuse le démarrage (échec fermé, A19). Points : `before-local-write`,
  `after-local-write-before-reply`, `during-drain-after-send-before-result`, `after-releasing-persisted`, et **`kill-local-database`** (A28 : `docker kill` du
  conteneur PostgreSQL local, pas seulement `SIGKILL` du processus, pour éprouver la durabilité de la base locale). Action des quatre premiers : `SIGKILL`
  du processus lui-même. Le profil de déploiement du site vérifie `fsync = on`, `full_page_writes = on` et `synchronous_commit = on` (test de
  démarrage : la passerelle refuse de servir si l'un est désactivé) ; la coupure de courant sans onduleur relève de la procédure de site.
- **Liste exhaustive des réglages « de développement » refusés en production (A19), avec un test de démarrage réel (`NestFactory`) par réglage** :
  `HARDWARE_KEYSTORE=fake`, `EDGE_CA` factice, vérificateur d'identité de test (copie de clés d'identité en mémoire), `EDGE_FAILPOINT`,
  `EDGE_ALLOW_FAILPOINTS`, `CORS_ALLOW_ALL=1` (ADR-154), écoute sans TLS (`bootstrap.ts` accepte le clair hors production), `GATEWAY_REQUEST_AUTHORITY` à joker
  (`:*`), secrets de test (`config.ts:226-260`), `NODE_ENV=staging` ou absent. Noms de variables fixés ici et repris par `quickstart.md` : `HARDWARE_KEYSTORE`,
  `EDGE_FAILPOINT`, `EDGE_ALLOW_FAILPOINTS`, `GATEWAY_REQUEST_AUTHORITY` ; relais : `apps/gateway/test/support/tcp-relay.ts`.
- **Deux processus, deux bases** : un support de test crée une seconde base (même chaîne `migrate` pour le central, chaîne `edge-NNNN`
  pour la passerelle), une fabrique démarre le processus central (`edge` et public, `startHttpsApp` de `test/support/app.ts:195-233`)
  et la passerelle (processus enfant, HTTPS réel, TLS 1.3 généré par `test/support/tls.ts`), le relais entre les deux. Aujourd'hui
  `startHttpsApp` fixe `DATABASE_URL_APP` et `_PLATFORM` sur la base de test unique (`app.ts:204-205`) : deux processus sur la
  même base masqueraient les défauts d'isolement (nonces, idempotence, verrous) ; la seconde base l'évite.
- **Étape de CI dédiée** : une étape `gateway-integration` dans `.github/workflows/ledger-tests.yml` (les étapes visent `-w
  @cashless/api` en dur, `:174-241`), séquentielle (`--runInBand`), après `migrate` du central **et** de la passerelle ; les
  suites lentes (NFR-001, NFR-002, NFR-006) y vivent. `npm run lint`, `typecheck`, `npm test` racine couvrent `apps/gateway` sans
  changement (`package.json:15-17`). `jest.preset.cjs` étendu, `transformIgnorePatterns` pour `jose`, `canonicalize`, `cbor2`
  comme dans `apps/api/jest.config.cjs`.
- **Contrainte de poste** (mémoire du projet) : les agents ne lancent ni Jest ni pgTAP ni `reset-db` ; la base est partagée ; la
  seconde base a un nom propre (`cashless_edge_test`) et ses suites tournent en série par l'agent principal.

## R-27 Image Docker et dépendances (C-011, DIRECTIVE_051)

- **Constat** : aucun Dockerfile dans le dépôt (`find` hors `.worktrees` : aucun ; seul `tools/export/files/docker-compose.yml`, base
  de développement). `docs/08-pile-logicielle.md` §1 mentionne la passerelle seulement par son titre (« API centrale et
  passerelle locale ») ; ADR-78 : l'existant prime, ce qui n'a pas de ligne est libre mais à consigner.
- **Décision** : `apps/gateway/Dockerfile` en deux étages, base `node:22-bookworm-slim` **épinglée par condensat** (`@sha256:`),
  utilisateur non-root, `npm ci --ignore-scripts` (`.npmrc`), exécution par `tsx` comme l'API (`apps/api/package.json:9`, les
  paquets workspace pointent sur des sources TypeScript), aucun secret dans l'image ; PostgreSQL 17 en **service voisin**
  (`docker-compose.site.yml`, image `postgres:17` épinglée par condensat, volume sur disque chiffré de l'hôte), non embarqué dans
  l'image ; contrôle de santé HTTP. Procédure de site (FR-033) : disque chiffré, onduleur, Wi-Fi dédié, révocation à distance,
  source de temps locale.
- **Dépendances ajoutées, liste complète** :
  | Ajout | Nature | Contrôle (DIRECTIVE_051) |
  |---|---|---|
  | npm | **aucune** : HTTPS, `pg`, `jose`, `canonicalize`, `cbor2`, `@peculiar/x509`, `@cashless/tag-format` sont déjà dans `apps/api/package.json` (versions exactes de la pile) et le seront dans `apps/gateway/package.json` aux mêmes versions épinglées | résultat : zéro nouveau paquet ; `package-lock.json` change uniquement par l'ajout des deux workspaces (`packages/shared-rules`, `apps/gateway`) |
  | image `node:22-bookworm-slim` | image de base | **à relever à l'implémentation** : image officielle Docker, condensat épinglé, balayage des vulnérabilités du condensat avant fusion |
  | image `postgres:17` | image de base | idem |
  Je n'ai exécuté aucun contrôle de ces deux images (pas de réseau ni de Docker utilisés ici) : leur résultat est à consigner
  dans `docs/08-pile-logicielle.md` (nouvelle ligne « Passerelle locale ») et dans l'ADR au moment du lot qui les ajoute.
- **Stockage matériel** : port `HARDWARE_KEYSTORE` (clé de signature ES256, clé d'accord ECDH P-256 ; opérations `sign`, `agree`,
  `publicKey`, jamais d'export de clé privée) avec un **faux** de développement (clés en fichier ou en mémoire) refusé au démarrage en
  production (test, NFR-009) ; adaptateur réel en mission 12b (C-007). Même chose pour `EDGE_CA` (R-04). La passerelle
  n'est pas utilisable en production avant la 12b.
- **Aucune clé maître** : test à canari (NFR-010, A22) sur le flux, le dump de la base, les journaux (dont PostgreSQL local avec `log_statement = all`),
  la sortie des processus enfants et l'image (`docker save`). Le canari est cherché sous **toutes ses représentations** (UTF-8, hexadécimal minuscule et
  majuscule, base64, base64url, échappements JSON et SQL) et le test comporte un **contrôle positif** : une version volontairement fautive du code, qui
  journalise le canari en base64, doit faire échouer le test. L'image ne contient aucune clé de bracelet.
- **Purge des secrets (A21, décision 17)** : voir `data-model.md` B.9 bis (FR-035). Automatique à la clôture de l'événement (statut `CLOSED` répliqué, file
  acquittée), manuelle à deux personnes (ordre signé, clé d'accord de la procédure de site) ; destruction des clés dans le port matériel (effacement
  cryptographique), suppression des colis, empreintes de jetons et tables répliquées. **Limite consignée** (`OP-N106`, `ADR-161`) : un mini-PC volé avant la purge
  garde ses secrets ; la révocation à distance ne joint pas une machine débranchée. Test : après la purge, aucune occurrence du canari, sous toutes ses
  représentations, ni aucune clé utilisable.
- **Contradiction levée (A27.9)** : `PROMPTS-A-ENVOYER.md:360` dit « Docker absent de la machine de développement actuelle » alors que la base du poste est en
  Docker (colima) et que le quickstart suppose Docker. Une seule version : Docker est présent sur le poste (base, relais, image) ; l'image se construit et se
  scanne en CI, la mention de `PROMPTS-A-ENVOYER.md` est rapprochée (« Contradictions » n° 12).

## R-28 Seuils NFR (dimensionnés)

| NFR | Seuil retenu | Méthode |
|---|---|---|
| NFR-001 | 0 débit de portefeuille de source autre que `EDGE_SYNC` écrit après la bascule, 0 opération perdue, sous 100 débits/s | SP §13-4 : requête SQL sur `journal_transaction` (`posting.id > W`, débit sur `WALLET_PAID/PROMO`, `source <> 'EDGE_SYNC'`), toute requête rend 2xx, 4xx ou `409 DEBIT_AUTHORITY_EDGE` |
| NFR-002 | 10 000 opérations en file, 0 débit après `RELEASING`, `edge_seq` 1..10 000 continus au registre, chaîne égale, redémarrage au milieu | SP §13-5 ; horodatage du journal local contre la date de `RELEASING` |
| NFR-003 | 100 rejeux : 1 écriture par clé d'idempotence, par trois chemins | SP §13-1 refait sur `POST /edge/sync-batches` |
| NFR-004 | 0 perte aux trois points d'arrêt, `edge_seq` continus, aucune réponse 2xx sans entrée de file | R-26 |
| NFR-005 | **1 000 paiements** (et non 200 : avec 200, un p99 repose sur 2 observations) en série puis à concurrence 10 : p95 <= 200 ms, p99 <= 500 ms, mesuré **serveur seul** (ADR-60, SPEC:1439, OA:1939), pas la tranche réseau et serveur de 800 ms | poste, deux processus, LAN simulé |
| NFR-006 | 10 000 opérations en moins de 10 min (16,7 op/s) en 20 lots de 500, un lot en vol | 30 s par lot, soit 60 ms par opération ; `edge_record_seq` en `FOR UPDATE` sur `edge_gateway` sérialise mais reste linéaire ; à remesurer en recette |
| NFR-007 | accusé en moins de 30 s après l'accord, lien sain, moins de 10 000 écritures à rattraper | **avec réveil immédiat (R-17)** ; sans lui le seuil est tangent ; flux paginé par `Limit` |
| NFR-008 | blocage appliqué sur la passerelle en moins de 5 s au p95, lien sain | N essais, mesure jusqu'à l'état local ; **périmètre : la passerelle seule** (R-22) |
| NFR-009 | 100 % des ports à faux et réglages de développement refusent le démarrage en production | un test de démarrage réel (`NestFactory`) par réglage de la liste de R-26 (A19), y compris `CORS_ALLOW_ALL=1`, écoute sans TLS, joker d'autorité, `NODE_ENV=staging` |
| NFR-010 | 0 clé maître, 0 mot de passe de bracelet en clair, sous aucune représentation | canari sur flux, dump, journaux PostgreSQL, sortie des processus, image, avec contrôle positif (R-27, A22) |
| NFR-011 | 0 lecture hors passerelle, événement ou prestataire | test sur chaque route `/edge/*` et sur la lecture de l'autorité (R-04) |
| NFR-012 | 0 différence hors `/edge/*` ; sous `/edge/*`, seuls des ajouts de propriétés non `required`, aucune valeur d'énumération ajoutée | comparaison de `openapi.yaml` au contrat du 05/11/2026 en CI, avec témoin positif (codes de sortie `2` refus, `1` panne) sur contrat modifié (SC-006, A23) |
| NFR-013 | purge : 0 occurrence du canari et 0 clé utilisable après la purge | test de purge automatique et manuelle à deux (R-27, FR-035) |

## R-29 Contrat : ce qui change, ce qui ne change pas (C-002, décision 7)

- **Aucune route ne change** ; aucun code d'erreur n'est renommé ni retiré. Ajouts, tous facultatifs et sous `/edge/*` : les champs de `ReplicationPage`
  (dont `edge_seq_applied`, `device_seq_acked`, `reference`), le paramètre `after_change_seq`, la propriété `staff_token_audit` d'`EdgeSyncBatch`, tous
  dans `contracts/replication-page-additions.yaml`. **Aucune valeur d'énumération n'est ajoutée (A11)** : `ShortfallReason` et `OfflineRejectReason` sont
  référencées par `OfflineOperationResult` (OA:14363, 14371), schéma de résultat de `submitOfflineBatch` et `getOfflineBatchResult`, routes de terminal. La
  mission réutilise `MALFORMED_OPERATION` (décision incohérente, `REJECTED`) et `INSUFFICIENT_FUNDS` (excédent de solde, manque) en mettant le détail dans
  `detail`, champ libre. Un client Dart généré strictement sur l'énumération ne rencontre donc aucune valeur inconnue.
- **Le 409 du central** : compléter `DEBIT_AUTHORITY_EDGE` par `edge_base_url` et l'époque est permis parce que le contrat les
  déclare déjà (exemple OA:11545-11552 ; schéma `DebitAuthority` exige `edge_base_url`, OA:12539). Aujourd'hui le corps est nu
  (`ProblemException('DEBIT_AUTHORITY_EDGE')`, `batch-intake.ts:194`, SQLSTATE sans extension). Fait via une extension du
  problème construite depuis `get_debit_authority`, sur **tous** les chemins de débit (FR-013). `DEBIT_AUTHORITY_MOVING` : le central
  garde son comportement actuel (`createPayment` rend `EDGE` pendant `RELEASING`, seuls les lots rendent `MOVING`) ; la passerelle
  rend `MOVING` pendant `RELEASING` (US 4). L'en-tête `X-Authority-Epoch` est contrôlé par la passerelle là où le contrat le
  déclare (paiement, annulation, lots) ; l'imposer ailleurs (activation, caution, recharge) romprait les terminaux qui ne
  l'envoient pas : non fait, pas d'écart (le débit sur solde n'y existe pas).
- **Fermeture de caisse refusée en `EDGE`** (R-11) : comportement nouveau hors `/edge/*`, code déjà déclaré, décision 6 du porteur.

## R-30 Clôture d'événement, audit et alertes

- `RECONCILING` est refusé tant que l'autorité n'est pas au central (`CL019`, `0008:145` ; test existant
  `tests_event_ledger.sql:244-254`) ; la mission le prouve par un test de bout en bout (FR-024). Les ventes `EDGE_SYNC` restent
  acceptées en `CLOSING`/`RECONCILING` (`S:566` ne refuse que la source `ONLINE`) ; la limite `SYNC_DEADLINE_PASSED` à partir de
  `SETTLING` s'applique aussi (cas 17, SP:851 ; OP-N99 à prouver pour `EDGE_SYNC`).
- `event_device_sync_status` ne compte que les terminaux (SPEC:1239 parle aussi des passerelles) : la mission ne l'étend pas ; elle
  ajoute au rendu la condition « file vide » (déjà garantie par `edge_complete_release`) et signale l'écart (OP-N96, « Contradictions » n° 14).
- Audit (FR-034) : chaque bascule, rendu, reprise, révocation, rotation et passage `ISOLATED` est écrit par une fonction
  `audit` existante ; alertes `CHAIN_BROKEN`, rendu bloqué (`RELEASING` depuis plus de 10 min), passerelle muette, horloge.

---

## Écarts de sécurité (liste exhaustive)

Format : risque, raison, mission qui lève, condition de levée. Un écart « accepté » a, selon la règle 3 de `CLAUDE.md`, une entrée dans
`docs/POINTS_OUVERTS.md` (`OP-N100` à `OP-N110`), un ADR dans `docs/DECISIONS_ADR.md` (`ADR-155` à `ADR-165`), un test qui échoue si la limite
s'élargit, et un report dans `PROMPTS-A-ENVOYER.md` et `PRD.md`. Numéros attribués et consignés (voir chaque ligne).

**Acceptés par le porteur (05/11/2026, décisions 1 à 17)**

1. **Clés de la passerelle simulées** (stockage matériel, autorité des passerelles `EDGE_CA`) jusqu'à la 12b (`OP-N100`, `ADR-155`). Risque : clé de signature et
   clé d'accord en fichier ou en mémoire d'un faux ; la passerelle n'est pas utilisable en production. Lève : mission 12b. Condition : adaptateurs réels, faux
   refusés au démarrage en production (déjà prouvé), preuves NFR-009 sur les adaptateurs réels. Test de borne : démarrage refusé en production avec chaque faux.
2. **Jetons d'appareil de la passerelle : clé propre, sans rotation du jeton de rafraîchissement** (décisions 2 et 11, `OP-N101` et `OP-N102`, `ADR-156` et `ADR-157`).
   Risque : secret de signature de jetons sur un mini-PC de site ; pendant `EDGE`, plus de détection de réutilisation d'un jeton de rafraîchissement volé, et
   empreintes de jetons de rafraîchissement sur le site. Lève : 12b (clé en matériel) ; la rotation sur la passerelle demande une décision de contrat. Tests :
   R-19.
3. **Jeton de personne expiré toléré au guichet** (décision 3, règle de R-20 avec la condition `exp >= activated_at` ajoutée, `OP-N103`, `ADR-158`). Risque :
   compte révoqué pendant la coupure qui agit jusqu'à 12 h ; horloge reculée pendant un arrêt. Lève : **mission à fixer par le porteur** (proposition : mission
   d'exploitation de la 12b, avec un jeton de coupure signé par le central à l'ouverture de session). Tests : R-20, R-14.
4. **Ventes `EDGE_ONLINE` sans signature du terminal : perte maximale chiffrée** (décision 13, `OP-N104`, `ADR-159`) : formule `P_max` en R-09. Preuve du bracelet,
   plafond par vente et par terminal et par heure, alerte, au rejeu. Lève : relais de la signature du terminal (changement de contrat) ou mission 13. Test : R-09.
5. **Inscription d'une passerelle par UNE personne** (décision 16, choix du porteur contre la recommandation, `OP-N105`, `ADR-160`). Compensée par l'alerte et le délai
   avant les colis (R-05). Lève : approbation à deux à l'inscription (mission 12b ou 13). Test : R-05.
6. **Purge des secrets : limite du mini-PC volé avant la purge** (décision 17, `OP-N106`, `ADR-161`). Lève : mission d'exploitation (chiffrement des tables avec une clé du
   module matériel dès la 12b). Test : R-27, B.9 bis.
7. **Passerelle perdue sans rejeu automatique** (décision 4, `OP-N107`, `ADR-162`) : activation ou caution non reversées, `TOPUP_CASH` en anomalie ; résolution à deux.
8. **Dépassement temporaire d'un plafond réglementaire** (décision 14, `OP-N108`, `ADR-163`) : à signaler au juriste (R-10).
9. **« Même moteur » devient « mêmes modules »** (décision 1, `OP-N109`, `ADR-164`) : écart de texte, base locale à schéma réduit.
10. **Époque plausible qui provoque un `STALE`** (décision 15, `OP-N110`, `ADR-165`) : une époque forgée à `epoch + 1` ou `epoch + 2` arrête les débits jusqu'à la levée
    locale à deux personnes (R-16).

**Renforcements faits puis consignés (aucun écart au plan ; OP + ADR ouverts et clos dans la mission, règle 1)** : écriture directe de `cashless_app` sur `edge_gateway`
retirée (R-06.1) ; liaison passerelle/handover (R-06.2) ; `record_edge_seq` refuse `REVOKED`, `STANDBY` et l'absence de handover (R-06.3) ; reprise forcée prouvée par la
base (R-06.4) ; `EDGE_SYNC` refusée à `cashless_app` et enveloppe avec `origin_*` obligatoire (R-09) ; `begin_cash_close` refusé en `EDGE` ou avec une file non vide, bascule
refusée avec une session `CLOSING` (R-11) ; `operations_count` contrôlé par cycle et `RELEASE_REQUESTED -> COMPLETED` direct refusé (R-07, A05) ; accusé de bascule refusé si
l'horloge dépasse 24 h (R-14) ; bornes de décision en SQL sous verrou (R-09, A06) ; preuve du bracelet et plafonds au rejeu (A07) ; `REVERSAL` borné (A08) ; accusé refusé
sans le curseur de référence (A03) ; condition `exp >= activated_at` de la tolérance (A15) ; plafond d'heure de l'horloge (A14) ; portefeuille inexistant à l'activation et compte
de caisse tiré de la session (A24) ; clés d'origine du guichet = clé du terminal (A10).

**À SOUMETTRE AU PORTEUR (rien n'est codé sur ces points avant sa réponse ; le reste avance)**

11. **Plafonds de rejeu `EDGE_ONLINE`** : TRANCHÉ par le porteur le 05/11/2026, 50 000 et 500 000 XOF.
12. **Délai avant l'envoi des mots de passe** : TRANCHÉ par le porteur le 05/11/2026, 30 minutes.
13. **Rotation du jeton de rafraîchissement sur la passerelle** : la décision 11 l'exclut ; si le porteur veut la rétablir, il faut un champ de contrat de retour (hors
    décision 7). Sans réponse, rien ne change (sans rotation).
14. **Rôle des terminaux sur `401` d'un jeton du central** : hypothèse que le client rafraîchit sur un `401` (C-013) ; à confirmer avec l'équipe terminal, sans changer le contrat.

**Résolus par la passe contradictoire (plus des points à soumettre)** : rafraîchissement du jeton d'appareil (décision 11) ; audit de la tolérance conservé sur la passerelle seule
(décision 18, champ facultatif) ; registres de nonces séparés (séparation par `@authority`, R-21) ; curseur de changement non comptable (décision 12, accepté) ; énumérations
partagées (aucune valeur ajoutée, R-29).

**Risques inhérents au protocole, listés pour ne rien taire (non nouveaux, aucun contrôle retiré)**

- **Passerelle compromise ou zombie** : elle peut décider des ventes dans les bornes de R-09 (SP:714-716) ; après reprise forcée, une passerelle vivante et isolée continue de
  débiter (SP:780-785, accepté par le protocole).
- **Terminal, vendeur ou personne révoqués au central pendant une coupure** : la passerelle les accepte jusqu'au rattrapage (spec, hypothèses ; SP §9.7) ; borné par la
  réplication à 5 s tant que le lien existe (NFR-008), non borné sans lien.
- **Mots de passe de bracelets déchiffrables en mémoire de la passerelle** : prévu par SPEC §9.7 ; jamais en clair en base ni en journal (NFR-010).

**Fichiers à faire relire par une personne** (règle 4) : `0058` et suivantes (droits, enveloppes, `post_transaction`,
`begin_cash_close`), `post-roles.sql`, `roles.sql`, `main.edge.ts` et la garde `edgeMtls`, `tools/edge-admin`, tout adaptateur de
clé (`HARDWARE_KEYSTORE`, `EDGE_CA`), le vérificateur de jetons de la passerelle et la règle de tolérance de R-20, le vérificateur
de preuves de terminal si adapté, la canonicalisation de `edge_content` (R-12). L'agent qui a écrit le code ne vaut pas relecture
indépendante.

## Contradictions de sources (signalées, avec le choix fait et sa raison)

1. **« Même moteur d'écritures, base PostgreSQL locale »** (SPEC:80, 100) contre le flux de réplication stable (soldes et
   bracelets seuls, OA:14690, SP:682-690). Choix : « mêmes modules » (R-01, R-02), la base est réduite. Raison : le moteur SQL
   local ne peut pas être alimenté en écritures par le flux et `post_transaction` refuse les débits sous `EDGE`.
2. **`RELEASING` posé avant toute vérification** (SP:640-650, OA:6916) contre `complete_edge_release`, dont l'exception annule la
   transaction, et la table de transitions qui permet `RELEASE_REQUESTED -> COMPLETED` (`S:2523`). Choix : `begin_edge_release` en
   transaction propre, et refus du `COMPLETED` direct (R-07). Raison : seul moyen de persister l'état même quand la vérification
   échoue.
3. **`edgeMtls` « (`edge_gateway.public_key`) »** (OA:10997) contre `cert_sha256` au schéma. Choix : mTLS par empreinte
   `cert_sha256`, `public_key` = clé de signature des lots (R-04, R-13). Raison : deux usages distincts, un seul mécanisme déjà
   éprouvé pour les terminaux.
4. **`post_transaction` refuse les débits hors `EDGE_SYNC` sous `EDGE`** (`S:573`) contre « la passerelle débite sous `EDGE` »
   (SP:576-593, SPEC:1038). Choix : la passerelle ne passe pas par `post_transaction` (R-01) ; le central rejoue en `EDGE_SYNC`.
5. **Caution : `DEPOSIT_TAKEN` en `EDGE_SYNC` avec clé d'origine** (SP:745-751, SPEC:413) contre `take_deposit` (source `ONLINE` codée en
   dur, clé `deposit:<media>:<n>`, `S:1596-1620`) et `take_deposit_for_session` (`0036:640-657`). Choix : `edge_take_deposit` nouvelle
   (R-10).
6. **Repli de SP:746-750 qui débite la caisse de la station** contre la garde de caisse (`0036:500-529`, CL029 si la session n'est
   plus `OPEN`). Choix : l'écriture d'attente seulement si la session est `OPEN`, sinon anomalie portant le montant (R-10).
   Raison : ne pas faire planter le rejeu, ne rien perdre en silence.
7. **`edge_decision` « obligatoire » par sa description** (OA:14466) mais absent de `required` (OA:14420). Choix : le central
   l'exige pour tout type portant un montant (R-09). Raison : une décision devinée par le central serait une seconde autorité.
8. **`OfflineOperation.chain_hash` requis** (OA:14129) et utilisé dans l'exemple tantôt comme chaîne du terminal, tantôt comme
   chaîne de la passerelle (OA:14550 contre 14623). Choix : selon `authorized_mode` (R-12).
9. **`cash_session.status` a `CLOSING`** (`0036:91`) contre un contrat à `OPEN` / `CLOSED` (OA:14793). Choix : le champ
   répliqué `EdgeCashSession.status` porte `CLOSING` (schéma nouveau `Edge*`, hors enum du contrat public) et la passerelle le traite comme fermé.
10. **`DEBIT_AUTHORITY_MOVING` sans code `CL`** (OA:11807) alors que les autres erreurs de bascule en ont un. Choix : aucun SQLSTATE
    ; l'erreur est produite par la passerelle et par les lots du central selon l'état du handover.
11. **Fraîcheur de bout en bout** : SP:889 et SP:895 (génération de snapshot, battement de cœur de 60 s) contre NFR-008 (5 s).
    Choix : NFR-008 est lue comme « appliqué sur la passerelle » (R-22, R-28).
12. **`PROMPTS-A-ENVOYER.md:360` (Docker absent de la machine)** contre la mémoire du poste (base en Docker via colima). Choix :
    l'image se construit en CI (R-27) ; à rapprocher dans `PROMPTS-A-ENVOYER.md`.
13. **Frais d'activation prélevés sur le solde** listés indisponibles par SPEC:1038 ; le code ne teste que la caution
    `FROM_BALANCE` (`activation.service.ts:70-76`). Choix : la passerelle refuse les deux (R-25).
14. **SETTLING « attend les terminaux et les passerelles »** (SPEC:1239) contre `event_device_sync_status` (terminaux seuls).
    Choix : non étendu dans cette mission, signalé en OP (OP-N96).
15. **`TOPUP_CASH` « toujours rejeté »** (`OfflineOperationType`, OA:14115 ; ADR-137 ; C-006) contre la recharge espèces servie par
    la passerelle (SP:696-698, décision du 05/11). Choix : l'interdiction vaut pour un **lot de terminal** (y compris relayé
    par la passerelle, mode `DEVICE_OFFLINE`) ; une recharge décidée par la passerelle en direct (`EDGE_ONLINE`, session de caisse
    ouverte avant la bascule) est servie (R-10). Raison : décision du porteur du 05/11/2026 ; la lettre de l'énumération ne distingue pas ces
    deux cas, d'où la signalisation ; à clarifier dans l'ADR.
16. **`X-Authority-Epoch` « sur toute requête de débit »** (SP:578) contre un contrôle sur trois chemins seulement (R-api §4).
    Choix : contrôlé par la passerelle là où le contrat le déclare (R-29).
17. **Test du kit** « fonctions de bascule exposées » (`tests_grand_livre_cashless.sql:539-542`) contre `post-roles.sql:22-23,
    407-412` (non accordées à `cashless_app`). Choix : le test du kit s'exécute sous un rôle de sonde et ne prouve rien sur
    `cashless_app` ; la mission ajoute un test sous connexion réelle (R-09).
18. **Clé d'origine des opérations de guichet** : `R-10` (version antérieure) posait `<serial>:edge:<edge_seq>` ; le contrat déclare l'`Idempotency-Key`
    `<serial>:<seq>` pour `activateMedia`, `takeDeposit` et `createCashTopup`. Choix : la clé du terminal (A10, R-10).
19. **Deux schémas de flux** (`service_state` de `research.md` contre `reference` de `contracts/`) : un seul, celui de `contracts/` (A02, R-24).
