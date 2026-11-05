---
work_package_id: WP18
title: 'Réplication sur la passerelle : pages, références, solde effectif'
dependencies: [WP17]
requirement_refs:
- FR-008
- FR-009
- NFR-008
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T080, T081, T082, T083]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/replication/
create_intent: [apps/gateway/src/replication/replication.service.ts, apps/gateway/src/replication/page-applier.ts, apps/gateway/src/replication/reference-store.ts, apps/gateway/src/replication/pwd-pack-key.ts, apps/gateway/src/replication/delta-purge.ts, apps/gateway/src/replication/replication-loop.ts, apps/gateway/src/replication/replication.module.ts, apps/gateway/test/replication/page-apply.spec.ts, apps/gateway/test/replication/reference.spec.ts, apps/gateway/test/replication/effective-balance.spec.ts, apps/gateway/test/replication/delta-purge.spec.ts, apps/gateway/test/replication/freshness.spec.ts, apps/gateway/test/replication/pwd-pack-key.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/src/replication/**, apps/gateway/test/replication/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP18 – Réplication sur la passerelle

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `contracts/interfaces.md` § 5 (`effectiveBalance`), § 10 (`ReplicationService.pullOnce`,
  `catchUpTo`, `effectiveBalance`) ;
- `contracts/replication-page-additions.yaml` en entier : **c'est le seul schéma du flux**
  (`ReplicationPage`, `EdgeReference`, `EdgeDevice`, `EdgeDeviceSeqAcked`, `pwd_pack_key`,
  `edge_seq_applied`, `after_change_seq`) ;
- `data-model.md` B.3 (`edge_wallet`, `edge_media`, `edge_replication_cursor`), B.4 (entités
  remplacées en entier), B.2 `edge_op_delta` (règle de purge A26), B.7 (invariant 5) ;
- `research.md` R-24 (pagination, reprise, horizon A18), R-22 (colis et clé de contenu), R-19
  (empreinte de jeton répliquée), R-15 ;
- `docs/passation-8/rapports/plan-adversarial.md` A02, A03, A09, A16, A18, A26 ;
  `docs/passation-8/contexte-m8.md` décisions 12, 13, 16.

Code produit par les lots précédents : `GatewayTx`, tables d'`edge-0001` (WP16),
`CentralClient.getEdgeReplicationFeed`, `AuthorityService`, `REPLICATION_CATCH_UP` (WP17). Priorité
des sources : SPECIFICATION §0.3 ; contradiction signalée.

## Objective

Copier fidèlement l'état du central sur la passerelle et en dériver un **solde effectif** juste : un
crédit du central apparaît, un blocage s'applique en moins de 5 s (NFR-008), la reprise après
coupure ne laisse aucun
trou et un débit local n'est jamais compté deux fois. Ce lot est la seule écriture des tables
répliquées (R).

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP18 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur, en série) ; pas de commit ; port 80
intouché ; aucun `GRANT` ; un écart qui affaiblit la sécurité s'arrête et remonte au porteur.

## T080 – `ReplicationService` : application d'une page, curseurs dans la transaction

**But** : `pullOnce(): Promise<{ hasMore }>` et `catchUpTo(watermark)` (`interfaces.md` § 10).

- Appel `getEdgeReplicationFeed` avec `after_posting_id`, `after_change_seq` (champ facultatif
  accepté, décision 12) et `limit` ; réponse validée contre le schéma de
  `replication-page-additions.yaml` (un champ inconnu est ignoré, un champ requis manquant refuse la
  page entière, jamais une application partielle).
- **Une seule transaction locale par page** : écriture des soldes (`edge_wallet`), des bracelets
  (`edge_media`), du bloc `reference`, **puis** avance de `edge_replication_cursor`
  (`last_replicated_posting_id`, `last_change_seq`, `last_edge_seq_applied`, `last_applied_at`). Une
  page qui échoue à mi-chemin ne laisse ni donnée ni curseur avancés (test par panne injectée entre
  deux tables).
- Horizon (A18) : n'avance `last_replicated_posting_id` qu'à la valeur de l'horizon que la page
  déclare ; ne devine jamais un `posting.id` à partir des écritures reçues.
- `catchUpTo(watermark)` boucle sur `pullOnce` jusqu'à `last_replicated_posting_id >= watermark`,
  puis **relit une page vide** avec `last_change_seq` pour que le central consigne
  `reference_applied_seq` (A03) ; il rend la main à `AuthorityService` pour l'accusé. Reprise après
  une coupure : repart du curseur persisté, sans trou ni doublon.
- Boucle de fond (`replication-loop.ts`) : tire quand `hasMore`, sinon toutes les 1 s (intervalle
  configurable, documenté comme porteur de NFR-008), arrêt propre. Le rôle lu dans
  `reference.gateway.role` est transmis à `AuthorityService` à chaque passe (promotion `STANDBY`,
  A25).
- Les passes alimentent `GatewayClock` par l'en-tête `Date` (déjà fait par le client, ne le refais
  pas) ; erreur du central : le service garde son état et n'efface rien.

## T081 – Entités de référence et `pwd_pack_key`

- `reference-store.ts` : chaque entité de B.4 est **remplacée en entier** quand `reference` la porte
  (état courant), dans la transaction qui avance `last_change_seq`. Le statut d'un bracelet vient de
  `reference.media_refs` (journal `change_seq`) et prime sur `media[]` ; le statut et le palier d'un
  portefeuille viennent de `reference.wallet_states` pour un `change_seq` plus récent (B.3).
- Empreinte du jeton de rafraîchissement et certificat du terminal (`devices[].token_family`,
  `devices[].cert_sha256`) : stockés comme tels, **jamais journalisés**, et seulement quand le
  central les sert (la `PRIMARY` seule, R-19) ; une `STANDBY` n'en reçoit pas, et le service ne doit
  pas supposer leur présence.
- `pwd-pack-key.ts` : la clé de contenu `pwd_pack_key` arrive scellée pour la clé d'accord de la
  passerelle. Stocke l'enveloppe **telle quelle** (scellée) ; le descellement se fait à l'usage, en
  mémoire, par `HARDWARE_KEYSTORE.agree` (WP23). Les colis `pwd_pack_enc` restent chiffrés. **Aucun
  mot de passe en clair en base ni dans un journal** (NFR-010). Une `STANDBY` non promue ne stocke
  ni colis ni clé (A16) ; test.
- `device_seq_acked` : porté par la dernière page de chaque passe, versé dans `edge_device_seq`
  (`central_acked_seq`, `central_acked_at`, `acked_known`) ; jamais d'accusé provisoire (FR-026).

## T082 – Solde effectif et purge des deltas (A26)

- `effectiveBalance(tx, walletId)` = `effectiveBalance` du code partagé appliqué au solde central
  répliqué et aux `edge_op_delta` d'`edge_seq > edge_wallet.applied_edge_seq`, jamais négatif.
  N'écris pas ta propre arithmétique : importe la fonction de `@cashless/shared-rules`.
  `applied_edge_seq` vient de `edge_seq_applied` de la page qui a porté ce solde, **jamais** d'un
  `posting.id`.
- **Purge des deltas par issue du central (A26)** (`delta-purge.ts`) : `ACCEPTED` et
  `ACCEPTED_WITH_SHORTFALL` conservés jusqu'à l'application d'une page dont `edge_seq_applied >=
  edge_seq` ; `DUPLICATE` conservé jusqu'à une passe de réplication COMMENCÉE après la réception du
  résultat et couvrant le portefeuille, puis annulé ; `REJECTED` et `VOID` annulés dès le résultat.
  Le résultat vient de WP20 ; expose `onOpResult(tx, edgeSeq, status)` et `onPageApplied(tx,
  edgeSeqApplied)`, sans importer `queue/**` (WP20 appelle ce lot).
- Une recharge espèces locale relève le solde effectif **immédiatement** (B.7-5) : le delta positif
  est lu comme les autres. Le solde local peut donc dépasser le solde central de la somme des
  recharges non rejouées ; c'est voulu, la borne est au rejeu côté central. Ne « corrige » pas cela.

## T083 – Tests (`apps/gateway/test/replication/`)

Central simulé par un faux serveur de flux de test ; bases jetables `cashless_m8_edge_*`.

- `page-apply.spec.ts` : page valide ; page invalide refusée en entier ; panne entre deux tables :
  ni donnée ni curseur ; reprise après coupure au milieu d'une passe : aucun trou, aucun doublon ;
  horizon respecté (un `posting.id` plus grand que l'horizon n'avance pas le curseur) ; page vide
  avec `last_change_seq` faite avant l'accusé.
- `reference.spec.ts` : remplacement en entier ; `media_refs` prime sur `media[]` ; `wallet_states`
  prime sur `status` ; `STANDBY` : aucun colis ni clé ni empreinte de jeton stockés ; rôle changé
  transmis.
- `effective-balance.spec.ts` : crédit du central visible ; débit local déduit ; **aucun double
  comptage** quand la page apporte le débit déjà compté (`applied_edge_seq` avancé) ; jamais négatif
  ; recharge locale relève le solde ; un test qui compare à `effectiveBalance` du paquet partagé sur
  des vecteurs.
- `delta-purge.spec.ts` : les cinq issues ; **les deux sens** (delta supprimé trop tôt : jamais ;
  gardé trop longtemps : borné, ici `DUPLICATE` annulé à la passe suivante) ; un `DUPLICATE` suivi
  d'une page ancienne ne supprime rien.
- `freshness.spec.ts` : blocage d'un bracelet au central appliqué sur la passerelle en moins de 5 s
  au p95 (N essais, lien sain, mesure jusqu'à l'état local, **périmètre : la passerelle seule**,
  R-22) ; la mesure ne compare pas l'horloge de Node à une date posée par la base.
- `pwd-pack-key.spec.ts` : canari dans un colis : absent de la base, des journaux et de la sortie du
  processus sous UTF-8, hexadécimal, base64, base64url (contrôle positif : une variante qui le
  journalise échoue).

## Sécurité

- Cloisonnement : la passerelle ne stocke que les données de son événement ; un `event_id` ou
  `ledger_id` étranger dans une page refuse la page (journal d'alerte).
- Aucune clé maître, aucun mot de passe en clair (NFR-010) ; l'empreinte du jeton de
  rafraîchissement n'est jamais journalisée.
- À faire relire par une personne : `page-applier.ts` (atomicité page et curseur), `delta-purge.ts`
  (somme d'argent).

## Definition of Done

- [ ] Atomicité page + curseurs prouvée par panne injectée ; reprise sans trou ni doublon.
- [ ] Solde effectif égal à la fonction partagée ; aucun double comptage ; les deux sens de la purge testés.
- [ ] Blocage appliqué en moins de 5 s (p95) ; `STANDBY` sans colis.
- [ ] Contradictions signalées (par exemple si `replication-page-additions.yaml` et `data-model.md` B.4 divergent sur un champ) ; lignes de 100 caractères ; aucune dépendance nouvelle.

## Ce que le relecteur doit casser

- Couper la connexion à chaque instruction SQL d'une page : le curseur ne doit jamais être en avance
  sur les données.
- Rejouer deux fois la même page ; envoyer une page dont l'horizon recule.
- Faire arriver le débit local dans une page, puis le même delta encore compté : le solde doit
  baisser une seule fois.
- Servir une page d'un autre événement ; une page avec `pwd_pack_enc` à une passerelle `STANDBY`.
- Chercher un chemin où un delta `DUPLICATE` ou `REJECTED` reste actif indéfiniment, ou disparaît
  avant que le central l'ait appliqué.
