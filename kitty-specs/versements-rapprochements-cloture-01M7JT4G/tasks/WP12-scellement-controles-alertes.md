---
work_package_id: WP12
title: Scellement, contrôles permanents et alertes (processus maintenance)
dependencies: [WP06]
requirement_refs: [FR-020, FR-021, NFR-005, NFR-006, C-005, C-006, C-010, C-011]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-versements-rapprochements-cloture-01M7JT4G
base_commit: f70e0e88638a9b9f382e066f2e86c5e26eb74e9d
created_at: '2026-11-17T10:15:31.045027+00:00'
subtasks: [T052, T053, T054, T055, T056, T057]
phase: Phase 3 - Services et routes
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/sealing/
create_intent:
- apps/api/src/sealing/seal-copy.ts
- apps/api/src/sealing/fake-seal-copy.ts
- apps/api/src/sealing/sealing.module.ts
- apps/api/src/sealing/ledger-seal.worker.ts
- apps/api/src/sealing/audit-seal.worker.ts
- apps/api/src/sealing/seal-verify.worker.ts
- apps/api/src/processes/ops-alerts.ts
- apps/api/src/processes/controls/ledger-controls.worker.ts
- apps/api/src/processes/controls/payout-overdue.worker.ts
- apps/api/src/processes/controls/statement-unmatched.worker.ts
- apps/api/src/processes/controls/open-anomalies.worker.ts
- apps/api/src/processes/controls/long-transactions.worker.ts
- apps/api/src/processes/controls/controls.module.ts
- apps/api/test/integration/sealing/seal-and-verify.spec.ts
- apps/api/test/integration/controls/controls-alerts.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/sealing/**
- apps/api/src/processes/bootstrap.ts
- apps/api/src/processes/maintenance.module.ts
- apps/api/src/processes/ops-alerts.ts
- apps/api/src/processes/controls/**
- apps/api/src/kms/production-guard.ts
- apps/api/src/security/port-tokens.ts
- apps/api/test/unit/production-guard.spec.ts
- apps/api/test/integration/sealing/**
- apps/api/test/integration/controls/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 : Scellement, contrôles permanents et alertes

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis `docs/passation-9b/fiche-implementation.md` (démarrage, base
`cashless_wp12`, Jest, fin de lot), ce prompt, puis seulement :

- `docs/passation-9b/contexte-9b.md` ; `spec.md` : story 6, FR-020, FR-021, NFR-005, NFR-006, C-005,
  C-006, C-010, C-011 ;
- `research.md` R-11, R-12, R-13, R-15 ; `contracts/interfaces.md` : fonctions `ops_*`, port
  `SealExternalCopy`, `OpsAlerts.raise`, **codes d'alarme 7 à 11** ; `data-model.md` (tableau des
  fonctions) ;
- la note de lane de WP05 et la migration `0087_ops_functions.sql` (signatures et colonnes réelles
  des `ops_*`) ; `post-roles.sql` section 12 de WP06 (droits de `cashless_maint`) ;
- `docs/SPECIFICATION.md` §12.2 (l. 1257-1271) et §13.7 ;
- gabarit du faux : `kms/production-guard.ts` ; `kms/kms.module.ts` l. 14-17 ;
  `customer-auth/otp-sender.ts` l. 28-53 ; `processes/bootstrap.ts` l. 44-62 ;
  `test/unit/production-guard.spec.ts` (cas de l'envoyeur de codes, l. 100-130) ;
- gabarit des travailleurs : `processes/worker.ts` ; `processes/maintenance-refund-promotion.ts` ;
  `edge/maintenance/edge-silence.worker.ts` ; `processes/maintenance.module.ts` ;
  `processes/bootstrap.ts` l. 150-235 (`serve` et `runWorkers`) ; `security/port-tokens.ts` ;
- tests existants à garder verts : `test/integration/maintenance/process-guard.spec.ts`,
  `test/unit/architecture.spec.ts` l. 233-242 (processus `maintenance` : ni `AuditModule`, ni
  `KmsModule`, ni `DbModule`).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Faire tourner dans le processus `maintenance` (rôle `cashless_maint`, aucune lecture de table) le
scellement des grands livres et du journal d'audit toutes les 5 minutes avec une copie externe
SIMULÉE, la vérification quotidienne, les contrôles permanents du §12.2 et la surveillance des
transactions longues. Chaque échec lève une alerte (audit, notification, journal `ALERT`) et un code
d'alarme lu aussi par la boucle continue. Le faux de copie refuse le démarrage en production.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP12 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Aucune dépendance nouvelle ; aucune route (le processus n'en a pas) ; aucun SQL (migrations de
  WP05, droits de WP06) : tu appelles les fonctions `ops_*` par `TenantTx.withoutTenant`, comme
  `RefundPromotionWorker`. Jamais de `SELECT` sur une table. Pas d'`AuditService` : le processus n'a
  pas `AuditModule` ; l'audit passe par `ops_raise_alert`.
- Retouche hors carte à demander : `processes/maintenance.module.ts` est à toi ; mais
  `test/integration/maintenance/process-guard.spec.ts` (hors carte) affirme que le processus démarre
  en production. Avec le faux de copie, ce test est faux : il doit attendre le refus nommant « la
  copie externe des scellements ». Signale-le, fais la retouche minimale, une ligne à la note de lane.
- **Écart accepté par le porteur (C-006, C-010), pas à élargir** : copie externe simulée jusqu'à la
  12b ; alertes sans envoi à une personne. WP14 consigne l'OP et l'ADR : note de lane pour lui.
- **Écart de sécurité** : ne donne à `cashless_maint` aucun droit (pas de `pg_signal_backend`, pas de
  `SELECT`). Besoin d'un droit manquant : décris-le (risque, options), attends le porteur.
- **Deux chaînes** : la vérification quotidienne couvre les DEUX chaînes (FR-020). WP05 ajoute
  `ops_verify_audit_chain(uuid, timestamptz)` pour le journal d'audit (absente de la liste de
  `research.md` R-11). Si sa note de lane dit autre chose, ne contourne pas : signale-le.
- Cadence : le processus ne repasse que toutes les `TAG_JOB_POLL_SECONDS` (5 s) et les travailleurs
  tournent en série. Chacun se limite par `nextRunAt`. Enregistre `long-transactions` EN PREMIER (ordre
  des imports de `maintenance.module.ts`) et note la durée d'un passage de scellement.

## Subtasks

### T052 : port, faux, garde de production

- `sealing/seal-copy.ts` : port `SealExternalCopy` (écrire l'empreinte d'un scellement identifié par
  type, identifiant et `seal_no`, rendre la référence externe ; relire par référence). Jeton `SEAL_COPY`
  dans `security/port-tokens.ts`.
- `sealing/fake-seal-copy.ts` : `FakeSealCopy` avec `readonly isFake = true`, SANS état en mémoire
  (un redémarrage ne doit rien perdre) : référence `fake:<seal_hash>`, relecture déduite de la
  référence. Elle ne prouve rien : la vérification rend « copie simulée », JAMAIS « conforme ».
- Fabrique `createSealCopy(config)` : en production, `throw new FakeInProductionError(['la copie
  externe des scellements'])` (modèle `kms.module.ts:14-17`, `otp-sender.ts:50-53`).
- `assertProcessIsSafe` (`bootstrap.ts:44-62`) : ajoute l'entrée « la copie externe des scellements »
  lue par `optional(app, SEAL_COPY)`. Mets à jour le commentaire de tête de `production-guard.ts`.
- `test/unit/production-guard.spec.ts` : (a) construction refusée en production, faux hors production ;
  (b) entrée du `it.each` de la garde de démarrage ; (c) `assertProcessIsSafe(processWith(true,
  SEAL_COPY, new FakeSealCopy()))` lève, `false` ne lève pas. Ce test échoue si la liste perd l'entrée.

### T053 : scellement et vérification

- `ledger-seal.worker.ts` et `audit-seal.worker.ts` (`nextRunAt`, 5 min) : lister (`ops_ledgers_to_seal`,
  `ops_audit_chains_to_seal`), sceller (`ops_seal_ledger`, `ops_seal_audit`, une transaction par
  grand livre ou chaîne), copier, puis `ops_record_seal_copy` UNE fois. Ordre : sceller, copier,
  enregistrer. Une copie qui échoue ne bloque pas le scellement suivant ; les scellements sans
  `external_ref` sont repris au passage d'après (`ops_seals_since`). `runOnce` rend le nombre de
  scellements écrits ou copiés, 0 s'il n'y a rien. Échec : alarme 7 et alerte.
- `seal-verify.worker.ts` (24 h) : chaque grand livre (`ops_verify_ledger_seals`) et chaque chaîne
  d'audit, plateforme comprise. Écart de chaîne ou de copie : alarme 8, alerte critique. Copie
  simulée : état « copie simulée » dans le journal et `describe()`, pas un écart.
- NFR-005 : aucune écriture non scellée plus de 10 minutes, copie comprise : le test le mesure avec
  `sealed_at` et `external_ref` sur une durée simulée par la base, pas par l'horloge de Node.

### T054 : alertes et boucle continue

- `processes/ops-alerts.ts` : `OpsAlerts.raise(code, detail)` appelle `ops_raise_alert` (ligne d'audit
  `OPS_ALERT` plateforme + `pg_notify('ops_alert', …)`) et écrit un journal `Logger.error` en JSON
  `{ "level": "ALERT", "code": …, … }`. `detail` ne contient ni secret, ni numéro, ni IBAN, ni texte
  de requête. Une panne de l'appel ne fait jamais taire le journal ni le code d'alarme.
- `bootstrap.ts` : la boucle continue de `runWorkers` (l. 224-236, `for (;;)`) et le minuteur de
  `serve` (l. 205-221) lisent `workers.alarm()` après chaque `drain()`. Tout code non nul est
  journalisé (`WORKER_ALARM`), sans inonder : à chaque changement de code et au plus une fois par
  minute pour un code qui dure. `--once` garde son code de sortie.
- Codes : 7 scellement ou copie, 8 écart d'intégrité, 9 `ledger-controls`, 10 `payout-overdue`,
  `statement-unmatched`, `open-anomalies`, 11 `long-transactions`. Chaque travailleur redescend à 0
  quand son contrôle repasse.

### T055 : contrôles permanents

`ledger-controls` (somme nulle et droits = argent toutes les 5 min, cache et comptes chauds toutes
les heures, deux horloges internes, grands livres `OPEN` et `CLOSING`), `payout-overdue` (`INITIATED`
depuis plus de 48 h, quotidien), `statement-unmatched` (lignes non rapprochées, quotidien),
`open-anomalies` (continu, 5 min, alerte sur une anomalie NOUVELLE seulement). Chacun appelle sa
fonction `ops_*` qui ne rend que les écarts, lève une alerte par écart ou par lot d'écarts, rend
`describe()`. Aucun travailleur ne lit de table.

### T056 : transactions longues

`long-transactions.worker.ts` : toutes les 10 s, `ops_long_transactions('60 seconds')`. Journal et
alerte (code 11) avec `pid`, `usename`, `application_name`, durée : JAMAIS le texte de la requête
(C-011). Aucun arrêt de session : `transaction_timeout = 60 s` du rôle applicatif coupe déjà. Le test
vérifie que la réponse, le journal et l'alerte ne contiennent pas `query`.

### T057 : tests

Voir « Tests et preuves » : SC-005 (chaque contrôle échoue et lève son alerte) et SC-004 (altération
détectée).

## Tests et preuves

```bash
cd <lane> && PGDATABASE=cashless_wp12 bash packages/ledger-sql/scripts/reset-db.sh
cd <lane>/apps/api && export PGDATABASE=cashless_wp12 && source ../../tools/dev-db/env.sh \
  && env | grep DATABASE_URL && SKIP_LATENCY=1 npx jest test/unit/production-guard.spec.ts \
  test/unit/architecture.spec.ts test/integration/sealing test/integration/controls \
  test/integration/maintenance --runInBand --forceExit
cd <lane>/apps/api && source ../../tools/dev-db/env.sh && npx ts-node src/main.maintenance.ts --once; \
  echo "alarme=$?"
cd <lane> && npm run typecheck -w @cashless/api && npx prettier --check "apps/api/src/sealing/**/*.ts" \
  "apps/api/src/processes/**/*.ts"
```

Relance `reset-db` après chaque Jest. Cas exigés :

- FR-020 : grand livre avec écritures anciennes : un scellement écrit, copie « simulée »,
  `external_ref` posée une fois (une seconde pose refusée) ; `LOCKED` scellé aussi ; chaîne d'audit
  scellée ; passage sans rien à faire : `runOnce` rend 0.
- SC-004 : une ligne scellée modifiée par le propriétaire de la base de test (déclencheur désactivé le
  temps de l'altération, modèle `tests_audit_log.sql` l. 79-95) fait échouer `seal-verify` : code 8,
  ligne `OPS_ALERT`, notification reçue (`LISTEN ops_alert`), journal `ALERT`. Même cas pour la chaîne
  d'audit et pour une copie qui diffère.
- SC-005 : un test par contrôle : somme non nulle, droits ≠ argent, cache faux, compte chaud du
  mauvais côté, versement `INITIATED` vieilli de 49 h par le propriétaire, ligne non rapprochée,
  anomalie nouvelle (une anomalie déjà vue ne relève pas l'alerte), transaction de 70 s tenue par une
  session du rôle applicatif : alerte et code attendus ; contrôle réparé : code 0.
- Faux : `--once` hors production passe ; en production la configuration refuse de démarrer.
- Droits : `cashless_maint` appelle les `ops_*` et rien d'autre (aucune lecture de table).

## Definition of Done

- [ ] Port, faux, fabrique, jeton, entrée de `assertProcessIsSafe` et test de garde.
- [ ] Huit travailleurs enregistrés (`--list` les décrit), codes d'alarme 7 à 11, boucle continue qui
  lit `alarm()`.
- [ ] Alertes par `ops_raise_alert` + `ALERT` JSON ; transactions longues sans texte de requête.
- [ ] SC-004 et SC-005 prouvés ; `architecture.spec.ts` et `process-guard.spec.ts` verts.
- [ ] Typecheck et Prettier (100) verts ; aucun `.sql` touché, aucun droit ajouté.
- [ ] Note de lane : retouches hors carte, durée d'un passage, trou d'audit éventuel, ce que WP14
  consigne (copie simulée, alertes sans envoi : OP, ADR, test qui échoue si la limite s'élargit),
  fichiers sensibles.

## Ce que le relecteur doit casser

1. Injecter `FakeSealCopy` dans un processus de production (`assertProcessIsSafe`, puis
   `createSealCopy` avec `production: true`) : refus nommé ; retirer l'entrée de la liste : le test
   échoue.
2. Altérer une écriture scellée, un `seal_hash`, une ligne d'audit : détecté au passage suivant.
3. Une copie simulée présentée comme « conforme » dans un journal, un `describe()` ou un test : défaut.
4. Lancer deux processus `maintenance` en même temps : pas de double scellement (verrou consultatif).
5. Chercher `query` dans toute sortie de `long-transactions` ; chercher un `SELECT` de table dans le
   code des travailleurs.
6. Une alerte dont le `detail` contient un secret, un numéro ou un IBAN.
7. Un travailleur dont `runOnce` rend toujours > 0 (boucle de `drain` jusqu'à 1000 passages).
8. Boucle continue : un code d'alarme qui dure inonde le journal ; un code qui disparaît reste affiché.

## Fichiers à faire relire par une personne

- `sealing/*` (copie, ordre sceller-copier-enregistrer, vérification, état « copie simulée ») ;
- `processes/ops-alerts.ts` et `processes/bootstrap.ts` (garde de production, boucle d'alarme) ;
- `processes/controls/long-transactions.worker.ts` (aucune fuite de requête) ;
- `kms/production-guard.ts` et `security/port-tokens.ts`.
