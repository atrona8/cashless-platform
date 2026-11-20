---
work_package_id: WP07
title: Codes de rattachement versionnés côté API et configuration
dependencies: [WP04]
requirement_refs:
- FR-007
- NFR-002
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
subtasks: [T027, T028, T029, T030, T031, T032]
phase: Phase 2 - API
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/config/config.ts
create_intent:
- apps/api/test/integration/media/claim-rotation.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/config/config.ts
- apps/api/test/unit/config.spec.ts
- apps/api/src/kms/claim-hash.ts
- apps/api/src/media/claims/claims.service.ts
- apps/api/src/media/batches/claim-codes.service.ts
- apps/api/src/media/personalization/personalization.service.ts
- apps/api/test/integration/media/claim-rotation.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 : Codes de rattachement versionnés côté API et configuration

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/claim-code-rotation.md`, `interfaces.md` (tables « Fonctions versionnées », «
  Configuration », « Motifs de ligne d'import »), `data-model.md` (migration 0097) ;
- la migration `0097` **telle que fusionnée** (signatures réelles : elles font foi sur ce prompt) et
  la section 14 de `post-roles.sql` (droits d'`EXECUTE` de `cashless_app` et `cashless_perso`) ;
- `apps/api/src/config/config.ts` : champ l. 50, `TEST_CLAIM_CODE_HMAC_KEY` l. 240, `hmacKey`
  l. 289-310, `claimCodeHmacKey()` l. 313, `boundedInt` l. 440-458, `customerOtpIpHourlyMax`
  l. 461-468 (réglage entier à défaut, valable en production), `claimKey` l. 861 et 980, objet rendu
  l. 1008 ;
- `apps/api/test/unit/config.spec.ts` l. 85-100 (clé de rattachement) et l. 178-190 (`it.each` d'un
  entier borné) ; `apps/api/test/unit/kms/kms-module.spec.ts` l. 112-156 (empreintes) ;
- `apps/api/src/kms/claim-hash.ts` en entier (48 lignes) ;
- `apps/api/src/media/claims/claims.service.ts` l. 54, 77-89 (`claim_media`), 267-323 (`confirm` :
  lecture directe `WHERE m.claim_code_hash = $1` l. 276-281, demandes en attente l. 284-293,
  `decide` l. 295-299), 349-376 (`lookup`), 379-391 (`customerMedia`, `printed_number: null`) ;
- `apps/api/src/media/batches/claim-codes.service.ts` l. 22-33 (`ASSOCIATION_REASONS`), 58-96
  (`issueOrder` : `issue_claim_codes` l. 72), 125-162 (import), 164-223 (`associate`, `refusal`) ;
- `apps/api/src/media/personalization/personalization.service.ts` l. 262-312 (`associateClaimCode`),
  314-360 (`refusal`, `associate` l. 350) ;
- `apps/api/test/integration/media/claims.spec.ts` l. 60-100 (amorçage d'un bracelet avec code) et
  `test/support/app.ts` l. 110-154 (`createTestApp` lit l'environnement : sert à simuler une
  rotation).

Priorité des sources (SPECIFICATION §0.3). Contradiction ou manque : tu le signales, tu ne tranches
pas en silence.

## Objective

Chaque lecture ou écriture d'empreinte de code de rattachement passe la version du secret à la base
; une empreinte d'une autre version compte comme absente, avec la même réponse qu'un code inconnu
(FR-007, SC-003, NFR-002). Poser la configuration (`CLAIM_CODE_HMAC_KEY_VERSION`, délais de la
chaîne d'envoi pour WP10) et refuser le démarrage de l'API si sa version est inférieure à celle que
la base connaît.

## Context

- **Décisions du porteur (20/11/2026)** : rotation **immédiate**, sans période de double empreinte ;
  version du secret sur chaque empreinte ; `printed_number` en 3e colonne facultative du fichier de
  l'imprimeur ; aucun code en clair nulle part.
- **Interfaces consommées** (`interfaces.md` fait foi) : cinq fonctions reçoivent
  `p_key_version smallint` **en dernier** (`issue_claim_codes`, `associate_claim_code`,
  `claim_media`, `confirm_media_claim`, `public_balance_lookup`) ; `associate_claim_code(p_hash,
  p_media, p_printed_number, p_key_version)` (numéro sans défaut, NULL permis) ;
  `register_personalized_media` est **inchangée** (elle n'écrit aucune empreinte) ; `CL065` ;
  `claim_key_version_max()` (`DEFINER`, exécutable par `cashless_app`) ;
  `media.claim_key_version NOT NULL DEFAULT 1` sans `CHECK` (les fixtures qui posent
  `claim_code_hash` restent valides). **Interfaces possédées** : `AppConfig.claimCodeKeyVersion`,
  `otpWhatsappTimeoutMs`, `otpSmsPrimaryTimeoutMs` ; `claimAdminSettings(env)` ;
  `ClaimHasher.keyVersion` ; motifs `BAD_PRINTED_NUMBER`, `PRINTED_NUMBER_TAKEN` de
  `ASSOCIATION_REASONS` (WP09 ajoute les deux valeurs à l'énumération du contrat). Une lecture lue
  par la section 14 fusionnée qui contredirait cela : signale-la.

## Subtasks

### T027 : `config.ts` : version du secret, délais, tests de configuration

1. `AppConfig` : `claimCodeKeyVersion: number` (commentaire : « version du secret des empreintes de
   codes de rattachement, `CLAIM_CODE_HMAC_KEY_VERSION`, entier de 1 à 32767, 1 par défaut »),
   `otpWhatsappTimeoutMs` (défaut 10 000, 1 000 à 15 000, `OTP_WHATSAPP_TIMEOUT_MS`),
   `otpSmsPrimaryTimeoutMs` (défaut 20 000, 1 000 à 20 000, `OTP_SMS_PRIMARY_TIMEOUT_MS`) : le code
   reste en mémoire 35 s au plus.
2. Une fonction `optionalInt(env, name, { min, max, default })` sur le modèle de
   `customerOtpIpHourlyMax` (valeur par défaut en production comme ailleurs, `^[0-9]+$`, message «
   entier de a à b attendu (reçu « v ») »). Valeur vide : défaut. `0`, `32768`, `1.5`, `-1`, `abc` :
   refus nommant la variable.
3. Renvoyer les trois champs dans l'objet de `loadConfig` (l. 1008 et suivantes). Ne touche ni
   `claimCodeHmacKey` ni `assertDistinctHmacKeys` : la version n'est pas un secret.
4. `claimAdminSettings(env)` exporté (modèle `vendorPinSettings`) : `{ production, claimCodeHmacKey,
   claimCodeKeyVersion, claimAdminDatabaseUrl }` **plus `claimCodeDomain`** (la colonne `url` du
   fichier en a besoin ; ajout au contrat de `interfaces.md`, à signaler), seule configuration lue
   par la commande de WP08 (jamais `loadConfig`) ; `DATABASE_URL_CLAIMADMIN` absent en production :
   erreur nommant la variable ; hors production, valeur locale `cashless_claimadmin_local`. Ne
   charge ni OIDC ni autre secret. Tests dans `config.spec.ts` (défauts, production sans variable,
   secret de test refusé en production).
4. `config.spec.ts` : défauts (1, 10 000, 20 000) en production et hors production ; valeurs valides
   aux bornes (`1`, `32767`, `1000`, `60000`) ; refus hors bornes et non entiers (`it.each`, modèle
   l. 178-190) ; la production sans la variable démarre avec la version 1.

### T028 : `ClaimHasher.keyVersion` ; refus de démarrage

1. `claim-hash.ts` : le constructeur prend `Pick<AppConfig, 'claimCodeHmacKey' |
   'claimCodeKeyVersion'>` ; `get keyVersion(): number` en lecture seule. **Ne change ni les
   préfixes (`CASHLESS/CLAIM/v1`, `CLAIM-CONFIRM/v1`, `CLAIM-ADDR/v1`) ni l'HMAC** : la clé change à
   la rotation, pas la construction. L'en-tête dit que `ClaimHasher` reste le seul lecteur du
   secret.
2. Refus de démarrage : exporte de `claim-hash.ts` une fonction pure
   `assertClaimKeyVersion(configured: number, known: number): void` (lève `Error` : «
   CLAIM_CODE_HMAC_KEY_VERSION=<v> inférieure à la version <m> connue de la base : une rotation ne
   se défait pas, démarrage refusé » ; égale ou supérieure : passe). **Le point d'appel n'est pas
   `processes/bootstrap.ts`** (WP10 le possède) : `ClaimsService` (module servi par l'API publique)
   implémente `OnModuleInit` et lit `SELECT claim_key_version_max() AS v` par
   `this.tx.unscoped(...)`, puis appelle la fonction pure. Une erreur d'`onModuleInit` fait échouer
   `app.init()` : démarrage refusé.
3. Tests : unitaire de `assertClaimKeyVersion` (inférieure refuse, égale et supérieure passent, 0 de
   la base passe) et de `keyVersion` dans `config.spec.ts` (le fichier de `kms-module.spec.ts` n'est
   pas à toi) ; intégration (T032) : API démarrée avec la version 1 sur une base qui connaît la 2 :
   `app.init()` rejette.

Validation : `npx tsc -p tsconfig.json --noEmit` ; le `Pick` élargi casse `new ClaimHasher(...)`
dans les tests hors carte (voir « Retouches »).

### T029 : `claims.service.ts` et consultation anonyme versionnés

1. `claim()` : `claim_media($1, $2, $3, $4, $5, $6)` avec `this.hasher.keyVersion` en sixième ;
   `CONFIRM_SQL` (l. 54) : `confirm_media_claim($1…$6)`, la version en sixième, ajoutée au tableau
   de `decide` (l. 296).
2. `confirm()` : la lecture **directe** l. 276-281 devient `WHERE m.claim_code_hash = $1 AND
   m.claim_key_version = $2` ; les demandes en attente l. 284-287 ajoutent `AND key_version = $2`
   (une demande en attente née sous l'ancien secret n'est ni confirmée ni comptée : réponse d'un
   code inconnu, `claimInvalid()`).
3. `lookup()` : `public_balance_lookup($1, $2, $3)` avec la version. `addressRef` ne change pas
   (compteurs d'adresse remis à zéro à la rotation : accepté, `plan.md` IC-03).
4. `customerMedia()` : lire `printed_number` en base et le rendre (`null` si NULL) ; le type
   `CustomerMedia` de `claims.dto.ts` l. 54 (`printed_number: null`) devient `string | null`
   (**retouche hors carte**).

Pièges : (a) un `SELECT … WHERE claim_code_hash` oublié dans un autre fichier de `src/media` :
`grep -rn "claim_code_hash" apps/api/src` doit ne rendre que des lectures filtrées par version ; (b)
le même travail pour tous les chemins (NFR-007, `claims.service.ts` l. 78-82) : n'ajoute aucune
branche qui fasse une requête de moins pour un code d'ancienne version.

### T030 : `claim-codes.service.ts` : commande, import à trois colonnes, deux motifs

1. `issueOrder` : `issue_claim_codes($1, $2::bytea[], $3)` avec la version. Le contrôle de collision
   de `draw` (`claim_code WHERE code_hash = ANY`) ne change pas.
2. `ASSOCIATION_REASONS` : ajouter `BAD_PRINTED_NUMBER` et `PRINTED_NUMBER_TAKEN` (en fin de liste).
3. `associate()` : `fields.length` vaut 2 ou 3 (sinon `MALFORMED_LINE`). Troisième champ : vide =
   absent (`null`) ; sinon majuscules (`toUpperCase()`), `^[A-Z0-9-]{1,32}$` sinon
   `BAD_PRINTED_NUMBER` (avant tout accès à la base). `associate_claim_code($1, $2, $3, $4)` avec
   numéro (ou `null`) et version. Erreur `CL065` (ou `23505` sur l'index du numéro) : motif
   `PRINTED_NUMBER_TAKEN` ; les `CL020` et `23505` existants gardent leur traitement (relecture du
   motif).
4. `refusal()` : `claim_code` lu avec `AND key_version = $2` ; un bracelet qui a déjà un code **de
   la version courante** (`claim_key_version = $version`) : `MEDIA_ALREADY_HAS_CODE` ; un bracelet
   au code d'**ancienne version** accepte un nouveau code (la base remplace, interface WP02). Lire
   donc `claim_key_version` avec `claim_code_hash`.

**Mutation** : retire la mise en majuscules du numéro imprimé : le test d'une ligne `fs26-004812`
échoue.

### T031 : `personalization.service.ts`

1. `register_personalized_media` est **inchangée** : n'y touche pas.
2. `associateClaimCode` : `hash` calculé comme avant ; la lecture du bracelet l. 280-296 prend aussi
   `claim_key_version` : un bracelet au code d'ancienne version n'est plus « déjà porteur d'un code
   » (il en accepte un nouveau) ; un code identique de la version courante reste `REPLAYED`.
   `refusal` : `claim_code` lu avec la version ; `associate` :
   `associate_claim_code($1, $2, NULL, $3)` (pas de numéro imprimé ici).


### T032 : intégration `media/claim-rotation.spec.ts`

Monde : `createMediaWorld`, lot `PUBLIC`, bracelets avec code (modèle `claims.spec.ts` l. 60-100,
avec `claim_key_version = 1`). Rotation simulée : une seconde application créée après avoir posé
`process.env.CLAIM_CODE_HMAC_KEY` (autre secret de 32 octets) et `CLAIM_CODE_HMAC_KEY_VERSION=2`,
puis restauration de l'environnement dans `finally`.

1. Un code de la version 1 : rattachement (`claimMedia`) refusé après la rotation, **même statut,
   même corps** que pour un code inconnu ; compteur d'essais identique ; consultation anonyme :
   `404` comme pour un code inconnu ; confirmation au guichet d'une demande née en version 1 :
   `claimInvalid`.
2. Un code posé en version 2 (`claim_key_version = 2`) rattache normalement ; solde lu par la
   consultation anonyme.
3. Import : un bracelet au code de la version 1 accepte une ligne `code,uid` de la version 2
   (`accepted: 1`) ; un bracelet déjà au code de la version courante : `MEDIA_ALREADY_HAS_CODE` ;
   ligne à trois colonnes : numéro imprimé posé ; ligne à deux colonnes : inchangée ;
   `BAD_PRINTED_NUMBER`, `PRINTED_NUMBER_TAKEN` (même numéro sur un second bracelet du même
   prestataire) ; même numéro chez un autre prestataire accepté.
4. Démarrage refusé : version 1 sur une base qui contient la 2 (`app.init()` rejette), puis version
   2 démarre.
5. NFR-002 (comptages limités au prestataire de l'essai) : recherche d'un code en clair (celui des
   assertions) dans `audit_log`, `api_idempotency` et les colonnes texte des tables du prestataire
   de l'essai : 0 occurrence.

**Mutations obligatoires** (note de lane) : (a) retire `AND m.claim_key_version = $2` de `confirm()`
: le test 1 (confirmation) échoue ; (b) passe `1` en dur à `claim_media` : le test 1 échoue après
rotation ; (c) retire `assertClaimKeyVersion` de `onModuleInit` : le test 4 échoue ; (d) retire la
lecture de `claim_key_version` dans `refusal` : le test 3 (bracelet d'ancienne version) échoue.


## Retouches hors carte à nommer dans la note de lane

- `apps/api/src/media/claims/claims.dto.ts` l. 54 : type `printed_number` en `string | null`.
- Appelants des cinq fonctions versionnées : cherche-les par grep ; seuls des commentaires de tests
  les citent par nom. Les pgTAP (`packages/ledger-sql/tests`) sont à WP02. Les fixtures qui posent
  `claim_code_hash` ne changent pas (pas de `CHECK`).

```
grep -rnE "issue_claim_codes|associate_claim_code" apps tools
grep -rnE "claim_media\(|confirm_media_claim|public_balance_lookup" apps tools
```

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP04 (donc WP01 à WP03).
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP07 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Commandes de preuve

```
cd <lane>/apps/api
export PGDATABASE=cashless_wp07; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/unit/config.spec.ts test/integration/media/claim-rotation.spec.ts \
  test/integration/media/claims.spec.ts test/integration/media/claim-code-order.spec.ts \
  test/integration/media/personalization.spec.ts --runInBand --forceExit
npx eslint <tes fichiers> && npx tsc --noEmit -p tsconfig.json
```

## Definition of Done

- [ ] `grep -rn "claim_code_hash" apps/api/src` : aucune lecture sans filtre de version ; cinq
  appels versionnés.
- [ ] Configuration (dont `claimAdminSettings`) et tests ; `ClaimHasher.keyVersion` ; démarrage
  refusé prouvé (test 4).
- [ ] Import à deux et trois colonnes, deux motifs nouveaux ; `printed_number` lu par
  `customerMedia`.
- [ ] Quatre mutations vérifiées et consignées ; NFR-002 prouvé.
- [ ] Note de lane : retouches hors carte listées, écarts éventuels à `interfaces.md`.
- [ ] Lignes de 100 caractères au plus ; `eslint` et `tsc` propres.

## Risks

1. Un chemin de lecture oublié accepte un ancien code, ou répond autrement (durée, corps) : oracle
   d'énumération (NFR-007).
2. `EXECUTE` manquant (`42501`) : ne jamais l'accorder pour faire passer un test.

## Ce que le relecteur doit casser

- Rattacher, confirmer, consulter avec un code de l'ancienne version après rotation : réponse
  identique à un code inconnu (corps, statut, en-têtes, nombre de requêtes de la base).
- Démarrer avec une version inférieure à celle de la base ; avec `0`, `32768`, `abc`.
- Importer un fichier à deux, trois et quatre colonnes ; un numéro imprimé en minuscules, trop long,
  déjà pris.
- Chercher un code en clair en base, audit, idempotence ; chercher un `claim_code_hash` lu sans
  version.
- Retirer chaque contrôle de la liste des mutations et vérifier que le test échoue.
