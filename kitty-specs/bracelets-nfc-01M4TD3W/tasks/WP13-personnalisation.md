---
work_package_id: WP13
title: 'Personnalisation : enregistrement d''un bracelet et association du code'
dependencies:
- WP11
- WP12
requirement_refs:
- FR-016
- FR-017
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T053
- T054
- T055
- T056
- T057
phase: 'Phase 4 - Bracelets'
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/personalization/
execution_mode: code_change
owned_files:
- apps/api/src/media/personalization/**
- apps/api/test/integration/media/personalization.spec.ts
- apps/api/test/support/media-fixtures.ts
create_intent:
- apps/api/test/integration/media/personalization.spec.ts
- apps/api/test/support/media-fixtures.ts
role: implementer
agent: claude
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 – Personnalisation : enregistrement d'un bracelet et association du code

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Enregistrer un bracelet personnalisé : calculer son mot de passe par le service de clés, le stocker chiffré, le rendre au poste sous enveloppe, associer le code imprimé.

## Context

Exigences : FR-016, FR-017, NFR-002, NFR-003, décisions de plan 3 et 4. Contrats : `contracts/openapi-additions.md` (poste), `contracts/tag-format.md`, `contracts/key-services.md`. Recherche : R-08. SPECIFICATION §7.3 à §7.5. Servi par le **processus de personnalisation** (`createTestApp({ process: 'personalization' })`). Ajoute `PersonalizationModule` à `media-personalization.module.ts` (retouche hors carte).

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : WP11, WP12. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP13 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T053 — Enregistrement

- `registerPersonalizedMedia` : rôle `PERSONALIZER` du prestataire du chemin (aucun autre rôle, pas même `OPERATOR_ADMIN`). Corps : lot, `token_hash` (32 o), `nfc_uid` (7 o), signature d'originalité (octets) et `signature_ok`, clé publique à usage unique du poste (P-256, 65 o).
- Déroulé, dans `PersoTx` : lit le lot et la clé (index, référence KMS, version active de la clé de données) ; tire l'identifiant du bracelet ; `MacPort.generateMac(ref, derivationMessage(...))` → `PWD‖PACK` ; obtient le clair de la clé de données (voir T suivant) ; `sealPwdPack` avec un nonce aléatoire et l'AAD du bracelet ; `register_personalized_media(...)` avec l'empreinte SHA-256 de la signature ; audit ; `sealForRecipient(clé du poste, PWD‖PACK, stationAad)` ; **mise à zéro** de `PWD‖PACK` et de la clé de données dans un `finally`.
- Réponse : identifiant du bracelet, index de clé, enveloppe. Jamais le mot de passe en clair, ni dans la réponse, ni dans un journal, ni dans l'audit.

### T054 — Clé de données de session

- Le processus de personnalisation n'a **pas** le droit `decrypt` (§3.2). **Décision du porteur n° 7** : il scelle sous une clé de données de session, fournie par `SessionDataKeyProvider.get(prestataire, index)` (WP11) : identifiant de version et clair, valables tant que la version est `ACTIVE`.
- `register_personalized_media` refuse une clé de données qui n'est plus la version active (WP05) : sur ce refus, redemande une clé au fournisseur et réessaie **une** fois ; un second refus est une erreur 409.
- Ne donne jamais `decrypt` à ce processus et ne garde le clair de la clé de session nulle part ailleurs que dans le fournisseur.

### T055 — Refus et idempotence

- Refus : signature déclarée invalide (422), lot d'un autre prestataire (404), quantité atteinte (409), clé ou clé de données non active (409), UID ou identité déjà connus (409), clé publique mal formée (400), service de clés indisponible (503, rien d'enregistré).
- Idempotence : la réponse n'est **pas** conservée (elle porte une enveloppe). Rejeu avec la même clé d'idempotence et le même UID : le bracelet existe → rend son identifiant et une enveloppe recalculée pour la clé présentée, sans second bracelet (prouvé par un test).

### T056 — Association du code scanné

- `associateClaimCode` : normalise, empreinte, `associate_claim_code` ; code inconnu, d'un autre lot ou déjà associé → même 422 générique côté poste (le détail va à l'audit, sans le code).
- Lot `STAFF` ou `VIP` : 409 (ces lots n'ont pas de code).

### T057 — Jeu de test partagé et tests

- `test/support/media-fixtures.ts` : fabrique réutilisée par les lots suivants — prestataire, organisateur, événement `LIVE`, clé et clé de données (faux KMS), lot `ACTIVE`, `n` bracelets personnalisés (par la route quand c'est possible, sinon par insertion directe avec le faux KMS pour les gros volumes), terminal factice avec sa paire de clés.
- `personalization.spec.ts` : le mot de passe ouvert par le poste est celui du vecteur du kit (clé de test, UID du vecteur) ; le chiffré stocké se rouvre en la même valeur ; chaque refus ; rejeu ; rôle ; isolation ; compteur du faux KMS (1 `generateMac` par bracelet) ; recherche du mot de passe en clair dans la base et les journaux → absent.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

Lint, types et Jest verts ; le mot de passe n'existe en clair qu'en mémoire du processus de personnalisation, le temps de la requête ; la clé de données de session n'existe en clair que dans le fournisseur, 5 minutes au plus sans activité. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Ce lot porte l'opération la plus sensible de la mission. La clé de données de session (décision n° 7) est le compromis retenu pour ne donner aucun droit de déchiffrement à ce processus : ne l'élargis pas. **Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.
