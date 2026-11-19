---
work_package_id: WP12
title: 'Inscription des passerelles : grand livre rendu par la base (OP-N116)'
dependencies: [WP03]
requirement_refs: [FR-020]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-durcissements-serveur-01M7QAJD
base_commit: 7b96957977717b3daab23a01378de960d9064544
created_at: '2026-11-19T09:42:06.049193+00:00'
subtasks: [T046, T047, T048]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: tools/edge-admin/src/commands.ts
create_intent: []
execution_mode: code_change
model: sonnet
owned_files:
- tools/edge-admin/src/commands.ts
- tools/edge-admin/src/db.ts
- tools/edge-admin/test/register.spec.ts
- tools/edge-admin/test/support.ts
- docs/procedure-site-passerelle.md
- tools/edge-admin/test/commands-other.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 : Inscription des passerelles : grand livre rendu par la base (OP-N116)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- `kitty-specs/durcissements-serveur-01M7QAJD/interfaces.md` (ligne `register_edge_gateway(...)`, code `CL058`) ;
  `plan.md` IC-08 ; `spec.md` FR-020 ; `research/R-N64-N116-app-attest-passerelles.md` **partie B seulement**
  (B1 à B3) ; la note de lane de WP02 (migration `0094` telle que fusionnée : **la signature réelle fait foi**) et
  celle de WP03 (droits de `cashless_edgeadmin` repris) ;
- `tools/edge-admin/src/commands.ts` l. 75-110 (`RegisterArgs`, début de `register`), l. 140-176 (appel de
  `register_edge_gateway`, `edge_register_snapshot_key`, fichier d'enrôlement) ;
- `tools/edge-admin/src/db.ts` en entier (`FUNCTIONS`, `AdminSession`, `sqlFor`, `openAdminDb`) ;
- `tools/edge-admin/src/main.ts` l. 20-30 et 120-130 (option `--ledger` ; **fichier hors lot**, lecture seule) ;
- `tools/edge-admin/src/enrollment-format.ts` (le format n'a pas à changer) et `FORMATS.md` ;
- `tools/edge-admin/test/register.spec.ts` (en entier), `test/support.ts` l. 95-170 (`mockDb`, `LEDGER`,
  `registerArgv`),
  `test/commands-other.spec.ts` l. 25-50 et 135-150 (usage réel de `ledger`, possédé par ce lot) ;
- `docs/procedure-site-passerelle.md` §2 (l. 29-36).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Lever OP-N116 : l'inscription d'une passerelle ne dépend plus d'un grand livre saisi à la main. La base le trouve
à partir de l'événement, le rend avec l'identifiant de la passerelle, et l'outil écrit **cette** valeur dans le fichier
d'enrôlement. L'option manuelle est refusée avec un message clair, aucune valeur non rendue par la base ne peut
entrer dans le fichier. Disponibilité seulement : aucune fuite, aucun droit nouveau.

## Context

- Point ouvert levé : **OP-N116** (mission 8, WP15 ; fiche `docs/POINTS_OUVERTS.md:228`). Décision du porteur du
  18/11/2026 (specify) : grand livre rendu par l'inscription, `--ledger` refusé, aucune lecture nouvelle pour
  `cashless_edgeadmin` (pas de septième `EXECUTE`).
- Côté base (WP02, migration `0094`) : `register_edge_gateway` garde les **mêmes neuf arguments** qu'en `0058` et
  rend `TABLE (gateway_id uuid, ledger_id uuid)` ; aucun grand livre ou plusieurs (plusieurs devises) : `CL058`. Les
  droits de `cashless_edgeadmin` sont repris par WP03 (le `DROP` les supprime) : ce lot n'y touche pas. Tant que WP02 et
  WP03 ne sont pas fusionnés dans la lane, les tests sur vraie base de l'outil échouent : normal (`merge-deps.sh`).
- **Interfaces consommées** : le retour `(gateway_id, ledger_id)` ; code `CL058`. **Possédée** : le comportement de
  `register` (refus de `--ledger`, fichier écrit avec le grand livre rendu).
- **Chemins vérifiés** : `tools/edge-admin/src/{commands,db}.ts`, `test/{register.spec,support}.ts` et
  `docs/procedure-site-passerelle.md` existent tels que listés.
- **Retouches hors carte nommées (listées dans la note de lane)** :
  1. `tools/edge-admin/test/commands-other.spec.ts` (lignes 34, 45 et 142) passe `ledger` à `register` : après ce lot
     l'option est refusée, ces trois lignes sont à retirer (le test continue d'utiliser `world.ledgerId` pour ses
     propres vérifications de base, l. 88-90). Aucune autre retouche de ce fichier.
  2. `tools/edge-admin/src/main.ts` : **ne pas le toucher**. L'option `--ledger` y reste déclarée
     (`SPECS.register.ledger`)
     pour que le refus se fasse dans `commands.ts` avec un message utile plutôt que par une erreur d'option inconnue.
     Si tu juges le retrait nécessaire, signale-le : c'est l'orchestrateur qui l'ajoute aux fichiers du lot.
- **Resserrement** (se fait, se consigne) : le grand livre n'est plus saisi. Aucun contrôle affaibli, aucun droit
  ajouté.
- Contrat `openapi.yaml` : aucun rapport (outil d'exploitation). Format d'enrôlement : inchangé (`ledger_id` UUID).

## Subtasks

### T046 : `db.ts` lit `TABLE(gateway_id, ledger_id)` ; `commands.ts` refuse `--ledger`

- **But** : (1) l'outil lit les deux colonnes rendues ; (2) `--ledger` n'est plus une source de valeur.
- **Étapes** :
  1. `db.ts` : `sqlFor` fabrique `SELECT ${fn}(...) AS result`, ce qui ne lit pas une fonction qui rend une table.
     Pour `register_edge_gateway` seulement, la requête devient `SELECT gateway_id, ledger_id FROM
     register_edge_gateway($1::uuid, …)` (mêmes neuf types, mêmes marqueurs) et `call` rend l'objet
     `{ gateway_id, ledger_id }` ; les quatre autres fonctions gardent `AS result`. Soit une méthode `callRow` séparée
     de `AdminSession`, soit une forme de retour typée par fonction : choisis la plus petite, garde `AdminSession`
     lisible, ne change pas la liste de types de `FUNCTIONS.register_edge_gateway`.
  2. `commands.ts` : supprimer `const ledger = uuid(args.ledger, '--ledger')` (l. 104). Si `args.ledger !== undefined`
     (même vide), lever `CliError` **avant toute base et avant tout fichier** : message du genre
     « --ledger : retiré ; le grand livre est déterminé par la base à partir de l'événement ». Le type `RegisterArgs`
     garde le champ `ledger?` pour que `main.ts` compile.
  3. Après l'appel, lire `{ gateway_id, ledger_id }` ; une forme inattendue (champ absent, non-UUID) lève l'erreur
     existante « identifiant de passerelle non rendu » (adaptée au grand livre). `edge_register_snapshot_key` reçoit
     `gateway_id`.
  4. Erreur `CL058` (aucun grand livre ou ambigu) : message d'exploitation clair, **sans** identifiant interne
     superflu ; rien n'est écrit (la transaction `withOperator` est annulée, aucun fichier d'enrôlement). Regarde
     comment les autres codes de la base sont déjà traduits par l'outil (`CliError`, `no-secret-in-logs.spec.ts`) et
     reste dans le même style.
- **Fichiers** : `tools/edge-admin/src/db.ts`, `tools/edge-admin/src/commands.ts`.
- **Validation** : `register.spec.ts` ; compilation `npx tsc -p tools/edge-admin --noEmit`.
- **Piège** : la requête reste paramétrée (aucune concaténation de valeur) ; `uuid(args.event, …)` et `operator`
  inchangés ; ne pas prendre le grand livre depuis le fichier de demande.
- **Mutation** : réintroduire la lecture de `args.ledger` dans le fichier écrit ; le test « `--ledger` refusé » et le
  test « grand livre du fichier = valeur de la base » échouent.

### T047 : fichier d'enrôlement avec le grand livre rendu ; faux `test/support.ts`

- **Étapes** :
  1. `commands.ts` l. 176 : `ledger_id: ledgerRendu` (valeur de la base), jamais une valeur d'option.
  2. `test/support.ts` : `mockDb` rend `{ gateway_id: randomUUID(), ledger_id: LEDGER }` pour `register_edge_gateway`
     (et `undefined` pour les autres, comme avant) ; `registerArgv` n'ajoute plus `ledger` aux options par défaut
     (`overrides` permet toujours d'en passer un pour tester le refus). `LEDGER` reste exporté comme **valeur rendue
     par le faux**, pas comme argument.
  3. `register.spec.ts` : ajouter
     - « grand livre du fichier = grand livre rendu par la base » (le faux rend `LEDGER`, le fichier écrit porte
       `ledger_id === LEDGER`, et `calls` montre neuf arguments **sans** grand livre) ;
     - « `--ledger` fourni : refus, aucune écriture » : code non nul, message nommant `--ledger`, `calls` vide, fichier
       absent ; y compris avec un UUID **identique** à celui de la base (refus quand même : une valeur n'est jamais
       lue de l'argument) ;
     - « grand livre introuvable ou ambigu (`CL058`) » : le faux lève `{ code: 'CL058' }` ; code non nul, aucun
       fichier, aucune alerte `EDGE_REGISTERED` annoncée, aucun secret en sortie ;
     - « le faux rend un non-UUID ou aucune ligne » : refus, aucun fichier ;
     - adapter le premier test existant (neuf paramètres exacts : ils le restent) et les cas « refus avant la base ».
  4. Vérifier `no-secret-in-logs.spec.ts` et `enrollment-file.spec.ts` (hors lot, lecture seule) : toujours verts.
  5. **Sur vraie base** : `commands-other.spec.ts` (possédé par ce lot) tourne avec `world.ledgerId` ; il
     prouve que le grand livre écrit est celui d'`identify_edge_gateway`. Ajouter, dans `register.spec.ts` ou dans la
     retouche minimale de ce fichier, **un** test sur vraie base seulement si la base de la lane est disponible ; sinon
     signale que seul le pgTAP de WP02 prouve le côté base.
- **Fichiers** : `commands.ts`, `test/support.ts`, `test/register.spec.ts` ; possédé aussi : `commands-other.spec.ts` (3
  lignes).
- **Validation** : `cd tools/edge-admin && npx jest --runInBand` (suites sans base) ; avec base :
  `PGDATABASE=cashless_wp12` dans le même appel que `source ../../tools/dev-db/env.sh` (lis `package.json` de l'outil
  pour la variable d'URL qu'il attend) puis `npx jest test/commands-other.spec.ts --runInBand`.
- **Mutation** : faire retomber `register` sur `args.ledger` quand il est fourni ; le test de refus échoue.

### T048 : `docs/procedure-site-passerelle.md` §2

- Ajouter au §2 (Inscription, après l'étape 1) une étape : le grand livre n'est **pas** saisi ; l'inscription le
  retrouve à partir de l'événement et l'écrit dans le fichier d'enrôlement ; `--ledger` est refusé ; une inscription
  qui échoue avec « grand livre introuvable ou ambigu » signifie qu'aucun grand livre (ou plusieurs, plusieurs devises)
  n'existe pour l'événement : voir l'exploitation du central, ne rien contourner à la main. Une phrase suffit pour
  chaque point ; renumérote les étapes suivantes. Pas de diagramme, pas d'autre section.
- Lignes ≤ 120 caractères, ton et vouvoiement/tutoiement du document respectés (lis le §2 et le §3 avant).
- `tools/edge-admin/FORMATS.md` : **inchangé** (le format ne change pas) ; vérifie que le mot « ledger » n'y décrit
  pas l'option retirée, sinon signale-le (hors carte).

## Branch Strategy

Planification et fusion sur `feat/durcissements-serveur`. Le worktree de lane est calculé par `lanes.json`
(`.worktrees/durcissements-serveur-01M7QAJD-lane-x`) ; travaille uniquement dedans. Implémentation :

```
LC_ALL=C LANG=C spec-kitty agent action implement WP12 --agent claude --mission durcissements-serveur-01M7QAJD
```

Base de la lane : `cashless_wp12` (jamais `cashless_test`) ; `reset-db` avant et après toute suite sur vraie base.

## Definition of Done

- [ ] `register` écrit dans le fichier d'enrôlement le `ledger_id` rendu par la base, jamais celui d'une option.
- [ ] `--ledger` fourni (vide, différent ou identique) : refus avant la base, aucun fichier, message clair.
- [ ] `CL058` : message d'exploitation, rien d'écrit, aucune alerte annoncée, aucun secret en sortie.
- [ ] `db.ts` : lecture `TABLE(gateway_id, ledger_id)` ; les quatre autres fonctions inchangées ; requête paramétrée.
- [ ] `register.spec.ts` : grand livre rendu, refus de `--ledger`, `CL058`, retour mal formé ; suite de l'outil verte.
- [ ] `commands-other.spec.ts` : seules les trois lignes de `ledger` retirées, sans autre changement.
- [ ] `procedure-site-passerelle.md` §2 à jour ; `FORMATS.md` et `main.ts` non modifiés.
- [ ] Une mutation (relire `args.ledger`) vérifiée et notée ; lignes de 100 caractères au plus ; aucune dépendance.

## Risks

- `main.ts` hors lot ; `commands-other.spec.ts` : une modification plus large que les trois lignes nommées est un
  écart.
- Le `DROP` de `register_edge_gateway` retire ses droits : si WP03 n'est pas fusionné, `permission denied` sur la
  vraie base ; ce n'est pas un défaut de ce lot (ne rouvre aucun droit).
- Le faux de `support.ts` ressemble à la base sans l'être : il ne prouve pas `CL058` côté SQL (c'est WP02).
- Un script de site qui passe encore `--ledger` casse : c'est le but (refus net), à dire dans la note de lane et la
  procédure.

## Ce que le relecteur doit casser

1. Passer `--ledger` (autre UUID, même UUID, vide, répété) et chercher un chemin qui écrit une valeur non rendue
   par la base dans le fichier ; chercher un fichier d'enrôlement partiel après un échec.
2. Provoquer `CL058` et vérifier : aucune alerte, aucun fichier, aucune clé, aucune fuite d'identifiant dans les
   journaux
   (`no-secret-in-logs.spec.ts` relancé).
3. Faire rendre au faux une ligne vide, un `ledger_id` nul, un non-UUID, deux lignes : refus, jamais un défaut
   silencieux.
4. Relancer `commands-other.spec.ts` sur vraie base après les droits de WP03 : le grand livre écrit égale celui
   d'`identify_edge_gateway` pour le même événement.
5. Relire la requête de `db.ts` : paramétrée, aucun `SELECT` direct de table, aucun septième `EXECUTE` nécessaire.
6. Vérifier la mutation de la note et l'écart de périmètre (fichier modifié hors liste, `main.ts` touché).
