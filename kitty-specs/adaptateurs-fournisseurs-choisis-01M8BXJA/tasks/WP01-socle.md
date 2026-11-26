---
work_package_id: WP01
title: 'Socle : dépendances, configuration, client HTTP sortant, garde « aucun réseau »'
dependencies: []
requirement_refs:
- NFR-001
- NFR-003
- NFR-004
- C-004
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003, T004, T005]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/psp/http/
create_intent:
- apps/api/src/psp/http/psp-http.ts
- apps/api/test/support/fake-servers/http-fake.ts
- apps/api/test/support/no-external-network.ts
- apps/api/test/unit/psp/psp-http.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/package.json
- package-lock.json
- apps/api/src/config/config.ts
- apps/api/test/unit/config.spec.ts
- apps/api/src/psp/http/**
- apps/api/test/support/fake-servers/http-fake.ts
- apps/api/test/support/no-external-network.ts
- apps/api/jest.config.cjs
- apps/api/test/unit/psp/psp-http.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 — Socle : dépendances, configuration, client HTTP sortant, garde « aucun réseau »

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §1, §2, §3 ; `<M>/research.md` R-01, R-13 ; `docs/08-pile-logicielle.md` §1 (règle de vérification) ;
- `apps/api/src/config/config.ts` (forme d'`AppConfig`, validation, lecture de l'environnement) et `test/unit/config.spec.ts` ;
- `apps/api/jest.config.cjs` ; `apps/api/package.json` (scripts `start:*`).

## Objective

Poser ce dont tous les lots ont besoin : les quatre dépendances épinglées, les clés de configuration, le client
HTTP sortant commun et les outils de test sans réseau. Aucun adaptateur ici.

Dépendances : aucune. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP01 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T001 — Dépendances épinglées et script `essai`

1. Depuis la racine de la lane : `npm install --ignore-scripts --save-exact -w @cashless/api axios@1.21.1
   @aws-sdk/client-kms@3.1172.0 @aws-sdk/client-secrets-manager@3.1172.0 @aws-sdk/client-s3@3.1172.0`.
   Versions **exactes** (pas de `^`), rien d'autre. Si npm refuse hors ligne, arrête-toi et signale-le.
2. Vérifie dans `package-lock.json` : `resolved` sur `registry.npmjs.org`, `integrity` présent pour les quatre ;
   `npm ls axios @aws-sdk/client-kms -w @cashless/api` sans doublon de version majeure. Liste dans la note le nombre de
   paquets transitifs ajoutés (`git diff --stat package-lock.json`).
3. Ajoute le script `"essai": "tsx src/external-services/trial/main.ts"` dans `apps/api/package.json` (le fichier sera
   créé par WP11 ; le script existe dès maintenant, sans effet tant qu'il manque).
4. Aucune dépendance de développement nouvelle.

### T002 — Configuration (`interfaces.md` §2, exactement)

1. Ajoute à `AppConfig` : `externalModes` (4 champs `'fake' | 'real'`), `pspHttpTimeoutMs`, `pspBases` (wave,
   paydunya, stripe), `waveDefaultUrls` (success, error : `string | null`), `aws` (`region`, `endpoint: string | null`),
   `sealCopy` (`bucket: string | null`, `retentionDays`), avec les variables, défauts et règles du tableau.
2. Validation au démarrage (même style que les clés existantes) : valeur hors liste → erreur qui nomme la variable,
   jamais sa valeur si elle peut être un secret (aucune ne l'est ici, mais garde le style). `AWS_ENDPOINT_URL` posé en
   production → refus. Adresses de base : `https://` exigé en production ; `http://127.0.0.1` / `localhost` permis
   hors production seulement.
3. N'ajoute **aucune** clé pour un secret : identifiants et clés vivent dans le coffre.
4. Tests dans `test/unit/config.spec.ts` : défauts ; chaque refus ; `SEAL_COPY=real` sans `SEAL_COPY_BUCKET` → refus ;
   `AWS_ENDPOINT_URL` en production → refus. Mutation : retirer le refus de l'endpoint en production → un test échoue.

### T003 — `PspHttpClient` (`interfaces.md` §3)

1. `src/psp/http/psp-http.ts` : une instance `axios.create({ timeout, validateStatus: () => true,
   responseType: 'arraybuffer', maxRedirects: 0, proxy: false })` ; aucune redirection suivie (un PSP qui redirige est
   une erreur).
2. Nouveaux essais (≤ 2) seulement si `idempotent` et statut 429/5xx ou erreur réseau ; `Retry-After` ≤ 5 s respecté,
   sinon 200 ms puis 800 ms. Un POST non idempotent n'est **jamais** rejoué : sur délai, `PspHttpError('TIMEOUT')`.
3. `PspHttpError` : `kind`, message sans URL de requête complète (hôte et opération seulement), sans corps.
4. Journal (Logger Nest) : une ligne par appel `{provider, operation, status, durationMs, attempts}` ; jamais
   d'en-têtes ni de corps. Taille de réponse bornée à 1 Mio (`maxContentLength`).

### T004 — Faux serveur HTTP générique et garde réseau

1. `test/support/fake-servers/http-fake.ts` : `startFakeServer(handler) → { url, close, requests }` sur
   `127.0.0.1:0` (`node:http`), qui enregistre méthode, chemin, en-têtes et corps brut de chaque requête reçue (pour que
   les tests vérifient ce que l'adaptateur envoie). Aucun TLS.
2. `test/support/no-external-network.ts` : enregistré dans `jest.config.cjs` (`setupFiles`) ; remplace `dns.lookup`
   (et `net.connect` vers une IP non locale) pour qu'une connexion à un hôte autre que `127.0.0.1`, `::1` ou `localhost`
   lève `Error('réseau externe interdit en test')`. Vérifie que la base Docker (`127.0.0.1:5433`) reste joignable.
3. Relance un échantillon de suites existantes (`test/unit/psp`, `test/integration/webhooks/receive.spec.ts`,
   `test/unit/attestation/android.spec.ts`) : si une suite existante appelle le réseau (par ex. liste de révocation
   Google), **ne l'affaiblis pas** : signale-la dans la note avec son nom ; ne contourne pas la garde.

### T005 — Tests et mutations

`test/unit/psp/psp-http.spec.ts`, contre `startFakeServer` : succès ; 503 puis 200 sur GET idempotent (2 requêtes
reçues) ; 503 sur POST non idempotent (1 seule requête) ; délai (serveur qui ne répond pas) → `TIMEOUT` sans second
envoi pour un POST ; redirection 302 non suivie ; journal capturé sans en-tête `Authorization` ni corps ; appel vers
`https://example.com` en test → refusé par la garde. Mutations : rejouer un POST non idempotent ; journaliser les
en-têtes ; retirer la garde réseau.

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Dépendance non exacte ou script d'installation exécuté ; un POST rejoué ; un secret ou un en-tête dans un journal ;
la garde réseau contournable (IPv6, `net.connect` direct) ; une suite existante cassée par la garde et passée sous silence.

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
