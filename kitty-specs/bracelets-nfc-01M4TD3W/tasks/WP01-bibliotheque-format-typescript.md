---
work_package_id: WP01
title: Bibliothèque de format en TypeScript (`@cashless/tag-format`)
dependencies: []
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-004
- FR-005
planning_base_branch: feat/bracelets-nfc
merge_target_branch: feat/bracelets-nfc
branch_strategy: Planning artifacts for this mission were generated on feat/bracelets-nfc. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/bracelets-nfc unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
- T005
- T006
phase: Phase 1 - Socle
history:
- timestamp: '2026-10-13T12:05:28Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/tag-format/src/
create_intent: []
execution_mode: code_change
owned_files:
- packages/tag-format/package.json
- packages/tag-format/tsconfig.json
- packages/tag-format/jest.config.cjs
- packages/tag-format/src/**
- packages/tag-format/test/**
- packages/tag-format/vectors/**
- packages/tag-format/scripts/**
- package.json
- package-lock.json
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP01 – Bibliothèque de format en TypeScript (`@cashless/tag-format`)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan`. Lis ensuite `README.md` (kit), `docs/SPECIFICATION.md` (sections citées ci-dessous), puis `kitty-specs/bracelets-nfc-01M4TD3W/spec.md`, `plan.md`, `research.md`, `data-model.md` et les contrats cités. En cas de contradiction entre sources, applique la règle de priorité de SPECIFICATION §0.3 et **signale-la** ; ne modifie jamais un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Livrer la bibliothèque de format du serveur, conforme à l'octet près aux vecteurs du kit, et figer ces vecteurs en JSON pour les deux langages.

## Context

Exigences : FR-001 à FR-005, NFR-001, C-003. Contrat : `contracts/tag-format.md`. Référence : `packages/tag-format/vecteurs_test_bracelet.py` (kit, **jamais modifié**), SPECIFICATION §7.2 à §7.4, §7.8. Aucune dépendance npm nouvelle : `node:crypto` et `node:zlib` seulement.

**Règle de sécurité du projet (`CLAUDE.md`, C-011)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder** ; continue le reste. Un renforcement se fait, puis se consigne.

## Branch Strategy

Planification et merge sur `feat/bracelets-nfc`. Dépendances : aucune. L'espace de travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande : `spec-kitty agent action implement WP01 --agent claude --mission bracelets-nfc-01M4TD3W`.

## Subtasks

### T001 — Workspace et vecteurs figés

- Ajoute `packages/tag-format` aux `workspaces` du `package.json` racine ; `package.json` du paquet (`@cashless/tag-format`, privé, scripts `typecheck`, `test`, `vectors`), `tsconfig.json` étendant `tsconfig.base.json`, `jest.config.cjs` sur le préréglage commun.
- `scripts/export_vectors.py` : importe ou rejoue `vecteurs_test_bracelet.py` et écrit `vectors/vectors.json` (format B, CRC de contrôle, message de dérivation, `PWD`, `PACK`, AAD, `pwd_pack_enc`). Le JSON est **produit par le script**, pas recopié ; un test compare le fichier commité à une régénération quand `python3` et `cryptography` sont présents (sinon il est ignoré avec un message).
- Ajoute au JSON une section `refusals` écrite à la main : majeur 2, CRC faux, longueur 27, AAD modifiée, chiffré de 33 octets, codes avec `0`, `1`, `I`, `O`.
- Si le script du kit et le texte de §7 divergent, **signale-le** dans le compte rendu du lot (C-003) : le script fait foi.

### T002 — Format B 1.0 et CRC

- `src/format-b.ts` : `encodeFormatB({ keyIndex, identity })`, `decodeFormatB(bytes)`, `crc32IsoHdlc(bytes)`, `tokenHash(identity)`.
- Refus typés (`TagFormatError` avec `code`) : `BAD_LENGTH`, `UNKNOWN_MAJOR`, `BAD_CRC`, `BAD_KEY_INDEX`, `BAD_IDENTITY`. Un mineur > 0 est accepté ; les octets réservés non nuls sont acceptés en lecture (compatibilité ascendante) et toujours écrits à zéro.
- CRC par `zlib.crc32` (Node 22) ; contrôle `123456789` → `CBF43926`.

### T003 — Dérivation et enveloppe de stockage

- `src/kdf.ts` : `derivationMessage({ operatorId, keyIndex, uid })` (compteur `00000001`, label de 22 octets, `00`, contexte, `00000030`), `splitPwdPack(mac)` ; `uuidToBytes` strict (36 caractères).
- `src/envelope.ts` : `pwdPackAad(...)`, `sealPwdPack({ dek, nonce, pwdPack, aad })` → 34 octets, `openPwdPack({ dek, blob, aad })` → 6 octets ; refus `BAD_LENGTH`, `AUTH_FAILED`. Le nonce est un paramètre : la bibliothèque ne tire pas d'aléa pour le stockage, l'appelant le fournit (`randomBytes(12)`).
- Aucune fonction ne journalise ; les tampons de sortie sont des `Buffer` que l'appelant peut mettre à zéro.

### T004 — Enveloppe pour un appareil ou un poste

- `src/device-envelope.ts` : `sealForRecipient({ recipientPublicKey (65 o, P-256 non compressé), plaintext, aad })` → `{ alg: 'ECDH-ES+HKDF-SHA256+A256GCM', epk, nonce, ciphertext, tag }` ; `openForRecipient` (pour les tests et le faux terminal).
- AAD construites par `deviceAad(deviceId, uid)` = `"CASHLESS/PWDPACK/DEV/v1" || device_id || nfc_uid` et `stationAad(mediaId, uid)` = `"CASHLESS/PWDPACK/PERSO/v1" || media_id || nfc_uid`.
- Aligne les noms et encodages des champs sur le schéma `MediaAuthKeyResponse` du contrat (`packages/contracts/openapi.yaml`) : lis-le avant d'écrire. HKDF : sel vide, `info` = l'AAD ; documente ce choix dans le fichier si le contrat ne le fixe pas, et signale-le dans le compte rendu.

### T005 — Code de rattachement

- `src/claim-code.ts` : alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` ; `generateClaimCode(randomBytes)` par rejet (5 bits par caractère, sans biais), `normalizeClaimCode(input)` (retire tirets et espaces, met en majuscules, refuse tout autre caractère et toute longueur ≠ 10), `formatClaimCode` (`XXXX-XXXXXX`), `claimCodeUrl(domain, code)`.
- L'empreinte à clé n'est **pas** ici (secret serveur) : elle vit dans l'API (WP08).

### T006 — Tests

- Un fichier de test par module, piloté par `vectors/vectors.json` : chaque vecteur du kit, chaque refus, aller-retour sur 200 entrées aléatoires, uniformité grossière du tirage des codes (chaque caractère présent sur 10 000 tirages).
- `test/cross-impl.spec.ts` : écrit `vectors/cross-impl.json` (1 000 entrées tirées d'une graine fixe et leurs sorties) que la suite Dart recalculera (SC-001). Le fichier est commité ; le test vérifie qu'il est à jour.

## Test Strategy

Tests demandés par la spec (pgTAP par contrainte, intégration HTTP sur vraie base, isolation à deux prestataires, preuves de sécurité). Ordre de vérification : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test`. Ne jamais lancer pgTAP sur une base où Jest vient de tourner. Dans un worktree de lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`.

## Definition of Done

`npm test -w @cashless/tag-format`, `npm run lint`, `npm run typecheck` verts ; `vectors.json` reproduit par le script du kit ; aucun secret journalisé. Chaque sous-tâche est marquée par `spec-kitty agent tasks mark-status Txxx --status done --mission bracelets-nfc-01M4TD3W`. Le compte rendu du lot liste : écarts au plan (avec leur sens : renforcement ou non), retouches hors carte, points soumis au porteur.

## Risks / Reviewer guidance

Recopier les vecteurs à la main masquerait un écart avec le kit. L'enveloppe pour un appareil doit suivre le contrat existant, pas une invention.
