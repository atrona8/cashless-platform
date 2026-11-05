---
work_package_id: WP11
title: Autorité de débit côté humains et refus de débit
dependencies: [WP09]
requirement_refs:
- FR-003
- FR-004
- FR-013
- FR-024
- FR-028
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T047, T048, T049, T050, T051]
phase: Phase 3 - API du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/debit-authority/
create_intent: [apps/api/src/debit-authority/debit-authority.module.ts, apps/api/src/debit-authority/debit-authority.controller.ts, apps/api/src/debit-authority/debit-authority.service.ts, apps/api/src/debit-authority/debit-authority.mapper.ts, apps/api/src/debit-authority/force-central.approval.ts, apps/api/src/debit-authority/edge-conflict.ts, apps/api/src/debit-authority/debit-paths.ts, apps/api/test/integration/debit-authority/debit-authority-routes.spec.ts, apps/api/test/integration/debit-authority/force-central.spec.ts, apps/api/test/integration/debit-authority/edge-conflict-body.spec.ts, apps/api/test/integration/debit-authority/debit-paths-refused.spec.ts, apps/api/test/integration/debit-authority/edge-view-by-terminals.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/debit-authority/**, apps/api/test/integration/debit-authority/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 : Autorité de débit côté humains et refus de débit

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte (`docs/passation-8/contexte-m8.md`, décisions 5, 6, 7), ce prompt, puis seulement :

- `contracts/interfaces.md` § 2 (WP04 : `edge_grant_authority`, `get_debit_authority`, `fail_edge_release`, `force_central_authority_approved`), § 3, § 7 (correspondance des erreurs, lignes `CL006`,
  `begin_cash_close`), § 11 ;
- `contracts/edge-routes.md` : `getDebitAuthority` (côté humain), `requestDebitAuthorityChange` (en entier), « Corps du 409 `DEBIT_AUTHORITY_EDGE` », « Écarts constatés » 1, 2, 9 ;
- `research.md` **R-03** (droits `cashless_app`), **R-06** (reprise forcée), **R-11** (décision 2 et 3) ; `data-model.md` A.1 (ligne `cashless_app`), A.3, A.4 (`force_central_authority_approved`,
  `edge_grant_authority`), A.7 ;
- constats `A03`, `A05`, `A17`, `A25` de `docs/passation-8/rapports/plan-adversarial.md` ;
- code existant : `apps/api/src/approval/action-registry.ts` et `approval.service.ts` (actions à deux personnes, `registerApprovalActions`), `errors/sqlstate-map.ts` (`CL006`),
  `errors/problem.ts` (`extensions`), `errors/problem.filter.ts`, `devices/config/device-config.service.ts` (lecture de l'autorité vue par les terminaux, autour des lignes 200-290),
  `devices/heartbeat/heartbeat.controller.ts`, `offline/batches/batch-intake.ts` (`checkAuthority`), `media/lifecycle/deposit.service.ts`, `release.service.ts`, `counter-access.ts`, `activation.service.ts`,
  `idempotency/device-key.ts` (refus non définitifs).

## Objectif

Côté **humains et terminaux**, dans le processus public (`cashless_app`), sans rien changer pour un client dont l'autorité est `CENTRAL` :

1. les routes `POST` et `GET /ledgers/{ledger_id}/debit-authority` (lecture `humanBearer`) pour bascule, rendu, abandon d'une bascule non accusée et reprise forcée à deux ;
2. tout **débit** du central **refusé** pendant que l'autorité est `EDGE`, avec le corps `409 DEBIT_AUTHORITY_EDGE` complet (`edge_base_url`, `authority_epoch`) sur chaque chemin ;
3. `edge_base_url` et l'époque vus par les terminaux (configuration, battement de cœur) vérifiés.

L'application n'appelle jamais `set_debit_authority` ni `force_central_authority` brute (C-003). Le processus `edge` (WP10, WP12) sert les routes de la passerelle : pas ici.

## Branch Strategy

- Branche de planification : `feat/passerelle-locale`. Branche de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane selon `kitty-specs/passerelle-locale-01M6NM1S/lanes.json`.

## Commande d'implémentation

```bash
LC_ALL=C LANG=C spec-kitty agent action implement WP11 --agent claude --mission passerelle-locale-01M6NM1S
```

## Règles du lot

- Tu ne lances ni Jest, ni pgTAP, ni `reset-db`. Tu ne commites pas. Tu ne touches pas à l'API du port 80. Aucune migration, aucun `GRANT` (WP09), aucun `.sql` généré.
- Lignes de 100 caractères, français, sans tiret cadratin.
- **Retouches hors carte inévitables** (voir « Contradictions ») : `errors/problem.filter.ts` ou `errors/sqlstate-map.ts` pour compléter le `409` ; les sites qui lèvent `DEBIT_AUTHORITY_EDGE` à la main
  (`media/lifecycle/deposit.service.ts`, `release.service.ts`, `batch-intake.ts`) ; `app.module.ts` (import du module). `interfaces.md` § 11 ne liste que `app.module.ts`. **Pour tous les autres,
  arrête-toi et demande l'accord de l'orchestrateur avant de modifier ; si tu peux atteindre le même résultat par un seul point d'accroche (le filtre), préfère-le.**
- Un écart qui affaiblit la sécurité s'arrête et remonte au porteur (CLAUDE.md, règle 1).

## T047 : Routes humaines `POST` et `GET debit-authority`

**But.** `requestDebitAuthorityChange` et la lecture `humanBearer` de `getDebitAuthority`, décrites mot pour mot par `edge-routes.md`. Corps `DebitAuthorityChangeRequest`, réponses `DebitAuthorityState`.

**Fichiers.** `debit-authority.controller.ts` (deux routes, `Idempotency-Key` sur le `POST`, rôle `OPERATOR_ADMIN` du prestataire du grand livre pour le `POST`), `debit-authority.service.ts`,
`debit-authority.mapper.ts` (ligne SQL vers schéma du contrat, `handover` nul permis).

**Cas par cas (le `target` et l'état du handover choisissent la fonction).**
- `target = EDGE` : `edge_grant_authority(p_ledger, p_gateway, p_actor)` (enveloppe humaine), `202` avec `handover.state = GRANTED`. `CL013` donne `409 HANDOVER_INVALID_STATE`.
  `edge_gateway_id` manquant : `422 VALIDATION_FAILED` (le contrat ne déclare pas de `400` sur cette route, ne pas en inventer un).
- `target = CENTRAL`, `force = false`, handover `TO_EDGE ACTIVE` : `request_edge_release` (via l'enveloppe qui lui correspond dans la liste de `cashless_app`), `202`, le grand livre reste `EDGE`.
- `target = CENTRAL` sur un handover `GRANTED` (bascule non accusée) : `fail_edge_grant`. **Ce cas n'a ni champ ni cible propre dans le contrat** (`edge-routes.md`, écart 2) : déduis-le de l'état, et fige-le par un test.
  Un `TO_CENTRAL` bloqué (`RELEASE_REQUESTED` ou `RELEASING`) qu'un humain abandonne passe par `fail_edge_release(p_handover, p_actor)` : même route, même règle de déduction, documentée dans le test.
- `force = true` : exige `gateway_confirmed_offline = true`, sinon `422 VALIDATION_FAILED`. Crée une demande d'approbation `FORCE_CENTRAL_AUTHORITY` (`202` avec l'`ApprovalRequest` `PENDING`), n'exécute **rien**.

**Lecture.** `OPERATOR_ADMIN` du prestataire et `ORGANIZER_ADMIN` de l'événement (rôle non déclaré au contrat : écart 1 d'`edge-routes.md`, à signaler à l'orchestrateur). Aucun rôle de guichet.
Passe par `get_debit_authority(ledger)` : `edge_base_url` = `lan_url` de la passerelle désignée, nul sinon.

**Arbitrages.**
- Idempotence : `Idempotency-Key` sur le `POST` suit l'intercepteur existant. Rejouer la même clé donne `Idempotency-Replayed` et la même réponse, sans nouvelle époque. Test.
- Aucune lecture des tables d'autorité par `SELECT` direct : fonctions seulement (`cashless_app` n'a ni `UPDATE` sur `ledger`, ni `EXECUTE` sur `set_debit_authority`).
- Un grand livre d'un autre prestataire répond `404` neutre.

## T048 : Reprise forcée à deux (`FORCE_CENTRAL_AUTHORITY`)

**But.** Enregistrer l'action dans le registre d'approbation (`force-central.approval.ts`, `registerApprovalActions`) : rôle `OPERATOR_ADMIN` pour l'auteur **et** le valideur, valideur
différent de l'auteur (le moteur d'approbation l'impose déjà : ne le recode pas, prouve-le). `validate(payload)` fige `{ ledger_id, reason, edge_gateway_id }`. `execute` appelle
`force_central_authority_approved(ledger, approval, reason)` : jamais la fonction brute.

**Attendu après approbation** (preuves de `tests_edge_handover.sql`, WP04, refaites ici par la route) : passerelle `REVOKED`, grand livre `CENTRAL`, époque `e+2`, handovers `FORCED`, audit
`EDGE_AUTHORITY_FORCED`. Aucun rôle de guichet, aucun `ORGANIZER_ADMIN` seul.

**Cas limites.**
- Auteur égal au valideur : refusé (`APPROVAL_INVALID` ou le code existant du moteur, ne le redéfinis pas).
- Approbation après que le rendu normal s'est terminé : `CL013` à l'exécution, la demande passe `FAILED`, rien n'est écrit.
- `gateway_confirmed_offline` faux ou absent : la demande n'est pas créée.
- Deux demandes `FORCE_CENTRAL_AUTHORITY` simultanées pour le même grand livre : la seconde échoue proprement (la fonction SQL est sous verrou), pas d'époque `e+4`.

## T049 : Complétion des `409` de débit, sans changer un code

**But.** `edge-routes.md` « Corps du 409 `DEBIT_AUTHORITY_EDGE` » : le central DOIT renseigner `edge_base_url` et `authority_epoch` (le contrat les déclare dans son exemple), avec
`retryable: true`. Aujourd'hui `ProblemException('DEBIT_AUTHORITY_EDGE')` les omet. C'est un alignement, pas un changement : aucun code, aucun statut, aucune route nouvelle (décision 7).

**Mise en oeuvre.** `edge-conflict.ts` expose `edgeConflictExtensions(client, ledgerId)` qui lit l'autorité par `get_debit_authority` et renvoie `{ edge_base_url, authority_epoch }`. Branche-le à **un seul**
endroit : le traducteur du filtre d'erreurs, pour tout `CL006` et tout `ProblemException('DEBIT_AUTHORITY_EDGE')` levé à la main, en retrouvant le grand livre depuis la transaction (variable de
session ou paramètre déjà présent). Si le grand livre n'est pas retrouvable au moment de la traduction, **le corps garde son ancienne forme** (jamais un champ faux).
`DEBIT_AUTHORITY_MOVING` ne change pas.

**Attention.** `X-Authority-Epoch` : si la réponse porte déjà cet en-tête pour d'autres codes, ajoute-le ici sans changer le corps d'un autre code. Si ce n'est pas le cas, n'en invente pas : renvoie-t'en à `edge-routes.md`.

## T050 : Refus de chaque chemin de débit, chemin par chemin

**But.** Tout débit du central est refusé tant que `debit_authority = 'EDGE'`, y compris ceux que le code de l'API ne passe pas par `post_transaction`. Les crédits restent acceptés.

**Marche à suivre.** Établis d'abord la liste (`debit-paths.ts`, un tableau de `{ route, operationId, kind: 'DEBIT' | 'CREDIT' | 'NEUTRAL' }`) par lecture du contrat et du code : `createPayment`,
`reversePayment`, `createTap` avec débit, `takeDeposit` en `FROM_BALANCE`, `releaseDeposit` / remboursement de caution, retraits et remboursements d'espèces débitant le portefeuille, ajustements,
rétrofacturations, `createWalletTransfer` s'il existe, annulations de recharge, lots hors ligne (`batch-intake.ts`, déjà refusé). **Ne devine pas** : pour chaque entrée, cite le fichier et la ligne qui
la protège, ou ouvre le trou. Un chemin non protégé que tu ne peux pas corriger dans tes fichiers se signale à l'orchestrateur (jamais corrigé en silence ni laissé).

**Arbitrages.**
- La garde SQL `CL006` est le dernier recours (elle refuse toute écriture débitrice de source autre que `EDGE_SYNC`). Les gardes TypeScript existantes (`deposit.service.ts:106`, `release.service.ts:91`) sont
  conservées : elles évitent une écriture partielle avant le refus.
- Un crédit (recharge en ligne, dépôt PSP, remboursement qui rend de l'argent) est accepté pendant `EDGE` ; le solde central monte, la page de réplication le portera. Test : crédit accepté pendant `EDGE`, puis visible
  au flux (le flux lui-même est WP12).
- Aucun comportement n'est modifié pour un grand livre en `CENTRAL` (suite existante verte).

## T051 : `edge_base_url` et époque vus par les terminaux

**But.** `getDeviceConfig` et le battement de cœur annoncent déjà `debit_authority`, l'époque et `edge_base_url` (lecture directe de `ledger` et `edge_gateway`). Vérifie, par test, qu'après `GRANTED`, `ACTIVE`,
rendu et reprise forcée : l'URL est celle de la passerelle courante tant que l'autorité est `EDGE`, nulle sinon ; l'époque augmente aux bons moments (`e+1`, `e+2`) ; un terminal d'un autre événement ne la voit pas.
Ne modifie `device-config.service.ts` qu'avec l'accord de l'orchestrateur (fichier hors carte) et seulement pour un défaut démontré.

## Tests attendus

Dans `apps/api/test/integration/debit-authority/` :

- `debit-authority-routes.spec.ts` : `EDGE` vers `GRANTED` (202, époque +1) ; `STANDBY`, révoquée, autre événement, bascule déjà ouverte : `409 HANDOVER_INVALID_STATE` ; `CENTRAL` sur `ACTIVE` : `RELEASE_REQUESTED`, le grand
  livre reste `EDGE` ; `CENTRAL` sur `GRANTED` : abandon par `fail_edge_grant`, époque +2 ; rejeu de la même `Idempotency-Key` ; rôles : caissier, vendeur, `ORGANIZER_ADMIN` au `POST` : refusés ; autre prestataire : 404.
- `force-central.spec.ts` : demande créée sans rien exécuter ; même personne : refus ; deuxième `OPERATOR_ADMIN` : passerelle `REVOKED`, `CENTRAL` à `e+2`, handovers `FORCED`, audit ; `force` sans confirmation : 422 ;
  approbation après rendu normal : `FAILED`.
- `edge-conflict-body.spec.ts` : chaque chemin de la liste, sous `EDGE`, répond `409 DEBIT_AUTHORITY_EDGE` avec `edge_base_url` et `authority_epoch` exacts et `retryable: true` ; sous `CENTRAL` le corps n'a pas ces champs ;
  `DEBIT_AUTHORITY_MOVING` inchangé ; le corps respecte le schéma `Problem` du contrat (validation par le schéma généré).
- `debit-paths-refused.spec.ts` : **un cas par entrée de `debit-paths.ts`** ; ce test lit la liste, pas une copie : ajouter un chemin sans test le fait échouer. Crédits acceptés.
- `edge-view-by-terminals.spec.ts` : voir T051.

Chaque test doit échouer sur une implémentation fausse (par exemple si `EDGE` n'est pas vérifié sur un chemin, le cas de ce chemin devient rouge ; si `set_debit_authority` était appelée, le test de droits de WP09 le dirait).

## Sécurité

- Fichiers à faire relire par une personne : `debit-authority.service.ts`, `force-central.approval.ts`, et le point d'accroche du filtre d'erreurs. L'agent qui a écrit le code ne vaut pas relecture indépendante.
- Le `409` ne livre `edge_base_url` qu'à un appelant déjà authentifié du même événement (le débit est une route authentifiée) ; ne l'ajoute à aucune réponse publique non authentifiée.
- La reprise forcée est le seul moyen de reprendre sans la passerelle : deux personnes, motif et confirmation hors ligne dans l'audit. Ne l'affaiblis pas pour « aider » (par exemple valideur automatique).
- Ne journalise pas le corps de la demande d'approbation au-delà des identifiants.

## Definition of Done

- [ ] Les deux routes humaines répondent comme `edge-routes.md`, idempotentes, rôles bornés.
- [ ] Reprise forcée à deux prouvée de bout en bout par la route.
- [ ] Chaque chemin de débit répertorié refusé sous `EDGE` avec le corps complet ; crédits acceptés ; `CENTRAL` inchangé.
- [ ] Liste `debit-paths.ts` complète, chaque entrée testée.
- [ ] Retouches hors carte listées dans le rapport (une ligne chacune) ; aucune autre.
- [ ] Fichiers à relire nommés.

## Ce que le relecteur doit casser

- Appeler chaque route de débit du contrat avec un grand livre en `EDGE` : y en a-t-il une qui répond 2xx ?
- Faire approuver par la même personne sous deux sessions, ou par un `ORGANIZER_ADMIN`.
- Rejouer le `POST` avec une autre clé juste après un abandon : une seconde époque doit-elle sauter ?
- Lire `GET debit-authority` avec un jeton de guichet, de vendeur, d'un autre prestataire.
- Chercher dans le diff un `UPDATE ledger`, un appel à `set_debit_authority` ou à `force_central_authority`.

## Contradictions relevées entre les sources (aucune n'est corrigée ici)

- `tasks.md` T049 et T050 supposent des changements dans `apps/api/src/debit-authority/**` seulement, alors que les chemins de débit et le filtre d'erreurs vivent ailleurs
  (`errors/*`, `media/lifecycle/*`, `offline/batches/*`). `interfaces.md` § 11 n'autorise que `app.module.ts` hors carte. Les retouches ci-dessus doivent être validées par l'orchestrateur.
- `edge-routes.md` « Corps du 409 » dit que le code actuel omet `edge_base_url` et `authority_epoch` ; `interfaces.md` § 7 dit « via la correspondance existante » : l'existante (`SQLSTATE_MAP`) est statique, sans extension. La complétion exige donc un code nouveau.
- `data-model.md` A.1 liste `fail_edge_release` parmi les fonctions de `cashless_app` ; `interfaces.md` § 2 la déclare dans WP04 sans dire quel rôle l'exécute. Vérifie la liste figée de WP09 avant de l'appeler ; absente, signale-le sans l'ajouter.
