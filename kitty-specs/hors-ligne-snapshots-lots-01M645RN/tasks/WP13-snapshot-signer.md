---
work_package_id: WP13
title: 'Processus snapshot-signer : vérification, signature, publication et alertes'
dependencies: [WP03, WP06, WP08, WP09]
requirement_refs:
- FR-009
- FR-034
- FR-043
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
subtasks: [T053, T054, T055, T056]
phase: Phase 2 - Ports et processus
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/snapshots-signer/
create_intent: [apps/api/src/main.snapshot-signer.ts, apps/api/src/processes/snapshot-signer.module.ts, apps/api/src/db/snapshot-signer-db.module.ts, apps/api/src/snapshots-signer/snapshot-signer.module.ts, apps/api/src/snapshots-signer/snapshot-signer.worker.ts, apps/api/src/snapshots-signer/draft-verifier.ts, apps/api/src/snapshots-signer/header-signer.ts, apps/api/src/snapshots-signer/snapshot-signer.repository.ts, apps/api/src/snapshots-signer/seq-gap-age.worker.ts, apps/api/test/integration/snapshots-signer/draft-verifier.spec.ts, apps/api/test/integration/snapshots-signer/sign-publish.spec.ts, apps/api/test/integration/snapshots-signer/draft-tamper.spec.ts, apps/api/test/integration/snapshots-signer/key-missing.spec.ts, apps/api/test/integration/snapshots-signer/seq-gap-age.spec.ts, apps/api/test/integration/snapshots-signer/production-start.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/snapshots-signer/**, apps/api/src/main.snapshot-signer.ts, apps/api/src/processes/snapshot-signer.module.ts, apps/api/src/db/snapshot-signer-db.module.ts, apps/api/test/integration/snapshots-signer/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 – snapshot-signer : signature et alertes

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `research.md` R-07, R-18 (alerte), R-30.8, R-30.11,
R-30.12 ; `contracts/interfaces.md` § 3 (fonctions « signer »), § 4 (`offline_batch_retries_open`
n'est pas utilisé ici), § 5 (`mark_seq_gap_alerted`, `offline_seq_gaps_to_alert`,
`offline_retries_to_alert`), § 8 (ligne `SignPort`, configuration) et § 11 ; `contracts/snapshots.md`
(« Production » point 4, « En-tête signé », « Contenu », « Garde de production ») ;
`contracts/database-rights.md` (rôle `cashless_snapsign`) ; `spec.md` FR-006, FR-009, FR-034,
FR-037, NFR-006, NFR-008 ; la migration `0044_offline_snapshots.sql` telle que fusionnée (WP03) et
`0047_offline_anomalies.sql` (WP06) pour les signatures réelles.
Priorité des sources (SPECIFICATION §0.3) : contradiction signalée, jamais choisie en silence.
Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Créer le processus `snapshot-signer` (rôle `cashless_snapsign`, port `SignPort` seul) : il relit
chaque brouillon `READY`, recalcule `content_sha256` depuis les entrées, vérifie l'en-tête, signe
`JCS(en-tête)` et publie par `publish_offline_snapshot`. Un brouillon qui ne se vérifie pas n'est
jamais signé. Il porte aussi le travailleur `seq-gap-age` : une alerte unique par trou de
numérotation ouvert depuis plus de 24 h et par numéro `RETRY` non renvoyé sous 24 h.

## Périmètre et arbitrages

Dans le lot : entrée, modules, pool `DATABASE_URL_SNAPSIGN`, `KmsModule.forCapabilities(['sign'])`,
vérification, signature, publication, rejet d'un brouillon faux, alarmes, `seq-gap-age`.
Hors lot : le port et le faux (WP09, déjà fusionnés) ; la préparation du brouillon, le chiffrement et
les enveloppes (WP11, WP12) ; le service HTTP (WP15) ; la création et la rotation de la clé
(`key-admin`, WP09). Aucune action automatique sur un trou : l'alerte seule (porteur,
`01M64AFDTANCENGM3N0FQ56BDB`, R-18). Décisions : R-30.8 (deux processus ; le signataire n'a aucun
droit sur les mots de passe ni sur `tag_data_key`), R-30.11 (alerte des traces `RETRY`), R-07
(ECDSA P-256, DER, base64 à la charge de l'API).
Dépendances en pratique : WP12 n'est pas requis ; sans lui, le signataire est testé avec des
brouillons posés par fonction SQL (voir Tests). Budget de 5 s après un blocage, partagé avec WP11.

## Subtasks

### T053 – Processus, pool, port

Modèles : `main.psp-poller.ts` (entrée), `processes/tag-check.module.ts:16`
(`KmsModule.forCapabilities`), `db/psp-poller-db.module.ts:22-37` (pool), `config.ts:711` (motif
`tagUrl`), `processes/bootstrap.ts:140` (`runWorkers`, option `pollSeconds` ajoutée par WP09).
- `db/snapshot-signer-db.module.ts` : un seul pool sur `config.snapshotSignerDatabaseUrl`
  (`DATABASE_URL_SNAPSIGN`), vide refusé au démarrage de CE processus seulement. Types `int8` en
  `bigint` comme le module modèle. Retouches hors carte, une ligne de rapport chacune :
  `config.ts` (`DATABASE_URL_SNAPSIGN`, `SNAPSHOT_SIGNING_KEY_REF`, `SNAPSHOT_POLL_SECONDS` si WP11
  ne l'a pas encore posée), `package.json` (`start:snapshot-signer`), `test/unit/architecture.spec.ts`
  (propriété de WP10 : une ligne `ROOTS`, une ligne `CAPABILITIES` à `['sign']`, le point d'entrée).
- `processes/snapshot-signer.module.ts` : base, `ProcessBaseModule`, `KmsModule.forCapabilities(['sign'])`,
  `SnapshotSignerModule`. Ni `AuditModule` ni pool de la plateforme (point tranché 3).
- `main.snapshot-signer.ts` : `runWorkers(SnapshotSignerProcessModule, argv, { pollSeconds })`.
- Critère : `--list` décrit les brouillons `READY` et les alertes dues ; `--once` publie ce qui est prêt.

### T054 – Vérification, signature, publication

Fichiers : `draft-verifier.ts` (PUR), `header-signer.ts`, `snapshot-signer.repository.ts`,
`snapshot-signer.worker.ts`.
- Lecture : `offline_snapshot_drafts_ready()` (une transaction courte, `TenantTx.withoutTenant`), puis
  pour chaque brouillon `offline_snapshot_draft_content(draft)` (jamais `pwd_pack_enc`). Les lignes
  `removed` donnent `removed_token_hashes`, les autres les `entries`. `token_hash` revient en `bytea` :
  le convertir en hex minuscule et exiger qu'il égale `entry.token_hash`.
- `verifyDraft(draft, rows, now)` → `{ok: true, header}` ou `{ok: false, reason}` ; vérifie :
  les 15 champs de l'en-tête présents (`contracts/snapshots.md`, « En-tête signé »), `format =
  "CASHLESS-SNAPSHOT/v1"`, `kind` ∈ `FULL|DELTA`, `base_version` nul pour `FULL` et égal à `version - 1`
  pour `DELTA`, `entries` et `removed` égaux aux comptes réels, `operator_id`, `ledger_id`, `version`,
  `kind` égaux aux colonnes du brouillon, `valid_until > generated_at`, entrées triées par `token_hash`
  croissant sans doublon, 11 clés exactes par entrée (`interfaces.md` § 3) sans `pwd_pack_enc`, et
  `content_sha256` recalculé égal à celui de l'en-tête.
- Empreinte : `SHA-256(canonicalize({"entries": [...], "removed_token_hashes": [...]}))` avec `canonicalize`
  (RFC 8785, `apps/api/package.json:28`), jamais `JSON.stringify`, jamais l'empreinte de WP11 importée :
  le signataire la recalcule PAR LUI-MÊME (code distinct, mêmes vecteurs fixes que
  `test/unit/snapshots-content/build-content-hash.spec.ts` recopiés dans `draft-verifier.spec.ts`).
- Signature : `header-signer.ts` signe `Buffer.from(canonicalize(header), 'utf8')` par
  `SignPort.sign(config.snapshotSigningKeyRef, message)` (DER ; le port hache). Avant de publier, vérifier
  la signature avec `SignPort.publicKey(ref)` (`crypto.verify`, SHA-256, DER) : une référence de clé
  fausse ne produit jamais de publication.
- Publication : `publish_offline_snapshot(draft, key_id, signature)` dans UNE transaction courte, avec
  `key_id` pris de l'en-tête du brouillon. Un brouillon déjà `PUBLISHED` ou jeté par un autre passage
  (deux signataires, reprise) n'est pas une erreur : ne pas republier, passer au suivant.
- Rejet : si `verifyDraft` échoue, `discard_offline_snapshot_draft(draft, raison)` (raison courte, sans
  valeur d'entrée), journal d'un identifiant et de la raison, alarme 3 (point tranché 2), puis les
  brouillons suivants. Rien n'est signé.
- Ordre : un grand livre à la fois par ordre de `version`, grands livres indépendants ; un grand livre en
  échec n'empêche pas les suivants. Aucun `SET statement_timeout` (délais du rôle, WP08).
- Critère : un brouillon `READY` sain devient `offline_snapshot` signé en un passage ; un brouillon dont
  une entrée a changé après le scellé est jeté, jamais signé.

### T055 – Alertes `seq-gap-age`

Fichier : `seq-gap-age.worker.ts`, modèle `media/daily-check/daily-check.worker.ts:10-11` (codes) et
sa structure (`runOnce`, `alarm`, `describe`).
- Trous : `offline_seq_gaps_to_alert('24 hours')` → pour chaque ligne, une alerte (journal structuré :
  prestataire, terminal, numéro, âge ; aucune autre donnée) puis `mark_seq_gap_alerted(anomaly_id)`
  dans la transaction qui suit. Une ligne déjà marquée ne revient jamais : une seule alerte par trou.
  Ordre : alerter puis marquer ; un échec entre les deux = nouvelle alerte au passage suivant (préférable
  à une alerte perdue), à écrire dans le commentaire.
- Numéros `RETRY` : `offline_retries_to_alert('24 hours')` (OP-N90 : garde « alerte à 24 h »),
  puis `mark_offline_retry_alerted(batch_id, seq)` (point tranché 5).
- Alarme 2 (constat métier) quand au moins une alerte est émise pendant le passage ; ne pas la
  confondre avec l'alarme 3 de T054. `--list` décrit les alertes dues sans rien marquer.
- Aucune action automatique (pas de suspension de terminal, pas de levée) : test qui le prouve par
  l'absence d'appel d'une autre fonction.
- Critère : deux passages de suite sur un trou de 25 h → une alerte puis aucune ; trou de 23 h → rien.

### T056 – Tests

Voir « Tests ». Critère : les quatre suites de T056 ci-dessous vertes ; chaque test de refus échoue
si on retire la vérification correspondante (mutation à faire à la main une fois, notée au rapport).

## Points tranchés (orchestrateur et porteur, 30/10/2026)

1. **Clé de signature** : aucun droit du rôle sur `snapshot_signing_key`. Référence KMS =
   `SNAPSHOT_SIGNING_KEY_REF`, `key_id` = en-tête du brouillon, contrôlé par `publish_offline_snapshot`
   (clé `ACTIVE` du central). La vérification locale de T054 attrape une configuration en retard sur une
   rotation : alarme 3, rien n'est publié. Aucun droit ajouté.
2. **Codes d'alarme** : brouillon altéré, clé absente, `KmsUnavailableError`, signature invalide = 3
   (intégrité de ce qui serait signé) ; alertes de trous et de `RETRY` = 2.
3. **Audit `SNAPSHOT_PUBLISHED`** : écrit par `publish_offline_snapshot` elle-même (WP03, ADR-140). Le
   processus n'écrit aucune trace d'audit et n'a aucun droit d'audit.
4. **`discard_offline_snapshot_draft`** : accordée à `cashless_snapsign` (décision du porteur, DM
   `01M667XBV66NBKA5DEFFXY15HM`, ADR-140). Un brouillon qui échoue à `verifyDraft` est jeté.
5. **Marque d'alerte des `RETRY`** : `mark_offline_retry_alerted(batch_id, seq)` (WP06, accordée par WP08,
   ADR-140), même ordre que les trous : alerter puis marquer. Pas d'ensemble en mémoire.

## Sécurité

- Ne jamais signer un brouillon non vérifié : `header-signer.ts` n'est appelable qu'avec la sortie
  `ok: true` de `verifyDraft` (type de retour marqué, pas de chemin de contournement). Test de borne.
- Ne rien journaliser des entrées, des signatures ni d'une clé ; la raison d'un rejet ne cite aucune valeur.
- Le processus n'a que `sign` : `DECRYPT_PORT` et `DATA_KEY_PORT` introuvables (test d'injection).
- Aucun faux en production (règle 2) : `production-start.spec.ts` compile `SnapshotSignerProcessModule`
  en configuration de production avec le faux `SignPort` et vérifie le refus de `assertProcessIsSafe`.
  OP-N89 : aucun snapshot n'est servi en production avant la mission 12b.
- Tout droit de base ou port ajouté est un écart qui affaiblit : au porteur avant codage (règle 1).
- Fichiers à faire relire par une personne : `draft-verifier.ts`, `header-signer.ts`,
  `snapshot-signer.repository.ts` (cryptographie, droits). L'agent qui écrit le code ne vaut pas relecture.

## Tests

Intégration (`test/integration/snapshots-signer/`, base de lot `cashless_wp13`, rôle `cashless_snapsign`,
faux `SignPort` de WP09) ; les brouillons sont posés par les fonctions SQL de WP03 sous le rôle de
`cashless_snapcontent` (ou le propriétaire, si l'accord n'est pas encore fusionné : le dire au rapport).
- `draft-verifier.spec.ts` (sans base) : vecteurs fixes d'empreinte (valeurs calculées hors du code testé),
  tri, `null` gardé, deux clés présentes, chaque champ d'en-tête retiré ou changé → refus avec sa raison.
- `sign-publish.spec.ts` : `FULL` puis `DELTA` publiés, signature DER vérifiée avec la clé publique du
  faux sur `JCS(en-tête)` relu de `offline_snapshot` ; version = précédente + 1 ; `--once` idempotent.
- `draft-tamper.spec.ts` : entrée modifiée, retirée ou ajoutée après le scellé ; `content_sha256`
  faux ; `entries` faux ; brouillon jeté, rien dans `offline_snapshot`, suivants publiés.
- `key-missing.spec.ts` : aucune clé `ACTIVE` → rien publié, code 3 ; panne injectée du port
  (`failNext`) → code 3 puis reprise sans doublon ; référence de clé fausse → rien publié.
- `seq-gap-age.spec.ts` : 25 h / 23 h, alerte unique, `RETRY` à 25 h, `--list` sans effet, aucune action.
- `production-start.spec.ts` : refus en production, démarrage accepté hors production.
Commandes : `npx jest test/integration/snapshots-signer` sur la base de lot ; le lot ne lance ni Jest
ni pgTAP sur `cashless_test`, l'orchestrateur relance en série. Mesure de 5 s : WP21 (`SKIP_LATENCY`).

## Ce que le relecteur doit casser

1. Changer un octet d'une entrée entre `seal` et la lecture du signataire : signature produite ?
2. Poser un brouillon dont l'en-tête annonce `entries` = N mais N−1 lignes, ou `removed` faux.
3. Brouillon `DELTA` de `base_version` ≠ version − 1, ou `FULL` avec une base : refus attendu.
4. `content_sha256` calculé par `JSON.stringify` à la place de `canonicalize` : le vecteur doit échouer.
5. Deux signataires lancés ensemble sur le même brouillon : une seule publication, pas d'erreur fatale.
6. Référence de clé du port qui ne correspond pas au `key_id` : rien ne doit être publié.
7. Trou à exactement 24 h, puis relance du processus : une alerte, pas deux.
8. Le processus demande `DECRYPT_PORT` ou lit `pwd_pack_enc` : le test d'architecture échoue.

## Definition of Done

- [ ] Processus démarrable (`--once`, `--list`), pool et rôle propres, `sign` seul.
- [ ] `verifyDraft` pur et testé ; empreinte recalculée indépendamment ; jamais de signature sans `ok`.
- [ ] Brouillon faux jeté (ou ignoré, selon le point 4), jamais publié ; vérification locale de la signature.
- [ ] `seq-gap-age` : une alerte par trou et par `RETRY`, alarme 2, aucune action automatique.
- [ ] Alarme 3 sans clé `ACTIVE` ou panne de signature ; faux refusé en production, test présent.
- [ ] Points tranchés appliqués ; retouches hors carte listées : `config.ts`, `package.json`,
      `architecture.spec.ts`.
- [ ] Lignes de 100 caractères au plus ; aucun `.sql` généré modifié.

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP13 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
