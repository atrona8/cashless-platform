---
work_package_id: WP23
title: Lots hors ligne, snapshots locaux et clés de bracelet sur la passerelle
dependencies: [WP18, WP19, WP20]
requirement_refs:
- FR-025
- FR-026
- FR-027
- C-006
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T103, T104, T105, T106, T107]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/operations/offline/offline-batches.service.ts
create_intent: [apps/gateway/src/operations/offline/offline-batches.service.ts, apps/gateway/src/operations/offline/offline-batches.controller.ts, apps/gateway/src/operations/offline/batch-verifier.ts, apps/gateway/src/operations/offline/offline-rules-runner.ts, apps/gateway/src/operations/offline/media-auth-key.service.ts, apps/gateway/src/operations/offline/offline.module.ts, apps/gateway/src/snapshots/snapshot-builder.ts, apps/gateway/src/snapshots/snapshot-signer.ts, apps/gateway/src/snapshots/snapshots.controller.ts, apps/gateway/src/snapshots/snapshot-worker.ts, apps/gateway/src/snapshots/snapshots.module.ts, apps/gateway/test/offline/batches.spec.ts, apps/gateway/test/offline/relay.spec.ts, apps/gateway/test/offline/snapshots.spec.ts, apps/gateway/test/offline/media-auth-key.spec.ts, apps/gateway/test/offline/canary.spec.ts, apps/gateway/test/offline/contract.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/src/operations/offline/**, apps/gateway/src/snapshots/**, apps/gateway/test/offline/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP23 – Lots hors ligne, snapshots et clés de bracelet

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `contracts/gateway-served-operations.md` : lignes 5, 13, 14, 15, 16 du tableau, notes 3 et 6 ;
- `contracts/interfaces.md` § 4 (`HARDWARE_KEYSTORE`), § 5, § 7 ; `data-model.md` B.2
  (`edge_device_batch`, `edge_op`), B.3 (`edge_media`), B.6 (`edge_snapshot*`), B.7 (invariant 6) ;
- `research.md` R-22 (snapshots, mots de passe, fraîcheur), R-25 (lignes `getOfflineSnapshot` à
  `getOfflineBatchResult`), R-12 (cas (c) lot relayé), R-13 (signature d'origine relayée), R-19
  (`kid` propre), R-27 (aucune clé maître), R-28 (NFR-008, NFR-010) ;
- `docs/passation-8/rapports/plan-adversarial.md` A02, A16, A22 ; `docs/passation-8/contexte-m8.md`
  décisions 4, 13, 14 ;
- mission 7 : `kitty-specs/hors-ligne-snapshots-lots-01M645RN/` (`contracts/batches.md`,
  `contracts/snapshots.md` si présents, R-xx des lots) pour les **règles** des lots et des
  snapshots.

Code de référence de l'API (à lire, **ne pas importer**) :
`apps/api/src/offline/batches/batch-intake.ts` (l.192-195 : refuse sous `EDGE`, règle d'autorité à
**inverser** ici), `batch-chain.ts` (partie pure déjà dans `@cashless/shared-rules`),
`offline/processing/offline-operation.processor.ts`, `offline/rules/*` (déjà dans le paquet
partagé), `offline/snapshots/` (format, `FULL`/`DELTA`, enveloppes), `@cashless/tag-format`
(`sealForRecipient`).
Priorité des sources : SPECIFICATION §0.3 ; contradiction signalée.

## Objective

Faire cohabiter terminaux isolés et passerelle : (1) recevoir les lots hors ligne d'un terminal avec
les règles de la mission 7 **sous l'autorité de la passerelle**, les mettre en file pour le central
; (2) produire des
snapshots signés par la **clé propre de la passerelle** ; (3) servir `getMediaAuthKey` sans clé
maître ni mot de passe en clair en base. Ce lot manipule des mots de passe de bracelets : le canari
est la preuve centrale.

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP23 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur, en série) ; pas de commit ; port 80
intouché ; aucun `GRANT` ; aucune dépendance npm nouvelle ; aucun faux nouveau sans règle de
production enregistrée ; un écart qui affaiblit la sécurité
s'arrête et remonte au porteur.

## T103 – `submitOfflineBatch`, `getOfflineBatchResult`

- `POST /offline-batches` (`Idempotency-Key` = `batch_id`, `X-Device-Serial`, `X-Authority-Epoch`) :
  le pipeline de la mission 7 est **réécrit sur les tables locales**, pas importé (le code de l'API
  est lié à la base centrale). Vérifie : `AuthorityService.assertCanDebit` (règle **inversée** :
  sous `EDGE` actif la passerelle accepte, `RELEASING` -> `409 DEBIT_AUTHORITY_MOVING`, `STALE` ->
  `409 STALE_AUTHORITY_EPOCH`, taille -> `413 BATCH_TOO_LARGE`), signature d'origine du lot avec
  `edge_device.public_key` (`400 BATCH_SIGNATURE_INVALID`), chaîne du terminal recalculée avec le
  code partagé jusqu'à `header.last_chain_hash` (`409 CHAIN_BROKEN`), continuité des numéros du
  terminal.
- **Règles de la mission 7 appliquées par le code partagé** (`offline/rules/*`, plafonds de la
  configuration citée `device_configs[]`, statut du bracelet **répliqué**, blocage répliqué, lot du
  bracelet, `event.status`) ; aucune logique de règle ne se recopie : appelle
  `@cashless/shared-rules`.
- Chaque opération acceptée devient une entrée `edge_op` : `authorized_mode = DEVICE_OFFLINE`,
  `device_batch_id`, `chain_hash` du **terminal** (R-12) ; l'en-tête et la signature d'origine sont
  rangés dans `edge_device_batch` pour être relayés à part. Tout dans la même transaction que le
  résultat du lot (`EdgeQueue.append`, WP20). Idempotence : même `batch_id` et même empreinte ->
  même résultat ; autre empreinte -> `422`.
- `getOfflineBatchResult` : `404` lot inconnu, `202` en cours, sinon le résultat local (jamais plus
  fort que le résultat du central quand celui-ci est revenu).

## T104 – `TOPUP_CASH` d'un lot de terminal rejeté ; relais en file

- Une opération `TOPUP_CASH` dans un lot de terminal : `REJECTED` avec `OFFLINE_NOT_ALLOWED`
  (C-006), **sans delta** et sans effet sur le solde ; le rejet est lui-même consigné (résultat du
  lot), numéro de file selon la règle de la mission 7 (verbatim). Cette rigueur est indépendante de
  `TOPUP_CASH` `EDGE_ONLINE` du guichet (WP22) : test des deux.
- Les opérations d'un lot de terminal sont relayées **dans l'ordre** ; le central les rejoue avec
  les règles de la mission 7 ; un rejeu direct d'un même lot du terminal vers le central après la
  passerelle a **un seul effet** (NFR-003, jeton d'idempotence du central) : le test est dans ce lot
  en simulant le central, et dans WP25 en vrai.
- Opérations `ACTIVATION`/`DEPOSIT_CASH` d'un journal de terminal (`ONLINE_REF`) : ce lot ne les
  produit pas ; la reprise forcée (WP14) les traite au central.

## T105 – Snapshots locaux signés par la clé propre

- `snapshot-builder.ts` : au format de la mission 7 (`FULL` ou `DELTA` de la version précédente,
  en-tête, `content_sha256`, entrées avec mots de passe chiffrés par une clé de contenu `K_v`
  enveloppée par terminal) à partir de `edge_media`, `edge_wallet` et du blocage répliqué. Cadence :
  60 s en régime courant, **5 s après un blocage** (SP:889) ; un travailleur (`snapshot-worker.ts`)
  qui n'écrit qu'une version nouvelle par changement.
- `snapshot-signer.ts` : signe par `HARDWARE_KEYSTORE.sign('snapshot', ...)` ; `signing_kid` de la
  clé propre ; **deux clés valides au plus** (rotation, OA:12640) ; la clé publique est exposée à
  WP19 (`config.snapshot_keys`, `owner = EDGE`) et déclarée à l'inscription. Une signature qui ne se
  vérifie pas avec la clé publique du port est un défaut.
- `GET /offline-snapshots/current` (`304`, `403 OFFLINE_NOT_ALLOWED`, `403 DEVICE_SUSPENDED`, `409
  CONFLICT_STATE` + `Retry-After`), `POST /offline-snapshots/ack` (`409 SNAPSHOT_VERSION_UNKNOWN`,
  `204` idempotent, `edge_snapshot_ack`). La version et l'empreinte servies à un terminal sont
  conservées pour l'accusé. Les mots de passe ne sont **jamais** en clair : colis `pwd_pack_enc`
  rescellés (`sealForRecipient`) pour chaque terminal (`edge_snapshot_key`).
- Fraîcheur : NFR-008 couvre « appliqué sur la passerelle » (WP18) ; le délai jusqu'au terminal
  ajoute le snapshot et le battement de cœur : ne l'annonce pas comme un délai de bout en bout.

## T106 – `getMediaAuthKey` : colis rescellé pour le terminal

- `POST /media/auth-keys` : trouve `pwd_pack_enc` du bracelet (`edge_media` ou non attribué), ouvre
  la clé de contenu `pwd_pack_key` **en mémoire** par `HARDWARE_KEYSTORE.agree` (la clé d'accord
  privée ne sort pas), ouvre le colis, puis le **rescelle** pour le terminal (ECDH-ES P-256,
  HKDF-SHA256, AES-256-GCM, AAD du contrat) avec `@cashless/tag-format`. Le PWD n'est jamais
  persisté en clair, jamais journalisé, jamais placé dans une exception ni une trace. Le tampon en
  clair est écrasé (`fill(0)`) après usage.
- `404 MEDIA_UNKNOWN` avec **délai constant** (même temps de réponse qu'un succès, à une marge
  fixe), `429` selon la note 3 (limite par terminal, compteur local).
- **Aucune clé maître** (C-009) ; une passerelle `STANDBY` non promue n'a ni colis ni clé de contenu
  (WP18) : réponse `404`. Une clé d'accord détruite (purge) -> `503`/`404` sans détail, jamais un
  secret.

## T107 – Tests (`apps/gateway/test/offline/`)

- `batches.spec.ts` : lot valide ; signature altérée ; chaîne rompue ; trop gros ; `RELEASING`,
  `STALE`, `ARMED` ; règles de la mission 7 sur un jeu de cas (plafonds, bracelet bloqué **par la
  réplication**, lot de bracelets bloqué) ; idempotence ; `TOPUP_CASH` rejeté. Chaque cas échoue sur
  une implémentation qui oublie la règle d'autorité inversée.
- `relay.spec.ts` : opérations relayées dans l'ordre avec en-tête et signature d'origine ; lot
  relayé puis rejeu direct au central simulé : un seul effet ; chaîne de la passerelle continue
  autour des opérations relayées.
- `snapshots.spec.ts` : signature vérifiable avec la clé publique du port ; `FULL`/`DELTA` ; 5 s
  après un blocage ; rotation à deux clés ; version inconnue ; clés publiées dans la configuration ;
  contenu égal au format de la mission 7 (réutilise ses vecteurs si disponibles, sinon un
  vérificateur de test écrit dans `test/offline/`).
- `media-auth-key.spec.ts` : le terminal retrouve le PWD ; mauvaise clé du terminal ;
  `MEDIA_UNKNOWN` à délai constant ; `429` ; `STANDBY` ; clé détruite.
- `canary.spec.ts` (**NFR-010**) : un PWD-canari traverse le flux, les snapshots, `getMediaAuthKey`
  ; on cherche le canari sous **toutes ses représentations** (UTF-8, hexadécimal minuscule et
  majuscule, base64, base64url, échappements JSON et SQL) dans la base de la passerelle (`pg_dump`
  complet), les journaux de PostgreSQL local (`log_statement = all`) et la sortie des processus.
  **Contrôle positif** : une variante volontairement fautive qui journalise le canari en base64 doit
  faire échouer la recherche.
- `contract.spec.ts` : schémas des réponses des cinq opérations.

## Sécurité

- Aucun mot de passe en clair en base, journal, exception ni réponse d'erreur ; aucune clé maître ;
  effacement des tampons.
- Fichiers à faire relire par une personne (cryptographie) : `media-auth-key.service.ts`,
  `snapshot-signer.ts`, `batch-verifier.ts`.
- Le code de la mission 7 est lié à la base centrale : la réécriture locale est un risque de
  divergence ; la parité est prouvée par `@cashless/shared-rules` et les vecteurs, jamais par
  recopie.

## Definition of Done

- [ ] Lots : règle d'autorité inversée, signature et chaîne vérifiées, `TOPUP_CASH` rejeté, relais en ordre.
- [ ] Snapshots signés par la clé propre, deux clés au plus, cadence 5 s après blocage.
- [ ] `getMediaAuthKey` sans PWD en clair ; canari absent sous toutes les représentations avec contrôle positif.
- [ ] Contradictions signalées ; lignes de 100 caractères ; aucune dépendance npm nouvelle.

## Ce que le relecteur doit casser

- Soumettre un lot pendant `RELEASING`, `STALE`, `ARMED` ; un lot signé par un autre terminal ; une
  chaîne rompue au 3e maillon ; 501 opérations ; un `TOPUP_CASH`.
- Chercher le PWD dans `pg_dump`, `log_statement = all`, la sortie standard, sous six formes ;
  introduire une fuite volontaire et vérifier que le test échoue.
- Mesurer le temps de réponse de `MEDIA_UNKNOWN` contre un succès.
- Demander un snapshot signé avec une clé détruite ; une troisième clé valide.
- Soumettre le même lot à la passerelle puis au central : un seul effet.
