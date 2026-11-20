---
work_package_id: WP08
title: Commande de réémission des codes et procédure de rotation
dependencies: [WP07]
requirement_refs:
- FR-007
- FR-008
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-serveur-app-festivalier-01M7WB69
base_commit: 13797e3564567a0ca28ffbf288f59488bc8b90ca
created_at: '2026-11-20T15:50:33.488910+00:00'
subtasks: [T033, T034, T035, T036]
phase: Phase 2 - API
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/cli/reissue-claim-codes.ts
create_intent:
- apps/api/src/cli/reissue-claim-codes.ts
- apps/api/test/integration/cli/reissue-claim-codes.spec.ts
- docs/procedure-rotation-codes-rattachement.md
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/cli/reissue-claim-codes.ts
- apps/api/test/integration/cli/reissue-claim-codes.spec.ts
- docs/procedure-rotation-codes-rattachement.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 : Commande de réémission des codes et procédure de rotation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/claim-code-rotation.md` (commande, codes de sortie, effets) et `interfaces.md` (lignes
  `reissue_claim_codes`, `claim_key_version_max`, rôle `cashless_claimadmin`,
  `DATABASE_URL_CLAIMADMIN`) ;
- la migration `0097` **telle que fusionnée** (signatures réelles, codes d'erreur de
  `reissue_claim_codes`) et la section 14 de `post-roles.sql` (ce que `cashless_claimadmin` peut
  exécuter) ;
- `apps/api/src/main.key-admin.ts` (12 lignes : point d'entrée non HTTP, `console.error`,
  `process.exit`) et `apps/api/src/main.maintenance.ts` ; `apps/api/src/db/maintenance-db.module.ts`
  l. 28-45 et `maintenance-role-guard.ts` l. 24-49 (pool d'un rôle dédié, refus en production du
  propriétaire, d'un superutilisateur, de `BYPASSRLS`) : le modèle de la garde de rôle de la
  commande ;
- `claimAdminSettings(env)` de `apps/api/src/config/config.ts` (WP07, **fusionné** : secret,
  version, URL du rôle, domaine ; modèle `vendorPinSettings`), jamais `loadConfig` ;
- `apps/api/src/kms/claim-hash.ts` (`ClaimHasher`, constructeur sur la configuration) ;
- `apps/api/src/media/batches/claim-codes.service.ts` l. 58-122 (tirage, collisions, `23505` rejoué
  trois fois, format `rank,code,url`) ; `packages/tag-format/src/claim-code.ts` l. 13, 34, 40
  (`generateClaimCode`, `formatClaimCode`, `claimCodeUrl`) ;
- `apps/api/tsconfig.build.json` (`include: ["src"]` : `src/cli/` sort en `dist/cli/`, rien à
  ajouter) et `apps/api/package.json` l. 7-22 (scripts : les `start:*` lancent
  `node --require tsx/cjs dist/…`) ;
- `docs/procedure-site-passerelle.md` : modèle de ton et de plan d'une procédure d'exploitation ;
  `apps/api/test/integration/media/claims.spec.ts` l. 60-100 (amorçage d'un bracelet avec code).

Priorité des sources (SPECIFICATION §0.3). Contradiction ou manque : tu le signales, tu ne tranches
pas en silence.

## Objective

Une commande d'exploitation `reissue-claim-codes` qui, après une rotation du secret, tire de
nouveaux codes pour les bracelets d'un lot `PUBLIC` qui n'ont pas de code ou dont le code est d'une
ancienne version jamais utilisé, les enregistre par `reissue_claim_codes` sous le rôle
`cashless_claimadmin` (jamais `cashless_app`), et écrit le fichier de commande `rank,code,url` en
mode `0600`. Plus la procédure d'exploitation de la rotation (FR-007, FR-008, SC-003).

## Context

- **Décisions du porteur (20/11/2026)** : réémission par commande d'exploitation, contrat inchangé,
  lots clos compris, rôle `cashless_claimadmin` ; aucun code en clair hors du fichier de sortie ;
  aucune route.
- **Interfaces consommées** : `reissue_claim_codes(p_operator, p_batch, p_media uuid[], p_hashes
  bytea[], p_key_version smallint) RETURNS int` (`DEFINER` ; `CL020` lot non `PUBLIC` ; `CL064`
  bracelet non réémissible) ; `reissuable_media(p_operator, p_batch, p_key_version) RETURNS TABLE
  (media_id, rank)` (liste ordonnée des bracelets réémissibles, `CL020` si le lot n'est pas
  `PUBLIC`) ; `claim_key_version_max()` ; `EXECUTE` du rôle : ces trois fonctions seulement. Codes
  de sortie (contrat) : `0` succès, `2` lot introuvable ou non `PUBLIC`, `3` aucun bracelet à
  réémettre, `1` autre erreur. Sortie standard : le nombre de codes réémis, rien d'autre.
- **Liste des bracelets** : le rôle n'a aucun droit de table ; la commande obtient la liste par
  `reissuable_media` (ordre = rang du fichier). `CL020` : code `2` ; lot absent du prestataire
  (liste vide et `CL020` absent, lot introuvable) : `2` ; liste vide d'un lot `PUBLIC` : `3`. Ne
  demande jamais de `SELECT` ni de `GRANT`.
- **Connexion** : `DATABASE_URL_CLAIMADMIN` seulement (valeur locale `cashless_claimadmin_local`,
  WP04) ; jamais `DATABASE_URL_APP`. La commande lit sa configuration par
  `claimAdminSettings(process.env)` (WP07) : aucun autre secret chargé.
- **Retouche hors carte possible** : `apps/api/package.json` (script `reissue-claim-codes`) : non
  nécessaire, la procédure donne la commande complète ; nomme-la seulement si tu la juges utile.

## Subtasks

### T033 : `cli/reissue-claim-codes.ts` (fichier 0600, refus d'écraser, sortie = nombre)

1. Arguments `--operator <uuid> --batch <uuid> --out <fichier>` (tous obligatoires, aucun autre
   accepté ; UUID mal formé : code `1`, message sans écho de la valeur). Point d'entrée sur le
   modèle de `main.key-admin.ts` (`import 'reflect-metadata'` inutile si aucun module Nest n'est
   chargé : n'en charge aucun, la commande utilise `pg`, `claimAdminSettings` et `ClaimHasher`
   directement).
2. Ordre sûr (un code perdu est irrécupérable : la fonction refuse de réémettre un code de la
   version courante) : (a) lire la liste par `reissuable_media` ; (b) tirer un code par bracelet
   (`generateClaimCode(randomBytes)`), calculer l'empreinte (`hasher.claimCodeHash`) ; (c) **ouvrir
   le fichier de sortie avec `flag: 'wx'` et mode `0o600`** (échec si le fichier existe : code `1`,
   rien d'écrit en base), y écrire `rank,code,url` (`formatClaimCode`,
   `claimCodeUrl(config.claimCodeDomain, code)`), `fsync`, fermer ; (d) seulement alors appeler
   `reissue_claim_codes` dans une transaction ; (e) si la base refuse (`CL020`, `CL064`, `23505`
   après trois tirages comme `issueOrder`, panne), **supprimer le fichier** et sortir en erreur.
   Jamais l'inverse : une base écrite et un fichier perdu laisserait des bracelets sans code
   lisible.
3. Sortie standard : le seul nombre retourné par la fonction (par exemple `412\n`). Erreurs sur la
   sortie d'erreur, **sans code, sans empreinte, sans contenu du fichier** ; aucun `console.log`
   d'un tableau de codes.
4. Garde de version : lire `claim_key_version_max()` ; si la version configurée est **inférieure** :
   code `1` (« rotation à l'envers »), fichier non créé.

Validation : `npx tsc --noEmit -p tsconfig.json` ; `npx eslint src/cli`.

Cas limites : fichier sur un disque plein (échec d'écriture : suppression, code `1`) ; arrêt entre
(c) et (d) : fichier orphelin de codes sans valeur, à signaler dans la procédure ; deux exécutions
concurrentes sur le même lot : la seconde reçoit `CL064` (codes déjà de la version courante) et
supprime son fichier.

### T034 : connexion `DATABASE_URL_CLAIMADMIN`, codes de sortie

1. `new pg.Client({ connectionString: process.env.DATABASE_URL_CLAIMADMIN })` ; variable absente :
   code `1`, message nommant la variable. En production (`config.production`), garde sur le modèle
   de `assertMaintenanceRole` : refuser si `current_user` est superutilisateur, `BYPASSRLS`,
   propriétaire de la base, ou **non membre de `cashless_claimadmin`**.
2. Table de codes de sortie dans une fonction pure testable : `CL020` ou lot introuvable : `2` ;
   liste vide : `3` ; succès : `0` ; tout le reste : `1`. Le texte d'erreur SQL n'est jamais
   affiché.
3. Fermer la connexion dans un `finally` ; `process.exitCode` posé, pas de `process.exit` brutal
   avant la fermeture.

Validation : test unitaire de la table de codes (dans `reissue-claim-codes.spec.ts`, section sans
base).

### T035 : intégration `cli/reissue-claim-codes.spec.ts`

Jeu d'essai : `createMediaWorld`, lot `PUBLIC` de 6 bracelets avec code de la version 1 (modèle
`claims.spec.ts` l. 60-100, `claim_key_version = 1`) ; secret et version 2 posés dans
l'environnement du sous-processus. Lance la commande **réellement** :
`child_process.spawnSync(process.execPath, ['--require', 'tsx/cjs',
'src/cli/reissue-claim-codes.ts', …])` avec `DATABASE_URL_CLAIMADMIN` visant `cashless_wp08` ; relis
la base en propriétaire.

1. **Rotation de bout en bout** (SC-003) : avant, le code ancien rattache ; après la commande
   (secret 2, version 2) : le code ancien est refusé comme inconnu, **chaque nouveau code du fichier
   rattache son bracelet** (via `claimMedia` d'une application démarrée en version 2), compte exact
   de lignes = nombre de bracelets éligibles.
2. Lot **clos** : réémis comme un autre ; lot `STAFF` ou `VIP` : code `2`, aucun fichier.
3. Bracelet dont le code a **déjà servi** (`claim_code_used_at` non nul) : ignoré, ni écrasé ni dans
   le fichier ; si tous le sont : code `3`.
4. Fichier : mode `0600` (`fs.statSync(...).mode & 0o777`), refus d'écraser (second lancement avec
   le même `--out` : code `1`, base et fichier intacts), en-tête `rank,code,url`, URL du domaine
   configuré.
5. **Aucun code ailleurs** : sortie standard égale au nombre seul ; sortie d'erreur sans code ;
   `audit_log` ne contient qu'un nombre (audit de la fonction) ; recherche du code en clair dans la
   base : 0 occurrence ; journal d'une exécution en échec (fichier supprimé).
6. Droits : sous `cashless_app` (`SET LOCAL ROLE`), `SELECT reissue_claim_codes(...)` : `42501` ; la
   commande avec `DATABASE_URL_APP` à la place : refusée (garde de production simulée ou `42501`).
7. Version inférieure à `claim_key_version_max()` : code `1`, aucun fichier.

**Mutations obligatoires** (note de lane) : (a) écris le fichier **après** l'appel de base : le test
« base refusée, aucun fichier restant » échoue ; (b) retire `wx` : le test de refus d'écraser échoue
; (c) mode `0o644` : le test du mode échoue ; (d) imprime les codes sur la sortie standard : le test
5 échoue.

Validation : `export PGDATABASE=cashless_wp08; source ../../tools/dev-db/env.sh; env | grep
DATABASE_URL`, puis `SKIP_LATENCY=1 npx jest test/integration/cli/reissue-claim-codes.spec.ts
--runInBand --forceExit` ; `reset-db`. Fichiers de sortie dans un dossier temporaire de l'essai,
supprimés en `afterAll`.

### T036 : `docs/procedure-rotation-codes-rattachement.md`

Plan et ton de `procedure-site-passerelle.md`, destinée à l'exploitant :

1. **Limites** : rotation immédiate, aucun code ancien ne vaut plus rien dès le redémarrage ; les
   compteurs de consultation anonyme par adresse repartent à zéro ; les demandes de confirmation en
   attente sont perdues ; la réémission porte sur les bracelets non utilisés ; un fichier de codes
   est un secret (jamais envoyé par courriel, détruit après remise à l'imprimeur) ; le fichier
   orphelin après un arrêt brutal.
2. **Quand** (fuite du secret, départ d'une personne qui le connaissait) et **avant de commencer**
   (accord du porteur, fenêtre sans bracelets en cours d'attache, copie de l'ancienne valeur dans le
   coffre, jamais dans un dépôt).
3. **Étapes** : (1) générer un secret de 32 octets au moins (`openssl rand -hex 32`) ; (2) poser
   `CLAIM_CODE_HMAC_KEY` et `CLAIM_CODE_HMAC_KEY_VERSION` (**ancienne version + 1** ; une version
   inférieure refuse le démarrage) pour tous les processus qui lisent l'empreinte : API publique,
   personnalisation ; (3) redémarrer ; (4) pour chaque lot concerné, lancer `node --require tsx/cjs
   apps/api/dist/cli/reissue-claim-codes.js --operator … --batch … --out …` avec
   `DATABASE_URL_CLAIMADMIN` ; (5) remettre le fichier à l'imprimeur (nouveau fichier de commande) ;
   (6) importer le fichier de correspondance de l'imprimeur (`code,uid[,printed_number]`) ; (7)
   détruire le fichier ; (8) vérifier : un ancien code est refusé, un nouveau rattache.
4. **Vérifications** et **codes de sortie** (0, 1, 2, 3 et leur sens) ; **ce qu'il ne faut jamais
   faire** (accorder des droits à `cashless_app`, relancer la commande sans avoir détruit le
   fichier, ré-utiliser un ancien secret).
5. Renvois : `contracts/claim-code-rotation.md`, OP-N47 (levé par WP11), ADR-87. Chaque commande
   citée doit exister : vérifie-les à la main (`grep`) avant de rendre.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP07 (donc WP04).
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP08 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Commandes de preuve

```
cd <lane>/apps/api
export PGDATABASE=cashless_wp08; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/cli/reissue-claim-codes.spec.ts --runInBand --forceExit
npx eslint src/cli test/integration/cli && npx tsc --noEmit -p tsconfig.json
```

## Definition of Done

- [ ] Commande fonctionnelle ; fichier `0600`, refus d'écraser, sortie standard = nombre, aucune
  fuite de code.
- [ ] Ordre « fichier puis base, suppression si la base refuse » prouvé par mutation.
- [ ] Rotation de bout en bout (SC-003) et droits (`cashless_app` refusé) prouvés ; quatre mutations
  consignées.
- [ ] Procédure écrite, commandes vérifiées ; lignes de 100 caractères au plus ; `eslint` et `tsc`
  propres.
- [ ] Note de lane : fichier à faire relire par une personne (la commande manipule des codes en
  clair et le rôle d'exploitation).

## Risks

1. Fichier perdu après écriture en base : bracelets non réémissibles (la version courante est
   refusée).
2. Code ou empreinte dans un message d'erreur, une trace, un journal de test.
3. Variable `DATABASE_URL_CLAIMADMIN` absente en CI : mot de passe du rôle manquant (WP04, piège de
   la PR #20).
4. Commande lancée avec l'ancien secret après rotation : la garde de version doit la refuser.

## Ce que le relecteur doit casser

- Lancer deux fois avec le même `--out` ; sur un disque plein ; avec un lot `STAFF`, clos, inconnu,
  d'un autre prestataire ; avec `DATABASE_URL_APP` ; avec une version inférieure.
- Chercher un code en clair dans la sortie, l'erreur, la base, l'audit, les fichiers temporaires.
- Vérifier le mode du fichier, l'ordre fichier puis base, la suppression après échec ; relire
  `ls -l` du dossier.
- Vérifier que la procédure est exécutable telle qu'écrite, étape par étape, sur une base de test.
- Retirer chaque contrôle des mutations et vérifier que le test échoue.
