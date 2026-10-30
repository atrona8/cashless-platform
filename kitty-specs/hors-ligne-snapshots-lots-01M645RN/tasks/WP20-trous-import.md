---
work_package_id: WP20
title: Levée de trou de séquence et import du journal d'un terminal révoqué
dependencies: [WP05, WP19]
requirement_refs:
- FR-032
- FR-035
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots.
  During /spec-kitty.implement this WP may branch from a dependency-specific base, but
  completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human
  explicitly redirects the landing branch.
subtasks: [T083, T084, T085, T086]
phase: Phase 3 - API
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/offline/seq/
create_intent: [apps/api/src/offline/seq/seq-gap.controller.ts, apps/api/src/offline/seq/seq-gap.service.ts, apps/api/src/offline/seq/waive-seq-gap.action.ts, apps/api/src/offline/seq/offline-seq.module.ts, apps/api/src/offline/journal/journal-import.controller.ts, apps/api/src/offline/journal/journal-import.service.ts, apps/api/src/offline/journal/journal-import.action.ts, apps/api/src/offline/journal/journal-import.worker.ts, apps/api/src/offline/journal/offline-journal.module.ts, apps/api/test/integration/offline/seq-waive.spec.ts, apps/api/test/integration/offline/journal-import.spec.ts, apps/api/test/integration/offline/journal-import-worker.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/offline/seq/**, apps/api/src/offline/journal/**, apps/api/test/integration/offline/seq*.spec.ts, apps/api/test/integration/offline/journal*.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP20 – Trous et import du journal

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite la fiche de contexte
d'implémentation de l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-031 à FR-035,
NFR-010, NFR-012), `research.md` R-30.2 et **R-30.10**, `contracts/batches.md` § « Trous » et
§ « Import du journal », `contracts/interfaces.md` § 4 (fonctions d'import et de trou), § 8
(audit), § 10, `openapi.yaml` (`waiveSeqGap` l. 1050-1100, `importDeviceJournal` l. 1103-1150),
`docs/sync_protocol.md` §6.3, §11 cas 33. Lis le code des lots fusionnés : `offline/batches/*`
(WP18 : vérification de signature et de chaîne à réutiliser), `offline/processing/*` (WP19 :
interface du processeur). Priorité des sources : SPECIFICATION §0.3 ; contradiction signalée. Les
`.sql` générés ne bougent pas.

## Objective

Fournir les deux procédures humaines du back-office qui ferment ce que les lots ne peuvent pas
fermer : lever un numéro perdu pour de bon (deux personnes, aucune écriture comptable), et
rejouer le journal exporté d'un terminal révoqué (deux personnes, vérifié deux fois, appliqué une
seule fois, opération par opération par le processeur de WP19, avec reprise après coupure).

## Périmètre et arbitrages

- Dans le lot : les deux routes, leurs deux actions à deux personnes, le travailleur
  `journal-import`, l'audit, les tests. Modèles de forme : `cash-sessions/cash-deposit-action.ts`
  (demande + audit, l. 55-100) et `reversals/sale-reversal-action.ts` (action, l. 62-140) ;
  contrôleur idempotent : `devices/admin/device-admin.controller.ts:55-70`.
- Hors lot : le traitement d'une opération (WP19, `process(ctx, op)`, interface § 8) ; les contrôles
  de lot de `POST /offline-batches` (WP18, à réutiliser, pas à recopier) ; les fonctions SQL
  (WP05) ; les `GRANT` (WP08) ; le contrat (WP01).
- Les actions `WAIVE_SEQ_GAP` et `DEVICE_JOURNAL_IMPORT` existent déjà dans la liste fermée de la
  base (`schema_grand_livre_cashless.sql:2911-2912`) : aucune migration.
- Rôle : `SUPERVISOR` pour demander ET approuver, personnes distinctes (service d'approbation).
  Portée figée à l'événement du terminal, lue en base, jamais d'un corps.
- Numéros : `{seq}` du chemin lu comme TEXTE puis `BigInt`, jamais `Number`. Au-delà de 2^53−1 :
  `422 VALIDATION_FAILED` (R-14, `maximum` posé par WP01). FR-033 parle d'un numéro supérieur à
  2^53 : R-14 prime (contradiction à signaler, voir Sécurité).
- Écart de forme : `openapi.yaml` dit que l'approbation « traite les lots à l'exécution » et rend
  un `DeviceJournalImportResult`. R-30.10 fait foi : l'approbation passe l'import à `PROCESSING`
  et rend son état ; le travailleur traite. Signale l'écart.
- Une seule instance du travailleur traite un import à la fois (pas de verrou nouveau : la base
  tient `PROCESSING` et le verrou du terminal ; `begin_…` est idempotent).

## Subtasks

### T083 — Levée de trou : route, pré-contrôle, action d'approbation, exécution

- **Fichiers** : `seq/seq-gap.controller.ts`, `seq-gap.service.ts`, `waive-seq-gap.action.ts`,
  `offline-seq.module.ts`. Route `POST /devices/{device_id}/seq-gaps/{seq}/waive`, corps `{reason}`
  (au moins 10 caractères, `422` sinon), `@Idempotent({ scope: 'bo:' })`, `202` avec la demande
  `PENDING` (`ApprovalService.request`, action `WAIVE_SEQ_GAP`, `targetId` = terminal).
- **Pré-contrôle** : `check_seq_gap_waivable(device, seq)` (sans effet) AVANT de créer la demande :
  `CL012` -> `409 SEQ_GAP_NOT_FOUND`, `CL010` -> `409 BATCH_IN_PROGRESS`
  (`errors/sqlstate-map.ts:22`). Terminal d'un autre prestataire ou inconnu : `404` neutre.
  Charge utile : `{device_id, seq: string, reason, scope_type: 'EVENT', scope_id}`, validée comme
  `validatePayload` de `cash-deposit-action.ts` (champs connus seulement).
- **Exécution** (`execute`, sous le point de sauvegarde de l'approbation) : rejouer le même
  contrôle, puis `waive_seq_gap(device, seq, requestedBy, approvedBy, reason)`
  (`schema_grand_livre_cashless.sql:2089-2110`). Résultat : `SeqStatus` (nouveau
  `contiguous_acked_seq`, `waived: true`). Refus de la base (`CL012`, `CL010`) : demande `FAILED`,
  message lisible (table `SQL_FAILURES` comme `cash-deposit-action.ts:36-42`).
- **Garanties à prouver** : aucune ligne `journal_transaction` créée ; registre `WAIVED` (canal
  `WAIVER`) ; anomalie `SEQ_GAP` du numéro `RESOLVED` ; curseur avancé.
- **Cas du trou hérité** (FR-033) : un numéro laissé sans ligne au registre par un corps en ligne
  non objet se lève par la même route ; test dédié.
- **Audit** (`AuditService.record`, valeurs ajoutées en fin d'union, une ligne dans le rapport :
  fichier sans propriétaire) : `SEQ_GAP_WAIVE_REQUESTED` à la demande, `SEQ_GAP_WAIVED` à
  l'exécution, avec terminal, numéro, motif, auteur, valideur. Jamais de secret.
- **Critère** : la même personne n'approuve pas sa demande ; un numéro déjà reçu, ou au-delà du
  dernier vu, est refusé à la demande ET à l'exécution (course entre les deux).

### T084 — Import : route (vérification immédiate, synthèse, empreinte), action

- **Fichiers** : `journal/journal-import.controller.ts`, `journal-import.service.ts`,
  `journal-import.action.ts`. Route `POST /devices/{device_id}/journal-imports`, corps `{batches:
  OfflineBatch[] (1 à 20), reason (≥ 10)}`, `SUPERVISOR`, idempotente (`bo:`), `202`.
- **Lecture du corps** : numéros en texte source (`parseWithSafeIntegers` de WP18,
  `offline/batches/raw-json.ts`), refus `> 2^53−1` en `400`. Taille : la limite globale reste
  100 ko ; comme WP18, la route d'import a son propre analyseur borné, au plus 20 × 1 Mio ; toute
  valeur au-delà de celle que tu choisis (justifiée au rapport) est soumise au porteur avant le code.
- **Vérification immédiate** (refus `400 VALIDATION_FAILED` / `BATCH_SIGNATURE_INVALID` /
  `CHAIN_BROKEN` / `SEQ_OUT_OF_ORDER`, sans rien créer) : réutilise les contrôles 3, 6, 7, 8 de
  `batches.md` de WP18 (schéma, signature DER de `JCS(header)` par `device.public_key`, continuité,
  `content_sha256` et chaîne recalculés, raccord entre lots successifs). Aucune copie de code :
  si WP18 ne les exporte pas, signale-le et demande l'export (retouche hors carte, une ligne).
- **Terminal non `REVOKED`** : `create_device_journal_import` lève `CL052` -> `409 CONFLICT_STATE`.
- **Synthèse** (R-30.10) : nombre d'opérations, total des ventes (`bigint`, somme des `PURCHASE`),
  plage de numéros, liste des opérations datées après la dernière présence du terminal
  (`device.last_seen_at` et dernier accusé). **Empreinte** : `batches_sha256` = SHA-256 du JCS de
  `batches` (octets canoniques RFC 8785, `canonicalize` comme `payments/device-seq-registry.ts`).
- **Création** : `create_device_journal_import(device, batches, batches_sha256, summary, reason,
  actor)` rend l'identifiant ; puis la demande `DEVICE_JOURNAL_IMPORT` (`targetId` = import) dont
  la charge utile porte `import_id`, `batches_sha256`, la synthèse et la portée de l'événement.
  L'approbateur voit donc la synthèse dans la demande. Audit `DEVICE_JOURNAL_IMPORT_REQUESTED`.
- **Exécution de l'approbation** : `begin_device_journal_import(import, batches_sha256, approver)`
  (`CL053` -> demande `FAILED`, import jamais appliqué deux fois ; idempotent si déjà
  `PROCESSING`), puis revérification des lots lus par `device_journal_import_view(import,
  with_batches)` (empreinte recalculée, signatures, chaîne). Écart : `finish_device_journal_import(
  FAILED)`. Sinon l'import reste `PROCESSING` et le travailleur prend la suite ; le résultat de la
  demande est l'état. Un lot du terminal encore `PROCESSING` : `CL010` -> `409`.
- **Critère** : empreinte modifiée entre demande et approbation -> `FAILED`, aucune opération
  traitée ; lot signé par une autre clé -> `400` immédiat.

### T085 — Travailleur `journal-import`

- **Fichier** : `journal/journal-import.worker.ts`, `ProcessWorker` (`processes/worker.ts:7-16`),
  nom `journal-import`, `runOnce`, `describe`, `alarm`. Modèle : `topups/poller/psp-event-retry.worker.ts`.
- **Source des imports à traiter** : `device_journal_imports_processing()` (WP05, `interfaces.md` § 4 ;
  décision du porteur, DM `01M667Y1J4DT3HY96ZBCXXMXBT`, ADR-140) rend `(import_id, operator_id)` de tous
  les prestataires, rien d'autre. Ouvre ensuite UNE transaction de prestataire (`TenantTx`, RLS) par
  import et relis-le par `device_journal_import_view(import, true)`. Aucun `SELECT` direct sur la table.
- **Boucle** : pour chaque import, ses lots dans l'ordre. Lot sans ligne : `open_imported_batch(
  import, batch, seq_from, prev_chain_hash, op_hashes[], last_chain_hash, signature)` (terminal
  `REVOKED`, canal `IMPORT`, même contrôle de chaîne). Pour chaque opération : `process(ctx, op)`
  de WP19, `ctx` portant le canal `IMPORT`, `recordedAt` = heure d'approbation (`R-30.3`), valideur
  = approbateur, un `batchId` par lot importé. Une opération = une transaction (celle du processeur).
- **Reprise** : `offline_op_results(batch)` donne les numéros déjà résolus ; reprendre à la
  première opération sans résultat, sans rien retraiter. Lot fini : `complete_offline_batch(batch,
  results)`. Dernier lot fini : `finish_device_journal_import(import, 'APPLIED', résultat)`.
  Erreur non reprenable : `FAILED`, import jamais rejoué tel quel. Audit `DEVICE_JOURNAL_IMPORTED`.
- **Opération datée après la révocation** : `REJECTED OFFLINE_NOT_ALLOWED` + `NON_COMPLIANT_OPERATION`
  — fait par la conformité de WP19 (`device_revoked_at`). Si le processeur refuse un terminal
  `REVOKED` ou ignore le canal `IMPORT`, c'est un défaut de WP19 : signale-le, ne le contourne pas.
- **Critère** : coupure après 3 opérations sur 10 : au redémarrage, 7 opérations traitées, aucun
  doublon d'écriture ; import rejoué après `APPLIED` : `CL053`, rien d'écrit.

### T086 — Tests

- `seq-waive.spec.ts` : même personne refusée à l'approbation ; numéro absent -> `409
  SEQ_GAP_NOT_FOUND` ; numéro dans un lot `PROCESSING` -> `409 BATCH_IN_PROGRESS` ; levée complète
  (registre `WAIVED`, anomalie `RESOLVED`, curseur, 0 écriture comptable) ; trou hérité ; numéro
  `2^53` refusé ; autre prestataire -> `404`.
- `journal-import.spec.ts` : terminal non révoqué -> `409` ; signature d'une autre clé -> `400` ;
  chaîne rompue -> `400` ; synthèse et empreinte dans la demande ; même personne refusée ;
  empreinte altérée à l'exécution (`CL053`) ; import rejoué ; lot du terminal `PROCESSING` -> `409`.
- `journal-import-worker.spec.ts` : application complète d'un export de 2 lots (soldes, anomalies,
  résultats) ; opération datée après la révocation rejetée avec anomalie ; reprise après coupure ;
  isolation entre deux prestataires. Fabrique les exports avec `TestTerminal` (WP18, `signBatch`).

## Sécurité

- Écart qui affaiblit la sécurité : au porteur AVANT de coder (règle 1). Ici : la lecture des imports
  par le travailleur (droit `SELECT` ou fonction manquante) ; une limite de corps relevée ; un
  contrôle de signature ou de chaîne allégé « parce que déjà fait à la demande » (non : refaire à
  l'exécution, R-30.10).
- Points sensibles : l'import écrit de l'argent pour un terminal révoqué (donc possiblement
  compromis) : deux personnes distinctes, synthèse montrée, empreinte liée, opérations postérieures à
  la révocation rejetées ; une levée de trou ne doit écrire aucune ligne comptable ; aucun `Number` sur
  un numéro ; un seul import appliqué une fois.
- Contradictions à signaler : FR-033 (numéros `> 2^53`) contre R-14 (`maximum` 2^53−1) ;
  `openapi.yaml` (« traite à l'exécution ») contre R-30.10 (travailleur asynchrone).
- Fichiers à faire relire par une personne : aucun ; mais `journal-import.action.ts` et
  `journal-import.worker.ts` portent un flux d'argent sans client en ligne : relecture attentive.

## Tests

- Commandes : `npm test -w @cashless/api -- integration/offline/seq integration/offline/journal
  integration/approval`. Non-régression : `integration/devices`, `integration/payments`. Le lot ne
  lance pas Jest sur `cashless_test` : base de lot `cashless_wp20` ; l'orchestrateur relance en série.
- Les montants et numéros se comparent en `bigint`.

## Ce que le relecteur doit casser

1. Demander et approuver avec le même compte `SUPERVISOR` (ou deux comptes d'un autre prestataire).
2. Lever un numéro déjà reçu, un numéro couvert par un lot `PROCESSING`, un numéro `2^53`.
3. Importer le journal d'un terminal `ACTIVE`, ou `SUSPENDED` : `409`.
4. Remplacer un lot du `batches` entre la demande et l'approbation : refus par l'empreinte.
5. Lot signé par la clé d'un autre terminal ; chaîne dont le maillon 3 est altéré.
6. Tuer le travailleur au milieu d'un lot : reprise sans double écriture ni opération perdue.
7. Opération datée une minute après la révocation : rejetée, anomalie, le reste du lot appliqué.
8. Lancer l'approbation deux fois en parallèle : une seule application (`CL053` ou idempotence).

## Definition of Done

- [ ] `waiveSeqGap` : pré-contrôle, demande, exécution, audit ; 0 écriture comptable prouvée.
- [ ] `importDeviceJournal` : vérification immédiate, synthèse, empreinte, revérification à l'exécution.
- [ ] Travailleur `journal-import` avec reprise ; passage par le processeur de WP19 seulement.
- [ ] Tests écrits, non-régression verte sur la base de lot ; isolation entre prestataires prouvée.
- [ ] Rapport : limite de corps choisie pour l'import, valeurs d'audit ajoutées, contradictions.

## Branch Strategy

Planification et fusion sur `feat/hors-ligne-snapshots-lots`. Dépendances : WP05, WP19. Worktree
attribué par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP20 --agent claude
--mission hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
