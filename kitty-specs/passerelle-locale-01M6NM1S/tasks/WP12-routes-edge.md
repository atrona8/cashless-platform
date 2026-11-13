---
work_package_id: WP12
title: Accusé, rendu et flux de réplication
dependencies: [WP10]
requirement_refs:
- FR-006
- FR-008
- FR-021
- FR-022
- FR-034
- NFR-011
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-passerelle-locale-01M6NM1S
base_commit: a5a2d1343a2a072b3d83cac32ac94d41696ff183
created_at: '2026-11-09T15:05:12.485749+00:00'
subtasks: [T052, T053, T054, T055, T056]
phase: Phase 3 - API du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/edge/handover/
create_intent: [apps/api/src/edge/handover/handover.controller.ts, apps/api/src/edge/handover/handover.service.ts, apps/api/src/edge/handover/handover.mapper.ts, apps/api/src/edge/handover/edge-handover.module.ts, apps/api/src/edge/replication/replication-feed.controller.ts, apps/api/src/edge/replication/replication-feed.service.ts, apps/api/src/edge/replication/edge-replication.module.ts, apps/api/src/edge/maintenance/edge-silence.worker.ts, apps/api/src/edge/maintenance/edge-release-stuck.worker.ts, apps/api/src/edge/maintenance/edge-maintenance.module.ts, apps/api/test/integration/edge/routes/ack-handover.spec.ts, apps/api/test/integration/edge/routes/release-handover.spec.ts, apps/api/test/integration/edge/routes/replication-feed.spec.ts, apps/api/test/integration/edge/routes/edge-maintenance.spec.ts, apps/api/test/integration/edge/routes/edge-cloistering.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/edge/handover/**, apps/api/src/edge/replication/**, apps/api/src/edge/maintenance/**, apps/api/test/integration/edge/routes/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 : Accusé, rendu et flux de réplication

> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour `edge_stuck_handovers` pour l'alerte de rendu bloqué.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte (`docs/passation-8/contexte-m8.md`, décisions 5, 6, 7, 12), ce prompt, puis seulement :

- `contracts/interfaces.md` § 2 (WP04 : `edge_ack_handover`, `begin_edge_release`, `edge_complete_release` ; WP08 : `edge_replication_page`, `mark_edge_gateways_silent`), § 7 (lignes `CL013`, `CL014`, `CL015`, `CL017`),
  § 10 ;
- `contracts/edge-routes.md` : `ackEdgeHandover`, `releaseEdgeHandover`, `getEdgeReplicationFeed`, « Erreurs de bascule », « Écarts constatés » 3, 4, 8 ;
- `contracts/replication-page-additions.yaml` (schéma **unique** du flux : à lire en entier) ;
- `research.md` **R-08** (lecture du flux, horizon, blocages), **R-24** (pagination, reprise, sort d'un delta), **R-30** (alertes) ; `data-model.md` A.3, A.4, A.7 (tableau « Persisté avant de répondre ») ;
- constats `A02`, `A03`, `A05`, `A17`, `A18` de `docs/passation-8/rapports/plan-adversarial.md` ;
- code existant : `apps/api/src/edge/identity/` (WP10 : garde, `assertOwnGateway`, `req.edgeGateway`), `errors/sqlstate-map.ts` (CL013 à CL017), `db/` (service de transaction du processus),
  `processes/worker.ts` (`WorkerRegistry`, `ProcessWorker`), `processes/maintenance.module.ts`, `db/maintenance-db.module.ts`.

## Objectif

Mettre en oeuvre trois routes du processus `edge` (socle de WP10) : `ackEdgeHandover`, `releaseEdgeHandover`, `getEdgeReplicationFeed`, plus les travaux de maintenance du central qui les entourent (passerelle muette,
rendu bloqué). Le point délicat est le rendu : `RELEASING` doit être **commité avant** toute vérification, et rester si la vérification échoue.

## Branch Strategy

- Branche de planification : `feat/passerelle-locale`. Branche de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane selon `kitty-specs/passerelle-locale-01M6NM1S/lanes.json`.

## Commande d'implémentation

```bash
LC_ALL=C LANG=C spec-kitty agent action implement WP12 --agent claude --mission passerelle-locale-01M6NM1S
```

## Règles du lot

- Tu ne lances ni Jest, ni pgTAP, ni `reset-db`. Tu ne commites pas. Tu ne touches pas à l'API du port 80. Aucune migration, aucun `GRANT`, aucun `.sql` généré.
- Lignes de 100 caractères, français, sans tiret cadratin. Aucun code d'erreur, aucune route, aucun schéma de contrat ajouté (WP01 seul touche `openapi.yaml`).
- Chaque route passe par une **enveloppe** `edge_*` avec `p_gateway` = `app.gateway_id` (posé par la garde de WP10) : jamais par une table, jamais par une fonction S12 brute.
- Fichiers hors carte : `apps/api/src/processes/maintenance.module.ts` (import du module de maintenance, une ligne) et `apps/api/src/processes/edge.module.ts` (import des trois modules de routes ; fichier de WP10, ajoute les
  imports seulement). Rien d'autre sans accord. Un écart qui affaiblit la sécurité s'arrête et remonte au porteur.

## T052 : `ackEdgeHandover`

**But.** `POST /edge/handovers/{handover_id}/ack`, corps `{ epoch, replicated_posting_id }`, via `edge_ack_handover(p_gateway, p_handover, p_epoch, p_replicated)`. Réponse `200` `DebitAuthorityState` (`ACTIVE`).

**Arbitrages.**
- **Idempotent (A17)** : un accusé répété sur un handover déjà `ACTIVE` de la même passerelle et de la même époque répond `200` avec l'état courant, sans écriture ; c'est la fonction SQL qui le décide, l'API
  ne le recode pas. Test : la réponse `200` est perdue, la passerelle réessaie, elle reçoit `200` (pas `409`).
- Refus : `CL013` donne `409 HANDOVER_INVALID_STATE` (handover inconnu **ou d'une autre passerelle**, même réponse, sans révéler l'existence) ; `CL014` donne `409 EDGE_NOT_CAUGHT_UP` (filigrane de posting non
  atteint **ou** curseur `change_seq` pas encore atteint, A03) ; `CL015` donne `409 STALE_AUTHORITY_EPOCH`. Corps incomplet ou valeur manquante : refus de la même façon, pas `500` (validation puis `422
  VALIDATION_FAILED` pour la forme ; le contrat ne déclare pas de `400` ici, voir « Contradictions »).
- La passerelle ne débite qu'après le `200` : rien à faire côté central, mais le test de la réponse d'état (`authority`, `epoch`, `handover.state`) doit montrer `ACTIVE` et l'époque du grand livre.
- Une passerelle `STANDBY` : `edge_ack_handover` la refuse (`CL013`). Ne contourne pas.

## T053 : `releaseEdgeHandover` (`RELEASING` d'abord)

**But.** `POST /edge/handovers/{handover_id}/release`, corps `{ epoch, final_edge_seq, last_chain_hash (Hex32), operations_count }`. Deux appels, dans deux transactions **séparées** :

1. `begin_edge_release(...)` : `RELEASE_REQUESTED` vers `RELEASING`, commit **propre** (rejouable : déjà `RELEASING`, sans effet). Cette transaction est validée **avant** l'étape 2, même si l'étape 2 échoue.
2. `edge_complete_release(...)` dans une seconde transaction : en cas de succès, `200` `DebitAuthorityState` avec `authority = CENTRAL`.

**Arbitrages.**
- Ne les mets jamais dans la même transaction (un rollback de la vérification effacerait `RELEASING`, c'est le défaut que A05 et R-08 visent). Test : la seconde échoue, la ligne reste `RELEASING`.
- `CL014` : `409 EDGE_NOT_CAUGHT_UP` avec `missing_edge_seqs` dans le corps (champ du schéma `Handover` ; limite à ce que le contrat prévoit, ne crée pas de champ). Le handover reste `RELEASING`.
- `CL017` : `409 CHAIN_BROKEN` (chaîne ou **nombre** d'opérations différent) ; lève l'alerte `EDGE_CHAIN_BROKEN` ; le handover reste `RELEASING`. `CL015` : `409 STALE_AUTHORITY_EPOCH`. `CL013` : `409 HANDOVER_INVALID_STATE`.
- `operations_count` est un compte **par cycle** : `final_edge_seq - edge_seq_at_activation` (A05). C'est la fonction SQL qui compare. Ne reproduis pas la formule dans l'API.
- L'API ne sort jamais `RELEASE_REQUESTED` vers `COMPLETED` directement : seule `RELEASING` y mène ; un handover déjà `COMPLETED` rend l'état courant (idempotence) sans nouvelle écriture.
- Le corps est petit (quelques octets), mais la route est dans le processus `edge` : limite de corps par défaut du processus, rien à relever (le relèvement à 1 Mio concerne `sync-batches`, WP13).

## T054 : `getEdgeReplicationFeed`

**But.** `GET /edge/replication-feed?after_posting_id=&limit=&after_change_seq=` via `edge_replication_page(p_gateway, p_after_posting, p_after_change, p_limit)` qui renvoie un `jsonb` conforme à
`replication-page-additions.yaml`. L'API **valide**, ne fabrique pas.

**Arbitrages.**
- Paramètres : `after_posting_id` requis (entier >= 0), `limit` entre 1 et 200 (défaut 50, à relire dans `components/parameters/Limit` du contrat), `after_change_seq` facultatif (>= 0). Hors bornes : `422 VALIDATION_FAILED`.
- La page est ré-émise telle que la fonction la rend, après vérification de forme par le schéma généré (`ReplicationPage` de `@cashless/contracts`). Une page qui ne valide pas : `500` journalisé sans corps, jamais renvoyée.
- **Aucun secret en clair** (NFR-010) : ni clé maître, ni mot de passe de bracelet en clair, ni empreinte de PIN. Un test de canari sur la réponse complète (voir tests).
- Horizon (A18) : la fonction le gère ; l'API ne relâche jamais `to_posting_id` et ne cache pas la page. Une page identique pour une même requête est normale (état absolu).
- Le `409` du contrat n'a pas de cause : n'en invente pas. Une passerelle `REVOKED` ne passe pas la garde (401), une `STANDBY` reçoit la page mais **sans** colis (la fonction le décide, A16) : test.
- `after_change_seq` absent : la réponse ne porte pas le bloc `reference` (forme d'avant l'ajout) ; présent, y compris `0` : le bloc est servi. `reference_applied_seq` est écrit par la fonction ; l'API ne l'écrit pas.

## T055 : Travailleurs de maintenance du central

**But.** Deux travailleurs (`ProcessWorker`), exécutés par le processus `maintenance` existant :
- `edge-silence.worker.ts` : appelle `mark_edge_gateways_silent(p_threshold)` (seuil 60 s, constante nommée, pas de clé de configuration nouvelle). La fonction fait `ACTIVE` vers `ISOLATED` et lève l'alerte `EDGE_SILENT`.
- `edge-release-stuck.worker.ts` : alerte `EDGE_RELEASE_STUCK` pour un handover `RELEASING` depuis plus de 10 minutes (`begun_releasing_at`, R-30).

**Point à régler avant de coder.** `interfaces.md` § 2 ne fournit aucune fonction pour l'alerte de rendu bloqué, et le rôle du processus de maintenance n'a aucun droit sur les tables. Lis les corps réels
de `mark_edge_gateways_silent` (WP08) : si elle couvre aussi le rendu bloqué, appelle-la seule. **Sinon, n'ajoute ni droit ni table : arrête-toi sur ce travailleur et signale-le** (le travailleur de silence se fait quand même).

**Cas limites.** Le travailleur ne lève pas deux fois la même alerte pour un même état (la fonction SQL déduplique ; vérifie). Une passerelle `REVOKED` n'est jamais remise `ACTIVE`. `alarm()` rend un code non nul
quand une passerelle est muette ou un rendu bloqué, comme `poller-alarms.ts`.

## Tests attendus

Dans `apps/api/test/integration/edge/routes/` :

- `ack-handover.spec.ts` : `GRANTED` vers `ACTIVE` ; deuxième accusé identique : `200`, aucune ligne d'audit ni de curseur de plus ; mauvaise époque : `409 STALE_AUTHORITY_EPOCH` ; `replicated_posting_id` sous le filigrane :
  `409 EDGE_NOT_CAUGHT_UP` ; curseur `change_seq` en retard (blocage sans écriture une seconde avant l'accord) : `409 EDGE_NOT_CAUGHT_UP` puis `200` après une page avec le curseur final ; handover d'une autre passerelle : même
  `409 HANDOVER_INVALID_STATE` qu'un inconnu, mêmes octets de corps.
- `release-handover.spec.ts` : chemin heureux (`RELEASE_REQUESTED` vers `COMPLETED`, `CENTRAL`, époque +2) ; **opérations manquantes** : `409 EDGE_NOT_CAUGHT_UP` avec `missing_edge_seqs`, le handover est `RELEASING` en base
  (relue d'une autre connexion) ; chaîne différente : `409 CHAIN_BROKEN`, alerte levée, `RELEASING` conservé ; **deux cycles consécutifs** : `operations_count` du second cycle = 40 pour `final_edge_seq` 4251 (A05) ;
  `operations_count` faux : `CHAIN_BROKEN` ; rejeu du `release` après réussite : `200`, aucune écriture ; `COMPLETED` direct depuis `RELEASE_REQUESTED` impossible.
- `replication-feed.spec.ts` : forme validée par le schéma généré ; reprise sans trou ni doublon sur trois pages ; **horizon** : deux sessions, validation retardée volontairement, aucune écriture d'`id` inférieur à
  `to_posting_id` n'est sautée ; `after_change_seq` absent ou présent ; `limit` hors bornes ; canari : une clé de bracelet connue du test n'apparaît dans la réponse sous aucune représentation (UTF-8, hex, base64) ; `STANDBY` : aucun colis.
- `edge-maintenance.spec.ts` : passerelle muette 90 s : `ISOLATED` + alerte ; retour d'un appel : `CATCHING_UP` puis `ACTIVE` (selon WP08) ; `REVOKED` jamais rétablie ; rendu bloqué 11 minutes : alerte (si T055 le permet) ; pas de doublon d'alerte.
- `edge-cloistering.spec.ts` : sur chacune des trois routes, passerelle d'un autre événement, d'un autre prestataire, révoquée, certificat de terminal : 401 ou `409` uniforme sans fuite (NFR-011) ; la même requête avec le `handover_id` d'un autre
  événement ne distingue pas « inconnu » de « étranger ».

Chaque test doit échouer sur une implémentation fausse : celle qui fait `begin` et `complete` dans une seule transaction doit être rouge ; celle qui recopie le compte au lieu de laisser la fonction SQL le contrôler, aussi.

## Décisions du porteur du 09/11/2026 (font foi sur ce prompt)

Source : `docs/passation-8/contexte-m8.md`, décisions 19 à 31, et les notes adressées à ce lot dans
`docs/passation-8/suivi-lots.md`.

- Décision 23 (OP-N102, décision 11) : rien ne pose encore `device_refresh_token.edge_exposed`. L'API appelle
  `edge_expose_device_token_families(event_id)` (WP09, `0064`) à l'octroi de l'autorité à la passerelle, avant la
  première page servie, puis à chaque renouvellement de jeton d'appareil sur le central pendant que l'événement est
  `EDGE`. Test : après l'octroi, la page de réplication porte `token_family` ; un terminal d'un autre événement non.
- WP07 : DUPLICATE/VOID/REJECTED + `EDGE_REPLAY_FAILED` à mapper si les routes les exposent (voir suivi).

## Sécurité

- Fichiers à faire relire par une personne : `handover.service.ts` (séquence `RELEASING` puis vérification), `replication-feed.service.ts` (aucun secret en clair).
- Les erreurs ne révèlent pas l'existence d'un objet d'une autre passerelle (un seul `409` uniforme).
- Aucun secret ni corps de page dans les journaux ; on loge des compteurs et des curseurs seulement.
- Une alerte `EDGE_CHAIN_BROKEN` ne contient ni le contenu des opérations ni les empreintes entières.

## Definition of Done

- [ ] Les trois routes répondent comme `edge-routes.md`, par les enveloppes seules.
- [ ] `RELEASING` conservé quand la vérification échoue, prouvé d'une autre connexion.
- [ ] `operations_count` par cycle prouvé sur deux cycles.
- [ ] Flux conforme au schéma généré, sans trou, sans secret, avec et sans `after_change_seq`.
- [ ] Silence et rendu bloqué alertés (ou point signalé).
- [ ] Hors carte listé dans le rapport ; fichiers à relire nommés.

## Ce que le relecteur doit casser

- Faire échouer `edge_complete_release` (opération manquante) puis lire la base d'une autre session : `RELEASING` doit y être.
- Accuser deux fois, puis accuser avec l'époque d'avant ; accuser le handover d'une autre passerelle du même prestataire.
- Appeler le flux avec `limit=201`, `after_posting_id=-1`, `after_change_seq=-5`, et pendant qu'un posting d'id inférieur valide tard.
- Chercher dans la réponse du flux la valeur d'une clé de bracelet ou d'un mot de passe de test.
- Chercher un `SELECT` direct sur `posting`, `media`, `debit_authority_handover` dans `apps/api/src/edge/**`.

## Contradictions relevées entre les sources (aucune n'est corrigée ici)

- `edge-routes.md` : `ackEdgeHandover` et `releaseEdgeHandover` ne déclarent pas de `400` ni de `422` ; un corps invalide répond `422 VALIDATION_FAILED` comme ailleurs dans l'API. À confirmer par l'orchestrateur (écart 3 d'`edge-routes.md`).
- `data-model.md` A.1 donne EXECUTE de `cashless_edge` sur `begin_edge_release`, `edge_complete_release`, `edge_ack_handover` ; `edge-routes.md` nomme `ack_edge_handover` et `complete_edge_release` dans son tableau. **`interfaces.md` fait foi** (enveloppes `edge_*`).
- `tasks.md` T055 prévoit des « alertes » du travailleur sans fonction SQL correspondante dans `interfaces.md` § 2 pour le rendu bloqué (voir T055).
- `research.md` R-08 situe `edge_sync_batch` en migration `0059` ; `interfaces.md` § 1 : `0060`. **`interfaces.md` fait foi.**
