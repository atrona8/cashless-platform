---
work_package_id: WP20
title: File des décisions et vidage vers le central
dependencies: [WP17]
requirement_refs:
- FR-014
- FR-017
- FR-022
- NFR-004
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T089, T090, T091, T092]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/queue/edge-queue.ts
create_intent: [apps/gateway/src/queue/edge-queue.ts, apps/gateway/src/queue/drain.service.ts, apps/gateway/src/queue/batch-builder.ts, apps/gateway/src/queue/result-applier.ts, apps/gateway/src/queue/staff-audit-feed.ts, apps/gateway/src/queue/queue.module.ts, apps/gateway/test/queue/append.spec.ts, apps/gateway/test/queue/drain.spec.ts, apps/gateway/test/queue/results.spec.ts, apps/gateway/test/queue/vectors.spec.ts, apps/gateway/test/queue/crash-points.spec.ts, apps/gateway/test/queue/abandoned.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/src/queue/**, apps/gateway/test/queue/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP20 – File et vidage

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `contracts/interfaces.md` § 4 (`EDGE_QUEUE`), § 5 (`edgeContent`, `edgeContentSha256`,
  `edgeChainGenesis`, `chainStep`, `batchSigningPayload`), § 7 (`409 EDGE_NOT_CAUGHT_UP`,
  `CHAIN_BROKEN`, `SEQ_OUT_OF_ORDER`), § 10 (`EdgeQueue.append`, `DrainService.runOnce`), points
  d'arrêt ;
- `data-model.md` B.2 en entier (`edge_chain_head`, `edge_op`, `edge_op_delta`, `edge_device_batch`,
  `edge_outgoing_batch`), B.7 (invariants 1, 2, 7), B.8 (lignes « file vide », `EDGE_NOT_CAUGHT_UP`)
  ;
- `research.md` R-12 (contenu haché, chaîne, vecteurs), R-13 (signature du lot), R-16 (numéro sous
  verrou, un lot en vol), R-20 (audit versé), R-26 (points d'arrêt) ;
- `contracts/edge-routes.md` (`submitEdgeSyncBatch`, taille du corps, `abandoned`),
  `contracts/replication-page-additions.yaml` (`staff_token_audit`) ;
- `docs/passation-8/rapports/plan-adversarial.md` A05, A26, A29, A28 ; vecteurs :
  `apps/api/test/fixtures/edge-vectors/vectors.json` (WP02).

Produits par les lots précédents : `GatewayTx`, tables d'`edge-0001`, `HARDWARE_KEYSTORE`,
`CentralClient.submitEdgeSyncBatch`, `AuthorityService`, `failpoint()` (WP16 et WP17), fonctions
partagées de WP02.

## Objective

Ne jamais perdre un numéro et ne jamais répondre sans avoir écrit. `EdgeQueue.append` attribue
`edge_seq` et la chaîne **dans la transaction de l'opération** ; `DrainService` envoie les décisions
au central par lots signés,
un seul lot en vol, avec renvoi à l'identique, traitement des lots abandonnés, application des
résultats et rendu final. Les lots 21 à 23 écrivent par ce lot, jamais directement dans `edge_op`.

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP20 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur, en série) ; pas de commit ; port 80
intouché ; aucun `GRANT` ; si une colonne manque à `edge-0001`, signale-le ; un écart qui affaiblit
la sécurité s'arrête et remonte au porteur.

## T089 – `EdgeQueue.append`

**But** : `append(tx, op: EdgeOpInput, deltas: WalletDelta[]): Promise<EdgeOpRow>` (`interfaces.md`
§ 4).

- Prend `edge_chain_head` `FOR UPDATE` **dans la transaction fournie** (celle de l'opération,
  ouverte par l'appelant) ; `edge_seq = last_edge_seq + 1` ; pas de séquence PostgreSQL (trous après
  arrêt brutal).
- Calcule `content_sha256 = edgeContentSha256(op)` et `chain_hash =
  chainStep(chain_head.last_chain_hash, content_sha256)` avec **le code partagé uniquement**. Écrit
  `edge_op` (l'objet `EdgeSyncOperation` complet dans `operation`), les `edge_op_delta`, avance
  `edge_chain_head`. Tout dans la même transaction que l'effet, l'idempotence, le nonce et le tap
  (invariant B.7-1) : `append` n'ouvre ni ne commite jamais de transaction.
- `chain_hash` d'une opération `EDGE_ONLINE` = chaîne de la passerelle ; pour `DEVICE_OFFLINE`
  relayée : maillon de la chaîne **du terminal** (R-12), celle de la passerelle étant portée par le
  lot. Le paramètre `op` porte le mode.
- `VOID` : une entrée `void_reason` consomme son numéro quand un refus final est enregistré
  (contrat, note 4) ; forme fixée par les vecteurs de WP02.
- Appelle `failpoint('before-local-write')` avant l'écriture et
  `failpoint('after-local-write-before-reply')` est placé **par l'appelant** après le commit :
  documente-le.
- Refuse (erreur interne, rien d'écrit) un `edge_seq` ou un delta hors `bigint` sûr (2^53 - 1), une
  opération sans clé d'origine, une clé d'origine déjà présente (l'appelant doit avoir consulté
  l'idempotence).

## T090 – `DrainService` : un lot en vol, signature, renvoi à l'identique, lot abandonné

- `runOnce(): Promise<{ sent, empty }>` : si un `edge_outgoing_batch` n'est pas `DONE`, **renvoie le
  même lot à l'identique** (même `batch_id`, même corps, même empreinte) ; sinon construit un lot de
  500 opérations et 1 Mio au plus (`edge_seq_from`, `edge_seq_to`, `prev_chain_hash`,
  `last_chain_hash`, `epoch`, `device_batches` relayés avec en-tête et signature d'origine,
  `staff_token_audit`). Statut `PREPARED` puis `SENT` (commit **avant** l'envoi).
- Signature : `HARDWARE_KEYSTORE.sign('batch', batchSigningPayload(lot))` (JCS sans `signature`,
  base64). Ne signe jamais deux contenus différents sous un même `batch_id`.
- Point d'arrêt `during-drain-after-send-before-result` entre l'envoi et l'écriture du résultat.
- Un seul lot en vol, imposé par l'index unique de WP16 **et** par le code ; deux `runOnce`
  concurrents n'en construisent qu'un (verrou).
- **Lot `ABANDONED` (A29)** : si le central répond `abandoned: true`, applique les résultats
  partiels, puis construit un **nouveau** lot avec un nouveau `batch_id` et `edge_seq_from` =
  premier numéro sans résultat. Jamais le même `batch_id` en boucle. Test dédié.
- Pas d'envoi si `AuthorityService` est `REVOKED`, ni si l'époque du lot est inférieure à
  `highest_epoch_seen` sans que le central l'ait demandé (le lot reste ; alerte). `STALE` n'empêche
  pas de **vider** la file (le vidage ne débite pas).
- `409 EDGE_NOT_CAUGHT_UP` : reprend depuis `missing_edge_seqs` ; `SEQ_OUT_OF_ORDER` : relit
  `device_seq_acked`/résultats et reconstruit ; `CHAIN_BROKEN` : arrêt du vidage, alerte locale,
  **aucune réécriture** de la file.

## T091 – Résultats, accusés, audit de tolérance, rendu final

- `result-applier.ts` : pour chaque résultat du central, met à jour `central_status`,
  `central_transaction_id`, `central_reason`, `central_detail`, `sent_batch_id` (seuls champs
  modifiables), applique la règle de purge des deltas par un appel à `onOpResult` de WP18 (jeton
  d'injection `DELTA_PURGE`, interface définie ici : `{ onOpResult(tx, edgeSeq, status) }`), avance
  `edge_chain_head.acked_edge_seq` / `acked_chain_hash`, marque le lot `DONE`. Un résultat pour un
  `edge_seq` inconnu ou déjà `ACCEPTED` avec une autre issue : alerte, aucune écriture.
- Les accusés du terminal (`edge_device_seq.central_acked_seq`) se mettent à jour **depuis les
  résultats du central**, jamais depuis la file locale (FR-026).
- `staff-audit-feed.ts` : joint au lot les lignes `edge_audit` `STAFF_TOKEN_TOLERATED` pas encore
  versées (`sent_in_batch` nul) et les ordres `LOCAL_UNSTALE` ; `sent_in_batch` est posé **à la fin
  du lot `DONE`** seulement.
- Rendu final : quand la file est vide et `acked_*` à jour, expose `QueueProbe.isEmpty()` (WP17) et
  un résumé `{ final_edge_seq, last_chain_hash }` ; le calcul de `operations_count` reste dans WP17
  (`final_edge_seq - edge_seq_at_activation`).

## T092 – Tests (`apps/gateway/test/queue/`)

Central simulé par un faux serveur de test ; bases jetables `cashless_m8_edge_*` ; le processus de
la passerelle est lancé en enfant quand un test tue le processus.

- `append.spec.ts` : numéros 1..N continus sous 50 appels concurrents ; chaîne égale à la
  recomputation indépendante ; **deux transactions concurrentes ne prennent jamais le même numéro**;
  un `ROLLBACK` après `append` ne laisse aucun trou (le numéro est réutilisable parce qu'il n'a
  jamais été commité, pas parce qu'on le saute) ; modification ou suppression d'une ligne refusée
  par la base.
- `vectors.spec.ts` : `content_sha256` et `chain_hash` égaux à `vectors.json` pour les cas (a) à (j)
  de R-12, dont `edge_seq` 2^32, 2^53 - 1 et le refus de 2^53.
- `drain.spec.ts` : un seul lot en vol ; après coupure, **même `batch_id`, même corps, même
  signature** ; 500 opérations ou 1 Mio, le premier atteint ; 100 renvois : un résultat ; signature
  vérifiable avec la clé publique du port.
- `results.spec.ts` : chaque issue du central et son effet sur les deltas (en liaison avec le faux
  `DELTA_PURGE`) ; accusés issus des résultats seulement ; `staff_token_audit` joint,
  `sent_in_batch` posé seulement à `DONE`.
- `abandoned.spec.ts` : lot abandonné -> nouveau `batch_id`, `edge_seq_from` correct, aucune boucle
  (A29).
- `crash-points.spec.ts` (en enfant, `EDGE_ALLOW_FAILPOINTS=1`) : `before-local-write` (rien écrit,
  numérotation continue au redémarrage), `after-local-write-before-reply` (l'entrée existe, aucun
  trou), `during-drain-after-send-before-result` (au redémarrage, **même lot** renvoyé, central
  simulé répond `DUPLICATE`, état final cohérent) ; `kill-local-database` : le banc de WP25 le
  déclenche, ici seulement le contrat du point (le processus attend sans valider). Doit échouer si
  `append` commite seul.
- `EDGE_NOT_CAUGHT_UP` reprend depuis `missing_edge_seqs` ; `CHAIN_BROKEN` arrête sans réécrire.

## Sécurité

- Une perte silencieuse est un défaut bloquant : aucune réponse 2xx sans entrée de file (NFR-004),
  aucune opération supprimée ou réécrite.
- Le lot est signé par la clé du port matériel ; jamais de signature d'un contenu non canonique ;
  aucune clé en base ni en journal.
- Fichiers à faire relire par une personne : `edge-queue.ts` (numéro et chaîne), `drain.service.ts`
  (un lot en vol, renvoi à l'identique).

## Definition of Done

- [ ] Continuité 1..N prouvée sous concurrence et après arrêts ; chaîne égale aux vecteurs indépendants.
- [ ] Renvoi à l'identique, lot abandonné, `EDGE_NOT_CAUGHT_UP`, `CHAIN_BROKEN` testés.
- [ ] Purge des deltas branchée par résultat ; accusés issus du central seul.
- [ ] Lignes de 100 caractères ; aucune dépendance npm nouvelle ; contradictions signalées.

## Ce que le relecteur doit casser

- Tuer le processus à chaque `failpoint`, puis relancer : chercher un trou de numéro, une opération
  sans entrée, un lot renvoyé avec un autre corps.
- Appeler `append` hors transaction, ou deux fois avec la même clé d'origine.
- Faire répondre le central `abandoned` en boucle ; lui faire renvoyer un résultat pour une
  opération inconnue.
- Modifier à la main une ligne d'`edge_op` ou d'`edge_audit` pendant un vidage.
- Vérifier que la chaîne reste vraie après 10 000 opérations et un redémarrage au milieu du vidage.
