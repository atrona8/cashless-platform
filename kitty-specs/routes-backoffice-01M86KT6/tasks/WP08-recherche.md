---
work_package_id: WP08
title: Recherche
dependencies: [WP01, WP03, WP05]
requirement_refs:
- FR-011
- FR-012
- FR-013
- FR-014
- FR-017
- FR-018
- NFR-001
- NFR-003
- NFR-004
- NFR-006
- SC-003
- SC-004
planning_base_branch: feat/routes-backoffice
merge_target_branch: feat/routes-backoffice
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/routes-backoffice. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/routes-backoffice unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-routes-backoffice-01M86KT6
base_commit: 8b2d8c483ec92f2eef984ed13d3c5aab1ac930b8
created_at: '2026-11-25T09:56:31.261942+00:00'
subtasks: [T029, T030, T031, T032, T033]
phase: Phase 2 - Routes
agent: claude
history:
- timestamp: '2026-11-24T13:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/search/
create_intent:
- apps/api/src/search/search.controller.ts
- apps/api/src/search/search.service.ts
- apps/api/src/search/search.dto.ts
- apps/api/src/search/phone-mask.ts
- apps/api/src/search/search-rate-limit.ts
- apps/api/src/search/search.module.ts
- apps/api/test/integration/backoffice/search.spec.ts
- apps/api/test/integration/backoffice/search-customer.spec.ts
- apps/api/test/integration/backoffice/search-rate-limit.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/search.cases.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/search/**
- apps/api/src/media/media-public.module.ts
- apps/api/test/integration/backoffice/search*.spec.ts
- apps/api/test/integration/end-to-end/backoffice-isolation-cases/search.cases.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 : Recherche

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-11b/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` §1, §2 (WP01 : index de débit sur `audit_log`), §3 (rôles des trois opérations), §4 (`maskPhone`,
  limite de débit, actions d'audit), §5 ; `contracts/backoffice-routes.md` A5 ; `research.md` D7, D8 ;
  schémas `MediaSearchResult`, `WalletOverview`, `CustomerSearchRequest`, `CustomerSearchResult` d'`openapi.yaml` (WP03) ;
- `apps/api/src/kms/claim-hash.ts` (`ClaimHasher.claimCodeHash`, l. 16-40 : empreinte du code imprimé ; **jamais** pour
  le numéro, D7) ; `apps/api/src/media/media-public.module.ts` (où inscrire `SearchModule`) ; la lecture d'un bracelet
  et d'un portefeuille existante (chercher `wallet_id` dans `apps/api/src/media/`) et le calcul des soldes
  (`payments/payment-read.service.ts`) ;
- limite de débit maison adossée à la base : `apps/api/src/devices/enrollment/enrollment.service.ts` l. 255-275
  (`checkLimits`, `RATE_LIMITED`, `Retry-After`) ;
- `apps/api/src/audit/audit.service.ts` (`AuditService.record`, `STAFF_CUSTOMER_SEARCH` et
  `STAFF_CUSTOMER_SEARCH_RATE_LIMITED` ajoutées par WP05) ; `identity/scope-resolver.ts` ;
- `test/integration/end-to-end/backoffice-isolation-cases/staff-profile.cases.ts` ; pour la réattribution d'un bracelet,
  `test/integration/media/` (chercher `release` ou `reassign`).

## Objective

Trois recherches du personnel : un bracelet (UID ou code imprimé), un portefeuille, un festivalier par numéro exact. Le
numéro n'est jamais dans une URL, une réponse en clair, une ligne d'audit ni un journal.

## Subtasks

### T029 — `searchMedia` (UID, code imprimé)

`GET /search/media?nfc_uid=…` ou `?printed_code=…` : un seul des deux (aucun ou les deux : `422`). UID : 7 octets en
hexadécimal, comparé à `media.nfc_uid` ; code imprimé : `claimCodeHash` puis comparaison à `media.claim_code_hash`
(même normalisation que le rattachement). Rôles : `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`,
`MERCHANT_ADMIN`. Portée dans la requête : l'événement du bracelet appartient à la portée de l'appelant (organisateur,
événement ; pour `MERCHANT_ADMIN` et `CASHIER`, voir `interfaces.md` §3 et le contrôle existant le plus proche). Liste de
0 ou 1 élément ; hors portée ou autre prestataire = liste vide, identique à « inconnu ». Réponse : soldes
(`paid_balance`, `promo_balance`, `deposit`), `printed_number`. Le code imprimé reçu n'est ni journalisé ni audité.
Mutation : portée retirée ; comparaison par préfixe (`LIKE`) au lieu d'égalité.

### T030 — `getWalletOverview`

`GET /search/wallets/{wallet_id}` : soldes, statut, bracelets (`media_id`, `status`, `printed_number`), `customer_ref`
masqué (un identifiant opaque dérivé, jamais le numéro ni le nom). Rôles : `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`,
`SUPERVISOR`, `CASHIER`. Portefeuille hors portée ou d'un autre prestataire : `404`. Même forme que les
`wallets[]` de T031 : une seule fonction de construction partagée dans `search.service.ts`.

### T031 — `searchCustomerByPhone`

1. `POST /search/customers`, corps `{ phone }`, **E.164 strict** (`^\+[1-9]\d{7,14}$`) ; tout autre format, préfixe,
   joker ou espace : `422 VALIDATION_FAILED` sans écrire le numéro dans le message ni le journal. Rôles :
   `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR` ; `PLATFORM_ADMIN`, `CASHIER`, `VENDOR`, `MERCHANT_ADMIN` : `403`
   (`PLATFORM_ADMIN` retiré par l'orchestrateur le 24/11/2026 : renforcement, une recherche hors prestataire porterait
   sur tous les prestataires ; à noter dans la note de lane).
2. Égalité exacte sur `customer_identity.phone` (prestataire de la RLS), puis restriction **dans la requête** aux
   portefeuilles dont l'événement est dans la portée de l'appelant (test : un `PLATFORM_ADMIN` reçoit `403`).
3. `maskPhone` (`phone-mask.ts`, §4) : `maskPhone('+221771234512') === '+221 77 *** ** 12'`, autre format : indicatif +
   étoiles + 2 derniers chiffres ; tests unitaires, dont un numéro court et un numéro d'un autre pays. La réponse ne
   contient que `masked_phone` et `wallets[]`.
4. Audit `STAFF_CUSTOMER_SEARCH` dans la même transaction : auteur, rôle exercé, portée, nombre de résultats,
   identifiants des clients trouvés ; **ni numéro, ni empreinte, ni préfixe** (D7). Écrit aussi quand il y a 0 résultat.
5. Mutation : le numéro (ou son masque) ajouté à l'audit fait échouer T033 ; l'audit retiré fait échouer « 100 % des
   recherches laissent une trace » (SC-004).

### T032 — Limite de débit et refus audités

Compter en base (jamais en mémoire : multi-instance, D8) les lignes `STAFF_CUSTOMER_SEARCH` de l'auteur sur les 60
dernières secondes glissantes, en s'appuyant sur l'index `audit_log (actor_id, action, occurred_at)` de WP01. Seuil :
variable `STAFF_PHONE_SEARCH_PER_MINUTE` (défaut 20), lue par la configuration existante (cherche comment
`enrollment.service.ts` lit ses seuils ; si une variable nouvelle doit entrer dans le schéma de configuration de
l'application, c'est une retouche hors carte nommée ci-dessous). Au-delà : écrire `STAFF_CUSTOMER_SEARCH_RATE_LIMITED`
(mêmes champs, sans numéro) **dans une transaction qui survit au refus** (le refus lève après le `COMMIT` de l'audit),
puis `429 RATE_LIMITED` avec `Retry-After` en secondes (délai jusqu'à la sortie de la plus ancienne ligne de la
fenêtre, ≥ 1). Le décompte du refus ne compte pas les refus eux-mêmes. Contrôle fait **avant** la lecture du client.
Mutation : seuil `>` au lieu de `>=` (la 21e passe, ou la 20e est refusée : le test à 20/21 échoue) ; comptage par
prestataire au lieu de l'auteur (le test avec deux personnes échoue).

### T033 — Tests et cas d'isolement

`search.spec.ts`, `search-customer.spec.ts`, `search-rate-limit.spec.ts` : recette n° 4 de `quickstart.md` ; UID et code
imprimé rendent le même bracelet ; code ou UID d'un autre prestataire : liste vide ; numéro exact : deux portefeuilles,
masqué ; préfixe (`+22177`), numéro voisin, espace final : `422` ou vide ; `CASHIER`, `VENDOR`, `MERCHANT_ADMIN` : `403`
et **aucune ligne d'audit `STAFF_CUSTOMER_SEARCH` pour un refus de droit** ; portefeuille hors de l'événement de
l'appelant : absent ; **bracelet réattribué** : l'ancien code imprimé ne retrouve plus l'ancien portefeuille ; 20
recherches passent, la 21e rend `429` avec `Retry-After`, une ligne `…_RATE_LIMITED`, et une autre personne passe encore.
**Test du numéro** : après tout le scénario, relire en base toutes les lignes `audit_log` du prestataire de test
(`to_jsonb`) et capturer les journaux de l'application (sortie du logger du test) : le numéro en clair, sans `+`,
son masque et ses 6 derniers chiffres ne s'y trouvent nulle part. Parcours JSON de chaque réponse (NFR-006).
`backoffice-isolation-cases/search.cases.ts` : un cas par opération (3), **sans** modifier `registry.ts` (§5) ; mutation :
retirer un cas fait échouer `backoffice-isolation.spec.ts`. Latence : p95 < 500 ms sur `searchMedia` (NFR-001),
mesurée sur `cashless_wp08` avec 200 000 bracelets, hors passe parallèle (`SKIP_LATENCY`).

## Retouches hors carte permises

Une seule, si nécessaire et nommée dans la note de lane : le schéma de configuration de l'application
(`apps/api/src/config/`) pour `STAFF_PHONE_SEARCH_PER_MINUTE` ; sans valeur par défaut dangereuse, et avec un test qui
refuse une valeur non entière ou ≤ 0.

## Definition of Done

- [ ] Trois routes conformes ; aucun droit nouveau, aucun secret nouveau, aucun code d'erreur nouveau.
- [ ] `search*.spec.ts`, `backoffice-isolation.spec.ts`, `architecture.spec.ts`, `test/unit/contracts` verts.
- [ ] Mutations notées : audit avec numéro, seuil, portée, préfixe, cas retiré.

## Ce que le relecteur doit casser

- Le numéro (clair, masqué, empreinte, 6 derniers chiffres) dans une ligne d'audit, un journal d'accès, une URL ou un
  message d'erreur de validation.
- Une recherche partielle ou approchée qui rend un résultat ; un format non E.164 accepté.
- Un `CASHIER`, `VENDOR` ou `MERCHANT_ADMIN` qui obtient autre chose que `403` sur le numéro.
- La 21e recherche acceptée, une limite comptée en mémoire (redémarre le test avec deux instances de service), ou un refus
  de débit non audité.
- Un portefeuille d'un autre événement ou prestataire retrouvé par numéro ; un ancien code de bracelet encore valable.
- Le nom, le courriel ou le numéro en clair dans `getWalletOverview`.

## Implementation command

`LC_ALL=C LANG=C spec-kitty agent action implement WP08 --agent claude --mission routes-backoffice-01M86KT6`
