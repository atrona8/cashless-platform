---
work_package_id: WP06
title: "OP-N74 : enrôlement et état de l'événement (migration 0035)"
dependencies: []
requirement_refs:
- FR-024
- C-001
- C-002
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks:
- T025
- T026
- T027
phase: Phase 1 - Contrat et base de données
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent:
- packages/ledger-sql/migrations/0035_enrollment_event_state.sql
- packages/ledger-sql/tests/tests_enrollment_event_state.sql
execution_mode: code_change
owned_files:
- packages/ledger-sql/migrations/0035_enrollment_event_state.sql
- packages/ledger-sql/tests/tests_enrollment_event_state.sql
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 – OP-N74 : enrôlement et état de l'événement (migration 0035)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement :
`spec.md` (FR-024 et le scénario « événement CLOSED ou point de vente supprimé »), `research.md` R-09, `plan.md`
IC-08 et la section « Charter Check » (écart « point de vente supprimé »), `data-model.md` (codes d'erreur : `CL031`).
Code de référence : `migrations/0022_device_enrollment.sql` §3a et §3c (dernières et seules définitions de
`create_device_enrollment_code` et `enroll_device` : vérifié, ni 0027 ni 0030 ne les remplacent),
`migrations/0021_definer_search_path.sql` (règle du `search_path`), `schema_grand_livre_cashless.sql`
(`event_status`, `set_event_status` qui prend l'événement `FOR NO KEY UPDATE`). En cas de contradiction entre
sources, applique la priorité de SPECIFICATION §0.3 (tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > PRD) et **signale-la**. Ne modifie jamais un `.sql` généré de
`packages/ledger-sql/`.

## Objective

Lever OP-N74 : l'émission d'un code d'enrôlement et l'enrôlement sont refusés, sans rien écrire, pour un événement
`CLOSED` (tout mode), et dès `CLOSING` pour les modes `CATALOG_POS` et `KEYPAD_TPE` ; `TOPUP_DESK` reste permis
jusqu'à `CLOSED`. Les deux fonctions sont remplacées en entier, sans perdre un seul contrôle de 0022.

## Context

- IC-08 ; décision du porteur `DM-01M5HKDXSTFR5JS88GZ4B2EA5J` (états bloquants). États : `DRAFT`, `LIVE` permis ;
  `CLOSING`, `RECONCILING`, `SETTLING`, `REFUND_WINDOW` → refus pour `CATALOG_POS` et `KEYPAD_TPE` ; `CLOSED` → refus
  pour tout mode.
- Mode effectif : celui du code, `NULL` valant `CATALOG_POS` (même règle que `enroll_device` :
  `coalesce(app_mode, 'CATALOG_POS')`). À l'émission, `p_mode NULL` est donc traité comme `CATALOG_POS`.
- Erreur nouvelle : `CL031` → `422 ENROLLMENT_EVENT_CLOSED` (traduction par WP08, contrat par WP01).
- « Point de vente supprimé » (FR-024) : aucune suppression n'existe en base (signalé au plan) ; le refus porte sur un
  point de vente inexistant ou qui n'appartient plus à l'événement du code (relu à l'enrôlement).
- L'autre part d'OP-N74 (retrait de `UPDATE (event_id, pos_id)` sur `device` à `cashless_app`) est faite par WP07.
  La clôture d'OP-N74 dans `docs/POINTS_OUVERTS.md` (SC-008) est faite par WP14 avec la preuve de ce lot.
- Droits : `CREATE OR REPLACE` garde les droits existants ; rejouer quand même `REVOKE ALL … FROM PUBLIC`. Aucun
  `GRANT` (WP07).

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus
longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- Renforcement retenu (ADR-117, audit de tous les refus) : le refus pour état de l'événement est audité par la fonction de refus existante ; retouche hors carte autorisée dans `apps/api/src/devices/enrollment/enrollment.service.ts` (valeur de `ATTEMPT_RESULTS`) et contrainte de `device_enrollment_attempt.result` élargie par 0035 à cette seule valeur. « Sans rien écrire » de FR-024 = ni terminal ni code ; l'audit du refus reste écrit.
- Point de vente hors de l'événement du code : `CL031`. Verrou `FOR SHARE` sur l'événement : retenu.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : aucune. Worktree attribué par lane
(`lanes.json`). Commande : `spec-kitty agent action implement WP06 --agent claude --mission
terminaux-paiement-en-ligne-01M52QB9`.

## Subtasks

### T025 — `create_device_enrollment_code` remplacée

`CREATE OR REPLACE FUNCTION create_device_enrollment_code(p_code_hash bytea, p_event uuid, p_pos uuid, p_mode text,
p_personal_phone boolean, p_ttl_seconds int, p_actor uuid) RETURNS uuid` — même signature, mêmes noms de paramètres,
`LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`. Copier le corps de 0022 §3a **à l'identique**
(prestataire de session, `PAIRED_TPE` → `CL027`, événement obligatoire, mode connu, téléphone personnel, durée
300..604800, empreinte de 32 octets, événement du prestataire, point de vente du prestataire et de l'événement,
`device_admin_allowed`), puis ajouter, **après** le contrôle de l'auteur (un auteur hors périmètre reçoit toujours
`P0002` et n'apprend pas l'état de l'événement) et avant l'`INSERT` :
- relire `event.status` de `p_event` **`FOR SHARE`** (sérialise avec `set_event_status`, qui prend `FOR NO KEY
  UPDATE` ; sans ce verrou, une clôture concurrente pourrait être validée entre la lecture et l'écriture) ;
- `CLOSED` → `CL031` ; `CLOSING`, `RECONCILING`, `SETTLING`, `REFUND_WINDOW` et mode effectif `CATALOG_POS` ou
  `KEYPAD_TPE` → `CL031`.
Rien n'est écrit sur un refus (l'exception annule tout).

### T026 — `enroll_device` remplacée

`CREATE OR REPLACE FUNCTION enroll_device(…, p_device_id uuid DEFAULT NULL) RETURNS TABLE (device_id uuid, next_seq
bigint)` — signature, noms, défaut et `#variable_conflict use_column` identiques à 0022 §3c. Garder **chaque**
contrôle dans son ordre : paramètres (`serial`, système, version, clés, certificat, attestation, jeton → `CL001`),
code `FOR UPDATE` (inconnu, utilisé, autre prestataire → `CL025`), expiration (`CL026`), mode (`CL027`), verrou
consultatif du `serial`, `CL028` (dont la traduction de `device_serial_active`), `next_seq`, insertion, code consommé,
familles `REENROLLED`, nouvelle famille, historique. Ajouter entre le contrôle du mode (étape 3) et le verrou du
`serial` (étape 4) :
- événement du code `FOR SHARE` (ordre : code, puis événement) ; `CLOSED`, ou état de clôture avec mode effectif
  `CATALOG_POS`/`KEYPAD_TPE` → `CL031` ;
- si le code porte un point de vente : il existe, appartient au prestataire du code et à l'événement du code (via
  `merchant_participation.event_id`) ; sinon refus. **Code non fixé au plan** : proposer `CL031` (FR-024 range le
  point de vente « supprimé » avec l'événement clos) et le signaler.
Le code n'est pas consommé sur ces refus (rien n'est écrit).
`check_device_enrollment_code` (lecture avant attestation) n'est pas dans le plan : la laisser telle quelle ; le
refus arrive donc après l'attestation. Signale-le (renforcement possible : refuser plus tôt) sans le coder.

### T027 — Suite `tests_enrollment_event_state.sql` et non-régression de 0022

Style de `tests/tests_device_enrollment.sql` (données en propriétaire, `pg_temp.id`, `pg_temp.h`, `ROLLBACK`).
Événements créés directement dans l'état voulu par `INSERT … status = '<état>'` (le garde `event_status_guard` ne
porte que sur `UPDATE OF status`). Pour « code émis puis événement clos », insérer le code en propriétaire sur un
événement déjà `CLOSED` ou `CLOSING`.
Cas :
- structure : les deux fonctions restent `SECURITY DEFINER`, `search_path = public, pg_temp`, non exécutables par
  `PUBLIC` ; signatures inchangées (`'enroll_device(bytea,…,uuid)'::regprocedure`) ;
- émission : matrice des 7 états × modes (`CATALOG_POS`, `KEYPAD_TPE`, `TOPUP_DESK`, `NULL`) → `CL031` attendu ou
  succès ; un refus n'écrit aucune ligne dans `device_enrollment_code` ;
- auteur hors périmètre sur un événement `CLOSED` → `P0002` (et non `CL031`) ;
- enrôlement : mêmes états × modes du code ; refus → aucun `device`, code non consommé, aucun jeton ni historique ;
  `TOPUP_DESK` sur Android enrôlé en `REFUND_WINDOW`, refusé en `CLOSED` ;
- point de vente du code rattaché à un autre événement (modifier en propriétaire la participation) → refus ;
- verrou : après `enroll_device` réussi, `pg_locks` montre l'événement verrouillé en partage dans la transaction ;
- non-régression : rejouer dans cette suite un échantillon des refus de 0022 (`CL025`, `CL026`, `CL027`, `CL028`,
  `CL001`, `P0002`) sur un événement `LIVE` ; et vérifier que `tests_device_enrollment.sql`,
  `tests_enrollment_refusal.sql`, `tests_enrollment_limits.sql`, `tests_execute_grants.sql`,
  `tests_definer_search_path.sql` passent sans modification (leurs événements sont `DRAFT`).

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w
@cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w @cashless/api -- --runInBand`
(les tests d'intégration de l'enrôlement de la 5a doivent rester verts). Jamais pgTAP sur une base où Jest vient de
tourner (rejouer `reset-db`). La base partagée appartient à l'orchestrateur : valide ton SQL sur un cluster
PostgreSQL 17 jetable dans le scratchpad, ou demande-lui de lancer les suites ; tests en série seulement. Dans un
worktree de lane, crée d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de
la base Docker qui peut reculer : aucun test ne compare l'heure de Node à `now()` sans marge.

## Definition of Done

- `0035_enrollment_event_state.sql` rejouable après `reset-db` ; toutes les suites pgTAP vertes.
- Diff du corps de chaque fonction avec 0022 : seuls les blocs ajoutés diffèrent (à joindre au compte rendu).
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu du lot en fin de ce fichier : écarts au plan (sens : renforcement ou non), retouches hors carte (une
  ligne de justification chacune), points soumis au porteur (code du refus « point de vente », refus après
  l'attestation, trace des refus — voir Risks), fichiers à faire relire par une personne
  (`0035_enrollment_event_state.sql` : fonctions d'enrôlement remplacées), **critères d'acceptation couverts avec
  leur preuve** (fichier de test et nom du cas, pour `acceptance-matrix.json` et la clôture d'OP-N74 par WP14).

## Risks

- Contrôle de 0022 perdu dans le remplacement (paramètre, verrou, traduction de contrainte) ou `search_path` effacé.
- Lecture de l'état sans `FOR SHARE` : clôture concurrente qui passe.
- **Trace des refus (hors carte, à signaler à l'orchestrateur)** : l'API n'enregistre un refus d'enrôlement
  (`record_enrollment_refusal`, essai et audit) que si son code figure dans `ATTEMPT_RESULTS`
  (`apps/api/src/devices/enrollment/enrollment.service.ts`), et `device_enrollment_attempt.result` n'admet pas de
  valeur pour ce refus. Un refus `CL031` ne serait donc ni compté ni audité. Ce n'est pas un affaiblissement par
  rapport à aujourd'hui (l'enrôlement passait), mais un manque face à ADR-117. Ne pas le coder ici sans décision :
  l'élargissement de la contrainte (0035) et la ligne de l'API (fichier d'aucun lot) sont à trancher.

## Reviewer Guidance

Vérifier : signatures identiques ; chaque contrôle de 0022 présent et dans le même ordre (diff) ; état lu sous
`FOR SHARE`, après l'auteur à l'émission et après le mode à l'enrôlement ; `NULL` traité comme `CATALOG_POS` ;
`TOPUP_DESK` permis jusqu'à `REFUND_WINDOW` inclus ; aucun écrit sur refus (code non consommé) ; `REVOKE … FROM
PUBLIC` rejoué ; aucun `GRANT` ; non-régression des suites de la 5a.
