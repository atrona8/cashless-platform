# Rapport de revue post-fusion : serveur-app-festivalier-01M7WB69 (mission 10a)

**Relecteur** : Claude (agent de revue, distinct des implementeurs et relecteurs de lots)
**Date** : 2026-11-23
**Mission** : `serveur-app-festivalier-01M7WB69`, Serveur de l'app festivalier
**Base** : `2508853b5adec7295e2633bfc99200a85526f896` ; squash `d4593299` ; PR #24 vers `main`
**HEAD a la revue** : `f1f06dbf` (feat/serveur-app-festivalier)
**Lots** : WP01 a WP11, 11 sur 11 `done`

Methode : lecture de `spec.md`, de la matrice d'acceptation (13 criteres, tous `pass`), de `docs/passation-10a/preuves.md`, du
journal d'etats (229 evenements), du `git diff` de la base a HEAD (90 fichiers, 8 168 ajouts), de `docs/POINTS_OUVERTS.md` §12 et
des ADR-225 a ADR-231, avec lecture ciblee du code (kyc, claim-admin-connection, otp-chain, me.service, workflow CI).
Faits recus et non redecouverts : batteries Jest/passerelle, pgTAP laisse a la CI de la PR, `SPECIFICATION.md` §6.3 point 5
amende (OP-N164 leve), `422` dans ADR-225, correctif `f5299969` relu. Aucun test relance, aucun code modifie.

## Gate Results

- **Gate 1 (contrat)** : non rejouee ici. `tools/contract-stability/check.mjs` : 0 refus aux lots WP05, WP06, WP09 (preuves.md,
  C-001) ; `check.test.mjs` 75 cas. Les 4 entrees de `contract-baseline.json` portent la mention « Decision du porteur : 20/11/2026
  ADR-225 ». Resultat : PASS sur preuves des lots.
- **Gate 2 (architecture)** : `unit/architecture.spec.ts` compris dans la batterie Jest API (4 333 / 4 348, 1 instabilite connue) ;
  `pg` reste confine a `apps/api/src/db/` (`claim-admin-connection.ts`). PASS.
- **Gate 3 (E2E inter-depots)** : sans objet (depot unique, pas de scenario inter-depots).
- **Gate 4 (matrice d'issues)** : pas d'`issue-matrix.json` (spec sans issue GitHub). Sans objet.
- **pgTAP** : laisse a la CI de la PR par decision du porteur (non verifie ici ; le verdict en depend, voir plus bas).

## Matrice FR / NFR / SC / contraintes

| ID | Lot | Preuve principale | Adequation |
|---|---|---|---|
| FR-001 a FR-003 | WP01, WP05 | `tests_kyc_functions.sql`, `kyc/create.spec.ts` (mutations CL060, CL061 detectees) | ADEQUATE |
| FR-004 | WP04 | `tests_10a_rights.sql` (78), `tests_execute_grants.sql` ; `kyc.controller.ts` n'ecrit que via la fonction DEFINER | ADEQUATE (pgTAP en CI) |
| FR-005 | WP06 | `kyc/revoke.spec.ts` 12/12 (auteur n'approuve pas, 409 deja revoquee) | ADEQUATE |
| FR-006 | WP01, WP06 | `kyc/limits.spec.ts` (avant/apres, expiration, revocation) | ADEQUATE ; plafond sur 2e portefeuille non rejoue (OP-N165 point 4) |
| FR-007, FR-008 | WP02, WP07, WP08 | `claim-rotation.spec.ts`, `reissue-claim-codes.spec.ts` « SC-003 », `tests_claim_key_version.sql` (125) | ADEQUATE ; spec ignore si `SKIP_LATENCY` (OP-N167) |
| FR-009, FR-010 | WP03, WP09 | `me-10a.spec.ts`, `tests_pending_offline_notice.sql` | ADEQUATE ; approximation assumee (OP-N168) |
| FR-011 a FR-013 | WP03, WP10 | `unit` et `integration/customer-auth/otp-chain.spec.ts` (19, 5) | PARTIAL : minuteries simulees seulement |
| NFR-001 | WP10 | minuteries simulees | PARTIAL : delais reels en 12b |
| NFR-002 | WP07, WP08, WP10 | tests de recherche de code en clair (audit, idempotence, tables, fichier) | ADEQUATE |
| NFR-003 | WP01 | pas de test dedie « 0 champ en plus » ; la fonction n'ecrit que 4 champs | PARTIAL (voir M-3) |
| NFR-004 | WP09 | p95 `getMe` 24 ms, `listMyWallets` 51 ms | ADEQUATE |
| NFR-005 | WP10 | `production-refusals.spec.ts`, `production-guard.spec.ts`, `otp-chain.spec.ts` | ADEQUATE |
| SC-001 a SC-005 | WP01 a WP10 | voir preuves.md ; « 100 % des essais de recette » relevent de la mission 13 | ADEQUATE en test, recette non faite |
| C-001 | WP05, WP06, WP09 | `check.mjs`, ADR-225 | ADEQUATE |
| C-002 | WP06 | `revoke.spec.ts` ; `SPECIFICATION.md` §6.3 point 5 amende | ADEQUATE |
| C-003, NFR-005 | WP10 | trois faux refuses en production, libelles testes | ADEQUATE |
| C-004, C-005 | WP11, WP01 | OP-N163 a OP-N169, ADR-225 a ADR-231, tests de borne section 9 | ADEQUATE |
| C-006 | aucun | plafonds provisoires, non presentes comme valides | sans objet code |
| C-007 | tous | aucun `.sql` genere de `packages/ledger-sql/` modifie : `gen_*.py` ne produit aucun des fichiers `tests_*` touches ; seuls migrations, `post-roles.sql`, `migrate.ts` et tests ecrits a la main | ADEQUATE |

Pas de module mort : `otp-chain`/`otp-providers` sont cables par `customer-auth.module.ts` et `bootstrap.ts` ; `kyc.module` par
`app.module.ts` ; la commande `reissue-claim-codes` est un point d'entree d'exploitation documente
(`docs/procedure-rotation-codes-rattachement.md` l. 49).

## Historique des lots

Aucun evenement `ReviewerSelfApproval` releve. WP03, WP10 en cycle 2, WP11 en cycle 3. Transitions forcees :
WP03, WP10, WP11 (`--force` sur le garde kitty-specs, autorise par le porteur pour les artefacts du runtime, voir memoire projet).
Aucun arbitrage force d'un desaccord de fond.

## Ecarts de securite ouverts (regle 4 de CLAUDE.md)

Aucun ecart ne **affaiblit** la securite par rapport au plan : les renforcements sont listes en §12 (ADR-226 a ADR-229) et
consignes apres coup, conformement a la regle 1. Limites acceptees et ouvertes, toutes consignees :

| Ecart | Point ouvert | ADR | Test de borne | Report | Consigne |
|---|---|---|---|---|---|
| Agent titulaire non detecte sans numero ou a autre numero (C-005) | OP-N163 | ADR-227 | `tests_kyc_functions.sql` §9, `create.spec.ts` | PROMPTS (10a, 11), PRD | oui |
| Auteur de la revocation (`p_by`) non controle par la base | OP-N165 (1) | ADR-226 | `revoke.spec.ts` (« demande falsifiee ») | PROMPTS (12b) | oui |
| `guardDecision` ne teste pas `REVOKED` (la base refuse, CL063) | OP-N165 (6) | ADR-226 | `revoke.spec.ts` | PROMPTS (11) | oui |
| Chaine d'envoi : code en memoire du processus, plafond 35 s, 1 000 entrees | OP-N166 | ADR-229 | `unit/otp-chain.spec.ts` | PROMPTS (12b, 13) | oui |
| Fournisseurs OTP simules, en-tete `X-Test-Otp-Code` (bloque la production) | OP-N120 | ADR-180, ADR-229 | `production-refusals.spec.ts` | 12b | oui ; refus de demarrage prouve |
| Fichier de reemission en clair (0600, `wx`) ; ENOSPC et COMMIT incertain non testes | OP-N167 | ADR-228 | `reissue-claim-codes.spec.ts` | mission 13 | oui ; deux cas non figes (consigne) |
| Version du secret globale, `seed-demo` sans version, ancien code non teste a la personnalisation | OP-N169 | ADR-231 | `tests_claim_key_version.sql` l. 298-299 | mission 13 | oui |

**Aucun constat bloquant de regle 4** : tout ecart releve est dans `POINTS_OUVERTS.md` et `DECISIONS_ADR.md`. Faux en production :
les trois faux fournisseurs refusent le demarrage, preuve par test (NFR-005).

## Fichiers a faire relire par une personne : la liste de la §12 est-elle complete ?

**Presque.** La §12 reprend migrations 0096 a 0099, `post-roles.sql` §14, `migrate.ts`, `reissue-claim-codes.ts`, `claim-hash.ts`,
`config.ts`, `claims.service.ts`, la chaine d'envoi, `kyc.service.ts`, `kyc-revocation-action.ts`, les deux controleurs kyc, `redact.ts`,
CI, `env.sh`, `env.test.example`, `claim-codes.service.ts`, `personalization.service.ts`, `customer-auth.service.ts` et `.module.ts`,
`audit.service.ts`, `sqlstate-map.ts`, `contract-baseline.json` et `openapi.yaml`.

**Omission (M-1)** : `apps/api/src/db/claim-admin-connection.ts` (nouveau, 56 lignes) ne figure pas dans la liste, alors que la phrase
d'exhaustivite de la §12 affirme que les autres fichiers hors tests sont de documentation, de lecture ou de cablage sans droit ni secret.
Ce fichier ouvre la connexion du role `cashless_claimadmin` et contient le controle de role en production (superutilisateur,
`BYPASSRLS`, proprietaire de base refuses) : il releve de « droits de la base ». A ajouter. Les fichiers `me.service.ts` et
`lost-media.service.ts` (lecture, SQL en lecture seule) et `app.module.ts`/`claims.dto.ts` (cablage) sont correctement exclus ;
`apps/api/jest.config.cjs` (configuration de test) aussi.

A faire relire en priorite par une personne (cles, droits, crypto, codes en clair) : `0096`, `0097`, `post-roles.sql` §14,
`claim-admin-connection.ts`, `reissue-claim-codes.ts`, `otp-chain.ts`, `kyc.service.ts`, `kyc-revocation-action.ts`.

## Constats

**Bloquants : aucun.**

**Mineurs / a noter**

- **M-1** Liste de relecture incomplete : `claim-admin-connection.ts` (voir ci-dessus). A corriger dans `POINTS_OUVERTS.md` §12.
- **M-2** `docs/06-docs-status.md` (l. 186) dit encore « non acceptee, non fusionnee ; reste : accept, consolidation, revue post-fusion, PR ».
  La mission est acceptee (b2b664b0) et fusionnee (d4593299). Ligne a rattraper (jalon accept/merge) ; le jalon post-review est bien journalise.
- **M-3** NFR-003 sans test dedie (« 0 champ supplementaire ») : la garantie vient de la forme de la fonction et de la table, reconnue
  « non etablie » par preuves.md. Un test sur les colonnes de `kyc_verification` la figerait.
- **M-4** NFR-001 et SC-005 prouves en minuteries simulees seulement (ecart annonce, mission 12b) ; 1 echec isole sur 50 en integration de
  la chaine (cause non etablie, OP-N166).
- **M-5** Rotation : rien ne verifie qu'un changement de `CLAIM_CODE_HMAC_KEY` s'accompagne d'une hausse de `CLAIM_CODE_HMAC_KEY_VERSION`
  (seule la regression de version est refusee au demarrage). Une cle changee sans version bloque les codes comme inconnus, sans fuite ; a
  rappeler dans la procedure (verifier qu'elle le dit) et a figer par un test ou une alerte.
- **M-6** Procedure de rotation : la commande est lancee sur `dist/` avec `--require tsx/cjs`, sans script npm ; a verifier lors de la
  recette de la mission 13 (OP-N167).
- **M-7** `spec` d'integration `reissue-claim-codes` et `claim-rotation` ignores sous `SKIP_LATENCY` : ils ne tournent que dans l'etape en
  serie de la CI ; un lancement local avec ce drapeau seul ne les exerce pas (OP-N167, deja consigne).
- **M-8** Lignes de plus de 100 caracteres a reformater (decision du 14/10/2026), deja consigne.

## Cas silencieux (silent failure candidates)

| Lieu | Condition | Resultat | Impact |
|---|---|---|---|
| `otp-chain.ts` l. 175, 200, 291-307 (`catch`) | echec de fournisseur ou de journalisation d'essai | bascule ou effacement du code, sans erreur au festivalier | voulu (aucune erreur ne revele le code) ; borne par OP-N166 ; l'arret au plafond de 35 s sans essai note est consigne |
| `wallet_pending_offline_notice` | grand livre `ORGANIZER` / `OPERATOR_BILLING`, lots `REJECTED` comptes | `false` ou `true` approximatif | avis superflu ou absent, jamais un solde faux (OP-N168) |

## Notes de securite

| Constat | Lieu | Classe | Recommandation |
|---|---|---|---|
| Role `cashless_claimadmin` : mot de passe exige en production, refus de demarrage de `migrate.ts` sans lui, connexion refusee si role superutilisateur, BYPASSRLS ou proprietaire | `claim-admin-connection.ts`, `migrate.ts` | privilege | relecture humaine (M-1) |
| Fichier de reemission en clair, mode 0600, `wx`, jamais sur la sortie standard | `reissue-claim-codes.ts` | secret expose | destruction apres remise (procedure) ; OP-N167 |
| `id_last4` ajoute aux champs masques | `errors/redact.ts` | donnees personnelles | OK |
| Droits de `cashless_app` : aucun `EXECUTE` sur la reemission | `post-roles.sql` §14 | droit | pgTAP en CI a surveiller |
| Aucun appel HTTP, aucun `shell=True` ajoute par la mission | diff | n/a | n/a |

## Verdict final

**PASS WITH NOTES.**

Les 13 FR, 5 NFR, 5 SC et 7 contraintes ont une preuve ; aucune decision verrouillee n'est violee ; aucune borne de securite n'est
affaiblie ; chaque limite acceptee est consignee (OP, ADR, test de borne, report PRD et PROMPTS) ; les faux refusent la production.
Reserve : la validation de la base repose sur les suites pgTAP, laissees a la CI de la PR #24 par decision du porteur. La fusion de
la PR est conditionnee a leur passage au vert.

### Elements ouverts non bloquants

M-1 a M-8, a traiter par la mission 13 (recette) ou une retouche de documentation : completer la liste de relecture, rattraper
`06-docs-status.md`, ajouter le test NFR-003, mesurer les delais reels en 12b.

## Retrospective Reminder

`retrospective.yaml` est present et ecrit par le runtime a la fusion (`kitty-specs/serveur-app-festivalier-01M7WB69/retrospective.yaml`).
Suite : `spec-kitty retrospect summary` (agregation, lecture seule) puis `spec-kitty agent retrospect synthesize --mission
serveur-app-festivalier-01M7WB69` (propositions, a blanc par defaut).
