---
work_package_id: WP14
title: Preuves de bout en bout, consignation et note aux équipes clientes
dependencies: [WP07, WP08, WP09, WP10, WP11, WP12, WP13]
requirement_refs: [NFR-001, NFR-002, SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, C-006, C-008, C-010]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T062, T063, T064, T065]
phase: Phase 4 - Preuves
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/test/scenario/
create_intent:
- apps/api/test/scenario/closing-journey.spec.ts
- apps/api/test/integration/invariants-cloture/concurrency.spec.ts
- docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/test/scenario/closing-journey.spec.ts
- apps/api/test/integration/invariants-cloture/**
- docs/POINTS_OUVERTS.md
- docs/DECISIONS_ADR.md
- docs/SPECIFICATION.md
- PRD.md
- PROMPTS-A-ENVOYER.md
- docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 : Preuves de bout en bout, consignation et note aux équipes clientes

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-9b/fiche-implementation.md`, ce prompt, puis seulement :

- **les notes de lane de WP01 à WP13** (`status.events.jsonl` ou `spec-kitty agent tasks status`) :
  c'est la liste des écarts, des renforcements, des retouches hors carte et des noms figés à
  consigner. Rien ne se consigne de mémoire ;
- `spec.md` (NFR-001, NFR-002, SC-001 à SC-006, C-006, C-008, C-010, C-011) ; `research.md`
  (« Contradictions de sources signalées », R-05, R-07, R-10 à R-13) ; `docs/passation-9b/contexte-9b.md`
  (décisions 1 à 5) ; `contracts/contract-additions.md` (les 20 opérations) ;
- `apps/api/test/scenario/replay.spec.ts`, `fixture.ts`, `commands.ts` (modèle du scénario rejoué) ;
  `packages/ledger-sql/scenario_reference.json` (`expected.after_closing`, l. 1663 et suivantes) ;
- `docs/POINTS_OUVERTS.md` : OP-N3, OP-N82, OP-N123 à OP-N130 (format d'une levée : voir OP-N129) ;
  `docs/DECISIONS_ADR.md` : ADR-191 à ADR-196 (format ; dernier numéro : ADR-196) ;
- `docs/SPECIFICATION.md` §3.2 (rôles) ; `PRD.md` et `PROMPTS-A-ENVOYER.md`, section « Mission 9b »
  et les sections des missions 12b et suivantes.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Prouver la mission de bout en bout (scénario de référence clos par les seules routes du back-office,
concurrence), puis consigner chaque écart, renforcement et levée de dette, et écrire la note aux
équipes clientes. Une limite non consignée est un constat bloquant à la revue post-fusion (règle 4 de
`CLAUDE.md`) : ce lot est la dernière occasion de la rattraper.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane ; base qui contient WP07 à WP13.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP14 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Fichiers : uniquement ceux d'`owned_files`. Aucun code de production : un défaut trouvé par les
  tests se signale à l'orchestrateur (lot concerné, test qui échoue, sortie), il ne se corrige pas ici.
- Le scénario passe **par HTTP** (routes de la mission et route de statut), jamais par appel direct
  d'un service ni par SQL en propriétaire, hormis la préparation des données du festival (fixture du
  scénario existant) et les lectures de vérification.
- **Consignation** : tu écris ce que les notes de lane et les décisions du porteur établissent. Tu
  n'inventes ni décision ni levée : une levée sans test de levée nommé dans une note reste ouverte, et
  tu le dis. Toute contradiction entre une note et le code se signale.
- **Contrat** : `openapi.yaml` n'est pas à toi. La note aux équipes reprend le contrat livré.

## Subtasks

### T062 : `closing-journey.spec.ts` (SC-001, NFR-002)

- Repars de la fixture du scénario de référence rejoué jusqu'à la fin du festival
  (`after_festival`). Puis, par HTTP, avec deux administrateurs distincts là où il faut deux personnes :
  passage `CLOSING` → `RECONCILING` (refus tant qu'une caisse est ouverte, puis succès) ; import d'un
  relevé PSP et banque construit depuis le scénario ; rapprochement automatique puis manuel du reste ;
  `RECONCILING` → `SETTLING` ; aperçu puis exécution des étapes dans l'ordre (25 000, 6 000, 1 017 :
  valeurs de WP07) ; lot de versements préparé par l'un et validé par l'autre, exporté, confirmé ;
  `REFUND_WINDOW`, étapes de casse, de caution et de promotion ; `CLOSED` ; `LOCKED`.
- Après chaque étape : chaque transaction à somme nulle, `ledger_invariant.must_be_zero = 0`, droits
  nets = argent détenu. À la fin : soldes égaux à `expected.after_closing.balances`, nombre de
  transactions égal à `after_tx` (ou l'écart justifié dans la note si le scénario ne prévoit pas les
  versements, et signalé).
- Rejeu complet (mêmes clés d'idempotence) : aucune transaction ni ligne nouvelle.

### T063 : concurrence et invariants (NFR-001, SC-002)

`integration/invariants-cloture/concurrency.spec.ts` :
- 50 exécutions concurrentes d'une même étape, d'une même validation de lot, d'un même résultat de
  versement, et 50 rejeux d'une même clé : exactement une écriture chacun.
- SC-002 : versement au-delà du droit net (seul, par cumul de deux lots, après un `FAILED` recrédité)
  et lot validé par son auteur : 100 % refusés, aucune écriture.
- Invariants de `data-model.md` 1 à 4 vérifiés en fin de test.

### T064 : consignation

Pour chaque élément, cite la note de lane ou la décision qui le fonde.
- **Écarts acceptés** (C-006, C-010) : OP nouveau et ADR nouveau (ADR-197 et suivants) pour (a) la
  copie externe des scellements simulée et (b) les alertes sans envoi à une personne. Chacun : risque,
  raison, décision du porteur du 17/11/2026, mission qui le lève (12b), condition de levée, **test qui
  échoue si la limite s'élargit** (nommé : garde de production de WP12, état « copie simulée »).
- **Réglage de déploiement** : appartenance du propriétaire de `ops_long_transactions` à
  `pg_read_all_stats` (R-13, note de WP06) : OP ou ligne de l'OP de la 12b, selon l'existant.
- **Limite d'exploitation (relecture de WP05)** : les `ops_*` exigent un propriétaire superutilisateur
  ou `BYPASSRLS` (hypothèse héritée de 0022, `audit_log_chain`) ; sans cela la chaîne d'audit de la
  plateforme est invisible et `ops_ledgers_to_seal` échoue. OP + ADR + test de WP06 qui la vérifie ;
  levée possible en 12b (lecture prestataire par prestataire). Avec le réglage `pg_read_all_stats`.
- **Relevés (relectures de WP02)** : ADR et OP du retrait de l'unicité globale `(source, external_ref)`
  (déni de service et fuite entre prestataires, remplacée par l'unicité par compte) et correction de la
  note de `data-model.md` (l. 51) ; OP : `closing_balance` déclaré par l'importeur jamais recoupé avec la
  somme des lignes ; OP : une transaction peut être rapprochée par plusieurs lignes (règlement PSP en
  plusieurs virements, non modélisé), règle proposée « somme des lignes rapprochées ≤ montant de la
  transaction sur ce compte », mission qui la lève à proposer au porteur.
- **Renforcements de phase 1** : garde de `closing_step` limitée au grand livre de l'événement (WP02) ;
  `create_payout_batch` limité à une demande `APPROVED` cohérente et lien `payout` ↔ transaction (WP03,
  décision 6 du porteur).
- **Renforcement de WP02 (constat de WP09, décision 7 du porteur)** : `import_statement_lines` ne
  rapproche automatiquement que si la somme des `posting` de la transaction sur le compte égale le
  montant de la ligne (signe et valeur) ; ADR, report `PRD.md`, preuve : `tests_statements.sql` §3b et
  `match-statement-line.spec.ts`. OP : `explained_by_anomalies` calculé en base mais absent
  d'`AccountReconciliation` (contrat figé), exposition à proposer au porteur pour une mission future.
  Précision : montant égal au net ou au brut (frais PSP sur le même compte), test §3c.
- **Versements (décisions 8 et 9)** : `net_claim` = `party_position + pending_payouts`, description de
  `net_claim` dans `openapi.yaml` à préciser (texte seul) ; msisdn exporté sans « + ». Mineurs de la
  relecture de WP08 en OP : approbateur du mauvais rôle → demande `FAILED` (nuisance), rejet sans rôle
  par classe, `confirm` rejoué même résultat → 200 sans audit, test d'auto-approbation `[403, 409]`.
- **WP07 (décisions 10 et 11)** : régularisation `NET_OF_REFUNDS` par écart explicite dans `fees.ts`
  (matrice inchangée, ADR) ; `breakage_destination = OPERATOR` = 100 % prestataire (ADR) ; clé de verrou
  `closing-step:` ; grand livre à portée organisateur refusé sur les sept étapes (renforcement).
- **WP10** : charge revalidée à l'exécution (renforcement) ; LEGAL refusé ; CASH inatteignable sur un
  grand livre LOCKED (OP) ; preuve de bout en bout que ni `approval_request` exposé ni `audit_log`
  (`APPROVAL_*`, `LATE_CLAIM_*`) ne portent d'IBAN ou de numéro après consolidation (test FR-024 de WP10
  réactivé).
- **WP10 (décisions 12 et 13)** : ADR « réclamation tardive sans frais » ; OP + ADR « mobile money vers
  un autre numéro sans code de vérification », test qui échoue si l'approbation par une seconde personne
  disparaît.
- **WP09 (relecture)** : OP : deux lignes de relevé peuvent être rapprochées à la même anomalie
  (`explained_by_anomalies` additionne les deux) ; mission qui le lève à proposer au porteur.
- **WP11** : OP : `errors/redact.ts` ne masque pas l'IBAN (aucun journal de corps aujourd'hui ; à
  couvrir avant qu'un tel journal existe) ; OP-N126 tranché par le défaut sûr (refus `409` sans second
  valideur) et arbitrages de la route 15, tels que listés dans la note de lane de WP11.
- **WP07 (relecture cycle 2)** : OP : l'écart `amount` de la régularisation `OPERATOR_FEE`
  n'est borné que par `requirePositive` (pas de plafond aux frais bruts ; interne, fixé par le seul
  calculateur) ; à vérifier à la consolidation : `tsc` signalait `PAYOUT_EXCEEDS_ENTITLEMENT` dans
  `errors/sqlstate-map.ts` en lane-g (type généré périmé ?) ; reformatage Prettier de
  `test/fixtures/edge-vectors/vectors.json` hors carte, absent de la note de lane.
- **Décision 14 (relecture de WP11)** : test Jest concurrent (deux connexions : confirmation `FAILED`
  d'une demande et rapprochement de sa ligne de relevé) : jamais recrédit + rapprochement ensemble ; il
  échoue si on retire le verrou de `refund_request` dans `match_statement_line`. Consigner le
  renforcement (ADR) et les arbitrages de la route 15 (virement `REQUESTED`, numéro mobile étranger en
  `AWAITING_HOLDER`, `extra_check`). `release-cumul-lock.spec.ts` est sous `refunds/` (pas `media/`).
- **Renforcements** (consignés après coup) : borne du droit net en base (`CL055`, R-07), conditions de
  passage ajoutées (R-05), `ops_verify_audit_chain` (WP05), et tout renforcement des notes de lane.
- **Levées** OP-N123, OP-N124, OP-N126, OP-N128, OP-N130 (SC-006) : chacune passe à « levé le … par la
  mission 9b », avec son test de levée et son ADR mis à jour. OP-N82 (anomalies PSP du contrôle « grand
  livre = relevé ») : levé si WP02 et WP09 le prouvent. OP-N3 reste ouvert (aucun jeu SYSCOHADA).
- **Contradictions** 1 à 5 de `research.md` : 1 → SPECIFICATION §3.2 amendée (rôle du versement selon
  le bénéficiaire) avec ADR ; 2 → ADR (`ADJUSTMENT` ajouté) ; 3 → ADR (figeage après `PROCESSING`) ;
  4 → ce que WP07 a fait de `breakage_destination = OPERATOR` ; 5 → note.
- **PRD.md et PROMPTS-A-ENVOYER.md** : section « Mission 9b » marquée faite avec ses écarts ; chaque
  dette reportée (12b : copie réelle S3, envoi des alertes, `pg_read_all_stats` ; mission qui retire
  l'ancienne `refund_deposit_for_session(uuid, uuid)`) ajoutée à la section de la mission qui en hérite.

### T065 : `docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md`

Note aux équipes du back-office, en français, sans jargon interne : pour chacune des 20 opérations,
route, rôle requis (versement : selon le bénéficiaire), corps, réponses et codes d'erreur
(`PAYOUT_EXCEEDS_ENTITLEMENT`, `CLOSING_CONDITION_NOT_MET`…) ; nouvelles valeurs de
`StatusCondition.code` et leur texte ; formats CSV (relevés, export du lot, export comptable avec ses
lignes `NON_MAPPE` et `X-Unmapped-Count`) ; circuit à deux personnes ; ce qui reste simulé (copie,
alertes) ; **renommage des enums Dart générés** (`Event.status` `Status4` → `Status5`,
`TokenFamily.status` `Status5` → `Status6`, `Payout.status` = `Status4`), accepté par le porteur le
17/11/2026 : les apps Dart ajustent leurs types. Exemples tirés des tests, aucune donnée réelle, aucun IBAN complet.

## Tests et preuves

```bash
cd <lane> && PGDATABASE=cashless_wp14 bash packages/ledger-sql/scripts/reset-db.sh
cd <lane>/apps/api && export PGDATABASE=cashless_wp14 && source ../../tools/dev-db/env.sh \
  && env | grep DATABASE_URL \
  && SKIP_LATENCY=1 npx jest test/scenario/closing-journey.spec.ts \
     test/integration/invariants-cloture --runInBand --forceExit
```

La batterie complète de la mission est passée par l'orchestrateur, en série.

## Definition of Done

- [ ] `closing-journey.spec.ts` vert : `CLOSING` → `LOCKED` par HTTP, soldes de `after_closing`,
      invariants à chaque étape, rejeu sans effet.
- [ ] `concurrency.spec.ts` vert : 50 × une écriture ; SC-002 à 100 %.
- [ ] Chaque écart accepté a OP, ADR, test nommé et report ; chaque levée a son test ; SPECIFICATION
      §3.2 amendée ; PRD et PROMPTS à jour.
- [ ] Note aux équipes écrite.
- [ ] Compte rendu : table « élément consigné → source (note de lane, décision) → test ».

## Ce que le relecteur doit casser

- Un écart de sécurité d'une note de lane absent de `POINTS_OUVERTS.md` ou sans ADR ; une levée
  déclarée sans test qui la prouve ; un test de limite qui passerait si la limite s'élargissait.
- Un scénario qui contourne l'API (service appelé directement, SQL en propriétaire pour avancer) ou
  qui ne compare pas les soldes à `after_closing`.
- Un test de concurrence qui sérialise ses appels (aucune vraie concurrence) ou qui compte des
  réponses au lieu des écritures.
- Une note aux équipes qui contredit `openapi.yaml`, ou qui présente la copie simulée comme réelle.

## Fichiers à faire relire par une personne

- `docs/DECISIONS_ADR.md` et `docs/POINTS_OUVERTS.md` : écarts acceptés et levées.
- `docs/SPECIFICATION.md` §3.2 amendée.
