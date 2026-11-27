---
work_package_id: WP11
title: Commandes d'essai par service (contre le vrai service, hors production)
dependencies: [WP10]
requirement_refs:
- FR-014
- NFR-003
planning_base_branch: feat/adaptateurs-fournisseurs-choisis
merge_target_branch: feat/adaptateurs-fournisseurs-choisis
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/adaptateurs-fournisseurs-choisis. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/adaptateurs-fournisseurs-choisis unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-adaptateurs-fournisseurs-choisis-01M8BXJA
base_commit: ecc2e5a4f97b7368ad14942c8f5e08b8184645b8
created_at: '2026-11-26T16:37:41.637363+00:00'
subtasks: [T048, T049, T050, T051]
phase: Phase 3 - Garde, essais, consignation
agent: claude
history:
- timestamp: '2026-11-26T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/external-services/trial/
create_intent:
- apps/api/src/external-services/trial/main.ts
- apps/api/test/unit/external-services/trial/trial.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/external-services/trial/**
- apps/api/test/unit/external-services/trial/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 — Commandes d'essai par service (contre le vrai service, hors production)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-12b-1/fiche-implementation.md` (démarrage, règles, base de
données, fin d'implémentation : ne pas la recopier ici), ce prompt, puis seulement (`<M>` =
`kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA`) :

- `<M>/interfaces.md` §7, §8 ; `<M>/contracts/production-guard.md` §5 ; `<M>/research.md` R-12 ; `<M>/quickstart.md` ;
- les fabriques de WP10 (`psp.providers.ts`, `kms.module.ts`, `sealing.module.ts`) et les adaptateurs de WP05 à WP09 ;
- `src/cli/reissue-claim-codes.ts` (forme d'une commande hors Nest du dépôt).

## Objective

`npm run essai -w @cashless/api -- <service> [--sandbox]` exécute le parcours minimal du service contre le vrai
service, avec les identifiants posés par le porteur, et rend un compte rendu JSON **sans aucun secret**, prêt à commiter
dans `docs/essais/<service>.json` (FR-014).

Dépendances : WP10. Implémentation :
`LC_ALL=C LANG=C spec-kitty agent action implement WP11 --agent claude --mission adaptateurs-fournisseurs-choisis-01M8BXJA`.

## Branch Strategy

Planification et fusion sur `feat/adaptateurs-fournisseurs-choisis`. Le worktree d'exécution est celui de la lane calculée dans
`<M>/lanes.json` ; si ta lane dépend d'autres lanes, `bash docs/passation-12b-1/scripts/merge-deps.sh <lettre>`
d'abord.

## Subtasks

### T048 — Cadre

1. `main.ts` : lit le service (`EXTERNAL_SERVICES` seulement ; inconnu ou hors périmètre → code 2 et message) ; refus si
   `NODE_ENV=production` ou `config.production` ; construit l'adaptateur par les **mêmes fabriques** que les processus
   avec le réglage `real` ; exécute les étapes ; écrit le compte rendu sur la sortie standard ; code 0 si tout `ok`.
2. Chaque étape : `{ name, ok, httpStatus?, durationMs }` ; une exception → étape `ok: false` avec un motif court sans
   secret ni corps ; les étapes suivantes qui en dépendent sont sautées.
3. Identifiants des PSP : lus dans le coffre (`PSP_SECRET_STORE=real`, référence passée par `--secret-ref`) ou, pour
   un premier essai sans coffre, depuis un fichier JSON local `--credentials <chemin>` (même forme que le secret) ;
   jamais par argument de ligne de commande ni variable d'environnement nommée.

### T049 — PSP

Wave : session de 100 XOF (adresses fournies par `--return-url`), relecture du statut (`PENDING`), expiration,
relevé du jour. PayDunya (`--sandbox` → base bac à sable) : facture de 100 XOF, confirmation (`pending`). Stripe :
session, relecture, expiration, relevé de la veille. Aucun paiement réel n'est conclu par la commande.

### T050 — AWS

Secrets Manager : lecture d'une référence de test passée en argument. KMS : création des trois clés de test, MAC,
clé de données aller-retour, signature vérifiée avec la clé publique, désactivation des trois clés (même en cas d'échec
intermédiaire). S3 : écriture verrouillée d'un objet de test (rétention courte permise **seulement** pour l'essai :
`--retention-days 1`), relecture, tentative d'écrasement refusée.

### T051 — Tests

Contre les faux serveurs de WP05 à WP09 (bases et `AWS_ENDPOINT_URL` locaux) : chaque service rend un compte rendu
`ok` ; refus en production ; service inconnu ; une étape en échec saute les suivantes ; **aucun secret** dans la sortie
(identifiants de test piégés, recherche dans la sortie) ; KMS : les clés de test sont désactivées même si la signature
échoue. Le compte rendu passe la validation du test de borne de WP10 (même fonction de validation : importe-la).

## Definition of Done

- Toutes les sous-tâches faites ; fichiers limités aux `owned_files` (+ retouches de compilation nommées) ;
- tests du lot verts sur la base du lot (ou sans base pour les tests unitaires), **aucun appel réseau externe** ;
- chaque contrôle ajouté a sa mutation notée (retiré → test rouge → remis) ;
- `eslint`, `prettier --check`, `tsc --noEmit` propres sur les fichiers du lot ;
- note de lane : retouches hors carte, écarts (renforce/affaiblit), points « à confirmer à l'essai », fichiers à
  faire relire par une personne.

## Ce que le relecteur doit casser

Un secret dans la sortie ou dans un message ; la commande utilisable en production ; un paiement conclu ; une clé KMS
de test laissée active ; une fabrique contournée (adaptateur construit autrement que par la production).

## Retouches hors carte permises

Seulement les retouches de compilation imposées par un changement de signature d'un lot antérieur (`interfaces.md`
§1), nommées dans la note de lane. Tout autre besoin : signale-le, ne le code pas.
