---
work_package_id: WP10
title: 'Versements : IBAN chiffré et décisions gardées (OP-N140, OP-N137)'
dependencies: [WP03, WP08]
requirement_refs: [FR-013, FR-014, FR-015, FR-016, NFR-002]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
subtasks: [T038, T039, T040, T041, T042]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/payouts/
create_intent:
- apps/api/test/integration/payouts/payout-guard-decision.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/payouts/**
- apps/api/src/approval/approval.service.ts
- apps/api/src/approval/action-registry.ts
- apps/api/src/audit/audit.service.ts
- apps/api/test/integration/payouts/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 : Versements : IBAN chiffré et décisions gardées (OP-N140, OP-N137)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- `kitty-specs/durcissements-serveur-01M7QAJD/interfaces.md` (tables « TypeScript » : coffre, payload,
  `guardDecision`, `PAYOUT_CONFIRM_REPLAYED`) ; `plan.md` IC-05 et IC-07 ; `spec.md` FR-013 à FR-016, NFR-002 ;
- `research/R-9b-iban-remboursements-versements.md` §1.2 (tableau des trois emplacements), §1.4 points 4(b) et 5,
  §3 en entier (mécanisme actuel, conception, risques) ;
- les notes de lane de WP03 et WP08 telles que fusionnées : **les signatures réelles font foi** (nom exact de
  `IbanVault`, façon de l'injecter dans un service Nest, noms des erreurs du coffre, `maskIban`) ;
- `apps/api/src/approval/action-registry.ts` l. 37-75 (`ApprovalActionDefinition`, `requiredRoles`) ;
- `apps/api/src/approval/approval.service.ts` l. 117-210 (`approve`, `reject`), l. 271-292 (`prepareDecision`),
  l. 340-350 (`roleOn`), l. 399-405 (`businessFailure`) ;
- `apps/api/src/payouts/payout-action.ts` l. 55-110 (types de ligne, `PAYOUT_ROLES`), l. 139-160 (`missingRole`),
  l. 205-300 (demande), l. 325-410 (`execute`), l. 414-430 (`sqlLines`), l. 455-500 (`validatePayload`) ;
- `apps/api/src/payouts/payouts.service.ts` l. 120-175 (`exportBatch`) et l. 183-245 (`confirm`) ;
- `apps/api/src/audit/audit.service.ts` l. 150-165 (union `AuditAction`, voisinage de `PAYOUT_CONFIRMED`) ;
- tests : `apps/api/test/integration/payouts/payout-batch.spec.ts` (l. 55-125), `payout-confirm.spec.ts`
  (l. 160-195), `payout-export.spec.ts` (l. 30-70), `payout-fixtures.ts`.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Deux durcissements sur les versements, sans changer le comportement d'aucune route du contrat :

1. **OP-N140 (partie lots de virements)** : l'IBAN d'une ligne de lot n'est plus jamais en clair en base ni dans le
   payload de la demande d'approbation ; il est chiffré par le coffre de WP08, l'affichage passe par `iban_mask`, et
   seul l'export CSV le rouvre.
2. **OP-N137 (a) à (d)** : un approbateur ou un refuseur sans le rôle de la classe de bénéficiaire reçoit `403` et la
   demande reste `PENDING` ; un `confirm` rejoué laisse une ligne d'audit sans écriture au grand livre ;
   l'auto-approbation
   rend exactement `409 APPROVAL_INVALID`.

## Context

- Points ouverts levés par ce lot : **OP-N137** (en entier) et la part « lots de versements » d'**OP-N140**
  (WP09 couvre les remboursements et les réclamations tardives, WP08 le coffre et le masque des journaux).
- Décisions du porteur du 18/11/2026 qui s'appliquent : clé de l'IBAN lue en configuration de l'API (limite
  résiduelle consignée par WP14, pas ici) ; **FR-016 amendé** : l'auto-approbation rend `409 APPROVAL_INVALID`
  (`CL023`), jamais `403` (rendre `403` changerait une route, C-002).
- Lecture retenue du point (b) : le refus contrôle les classes de bénéficiaire comme l'approbation (FR-014).
  Resserrement : une personne sans la classe ne peut plus refuser. Se fait, se signale dans la note de lane.
- **Interfaces possédées** : `ApprovalActionDefinition.guardDecision?(ctx, decision)` (dans `action-registry.ts`) ;
  l'action d'audit `PAYOUT_CONFIRM_REPLAYED` (union `AuditAction`). **Consommées** : `IbanVault.seal/open/isSealed`
  (WP08), `maskIban` existant, le `CHECK payout_iban_sealed` de `0093` (WP02), les droits de WP03.
- **Hors carte, à ne pas toucher** : `approval/approval.mapper.ts` (WP09 : `maskPaymentData` rend `iban_mask`),
  `late-claims/**` et `refunds/**` (WP09), `test/unit/payouts/payout-roles.spec.ts` (hors lot ; s'il casse, signale).
- Contrat : `openapi.yaml` inchangé ; `AuditAction` est une union TypeScript, `audit_log.action` un `text` libre :
  aucune entrée de `contract-baseline.json`.

## Subtasks

### T038 : `payout-action.ts` : IBAN chiffré dans le payload et dans `payout.iban`

- **But** : aux trois niveaux (payload d'approbation, ligne `payout`, jamais le clair), l'IBAN d'une ligne
  `BANK_TRANSFER` est une enveloppe `enc:v1:…` ; le masque est conservé à côté.
- **Étapes** :
  1. À la demande (autour de `payout-action.ts:233` et `:291`), valider l'IBAN sur le clair (`isValidIban`,
     `normalizeIban`), calculer `iban_mask = maskIban(clair)` **avant** de chiffrer, puis écrire dans la ligne du
     payload
     `iban: vault.seal(clair, operatorId)` et `iban_mask`. Le clair ne doit survivre dans aucune variable passée à
     l'audit ni au journal.
  2. `validatePayload` (l. 474-476) : accepter l'enveloppe (`isSealed`) ; pour revalider à l'exécution, ouvrir
     (`open(envelope, operatorId)`) et tester `isValidIban` **sans réécrire le clair** ; un clair dans le payload
     reçu à l'exécution est refusé (422), c'est le test de borne de ce lot. `iban_mask` entre dans la liste des champs
     permis de la ligne (voir la liste de clés, l. 90 et `payouts.dto.ts:18`) sans devenir une entrée du corps public.
  3. `sqlLines` (l. 414-430) transmet l'enveloppe telle quelle à `create_payout_batch` ; la fonction SQL et le
     `CHECK payout_destination_bank` restent satisfaits, le `CHECK payout_iban_sealed` (0093) refuse tout clair.
  4. L'accès au coffre : injection Nest comme le décrit la note de lane de WP08 ; **aucun port KMS** ajouté au processus
     public (`architecture.spec.ts` l. 158-170 le garde).
- **Fichiers** : `apps/api/src/payouts/payout-action.ts`, `payouts.dto.ts`, `payouts.module.ts` si le fournisseur du
  coffre doit y être déclaré.
- **Validation** : `payout-batch.spec.ts` étendu : après une demande puis une approbation, `SELECT iban FROM payout`
  et `SELECT payload FROM approval_request` ne contiennent l'IBAN en clair nulle part (`LIKE '%<iban>%'` faux),
  `iban` commence par `enc:v1:`, `GET /approval-requests/{id}` rend le masque seul.
- **Pièges** : l'IBAN est normalisé (espaces retirés) avant `isValidIban` : chiffrer la forme normalisée, sinon
  l'export rend une forme différente d'avant. `payout_transition_guard` compare `iban` par `IS DISTINCT FROM` : un
  chiffrement à IV aléatoire ne doit être fait qu'une fois, à la création (jamais re-chiffrer à l'exécution).
- **Mutation (NFR-004)** : faire écrire le clair dans `sqlLines` ; constater l'échec du test d'absence de clair et du
  `CHECK` de la base ; remettre.

### T039 : export CSV : ouverture de l'IBAN ; erreur nommée sans valeur ; mesure NFR-002

- **But** : `PayoutsService.exportBatch` (`payouts.service.ts:122-175`) est le **seul** endroit où l'IBAN est rouvert.
- **Étapes** : ligne 164 (`destination: r.iban ?? …`) devient `vault.open(r.iban, operatorId)` pour une enveloppe ; une
  valeur illisible (altérée, autre prestataire, `kid` inconnu) lève une erreur **nommée** (`ProblemException` existant
  ou erreur du coffre selon WP08), **sans la valeur ni le clair en repli**, et sans écrire un CSV partiel. Un `iban`
  non chiffré rencontré en base (ligne ancienne) est refusé de la même manière : pas de lecture en clair silencieuse.
  Une seule ouverture par ligne, dans la boucle de rendu, sans requête par ligne.
- **NFR-002** : mesurer un lot de 500 lignes (création directe des 500 lignes en base par la fixture, chiffrées par le
  coffre) : l'export < 2 s, déchiffrement compris. Ajouter la mesure au test d'export sous `SKIP_LATENCY` (comme la
  suite de latence de WP07) ; noter la durée mesurée dans la note de lane.
- **Fichiers** : `apps/api/src/payouts/payouts.service.ts`, `apps/api/test/integration/payouts/payout-export.spec.ts`.
- **Validation** : `payout-export.spec.ts` : CSV exact (le CSV rend l'IBAN **en clair**, c'est le contrat), absence du
  clair ailleurs (l. 57-66 conservés et renforcés), enveloppe altérée : erreur nommée, aucune valeur dans la réponse.
- **Mutation** : faire retomber `exportBatch` sur `r.iban` brut quand l'ouverture échoue ; le test d'altération échoue.

### T040 : crochet `guardDecision` (approuver et refuser)

- **But** : FR-013 et FR-014. Le contrôle de classe, aujourd'hui dans `execute` (`payout-action.ts:352-358`), est
  fait **avant** `decide`, pour approuver comme pour refuser.
- **Étapes** :
  1. `action-registry.ts` : ajouter à `ApprovalActionDefinition` un crochet **facultatif**
     `guardDecision?(client, ctx, decision: 'APPROVE' | 'REJECT'): Promise<void>` (forme exacte : `interfaces.md` ; le
     contexte porte la demande, le payload validé, l'acteur et sa chaîne). Aucune autre action ne le définit.
  2. `approval.service.ts:prepareDecision` (l. 271-292) : après le contrôle de rôle générique (`roleOn`) et **avant**
     tout `decide`, appeler le crochet s'il existe. `approve` et `reject` passent tous deux par `prepareDecision` :
     ne pas dupliquer l'appel. Passer la décision (`APPROVE` ou `REJECT`) depuis les deux sites d'appel.
  3. `payout-action.ts` : implémenter `guardDecision` avec `missingRole(actor.principal.assignments, kinds, chain)`,
     `kinds` lus du payload (`lines[].beneficiary_kind`), `chain = resolveChain(client, scopeOf(payload))` ; refus :
     `ProblemException('FORBIDDEN')` avec le détail de rôle déjà utilisé par `execute`.
  4. Conserver le contrôle d'`execute` (`[requestedBy, approvedBy]`) comme défense en profondeur (attribution
     révoquée entre la demande et la décision) et le dire dans un commentaire : c'est le seul cas où un refus de rôle
     peut encore faire passer la demande `FAILED`.
- **Fichiers** : `apps/api/src/approval/action-registry.ts`, `apps/api/src/approval/approval.service.ts`,
  `apps/api/src/payouts/payout-action.ts`.
- **Validation** : nouveau `apps/api/test/integration/payouts/payout-guard-decision.spec.ts` et
  `payout-batch.spec.ts:95-122` réécrit : approbation du lot mixte par un détenteur d'une seule classe : `403`, la
  demande relue par `GET /approval-requests/{id}` reste `PENDING`, **aucune** ligne `APPROVAL_FAILED`, aucune écriture
  `payout` ; puis un valideur qui a les deux rôles approuve **la même demande** : `EXECUTED` (preuve que la nuisance
  est levée) ; refus (`/reject`) par un détenteur d'une seule classe : `403`, demande `PENDING` ; refus par un
  détenteur des deux : `REJECTED`. Un test unitaire du crochet (appelé si défini, pour `APPROVE` **et** `REJECT`, jamais
  sinon) va dans le même fichier nouveau (le dossier `test/unit/approval/` n'est pas à ce lot).
- **Pièges** : ne pas lever le `403` après `decide` (la demande passerait `APPROVED`, puis `FAILED`) ; le crochet lit
  la chaîne en base dans la transaction de la décision. `businessFailure` traite une `ProblemException` < 500 de
  `execute` comme échec métier : le crochet est **hors** de ce `SAVEPOINT`, vérifier que l'erreur remonte telle quelle.
- **Mutation** : retirer l'appel du crochet dans `prepareDecision` ; les tests de `403` et de `PENDING` échouent.

### T041 : audit `PAYOUT_CONFIRM_REPLAYED` ; auto-approbation exacte

- **Étapes** :
  1. `audit.service.ts` : ajouter `'PAYOUT_CONFIRM_REPLAYED'` à l'union `AuditAction`, à côté de `PAYOUT_FAILED`
     (l. 158-159). Aucune migration (`audit_log.action` est libre).
  2. `payouts.service.ts:confirm` (l. 188-245) : quand `settle_payout` réussit et que `current.status !== 'INITIATED'`
     (rejeu identique), enregistrer l'audit `PAYOUT_CONFIRM_REPLAYED` avec `after: { ledger_id, outcome, replay: true
     }`,
     même auteur et même portée que `PAYOUT_CONFIRMED`, **jamais** de destination ni de référence. Réponse inchangée
     (`200`), aucune écriture comptable. Le rejeu avec une `Idempotency-Key` identique ne passe pas ici (réponse
     mémorisée) : aucune ligne de plus, c'est voulu et testé.
  3. Auto-approbation (FR-016) : aucun code. `decide_approval_request` lève `CL023`, mappé `409 APPROVAL_INVALID`
     (`errors/sqlstate-map.ts:33`). Le test passe de `expect([403, 409])` à `expect(self.status).toBe(409)` et
     `expect(self.body.code).toBe('APPROVAL_INVALID')`, avec la demande relue encore `PENDING`.
- **Fichiers** : `apps/api/src/audit/audit.service.ts`, `apps/api/src/payouts/payouts.service.ts`,
  `apps/api/test/integration/payouts/payout-batch.spec.ts` (l. 63-73).
- **Validation** : `payout-confirm.spec.ts` : rejeu identique avec une **autre** clé d'idempotence : `200`,
  `txCount('PAYOUT_CONFIRMED')` inchangé, exactement **une** ligne `PAYOUT_CONFIRM_REPLAYED` sans destination ;
  rejeu différent : `409` (inchangé, `CL029`), aucune ligne de rejeu.
- **Pièges** : `grep` de `docs/07-api-reference.md` et de tout test qui énumère des actions d'audit : signale (sans le
  modifier hors carte) si une liste doit recevoir la nouvelle action. Un `409 CL023` ne doit pas être pris pour un échec
  métier de `businessFailure` (il survient avant `execute`).
- **Mutation** : retirer l'audit du rejeu ; le test d'une ligne `PAYOUT_CONFIRM_REPLAYED` échoue.

### T042 : tests des versements

- Réunir et tenir verts : `payout-batch.spec.ts`, `payout-confirm.spec.ts`, `payout-export.spec.ts`,
  `payout-guard-decision.spec.ts` (nouveau) ; `entitlements.spec.ts` et `payout-concurrency.spec.ts` inchangés et verts
  (parcours existants, SC-002).
- Un test montre aussi que `payout.iban` en clair est refusé par la base depuis `cashless_app` (`CHECK`, `23514`) : il
  prouve la borne qui échoue si la limite s'élargit.
- Commande : voir Branch Strategy (base `cashless_wp10`, jamais `cashless_test`).

## Branch Strategy

Planification et fusion sur `feat/durcissements-serveur`. Le worktree de lane est calculé par `lanes.json`
(`.worktrees/durcissements-serveur-01M7QAJD-lane-x`) ; travaille uniquement dedans. Implémentation :

```
LC_ALL=C LANG=C spec-kitty agent action implement WP10 --agent claude --mission durcissements-serveur-01M7QAJD
```

Preuves (dans le même appel Bash, depuis `apps/api` de la lane) :
`export PGDATABASE=cashless_wp10; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL` puis
`SKIP_LATENCY=1 npx jest test/integration/payouts --runInBand --forceExit`. Après Jest : `reset-db`. WP03 et WP08
doivent être fusionnés dans la lane avant les tests (`docs/passation-11a/scripts/merge-deps.sh`).

## Definition of Done

- [ ] Plus aucun IBAN en clair dans `payout.iban`, `approval_request.payload`, l'audit ni `GET /approval-requests`.
- [ ] L'export CSV rend l'IBAN en clair ; enveloppe illisible : erreur nommée sans valeur, pas de repli, pas de CSV
      partiel.
- [ ] Export de 500 lignes sous 2 s mesuré (NFR-002), durée notée.
- [ ] `guardDecision` appelé pour `APPROVE` et `REJECT`, avant `decide` ; mauvais rôle : `403`, demande `PENDING`.
- [ ] Contrôle d'`execute` conservé (défense en profondeur), commenté.
- [ ] `PAYOUT_CONFIRM_REPLAYED` : une ligne par rejeu à clé différente, aucune écriture comptable.
- [ ] Auto-approbation : exactement `409 APPROVAL_INVALID`, test sans tolérance.
- [ ] Une mutation par levée (T038, T039, T040, T041) notée avec son résultat dans la note de lane.
- [ ] `node tools/contract-stability/check.mjs` : 0 refus ; `openapi.yaml` inchangé.
- [ ] Lignes de 100 caractères au plus ; aucune dépendance nouvelle ; retouches hors carte listées dans la note.

## Risks

- Re-chiffrer par erreur à l'exécution : les gardes de transition de `payout` (comparaison d'`iban`) refuseraient.
- Le crochet change `prepareDecision` pour toutes les actions : vérifier les tests unitaires de `approval` et
  `registry.spec` (lecture seule) ; une action sans crochet ne doit voir aucun changement.
- Lecture de classe : `canSee` (liste des demandes) montre encore le lot mixte à un détenteur d'une seule classe
  (lecture, sans effet) : le mentionner dans la note, ne pas corriger ici.
- L'IBAN reste lisible du processus public (clé de configuration) : limite résiduelle déjà acceptée, consignée par WP14.

## Ce que le relecteur doit casser

1. Chercher l'IBAN en clair : `payout`, `approval_request.payload` (demande **et** résultat), `audit_log`, réponse de
   `GET /approval-requests`, message d'erreur d'un export raté, journal de test. Un seul clair = constat bloquant.
2. Approuver puis refuser un lot mixte avec un détenteur d'une seule classe, avec un détenteur des deux, avec un
   acteur dont l'attribution est révoquée entre la demande et la décision : la demande doit rester `PENDING` (ou le
   cas défense en profondeur documenté), jamais `FAILED` par le seul fait d'un mauvais rôle.
3. Forger un payload avec un IBAN en clair, ou une enveloppe d'un autre prestataire, et le faire exécuter : refus.
4. Exporter après altération d'un octet de l'enveloppe : erreur sans valeur, pas de CSV, pas de repli sur le clair.
5. Rejouer un `confirm` identique (même clé, autre clé) et différent : une seule ligne de rejeu, aucune écriture
   comptable de plus, aucune destination dans l'audit.
6. Retirer chaque contrôle (mutations de la note) et vérifier que le test annoncé échoue vraiment ; chercher un test
   qui passe sans le contrôle (`[403, 409]` toléré, `PENDING` non relu).
7. Écart non signalé : un fichier hors `owned_files` modifié (surtout `approval.mapper.ts`), un droit ou un port KMS
   ajouté.
