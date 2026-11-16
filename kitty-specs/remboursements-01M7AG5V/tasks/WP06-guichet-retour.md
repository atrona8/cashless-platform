---
work_package_id: WP06
title: Guichet de retour enchaîné
dependencies: [WP02]
requirement_refs: [FR-015, FR-016, FR-017]
planning_base_branch: feat/remboursements
merge_target_branch: feat/remboursements
branch_strategy: Planning artifacts for this mission were generated on feat/remboursements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/remboursements unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-remboursements-01M7AG5V
base_commit: 6ff27ff396b35171f311d225fee6ad2566690783
created_at: '2026-11-13T15:05:30.840691+00:00'
subtasks: [T031, T032, T033, T034, T035]
phase: Phase 3 - Back-office et guichet
agent: claude
history:
- timestamp: '2026-11-13T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/media/lifecycle/
create_intent: [apps/api/test/integration/media/release-chaining.spec.ts, apps/api/test/integration/media/cash-due-after-replace.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/media/lifecycle/release.controller.ts, apps/api/src/media/lifecycle/release.service.ts, apps/api/src/media/lifecycle/lifecycle.dto.ts, apps/api/src/media/lifecycle/return.module.ts, apps/api/test/integration/media/release.spec.ts, apps/api/test/integration/media/release-chaining*.spec.ts, apps/api/test/integration/media/cash-due-after-replace.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 : Guichet de retour enchaîné

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis `docs/passation-9a/fiche-implementation.md` (démarrage, base `cashless_wp06`, Jest, fin de lot),
ce prompt, puis seulement :

- `docs/passation-9a/contexte-9a.md` : décisions 2, 9, 10 ;
- `contracts/interfaces.md` : clés de grand livre du guichet, `moneyAccount` `A-CAISSE-…` ;
- `contracts/served-operations.md` : ligne `releaseMedia` ; `research.md` R-08 (en entier) ; `spec.md` User Story 4 ;
- `packages/contracts/openapi.yaml` : `releaseMedia` l. 1593-1680 (description comprise), `MediaReleaseRequest` et
  `MediaReleaseResponse` l. 13153-13200, `CashMovement` l. 15469 ;
- SPECIFICATION §7.9 (ordre), §8.5 (seuil) ;
- code : `media/lifecycle/release.controller.ts` (en entier, 103 l.) ; `release.service.ts` l. 14-119 ;
  `lifecycle.dto.ts` l. 119-140 (règles de refus) ; `cash-due.controller.ts` l. 42-91 (jeton, ordre des décorateurs) ;
  `cash-due.service.ts` l. 37-123 ; `deposit.service.ts` l. 138-185 et l. 211-226 ; `counter-access.ts` l. 138-151 ;
  `approval/onsite/onsite-approval.ts` l. 39-90 ; `topups/cash/cash-topup.service.ts` l. 195-222 (modèle d'un `…_CASH` :
  compte de la session, `deviceId`, `attach_cash_tx`) ; `ledger/builders/festival/refund.ts` l. 23-45 ;
  `ledger/builders/festival/promo.ts` l. 33-46 ; `ledger/ledger-engine.service.ts` l. 150-245 et 254-335 ;
  `0036_cash_sessions.sql` l. 507-533 (`posting_cash_desk_guard`) et l. 676 (`refund_cash_due_for_session`).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi sur ce prompt.

## Objective

Lever le refus provisoire `422 release.no_chaining` (OP-N51, ADR-91) : `POST /media/{id}/release` avec `settle_balance`
(et/ou `refund_deposit_by`) exécute, dans la transaction existante de `tx.run`, caution, expiration des crédits offerts,
remboursement du solde payé en espèces, espèces dues, puis `release_media` (SPECIFICATION §7.9). Tout ou rien ; rejeu
par la
même clé : même réponse. Sans `settle_balance`, le comportement actuel reste identique.

## Branch Strategy

- Branche de planification et de fusion : `feat/remboursements`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP06 --agent claude --mission remboursements-01M7AG5V`.

## Périmètre et arbitrages

- Hors lot : migration, `debit-paths.ts` (WP05 : `releaseMedia` y est déjà `DEBIT`, la garde `EDGE` doit rester la
  première
  chose qui s'exécute), `lifecycle.module.ts`, tout le dossier `refunds/`.
- Fichiers à toi en plus de la carte initiale : `test/integration/media/release.spec.ts` (l. 289-298 attendent
  `release.no_chaining` : à remplacer par un test du nouveau comportement, c'est le seul cas existant qui change) et
  `media/lifecycle/return.module.ts` (injection de `DepositService` et du moteur). `ledger-engine.service.ts` est à
  WP02,
  pas à toi : si une retouche du moteur s'avère nécessaire pour le `WALLET_REFUND` en espèces, NE LA FAIS PAS,
  signale-la
  au compte rendu (retouche hors carte). `AuditAction` (fin d'union) si tu en ajoutes une, une ligne par valeur.
- Aucun code d'erreur nouveau : `APPROVAL_REQUIRED`, `APPROVAL_INVALID`, `DEBIT_AUTHORITY_EDGE`, `CONFLICT_STATE`,
  `BALANCE_OUTSTANDING`, `MEDIA_STATE_INVALID`, `VALIDATION_FAILED` existent.
- Le contrat ne rend que des ESPÈCES (`CashMovement.method = CASH`) : aucun remboursement mobile au guichet.
- Plusieurs portefeuilles (devises) : seuls ceux du grand livre du terminal se soldent ; tout autre solde garde le refus
  actuel `release.balance` (`409 BALANCE_OUTSTANDING`).

## Subtasks

### T031 : `WALLET_REFUND` en espèces sur la caisse de la session (sans toucher au moteur)

But : le `WALLET_REFUND` du solde payé crédite la caisse de la SESSION du terminal, sous `posting_cash_desk_guard`
(`0036:507-533` : session `OPEN`, `t.device_id` nul ou égal au terminal de la session, jamais `CASH_CLOSE`).

- Constat : `writeLines` passe déjà `command.deviceId` à `post_transaction` (`ledger-engine.service.ts:215`) et
  `TOPUP_CASH` crédite déjà `A-CAISSE-<n° de série>` (`cash-topup.service.ts:198-210`). Passe donc
  `payload.moneyAccount =
  session.code` (`requireCashSession`, `counter-access.ts:138`) et `deviceId` du terminal, et PROUVE par un test que le
  moteur
  actuel suffit. S'il ne suffit pas, ne le modifie pas : décris la retouche au compte rendu (hors carte, WP02 possède
  le moteur).
- Après l'écriture, rattache la transaction à la session : `SELECT attach_cash_tx($1, $2)`
  (`cash-topup.service.ts:220`) ;
  sans cela, l'attendu de la caisse à la fermeture est faux.

### T032 : enchaînement §7.9 dans `release.service.ts`

Dans le `tx.run` existant (`release.controller.ts:56-69`), après `authorize` et la lecture du tap, si
`settle_balance` ou
`refund_deposit_by` est présent. L'ordre est celui du contrat ; la garde `EDGE` (l. 90 actuelle) reste AVANT toute
écriture.

1. `requireCashSession` (`409 CONFLICT_STATE` sans session ouverte ou session fournie différente), puis
   `lockCounterMedia`.
2. Caution `HELD` : `DepositService.refund` (`deposit.service.ts:138`) avec
   `payment = refund_deposit_by ?? settle_balance`
   (`SEPARATE` exige `CASH` et la session) ; clé `deposit-refund:<media>:<n°>` posée par la base. Caution
   `FROM_BALANCE` :
   le recrédit grossit le solde payé : LIS les soldes APRÈS cette étape. Caution `DUE` : refus actuel
   `release.deposit_held`.
   `refund_deposit_by` SEUL (sans `settle_balance`) : exécute cette étape puis les contrôles actuels (le solde non nul
   refuse) ; précise ce choix au compte rendu.
3. Crédits offerts restants : si `promo > 0`, `PROMO_EXPIRY` (`promo.ts:34-46` refuse un montant nul : NE L'APPELLE
   PAS à
   zéro), clé `promo-expiry:<wallet_id>:<n° de rattachement>`, le moteur lit le solde
   (`ledger-engine.service.ts:531-536`).
4. Solde payé > 0 : `WALLET_REFUND` du solde payé, frais compris, `source: 'ONLINE'`, `createdBy = actor.userId`,
   `approvedBy` du jeton (T033), `deviceId` du terminal, `payload {walletId, amount, moneyAccount: session.code}`,
   clé `release-refund:<media>:<n° de rattachement>`, métadonnées `{cash_session_id}` ; puis `attach_cash_tx`. Frais
   `>=` solde :
   le constructeur refuse (`refund.ts:33-37`, `422`) et TOUT est annulé : garde ce comportement et signale-le (un
   petit solde
   ne se solde plus au guichet) plutôt que d'inventer un contournement.
5. Espèces dues ouvertes : `refund_cash_due_for_session($media, $session, $key, $actor, $approver, $device)`
   (`0036:676` ; modèle `cash-due.service.ts:79-89`) avec la clé `release-cash-due:<media>:<n°>` ; mêmes
   préconditions que le
   rendu seul : bracelet `ACTIVE` (`cash-due.service.ts:51`), anomalies du grand livre du terminal.
6. `release_media` (appel actuel, `release.service.ts:103-104`) ; solde nul exigé par la base.

Chaque étape écrit sous sa propre clé ; l'ensemble est idempotent par `@Idempotent` (même clé : même réponse stockée).
Refactorise sans copier : extrais l'appel du jeton et la lecture des soldes en fonctions privées ; `release()` sans
chaînage reste le même chemin qu'avant (même ordre de refus, mêmes messages).

### T033 : jeton sur place `releaseMedia`

- Sur `release.controller.ts` :
  `@RequiresOnsiteApproval({operationId: 'releaseMedia', role: 'SUPERVISOR', optional: true,
  scope: (req) => ({type: 'EVENT', id: requestDevice(req).eventId ?? ''})})`, placé AU-DESSUS de `@CounterAuth()`
  (décorateurs appliqués de bas en haut, comme `cash-due.controller.ts:45-51`). Sans en-tête, la garde laisse passer ;
  avec en-tête, elle vérifie tout (lié à la requête exacte par `act_hash`).
- Le service décide : si le solde payé rendu en espèces dépasse `event.cash_refund_single_max` (même lecture que
  `cash-due.service.ts:69-78`), il faut un jeton ; sans jeton : `403 APPROVAL_REQUIRED` et RIEN d'écrit (contrôle
  fait avant la
  première écriture de l'enchaînement : le jeton n'est consommé que si tout réussit). Compare avec `>` et le montant
  BRUT du
  `WALLET_REFUND` (le plus strict ; signale ta lecture : le texte dit « solde payé rendu en espèces », la caisse sort
  net
  des frais).
- `consumeOnsiteApproval(client, req, audit)` UNE fois, dans la transaction ; l'approbateur est passé au `WALLET_REFUND`
  et, s'il faut, au rendu des espèces dues (seuil propre, vérifié aussi par la base). Valideur = appelant : refusé
  par la
  garde. Le jeton présenté mais inutile n'est pas consommé.
- Fractionnement : caution en espèces, solde payé et espèces dues, chacun sous le seuil mais dont la somme le dépasse :
  ni le contrat ni `research.md` ne le traitent ; n'ajoute aucun contrôle, mais écris le cas dans le compte rendu (point
  pour le porteur, règle 1 de `CLAUDE.md`) et prouve le comportement par un test nommé.

### T034 : réponse et retrait du refus provisoire

- `ReleaseResult` : `deposit_refund_transaction_id`, `promo_expiry_transaction_id`, `balance_refund_transaction_id`
  (uuid ou
  `null`, jamais omis), `cash_to_hand_back` = caution rendue EN ESPÈCES (`SEPARATE`) + espèces réellement sorties de
  la caisse
  pour le solde payé (montant moins frais, lu sur la ligne de la caisse) + espèces dues. Constat : `research.md` R-08
  écrit
  « solde payé » ; la sortie réelle est nette des frais : applique le net et signale l'écart. `cash_session_id` renvoyé.
- Supprime le refus de `release.controller.ts:49-50` et la règle `release.no_chaining` de `lifecycle.dto.ts` (l.
  124-127,
  français et anglais) ; plus aucune référence (`grep`). Bracelet déjà `RELEASED` : même réponse qu'aujourd'hui.
- Audit : une ligne `MEDIA_RELEASED` comme aujourd'hui, avec en plus les identifiants de transactions des étapes ;
  les audits
  des étapes réutilisées (`MEDIA_DEPOSIT_REFUNDED`, `MEDIA_CASH_DUE_REFUNDED`) restent émis par leurs services.

### T035 : tests du guichet de retour

Voir « Tests et preuves ». Fichier : `test/integration/media/release-chaining.spec.ts`.

## Tests et preuves

```bash
cd <lane>/apps/api
export PGDATABASE=cashless_wp06; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/media/release-chaining test/integration/media/release \
  test/integration/media/cash-due test/integration/media/deposit --runInBand --forceExit
npm run typecheck -w @cashless/api
```

Réutilise les fixtures `test/support/{media-fixtures,cash-fixtures,seed-cash-session}.ts` ; n'en modifie aucune.

- SC-004 / FR-015 : bracelet avec caution `HELD` `SEPARATE`, crédits offerts, solde payé et espèces dues : un appel,
  quatre écritures dans l'ordre (compare `created_at`/identifiants), bracelet `RELEASED`, `cash_to_hand_back` exact,
  caisse de
  la session créditée de la somme sortie, attendu de session cohérent à la fermeture. Variante caution `FROM_BALANCE`.
- Étapes sans objet : promo nulle (`promo_expiry_transaction_id: null`, aucune erreur), solde payé nul, pas de caution,
  pas d'espèces dues.
- FR-016 : solde payé > `cash_refund_single_max` sans jeton : `403 APPROVAL_REQUIRED`, `journal_transaction` et bracelet
  inchangés ; jeton d'un `SUPERVISOR` valide : accepté, `approved_by` = `sub` du jeton ; jeton lié à un autre corps,
  expiré,
  réutilisé, de l'appelant lui-même : `403 APPROVAL_INVALID`, rien d'écrit ; solde au seuil exact : sans jeton.
- FR-017 : refus à chaque étape (jeton, caisse fermée, `EDGE`, frais `>=` solde) : rien d'écrit (compte des
  transactions, statut de la caution, anomalies ouvertes) ; rejeu de l'appel réussi avec la même clé : même corps, 0
  nouvelle
  écriture ; même appel avec une AUTRE clé après succès : bracelet déjà `RELEASED`, 0 écriture.
- Sans `settle_balance` : `release.spec.ts`, `cash-due.spec.ts`, `deposit.spec.ts` existants verts, sauf le cas
  `no_chaining`
  remplacé.
- `EDGE` : `409 DEBIT_AUTHORITY_EDGE` avec `settle_balance`, rien d'écrit (le cas HTTP de
  `debit-paths-refused.spec.ts` reste vert,
  lance-le).
- `cash-due-after-replace.spec.ts` : bracelet remplacé (`replace_media`, corrigé par WP02) dont l'ancien portait des
  espèces
  dues : `refundCashDue` sur le bracelet NEUF les rend une fois et une seule ; second appel : `409`, rien d'écrit ;
  l'ancien
  bracelet n'en porte plus.
- Terminal d'un autre événement, session d'un autre terminal, bracelet d'un autre organisateur : refus actuels
  (`404`/`409`).

## Definition of Done

- [ ] `settle_balance` et `refund_deposit_by` servis dans l'ordre §7.9, une transaction, tout ou rien ;
      `release.no_chaining`
      supprimé (code, règle, test).
- [ ] `WALLET_REFUND` en espèces sur la caisse de la session, rattaché à la session ; `posting_cash_desk_guard`
      respecté.
- [ ] Jeton `X-Approval-Token` au-delà du seuil : `403 APPROVAL_REQUIRED` sans jeton, rien d'écrit.
- [ ] Réponse complète (trois identifiants, `cash_to_hand_back`, `cash_session_id`) ; rejeu : même réponse.
- [ ] Comportement sans `settle_balance` inchangé : suites `media/*` existantes vertes.
- [ ] Tests verts sur `cashless_wp06` ; typecheck et Prettier (100 caractères) ; aucun `.sql` généré touché.
- [ ] Compte rendu : moteur suffisant ou retouche à signaler, retouches hors carte, seuil brut ou net, fractionnement,
      `refund_deposit_by` seul.

## Ce que le relecteur doit casser

1. Appeler avec `settle_balance` et un solde payé au-dessus du seuil sans jeton, puis avec le jeton d'un `CASHIER` ou de
   l'appelant : jamais d'écriture ; vérifie que la caution n'a pas été rendue avant le refus (tout annulé).
2. Jeton émis pour un autre `Idempotency-Key`/corps (autre `settle_balance`, autre `tap_id`) : refusé par `act_hash`.
3. Même jeton rejoué avec une autre clé d'idempotence : refusé (usage unique), aucun second remboursement.
4. 50 appels simultanés avec la même clé et 50 avec des clés différentes : une seule série d'écritures, jamais deux
   `release-refund:` pour un rattachement.
5. Fermer la session de caisse (ou ouvrir celle d'un autre terminal) pendant l'appel : CL029, rien d'écrit.
6. `PROMO_EXPIRY` à promo nulle, `WALLET_REFUND` à solde payé nul : pas d'erreur de montant nul, pas de transaction
   vide.
7. Caution `FROM_BALANCE` : le solde payé remboursé inclut bien le recrédit de la caution, une seule fois.
8. Espèces dues sur un bracelet remplacé (WP02) puis restitué : rendues une fois ; second appel : rien de plus.
9. `release_media` refuse malgré les étapes (solde d'une autre devise) : les écritures déjà faites sont annulées.
10. Bracelet `SUSPENDED`, `BLACKLISTED` ou d'un autre prestataire : aucun remboursement de solde ne sort de la caisse.

## Fichiers à faire relire par une personne

- `media/lifecycle/release.service.ts` (enchaînement, ordre, jeton, caisse) ;
- `release.service.ts` : la partie caisse (`attach_cash_tx`, compte de la session) mérite une seconde lecture.
