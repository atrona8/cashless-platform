---
work_package_id: WP11
title: 'Processus snapshot-content : cadence, construction et brouillon'
dependencies: [WP03, WP06, WP08, WP09]
requirement_refs:
- FR-007
- FR-008
- NFR-004
- NFR-005
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
subtasks: [T045, T046, T047, T048]
phase: Phase 2 - Ports et processus
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/snapshots-content/
create_intent: [apps/api/src/main.snapshot-content.ts, apps/api/src/processes/snapshot-content.module.ts, apps/api/src/db/snapshot-content-db.module.ts, apps/api/src/snapshots-content/snapshot-content.module.ts, apps/api/src/snapshots-content/snapshot-content.worker.ts, apps/api/src/snapshots-content/snapshot-cadence.ts, apps/api/src/snapshots-content/snapshot-builder.ts, apps/api/src/snapshots-content/content-hash.ts, apps/api/src/snapshots-content/entry-encryptor.ts, apps/api/src/snapshots-content/snapshot-draft.repository.ts, apps/api/test/unit/snapshots-content/build-content-hash.spec.ts, apps/api/test/unit/snapshots-content/build-diff.spec.ts, apps/api/test/integration/snapshots-content/cadence.spec.ts, apps/api/test/integration/snapshots-content/cadence-blocking.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/snapshots-content/*.ts, apps/api/src/main.snapshot-content.ts, apps/api/src/processes/snapshot-content.module.ts, apps/api/src/db/snapshot-content-db.module.ts, apps/api/test/integration/snapshots-content/cadence*.spec.ts, apps/api/test/unit/snapshots-content/build*.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 – snapshot-content : cadence et brouillon

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `research.md` R-05, R-06, R-30.5, R-30.6, R-30.8 ;
`contracts/interfaces.md` § 3 (fonctions WP03, forme d'une entrée), § 8 et § 11 ; `contracts/
snapshots.md` (« Production », « En-tête signé », « Contenu ») ; `data-model.md` (sections
`offline_snapshot_draft`, `_entry`, `_state`) ; `spec.md` FR-007, FR-008, NFR-004, NFR-005 ;
la migration `0044_offline_snapshots.sql` telle que fusionnée (WP03) pour les signatures réelles.
Priorité des sources (SPECIFICATION §0.3) : contradiction signalée, jamais choisie en silence.
Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Créer le processus `snapshot-content` (rôle `cashless_snapcontent`, ports `DecryptPort` + `DataKeyPort`) :
il détecte les changements par grand livre, décide quand produire une version, construit l'artefact
(`FULL`, `DELTA` ou version de maintien) et l'inscrit NON signé en brouillon. Il ne signe jamais et n'a
aucun droit sur `offline_snapshot`. Le chiffrement des mots de passe et les enveloppes sont à WP12 ;
la signature et la publication à WP13.

## Périmètre et arbitrages

Dans le lot : entrée, modules, pool, détection, cadence, construction, empreinte de contenu, brouillon
par paquets, purge, alarmes. Hors lot : chiffrement sous `K_v`, `pwd_pack_sha256`, enveloppes par
terminal (WP12, qui branche son implémentation sur l'interface `EntryEncryptor` de ce lot) ; signature,
`publish_offline_snapshot`, alertes de trous (WP13) ; service HTTP (WP15).
Décisions : R-30.5 (cadence : bloquant ≤ 5 s, 60 s, maintien à `valid_until/3`, `FULL` horaire ou
> 20 %), R-30.6 (calcul et KMS hors transaction, inscription courte, paquets de 5 000, délais 30 s /
60 s), R-30.8 (deux processus). Rappel de cadence et de délais : `research.md` R-30.5, R-30.6.

## Subtasks

### T045 – Processus, pool, ports

Modèles : `main.psp-poller.ts`, `processes/tag-check.module.ts:11` (`KmsModule.forCapabilities(['mac',
'decrypt'])`), `db/process-db.module.ts:46` / `db/psp-poller-db.module.ts:22`, `processes/bootstrap.ts:140`
(`runWorkers`, avec l'option `pollSeconds` ajoutée par WP09).
- `db/snapshot-content-db.module.ts` : un pool sur `config.snapshotContentDatabaseUrl`
  (`DATABASE_URL_SNAPCONTENT`), vide refusé au démarrage de CE processus seulement (motif `tagUrl`,
  `config.ts:711`). Retouche hors carte de `config.ts` : `DATABASE_URL_SNAPCONTENT`, `SNAPSHOT_POLL_SECONDS`
  (1), `SNAPSHOT_FULL_EVERY_SECONDS` (3 600) ; ligne de rapport. `package.json` : `start:snapshot-content`.
- `processes/snapshot-content.module.ts` : base, `ProcessBaseModule`, `KmsModule.forCapabilities(['decrypt',
  'dataKey'])`, `SnapshotContentModule`. Ni `AuditModule` s'il n'est pas utilisé, ni pool de la plateforme.
- `main.snapshot-content.ts` : `runWorkers(SnapshotContentProcessModule, argv, { pollSeconds })`.
- Retouche hors carte de `test/unit/architecture.spec.ts` (propriété de WP10) : une ligne `ROOTS`, une
  ligne `CAPABILITIES` (`['dataKey','decrypt']`), le point d'entrée ; signalée au rapport.
- Critère : `--list` décrit, par grand livre, la prochaine version due ; `--once` produit les brouillons.

### T046 – Détection et cadence

Fichiers : `snapshot-cadence.ts` (fonctions PURES, testables sans base), `snapshot-content.worker.ts`.
- Entrées : `offline_snapshot_targets()` (un grand livre d'un événement non `LOCKED` avec au moins un
  terminal éligible) ; détection des changements par `offline_snapshot_source_delta(ledger, since)`
  (recouvrement de 5 s déjà dans la fonction, WP03) ; `since` = `last_generated_at`. Le rôle n'a aucun
  droit direct sur les historiques : tout passe par ces fonctions.
- Changement **bloquant** : entrée retirée, ou `status` ∈ `SUSPENDED|BLACKLISTED|REPLACED|RETIRED`, ou
  `batch_status` ≠ `ACTIVE`, ou `wallet_status = BLOCKED` → `DELTA` immédiat. Autre changement →
  `DELTA` si 60 s depuis `last_generated_at`. Fonction pure `isBlocking(entry)`.
- Première version d'un grand livre → `FULL`. `FULL` si la dernière a plus de `SNAPSHOT_FULL_EVERY_SECONDS`
  ou si le `DELTA` dépasse 20 % des entrées. Version de maintien (`DELTA` vide) dès que la dernière a
  `valid_until/3` d'âge (`valid_until − generated_at` = `max_snapshot_age`, 15 min par défaut), tant que
  `eligible_devices > 0` ; version aussi quand un terminal devient éligible (R-30.5).
- Horloge : injectée (`now()`), jamais `Date.now()` en dur ; âge négatif (horloge de la base qui recule)
  traité comme 0. Fonction pure `decideNext(state, changes, now) → none | DELTA | FULL | KEEPALIVE`.
- Sans lacune entre deux versions : `base_version` d'un `DELTA` = version précédente du grand livre.
- Concurrence : un `FULL` de 50 000 bracelets (30 s) ne doit pas retarder le `DELTA` bloquant d'un autre
  grand livre (≤ 5 s). Un `FULL` tourne détaché, suivi par un ensemble « en cours » par grand livre
  (un seul par grand livre) ; `--once` attend tout ce qui est en cours.
- Points à confirmer avec l'orchestrateur (ne pas deviner, voir Sécurité) : la date du dernier `FULL`
  n'est pas dans `offline_snapshot_targets` (seulement `last_full_version`) ; le dénominateur des 20 %
  non plus. Défauts proposés : date en mémoire, inconnue après redémarrage = traitée comme « maintenant » ;
  dénominateur = nombre de lignes de `offline_snapshot_source` compté une fois par grand livre.
- Critère : tableau de vérité de `decideNext` testé (blocage immédiat, 59 s, 61 s, maintien, `FULL`).

### T047 – Construction, empreinte, brouillon

Fichiers : `snapshot-builder.ts`, `content-hash.ts`, `entry-encryptor.ts`, `snapshot-draft.repository.ts`.
- Différences : comparer chaque ligne de la source à l'état courant (`offline_snapshot_state`, empreinte
  d'entrée `entry_sha256`) pour ne garder que les entrées modifiées et les retirées. Si la fonction de
  source dédoublonne déjà (R-30.5, WP03), ne pas refaire ; sinon signaler le droit manquant.
- `content_sha256 = SHA-256(JCS({"entries": [...], "removed_token_hashes": [...]}))` : `canonicalize`
  (existant, RFC 8785, `apps/api/package.json:28`), entrées SANS `pwd_pack_enc`, triées par `token_hash`
  hex croissant, `null` gardés, deux clés toujours présentes, `removed_token_hashes` triée. Vecteurs
  fixes dans `test/unit/snapshots-content/build-content-hash.spec.ts` (valeurs calculées hors du code
  testé, par un petit script Python indépendant, et collées ; WP13 recalcule l'empreinte de son côté).
- En-tête : 15 champs de `contracts/snapshots.md` (`format = "CASHLESS-SNAPSHOT/v1"`, `kind`,
  `operator_id`, `ledger_id`, `event_id`, `currency`, `version`, `base_version`, `generated_at`,
  `valid_until`, `entries`, `removed`, `content_sha256`, `authority_epoch`, `key_id`). Le rôle ne lit ni
  la devise, ni l'époque, ni la clé de signature : suivre `save_offline_snapshot_draft` TELLE QUE
  fusionnée par WP03 (quels champs elle remplit, lesquels elle exige). Tout champ sans source : à
  l'orchestrateur, avant codage.
- Interface `EntryEncryptor` (jeton `ENTRY_ENCRYPTOR`) : `encrypt({ledgerId, version, rows}) →
  {contentKeyWrapped, entries}` où chaque entrée porte `pwd_pack_enc` et `pwd_pack_sha256`. Ce lot lie le
  jeton à une implémentation qui REFUSE toute ligne portant un mot de passe (erreur), pour qu'aucun
  chemin secret à moitié construit n'existe avant WP12.
- Ordre des opérations : la version entre dans l'AAD des mots de passe et le chiffré dans l'empreinte ;
  il faut donc la connaître AVANT de chiffrer. `save_offline_snapshot_draft` ne la rend pas
  (`interfaces.md` § 3 : elle rend l'id du brouillon). Contradiction à soumettre à l'orchestrateur
  (voir WP12) ; coder le builder avec la version en paramètre.
- Inscription : une transaction courte par appel (`TenantTx.withoutTenant`, `tenant-tx.ts`), paquets
  de 5 000 par `append_offline_snapshot_draft_entries`, puis `seal_offline_snapshot_draft`. Échec en
  cours de route : `discard_offline_snapshot_draft(draft, raison)`. Jamais de gros calcul dans la
  transaction.
- Critère : un brouillon de 12 000 entrées = 3 paquets ; `entries`/`removed` de l'en-tête = comptes réels.

### T048 – Purge, alarmes, délais

- Après chaque `FULL` publié (vu au passage suivant), `purge_offline_snapshot_content(ledger)` (versions
  avant l'avant-dernier `FULL`) ; jamais pendant la construction d'un `DELTA` de ce grand livre.
- Alarmes (modèle `daily-check.worker.ts:10-11` et `:41`) : 3 si `KmsUnavailableError` ; 2 si un grand
  livre échoue trois passages de suite (erreur inattendue, nommée sans secret). Un grand livre en échec
  n'empêche pas les suivants. Codes à confirmer par l'orchestrateur ; ne pas en inventer d'autres.
- Délais : aucun `SET statement_timeout` dans le code ; les délais viennent du rôle (`post-roles.sql`,
  WP08). Chaque appel SQL du lot est borné à un paquet.
- Critère : `--once` rend le code d'alarme le plus grave ; la purge ne supprime jamais le contenu servant
  un `DELTA` encore servi.

## Sécurité

- Le processus ne signe pas et ne lit aucun secret hors `tag_data_key` listé (R-30.12) ; ne jamais
  journaliser une entrée complète ni une clé. Tout droit de base ou port ajouté au-delà de `decrypt` +
  `dataKey` est un écart qui affaiblit : au porteur avant codage (règle 1 de `CLAUDE.md`).
- Aucun faux en production : le processus passe par `assertProcessIsSafe` (WP09) ; test dans le lot.
- Fichiers à faire relire par une personne : `snapshot-builder.ts`, `snapshot-draft.repository.ts`
  (usage des fonctions de droits de base). L'agent qui écrit le code ne vaut pas relecture (règle 4).

## Tests

- Unitaires (`test/unit/snapshots-content/build*.spec.ts`) : `build-content-hash.spec.ts` (vecteurs,
  tri, `null`, deux clés présentes), `build-diff.spec.ts` (modifié, inchangé, retiré, `isBlocking`,
  `decideNext`).
- Intégration (`test/integration/snapshots-content/cadence*.spec.ts`, base de lot `cashless_wp11`, rôle
  `cashless_snapcontent`) : blocage → brouillon `READY` en un passage ; 59 s / 61 s ; maintien ; `FULL`
  horaire (horloge injectée) ; `DELTA` > 20 % → `FULL` ; processus sans droit sur `offline_snapshot`.
- Commandes : `npx jest test/unit/snapshots-content`, intégration en base de lot ; l'orchestrateur
  relance en série. Mesures de 5 s / 50 000 : WP21 (suites `SKIP_LATENCY`).

## Ce que le relecteur doit casser

1. Un blocage dans un grand livre pendant un `FULL` d'un autre : le `DELTA` attend-il plus de 5 s ?
2. Redémarrer le processus entre `save` et `seal` : brouillon abandonné sans `READY` incomplet servi.
3. Deux passages concurrents sur le même grand livre : une seule version réservée à la fois.
4. Une entrée retirée puis ré-ajoutée dans la fenêtre de recouvrement de 5 s : pas de doublon.
5. Horloge de la base reculée : aucune division par zéro ni version de maintien en rafale.
6. Une ligne avec mot de passe tombe dans l'implémentation provisoire : erreur, rien d'écrit.
7. Paquet de 5 001 entrées : refusé par la base ; le lot découpe à 5 000.
8. `content_sha256` calculé avec `JSON.stringify` à la place de `canonicalize` : le vecteur échoue.

## Definition of Done

- [ ] Processus démarrable (`--once`, `--list`), pool et rôle propres, `decrypt` + `dataKey` seuls.
- [ ] `decideNext` pur et testé ; cadence R-30.5 respectée ; `FULL` n'arrête pas les `DELTA` bloquants.
- [ ] Empreinte JCS avec vecteurs fixes ; brouillon par paquets de 5 000, scellé ou jeté.
- [ ] `EntryEncryptor` défini ; implémentation provisoire qui refuse tout mot de passe.
- [ ] Purge et alarmes ; points à confirmer soumis à l'orchestrateur.
- [ ] Retouches hors carte listées : `config.ts`, `package.json`, `architecture.spec.ts`.
- [ ] Lignes de 100 caractères au plus ; aucun `.sql` généré modifié.

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP11 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
