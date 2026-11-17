---
work_package_id: WP01
title: Contrat et utilitaires communs
dependencies: []
requirement_refs:
- C-002
- FR-011
- FR-013
- FR-017
- FR-022
- FR-023
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003, T004, T005, T006]
phase: Phase 1 - Fondations
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/contracts/
create_intent: [apps/api/src/common/csv.ts, apps/api/src/common/iban.ts, apps/api/test/unit/common/csv.spec.ts, apps/api/test/unit/common/iban.spec.ts, apps/api/test/unit/contracts/contract-additions-9b.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [packages/contracts/openapi.yaml, packages/contracts/generated/**, packages/contracts/dart/**, apps/api/src/errors/sqlstate-map.ts, apps/api/src/common/csv.ts, apps/api/src/common/iban.ts, apps/api/test/unit/common/csv.spec.ts, apps/api/test/unit/common/iban.spec.ts, apps/api/test/unit/contracts/contract-additions-9b.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 : Contrat et utilitaires communs

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-9b/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/contract-additions.md` en entier : c'est la **liste validée par le porteur**
  (17/11/2026) ;
- `contracts/interfaces.md` : section « TypeScript » (lignes `Csv`, `isValidIban`) ;
- `research.md` R-14, R-10, R-15 ; `spec.md` C-002 ;
- `packages/contracts/openapi.yaml` : intro l. 10-15 et 165-166 (`humanBearer`), `IdempotencyKey` l.
  11103-11135 (liste des routes non rejouées l. 11118-11122), `Cursor`/`Limit` l. 11216-11232,
  `PageMeta` l. 11986-11995, `Problem` l. 11674-11713, `ProblemCode` l. 11751+ (puces de statut) et
  enum l. 11889+, `ApprovalAction` l. 15787, `ApprovalRequestAccepted` l. 11581, `StatusCondition`
  l. 17307-17330, `postLateClaim` l. 6457-6513 (modèle d'une route `202`), `LateClaimRequest` l.
  15690-15726, `issueClaimCodeOrder` l. 10347-10381 (modèle `text/csv` en sortie),
  `RefundRequestCreate` l. 16232-16275 ;
- `apps/api/src/errors/sqlstate-map.ts` l. 25-90, `apps/api/test/unit/errors/sqlstate-map.spec.ts`
  l. 20-90 ;

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `contract-additions.md`
fait foi.

## Objective

Écrire dans `openapi.yaml` **exactement** les ajouts de `contract-additions.md` (20 opérations, 19
schémas, 3 codes de condition, 1 code d'erreur) sans rien modifier d'existant ; régénérer les types
TypeScript et Dart ; poser `CL055` dans la table SQLSTATE ; livrer `csv.ts` et `iban.ts`, partagés
par les lots suivants. Un test prouve par diff qu'aucune opération, aucun chemin, aucun champ ni
aucune valeur d'enum existants n'ont changé.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP01 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Fichiers : uniquement ceux d'`owned_files`. Aucune migration, aucun service, aucun contrôleur :
  les routes sont **déclarées** au contrat, servies par les lots suivants.
- **Rien de plus, rien de moins** que `contract-additions.md` : si un champ te manque pour écrire un
  schéma, tu le signales (compte rendu), tu n'inventes pas. Aucune route d'envoi de paiement, aucune
  route d'alerte, aucun PDF (§5 du fichier).
- Conventions du contrat (rapport C §6), à suivre pour chaque opération : `x-process: public`,
  `tags`, `operationId`, `summary`, `description` qui nomme le rôle exigé, `parameters` par `$ref` ;
  sécurité héritée de `humanBearer` (ne rien ajouter) ; erreurs en `Problem`
  (`application/problem+json`, réponses partagées de `components/responses`) ; pagination
  `Cursor`/`Limit` et réponse `allOf: [PageMeta, {data: [...]}]` ; `Idempotency-Key` par `$ref` sur
  toute écriture. Les opérations en lecture n'ont pas cet en-tête.
- Chemins : `/operators/{operator_id}/…` pour la gestion, `/ledgers/{ledger_id}/…` pour les routes
  servies à partir de la session ; ne mélange pas. Le chemin de la ligne 18 porte deux méthodes
  (`GET` et `POST`).
- Piège Dart : **aucun `oneOf` de `$ref`** dans un schéma nouveau (corps `{transaction_id}` ou
  `{anomaly_id}` de `StatementLineMatch` : deux champs optionnels et une règle en description, pas
  un `oneOf`). Le modèle exclu de `generate-dart.sh` ne doit pas s'allonger.
- `StatusCondition.code` est un `type: string` dont la **description** énumère les codes (pas un
  `enum`) : ajoute les trois codes à la description et passe `PSP_RECONCILED` de la liste `EXTERNAL`
  à une liste « calculée » ; ne change pas le type, n'ajoute pas d'`enum`. Signale l'écart de
  vocabulaire du fichier.
- Hors carte (une ligne chacune au compte rendu) : `apps/api/test/unit/errors/sqlstate-map.spec.ts`.
  Sa `TABLE` est exacte (« la table ne contient que les lignes du contrat ») : sans la ligne
  `CL055`, la suite échoue. Ajoute seulement `['CL055', 'PAYOUT_EXCEEDS_ENTITLEMENT', 409]` dans le
  bloc « mission 9b ».
- Aucune dépendance : `yaml` (déjà dépendance de `@cashless/contracts` et utilisée par
  `contract-schema.ts`) suffit au test de non-régression ; CSV et IBAN s'écrivent à la main.

## Subtasks

### T001 : `openapi.yaml`, opérations, schémas, enum, code

But : déclarer au contrat tout ce que `contract-additions.md` liste, rien d'autre.

1. Les 20 `operationId` des sections 1 de `contract-additions.md` : `listEventClosingSteps`,
   `previewEventClosingStep`, `executeEventClosingStep`, `getEventRemainingBalances`,
   `listPayoutEntitlements`, `requestPayoutBatch`, `listPayouts`, `exportPayoutBatch`,
   `confirmPayout`, `importAccountStatement`, `listStatementLines`, `matchStatementLine`,
   `getLedgerReconciliation`, `postLateAdjustment`, `createRefundRequest`, `getPartyStatement`,
   `getMyWalletStatement`, `listAccountMappings`, `createAccountMappingVersion`, `exportAccounting`.
   Méthode, chemin, rôle, réponse : le tableau fait foi.
2. Les 19 schémas de la section 2 (`ClosingStep` enum de 7 valeurs dans l'ordre du fichier, etc.).
   Les champs se déduisent de `data-model.md` (colonnes), `research.md` (R-03, R-06, R-08, R-14) et
   de `interfaces.md`. Montants en entiers (`int64`, plus petite unité), dates en
   `date`/`date-time`, identifiants `uuid`. `Payout` ne porte **jamais** l'IBAN ni le numéro en
   clair (ils ne sortent que du CSV de la route 8).
3. Réponses `text/csv` : routes 4 (`format=csv`), 8, 10 (corps), 16 (`format=csv`), 17, 19. Route 19
   : en-tête de réponse `X-Unmapped-Count` documenté. Route 8 et les autres lectures CSV sont **non
   rejouées** : ajoute `exportPayoutBatch` (et toute route CSV sans réponse conservée) à la liste de
   la description du paramètre `IdempotencyKey` (l. 11118-11122), sans toucher au reste de ce texte.
4. `StatusCondition.code` : voir « Périmètre ». `ProblemCode` : valeur `PAYOUT_EXCEEDS_ENTITLEMENT`
   dans l'enum ET puce « - `PAYOUT_EXCEEDS_ENTITLEMENT` (409, `CL055`) : sens » dans la description
   (le générateur lit le statut entre parenthèses ; une puce manquante fait échouer la génération).
5. Les actions `PAYOUT`, `LATE_CLAIM`, `ADJUSTMENT` et le code `CLOSING_CONDITION_NOT_MET` existent
   déjà : ne les redéclare pas.

### T002 : régénération TS et Dart

- `npm run generate -w @cashless/contracts`, puis `npm run generate:dart -w @cashless/contracts` (si
  le SDK Dart manque en local, dis-le au compte rendu : la CI l'impose). Commite `generated/**` et
  `dart/**`.
- `npm run check -w @cashless/contracts` doit être vert, puis `npm run typecheck -w
  @cashless/contracts`.
- Aucune édition à la main des fichiers générés.

### T003 : test de non-régression du contrat

`apps/api/test/unit/contracts/contract-additions-9b.spec.ts` (Jest, sans base). Le test lit le
contrat de la base de la mission par `git show b537c16d:packages/contracts/openapi.yaml` (fin de la
9a, constante nommée `BASE_COMMIT` en tête du fichier) via `child_process.execFileSync`, et celui du
worktree, tous deux avec `yaml`. Il prouve :
1. tout `operationId` de la base existe encore, avec la **même méthode et le même chemin** ;
2. tout chemin de la base existe encore, et toute méthode de ce chemin ;
3. pour chaque schéma de la base : toutes les propriétés, tous les `required`, tous les `enum`
   existants sont conservés à l'identique (`enum` : la base est un sous-ensemble ordonné du nouveau,
   seuls les ajouts listés sont admis : `ProblemCode` + `PAYOUT_EXCEEDS_ENTITLEMENT`) ;
4. les ajouts sont **exactement** : les 20 `operationId`, les 19 schémas, la valeur de
   `ProblemCode`, et les trois codes dans la description de `StatusCondition` (ensemble figé : un
   ajout de plus fait échouer) ;
5. aucun `oneOf` de `$ref` dans les schémas ajoutés ; toute opération ajoutée porte `x-process:
   public`.
Si `git show` échoue (checkout sans historique), le test échoue avec un message clair : pas de saut
silencieux.

### T004 : `sqlstate-map.ts` : `CL055`

- Ligne `CL055: { code: 'PAYOUT_EXCEEDS_ENTITLEMENT', status: 409 }` après `CL054`, commentaire «
  mission 9b, migration 0085 ». Aucun autre code. Retouche hors carte : la `TABLE` de
  `sqlstate-map.spec.ts` (voir plus haut).
- `generated/problem-statuses.ts` doit contenir la valeur après T002 : le test existant « statut
  conforme à la description » le vérifie.

### T005 : `common/csv.ts`

Interface figée (`interfaces.md`) : `Csv.write(rows, columns)` et `Csv.parse(text, columns)`. Crée
le dossier `apps/api/src/common/` (il n'existe pas encore). Écriture et lecture à la main, sans
bibliothèque.
- Écriture RFC 4180 : UTF-8, fin de ligne `CRLF`, champ entre guillemets s'il contient séparateur,
  guillemet ou saut de ligne, guillemet doublé. Séparateur : option `delimiter`, défaut `,`. Un BOM
  est une option (`bom: false` par défaut). Les colonnes déclarent `key`, `header` et `kind: 'text'
  | 'number'`.
- **Anti-injection** : pour tout champ `text` qui commence par `=`, `+`, `-`, `@`, tabulation ou
  retour chariot, préfixer d'une apostrophe `'`. Jamais pour un champ `number` (un montant négatif
  reste `-500`). Les en-têtes sont des constantes de code, jamais neutralisés.
- Lecture : même dialecte (guillemets, guillemets doublés, séparateur et sauts de ligne dans un
  champ), `CRLF` ou `LF`, BOM toléré, ligne finale vide ignorée, en-têtes exigés et dans l'ordre des
  `columns` ; erreur typée (numéro de ligne) sur un nombre de colonnes faux ou un guillemet non
  fermé : l'appelant la traduit en `422 VALIDATION_FAILED`. Aucune neutralisation à la lecture.
- Ambiguïté à signaler : `quickstart.md` importe avec `;`, RFC 4180 dit `,` : option `delimiter`.
- Tests `csv.spec.ts` : aller-retour, guillemets, virgule et saut de ligne dans un champ, injection
  (les quatre préfixes), nombre négatif intact, BOM, `CRLF`/`LF`, ligne mal formée, 10 000 lignes
  sans lenteur.

### T006 : `common/iban.ts`

Signatures figées : `isValidIban(value: string): boolean`, `normalizeIban(value: string): string`,
plus `maskIban(value: string): string` (ex. `SN08************3035` : code pays, deux chiffres de
contrôle et quatre derniers caractères visibles).
- `normalizeIban` : retire espaces et tirets, majuscules. Ne valide pas.
- `isValidIban` : normalise ; longueur par pays de la table ISO 13616 écrite en constante (registre
  complet, dont `SN`, `CI`, `FR`) ; pays inconnu : invalide ; caractères `[A-Z0-9]` ; **modulo 97
  calculé par morceaux** (sans `BigInt` obligatoire, sans dépendance) : déplacer les 4 premiers
  caractères à la fin, remplacer les lettres par 10 à 35, reste = 1.
- Tests `iban.spec.ts` : exemples officiels valides par pays, un chiffre changé, une transposition,
  longueur fausse, minuscules et espaces, pays inconnu, chaîne vide, `maskIban`. Le IBAN du test 9a
  `SN08SN0100152000048500003035` est valide (reste 1) : vérifie-le, WP11 le réutilisera.

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`) ; ces tests n'ont pas besoin de base, mais tout Jest suit la
fiche :

```bash
cd <lane>
npm run generate -w @cashless/contracts && npm run check -w @cashless/contracts
npm run typecheck -w @cashless/contracts
cd apps/api
export PGDATABASE=cashless_wp01; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/unit/common test/unit/contracts test/unit/errors \
  --runInBand --forceExit
npm run typecheck -w @cashless/api
```

Preuves à citer : C-002 (test de non-régression vert, ensemble d'ajouts exact) ; FR-011, FR-013
(CSV) ; FR-017 (IBAN) ; `check` du contrat vert.

## Definition of Done

- [ ] Les 20 opérations, 19 schémas, 3 codes de condition et le code `PAYOUT_EXCEEDS_ENTITLEMENT`
      sont au contrat, et seulement eux ; routes non rejouées ajoutées à la liste de
      `IdempotencyKey`.
- [ ] Types TS et Dart régénérés, `check` vert ; aucun `oneOf` de `$ref` ajouté.
- [ ] Test de non-régression (base `b537c16d`) vert et strict sur l'ensemble des ajouts.
- [ ] `CL055` dans `sqlstate-map.ts` et dans la `TABLE` du test ; suite `sqlstate-map` verte.
- [ ] `csv.ts` (RFC 4180, anti-injection) et `iban.ts` (mod 97, masque) testés ; aucune dépendance
      ajoutée.
- [ ] Compte rendu : retouche hors carte, écart de vocabulaire de `StatusCondition`, ambiguïté du
      séparateur.

## Ce que le relecteur doit casser

- Un `operationId`, un chemin, un champ, un `required` ou une valeur d'enum existants modifiés ou
  retirés : fais un diff à la main de `git show b537c16d:packages/contracts/openapi.yaml`, ne te fie
  pas au test.
- Un ajout hors de `contract-additions.md` (champ, route, code, 20e schéma) ; un `oneOf` de `$ref`.
- `Payout` ou un autre schéma de lecture qui expose l'IBAN ou le numéro ; un schéma d'écriture sans
  `Idempotency-Key` ; une lecture CSV rejouée par erreur.
- CSV : `=cmd|' /C calc'!A0`, `+1`, `-1`, `@SUM(A1)`, tabulation en tête ; champ avec guillemet et
  saut de ligne ; montant négatif dénaturé ; fichier tronqué ; en-tête manquant ou dans le désordre.
- IBAN : `SN08 SN01 0015 2000 0485 0000 3035` (espaces), minuscules, longueur 27 ou 29, pays
  inconnu, deux chiffres de contrôle faux (`00`, `01`, `99`), caractère non alphanumérique, reste de
  97 égal à 1 mais pays hors table.
- Un fichier généré modifié à la main ; une dépendance ajoutée.

## Fichiers à faire relire par une personne

- `apps/api/src/common/iban.ts` (validation ISO 13616 : table des longueurs et modulo 97).
- `apps/api/src/common/csv.ts` (écriture RFC 4180 et neutralisation des formules).
- `packages/contracts/openapi.yaml` : rôles exigés par opération et absence de champ sensible dans
  les schémas de lecture (IBAN, numéro).
