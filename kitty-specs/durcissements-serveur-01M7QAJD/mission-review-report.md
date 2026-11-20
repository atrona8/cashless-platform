# Mission Review Report: durcissements-serveur-01M7QAJD

**Reviewer** : claude (revue post-fusion, skill `spec-kitty-mission-review` ; l'agent de revue n'a écrit ni le code ni
les relectures des lots)
**Date** : 2026-11-20
**Mission** : `durcissements-serveur-01M7QAJD` — Durcissements serveur hérités (mission 11a)
**Baseline** : `main` (`git diff main...HEAD`, 228 fichiers, +27 068 / -705).
**HEAD at review** : `bcaf8c4e` sur `feat/durcissements-serveur` (squash `cdedcd48`, PR #20 vers `main`).
**WPs reviewed** : WP01..WP14 (14/14 `done`). Revue du code livré, lu dans le diff, pas dans la seule matrice.

> Limite d'indépendance : implémentation, relectures, acceptation et présente revue viennent d'agents Claude. Cette revue
> ne vaut pas relecture humaine (règle 4 de `CLAUDE.md`) : voir « Fichiers à faire relire par une personne ».
> Contraintes de la revue : ni Jest, ni pgTAP, ni `reset-db` n'ont été lancés (base partagée). Les résultats de tests
> cités viennent de `acceptance-matrix.json` et des notes de lane ; les constats ci-dessous viennent de la lecture du code,
> des migrations et des tests.

## Verdict : FAIL (un constat bloquant, correctif léger)

Le périmètre est livré et solide : 21 FR, 5 NFR, 5 SC ont du code, et la grande majorité a un test réel (voir tableau). Un
seul constat bloque, au titre de la règle 4 de `CLAUDE.md` : une faiblesse de sécurité introduite par la mission et non
consignée (B-1, masque d'IBAN des versements non recoupé avec l'enveloppe). Il se lève en quelques lignes et un test, ou
par une consignation acceptée par le porteur. Le verdict passe alors à PASS WITH NOTES, sans autre reprise de code.

---

## Gate Results

### Gate 1 — Contrat (C-002)
`node tools/contract-stability/check.mjs` : `Total : 71 différence(s), 71 admise(s), 0 refusée(s)`. Ces 71 admises sont
celles des missions précédentes ; `git diff main...HEAD` ne touche ni `openapi.yaml`, ni `contract-baseline.json`, ni
`docs/SPECIFICATION.md`. Aucune route ajoutée (cohérent avec le plan : l'appel API vers `vendor-pin` est interne, le
vérificateur d'assertions n'est importé par aucun contrôleur, `unit/attestation/assertion-architecture.spec.ts`).

### Gate 2 — Fichiers générés (C-004)
Fichiers modifiés sous `packages/ledger-sql/` : migrations `0090` à `0095` (nouvelles), `post-roles.sql`,
`src/migrate.ts`, tests pgTAP. Aucun des `.sql` générés (`tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`,
`schema_grand_livre_cashless.sql`), ni `gen_tests.py`, `gen_golden.py`, `scenario_reference.json`, ni aucune migration
antérieure à `0090` n'est touché. Conforme.

### Gate 3 — Tests (non rejoués)
Matrice : pgTAP toutes suites vertes sur la tête `02b5b5f8` ; Jest API 4 231 réussis sur 4 246 (13 ignorés, 2 échecs de
fragilité connus : `claim-code-order.spec.ts` et une latence Docker). `overall_verdict: pass`, 31 critères, 7 invariants
négatifs. Non revérifié ici (contrainte de la revue).

---

## FR / NFR / SC : code et test réels

| ID | Code (lu dans le diff) | Test | Verdict |
|---|---|---|---|
| FR-001, FR-002, FR-003 | `0091` : `create_media_batch` (pas de paramètre de statut, `ORDERED` imposé), `update_media_batch` (liste blanche de 6 colonnes, lot `ORDERED`, `quantity` refusée après émission des codes), `set_media_batch_status` et `issue_claim_codes` passés `SECURITY DEFINER`, `media_set_status` limité à `SUSPENDED` et `BLACKLISTED` ; `post-roles.sql` §13b : `REVOKE INSERT, UPDATE ON media_batch`, `UPDATE` de `media` réduit à deux colonnes. Le déclencheur de transition de `media_batch` (schéma de référence l. 1565) reste juge des passages ; `set_media_batch_status` refuse `CLOSED` | `tests_11a_rights.sql` (l. 131 à 160 : aucun `INSERT`/`UPDATE` colonne par colonne, `FOR UPDATE` refusé en `42501`), `tests_media_batch_functions.sql` (79), `blacklist.spec.ts` | Conforme |
| FR-004 | `batches.service.ts` appelle les fonctions ; `row()` perd son `FOR UPDATE` (l. 45) | `batches.spec.ts`, `batches-op-n161.spec.ts` | Conforme |
| FR-005, FR-006, C-008 | `cashless_pin` (créé en §8b, rejoué), `EXECUTE` de `begin_vendor_pin_check` et `open_vendor_session` retiré à `cashless_app` et `PUBLIC`, accordé à `cashless_pin` seul ; processus `vendor-pin` (`main.vendor-pin.ts`, `VendorPinProcessModule`, `vendor-pin-open.service.ts`) ; client sans repli (`vendors/vendor-pin.client.ts`, 2 s, aucune relance) ; `VENDOR_PIN_SECRET` n'est lu que par `vendorPinSettings` (grep de `apps/api/src` : aucune autre lecture) | `tests_11a_rights.sql` (`cashless_pin` : `pin_hash` illisible, l. 211), `vendor-pin-process.spec.ts`, `vendor-sessions.spec.ts` (processus arrêté), `architecture.spec.ts` (l. 302) | Conforme (voir N-4 sur le périmètre de l'affirmation) |
| FR-007 | `vendor-pin-open.service.ts` reprend « compter d'abord » à l'identique (essai compté avant argon2, empreinte factice, audit) | `vendor-sessions.spec.ts` (PIN juste, faux, 5 échecs, mêmes réponses) | Conforme |
| FR-008 | `0090` : `UNIQUE (id, vendor_id)` et clé étrangère composite `sale_attribution_session_vendor_fk` ; contrôle `DO` préalable | `tests_vendor_session_key.sql` (23503, mutation par `DROP` de la clé) | Conforme |
| FR-009 | `errors/redact.ts` : champ `iban`, forme IBAN, `msisdn`, E.164 | `unit/errors/redact.spec.ts` | Conforme |
| FR-010, NFR-005 | `common/iban-vault.ts` (AES-256-GCM, IV aléatoire, AAD liée au prestataire), scellement aux trois endroits (`refund-backoffice-create.service.ts`, `payout-action.ts`, `late-claim-action.ts`), ouverture dans `exportBatch` seulement (`payouts.service.ts` l. 164), `0093` `CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID` | `iban-vault.spec.ts`, `tests_iban_sealed.sql`, `create-backoffice.spec.ts`, `payout-export.spec.ts`, `payout-batch.spec.ts` (clair refusé en 422) | Conforme, avec N-2 (garde de la base de forme seulement) et B-1 |
| FR-011, FR-012 | `0092` : déclencheur `refund_request_insert_guard` (`CL057`), `INSERT` par 16 colonnes, `refund_deposit_for_session(uuid, uuid)` supprimée, `refund_deposit(uuid, uuid)` sans `EXECUTE` pour aucun rôle (écart accepté 18/11, OP-N153) | `tests_refund_insert_guard.sql`, `tests_11a_rights.sql`, `limits-9b.spec.ts` inversé | Conforme |
| FR-013, FR-014 | `guardDecision` (`action-registry.ts`, `approval.service.ts` : `prepareDecision(..., 'APPROVE'/'REJECT')`, `payout-action.ts`) | `payout-guard-decision.spec.ts` (403, `PENDING`), `payout-roles.spec.ts` | Conforme |
| FR-015 | `payouts.service.ts` : audit `PAYOUT_CONFIRM_REPLAYED`, sans écriture comptable | `payout-confirm.spec.ts` | Conforme |
| FR-016 | Test d'auto-approbation exige `409 APPROVAL_INVALID` (amendement du plan, C-002) | `payout-batch.spec.ts`, `tests_payouts.sql` | Conforme |
| FR-017 | `fees.ts` : `operatorFeeTotal` factorisée, plafond avant toute ligne écrite | `closing-builders.spec.ts` (brut accepté, brut+1 refusé sur 3 assiettes) | Conforme |
| FR-018, FR-019 | `0095` : `device_app_attest_key` (RLS forcée), `enroll_device` à 15 arguments, `advance_app_attest_counter` ; `ios-app-attest-assertion.ts` : CBOR strict, `nonce = SHA-256(authData ‖ clientDataHash)`, signature ECDSA vérifiée sur le nonce comme message, `rpIdHash`, compteur strictement croissant, avance atomique en dernier ; borne iOS inchangée | `app-attest-enrollment.spec.ts`, `app-attest-assertion.spec.ts` (concurrence, rejeu), `ios-assertion.spec.ts`, `tests_device_app_attest.sql`, `tests_11a_bounds.sql` | Conforme ; vecteur réel d'Apple exigé avant la mission 12 (consigné ADR-222) |
| FR-020 | `0094` : `register_edge_gateway` rend `(gateway_id, ledger_id)`, `CL058` si zéro ou plusieurs ; `edge-admin` refuse `--ledger` | `tests_edge_gateway.sql`, `tools/edge-admin/test/register.spec.ts` | Conforme |
| FR-021 | `POINTS_OUVERTS.md` §11 et tableau §2, ADR-216 à ADR-224, reports `PROMPTS-A-ENVOYER.md` et `PRD.md` | contrôlé dans le présent rapport | Conforme |
| NFR-001, NFR-002 | mesures `vendor-pin-latency.spec.ts` (p95 211 ms, p99 249 ms) et `payout-export.spec.ts` (500 lignes) | à rejouer par le porteur (suite isolée) | Conforme sur la matrice |
| NFR-003, SC-005 | trois `EXECUTE` ajoutés (`create_media_batch`, `update_media_batch`, `advance_app_attest_counter`), listes figées | `tests_execute_grants.sql`, `tests_11a_rights.sql`, `tests_11a_bounds.sql` | Conforme, avec N-1 |
| NFR-004, SC-004 | mutations consignées par point (WP01, WP05, WP06, WP07, WP08, WP09, WP10, WP12) | notes de lane et matrice | Conforme (aucune mutation pour OP-N160 (a), dit) |
| SC-001, SC-002, SC-003 | refus depuis `cashless_app` couverts par `tests_11a_rights.sql` et `limits-9b.spec.ts` ; parcours inchangés | matrice | Conforme |

---

## Constats

### Bloquant

**B-1 — Le masque d'IBAN d'un lot de versements n'est jamais recoupé avec l'enveloppe, alors que le dossier affirme le
contraire.** Fichiers : `apps/api/src/payouts/payout-action.ts:325` (`checkSealed`), `:530-533` (`validateLine`),
`apps/api/src/approval/approval.mapper.ts:62-76` (`maskPaymentData`) ; à comparer à
`apps/api/src/late-claims/late-claim-action.ts:317` (`if (d.iban_mask !== maskIban(iban)) throw …`).

- *Preuve.* Pour une réclamation tardive, l'exécution ouvre l'enveloppe et refuse un masque différent de `maskIban(clair)`.
  Pour un lot de versements, `checkSealed` ouvre l'enveloppe et vérifie seulement qu'elle donne un IBAN valide ; `validateLine`
  accepte tout `iban_mask` non vide. L'écran d'approbation et l'audit montrent `iban_mask` tel qu'écrit dans la charge
  (`maskPaymentData`), et l'export paie l'IBAN de l'enveloppe. `grep` de `maskIban` et `iban_mask` dans
  `apps/api/src/payouts/` : le masque n'est calculé qu'à la demande (l. 308) et jamais recomparé. Aucun test ne couvre un
  masque falsifié sur un versement (`apps/api/test/integration/payouts/` : seul `payout-batch.spec.ts:65` vérifie la valeur
  produite par le chemin normal).
- *Pourquoi c'est une faiblesse.* Avant la mission, l'écran montrait toujours le masque de l'IBAN réellement payé (il le
  calculait sur le clair). Désormais l'IBAN montré aux deux approbateurs et l'IBAN payé sont deux champs distincts de la
  même charge. Une connexion de l'API compromise (le scénario de la spec) qui écrit `approval_request.payload` peut y
  recopier une enveloppe valide existante (lisible en `SELECT` sur `payout` et `refund_request`, AAD liée au seul
  prestataire) et y afficher un autre masque. Sans la clé, elle ne crée pas d'enveloppe pour un IBAN de son choix : le
  gain est borné au réemploi d'enveloppes existantes. Mais c'est un contrôle de l'approbation à deux qui perd sa fidélité,
  sans que la décision du porteur sur l'IBAN (ADR-218) ni aucune fiche ne le dise.
- *Consignation.* Aucune entrée dans `POINTS_OUVERTS.md`, aucun ADR, aucun test de borne. La liste des renforcements dit
  « masque falsifié et enveloppe illisible refusés à l'exécution (`APPROVAL_INVALID`) » : exact pour `late-claim-action.ts`,
  inexact pour `payout-action.ts`. C'est donc à la fois un écart non consigné (règle 4) et une affirmation de dossier plus
  large que le code.
- *Correctif proposé (léger, renforcement).* Dans `checkSealed`, comparer `line.iban_mask` à `maskIban(clair)` et refuser en
  `422` ou `APPROVAL_INVALID` ; l'ajouter aussi dans `guardDecision` pour refuser avant la décision (la charge est déjà
  validée à ce moment) ; ajouter un test de masque falsifié dans `payout-guard-decision.spec.ts` ou `payout-batch.spec.ts`
  avec mutation. Sinon, consigner (OP, ADR, test de borne, report 12b) et demander l'accord du porteur.

### Non bloquant

**N-1 — NFR-003 pris à la lettre.** `post-roles.sql` §13b rend à `cashless_app` `GRANT INSERT (16 colonnes) ON refund_request`
et `GRANT UPDATE (claim_code_used_at, claim_attempts) ON media`. Ce sont des octrois de colonne, mais des sous-ensembles stricts
des droits retirés juste avant (net : moins de droits). L'amendement de NFR-003 ne parle que des `EXECUTE`. Préciser la formule
« aucun droit de colonne ne dépasse l'état précédent », ce que `tests_11a_rights.sql` établit déjà.

**N-2 — La garde `NOT VALID` d'IBAN est de forme.** `0093` accepte tout `enc:v1:…`, y compris un clair préfixé à la main ; elle
n'existe pas pour `approval_request.payload` (garde applicative seule : `validateLine` refuse le clair en 422). NFR-005 dit
« 100 % des écritures en clair refusées par la base » : vrai pour un clair sans préfixe, faux pour un clair préfixé. Aucune
perte de sécurité par rapport au plan (le chiffrement réel est applicatif, limite OP-N150), à nommer dans OP-N150 ou ADR-218.
La limite OP-N155 (lignes anciennes, `VALIDATE`) est, elle, bien consignée et bloque la production.

**N-3 — Réinitialisation du PIN et portée de l'affirmation « API sans droit sur le PIN ».** `set_vendor_pin` et `create_vendor`
restent exécutables par `cashless_app` (`post-roles.sql` §13c, commentaire). Une connexion SQL seule ne peut pas forger
d'empreinte (l'empreinte dépend de `VENDOR_PIN_SECRET`, paramètre `secret` d'argon2 : `vendor-pin.digester.ts`), donc le scénario
de la spec est tenu. En revanche, un processus d'API entièrement compromis détient `VENDOR_PIN_CALL_KEY`, peut demander une
empreinte d'un PIN choisi par la route `hash`, appeler `set_vendor_pin` (qui remet `failed_attempts` à 0 et lève le blocage),
puis ouvrir une session pour ce vendeur. La fiche OP-N151 ne cite que « tester des PIN au rythme du décompte d'essais ». À
corriger dans le texte d'OP-N151 et d'ADR-217 (la levée est complète contre une connexion SQL, partielle contre le processus
d'API). La levée demeure en mission 12 / 12b (preuve du PIN calculée par l'app).

**N-4 — Cache anti-rejeu de `vendor-pin` en mémoire d'un processus.** `vendor-pin-call.guard.ts:41` : un redémarrage ou une
seconde instance du processus laisse une signature rejouable pendant la fenêtre de 30 s. Dit dans le commentaire du code,
absent d'OP-N151/N158. Faible risque (un rejeu ne rejoue qu'un essai compté, jamais plus). À ajouter à OP-N158 pour le
déploiement multi-instance.

**N-5 — Export d'un lot : `500` brut sur enveloppe illisible.** `payouts.service.ts:164-168` lève `IbanVaultError` non traduite
(consigné OP-N160 (a), échec fermé voulu). Le défaut de rapport de `23514` en `VALIDATION_FAILED` sans motif (§11, « défaut de
rapport ») est de même nature. Non bloquant ; à traduire en 409 ou 422 nommés à la recette (mission 13).

**N-6 — Contrôle de déploiement manquant (OP-N154, OP-N157 (b)).** Réutilisation du secret des PIN entre processus et mot de
passe de `cashless_pin` absent en production sont des contrôles de déploiement, non testables en base de test. Bien consignés
et reportés en 12b ; à mettre dans la liste de recette de la mission 13.

**N-7 — Fichier de test à relire.** `tests_refund_insert_guard.sql` accorde `INSERT` dans une transaction annulée (déjà signalé
par WP14) ; `tests_11a_bounds.sql` porte les listes attendues qui sont la source des bornes.

---

## Écarts de sécurité : état de la consignation (règle 3 et règle 4)

| Écart (et origine) | OP | ADR | Test de borne | Report mission héritière | État |
|---|---|---|---|---|---|
| Clé d'IBAN dans le processus public (décision 1, 18/11) | OP-N150 | ADR-218 | `config.spec.ts`, `tests_iban_sealed.sql`, `architecture.spec.ts` | 12b (`PROMPTS` l. 707, `PRD` l. 483) | Consigné |
| PIN en transit vers `vendor-pin` | OP-N151 | ADR-217 | `architecture.spec.ts` « OP-N151 », `vendor-pin-bounds.spec.ts` | 12 et 12b (l. 667, 712) | Consigné, texte à compléter (N-3) |
| `EXECUTE` de `advance_app_attest_counter` (décision 3) | OP-N152 | ADR-222 | `tests_11a_bounds.sql` section OP-N152, listes figées | 12 (l. 666) | Consigné |
| `refund_deposit(uuid, uuid)` gardée (décision 2) | OP-N153 | ADR-219 | `tests_11a_rights.sql` (« exécutable par aucun rôle ») | 13 (l. 752) | Consigné |
| Secret des PIN réutilisé ailleurs, non détecté | OP-N154 | ADR-224 | aucun possible (contrôle de déploiement, dit) | 12b (l. 713) | Consigné |
| IBAN `NOT VALID`, superutilisateurs hors de la garde ; **bloque la production** | OP-N155 | ADR-224 | `tests_iban_sealed.sql`, `tests_11a_bounds.sql` | 12b (l. 715, 755) | Consigné |
| Audit de `cashless_pin` sans politique `VENDOR_*`, mot de passe du rôle | OP-N157 | ADR-224 | `tests_11a_bounds.sql` | 12b (l. 713) | Consigné |
| Session ouverte hors transaction de l'API | OP-N158 | ADR-217 | `vendor-pin-bounds.spec.ts` « OP-N158 » (cas de la clé relâchée avant validation non figé, dit) | 13 (l. 748) | Consigné |
| Tests faibles de WP06 et WP07 | OP-N159 | ADR-217 | `architecture.spec.ts`, `vendor-pin-bounds.spec.ts` | 13 (l. 748) | Consigné |
| `canSee` d'un lot mixte, export illisible | OP-N160 | ADR-220 | `payout-export.spec.ts`, `payout-mixed-visibility.spec.ts` | 11 (l. 607) | Consigné (mutation de (a) non faite) |
| Verrou consultatif avant la RLS | OP-N161 | ADR-216 | `batches-op-n161.spec.ts` | 13 (l. 749) | Consigné |
| `--ledger` refusé | OP-N162 | ADR-221 | `register.spec.ts` | 11a (voulu) | Consigné |
| OP-N64 : côté serveur prêt, non levé | OP-N64 | ADR-222 | assertions + borne iOS inchangée | 12 | Consigné |
| **Masque d'IBAN d'un versement non recoupé (B-1)** | **aucun** | **aucun** | **aucun** | **aucun** | **Non consigné : bloquant** |

Écarts ouverts à ce jour, dans l'ordre de gravité : OP-N155 (bloque la production : purger ou chiffrer les lignes anciennes,
`VALIDATE CONSTRAINT`, avant la première donnée réelle, mission 12b) ; OP-N150 (clé d'IBAN dans l'API, 12b) ; OP-N151 et OP-N152 ;
puis les limites de disponibilité ou de déploiement (OP-N153, N154, N157, N158, N159, N160, N161). Aucun renforcement n'a été
fait sans consignation ; les renforcements de la liste de WP14 (`media_set_status` restreint, historique `→ORDERED` avec
auteur, refus de lot par classe, `23505` App Attest en `422`) sont tous du côté sécurité.

---

## Aucun faux en production

- Aucun faux nouveau n'est introduit : pas de nouveau port de faux, pas de nouveau jeton. La liste de `assertProcessIsSafe`
  (`processes/bootstrap.ts:45-67`) est inchangée et sa liste de faux reste complète ; `COVERAGE` de
  `apps/gateway/test/e2e/production-refusals.spec.ts` (l. 394) n'a pas de faux à ajouter (aucun fichier de l'outil de
  recensement touché).
- Les trois valeurs « de test » de la mission sont des constantes de configuration, refusées en production : clé d'appel
  (`VENDOR_PIN_CALL_KEY`), clé d'IBAN (`TEST_IBAN_KEY` : « clé de test refusée en production », `config.ts`), secret des PIN.
  Preuves : `unit/config.spec.ts` (l. 474-560 : anneau absent, clé de test, `kid` actif absent ou hors anneau, base64 strict),
  `unit/processes.spec.ts` (le processus `vendor-pin` refuse de démarrer en production sans secret, sans clé d'appel ni sans
  `DATABASE_URL_PIN`, refuse la valeur de test et une clé d'appel trop courte ou égale au secret ; `TRUST_PROXY_HOPS` et
  `NODE_ENV` inconnu refusés pour ce processus aussi). `serve()` appelle `assertProcessIsSafe` (`bootstrap.ts:208`) pour
  `vendor-pin`. `VENDOR_PIN_URL` est exigée en `https:` en production.
- `processes.spec.ts` ne couvre pas le démarrage réel d'un processus public en production sans `IBAN_KEYRING` ; seul
  `loadConfig` est testé (appelé au démarrage de tous les processus). Suffisant, noté.

Verdict de ce point : conforme.

---

## Fichiers à faire relire par une personne

Reprend la liste de WP14 (confirmée) et ajoute ce que la revue a lu en détail.

1. Cryptographie : `apps/api/src/common/iban-vault.ts` ; `apps/api/src/attestation/ios-app-attest-assertion.ts` (la seule
   garantie avant un vecteur réel d'Apple : double hachage du nonce, ordre des contrôles) ; `ios-app-attest.ts` (clé et
   `keyId` rendus) ; `apps/api/src/vendor-pin/vendor-pin-call-signature.ts` et `vendor-pin-call.guard.ts` (HMAC, fenêtre,
   anti-rejeu) ; `vendor-pin.digester.ts` (secret d'argon2).
2. Droits de la base : `packages/ledger-sql/post-roles.sql` §13 (a, b, c) et §8b ; migrations `0091` (fonctions `DEFINER` de lot,
   `media_set_status` restreinte), `0092` (`refund_request_insert_guard`), `0094` (`register_edge_gateway`), `0095` (`enroll_device`
   à 15 arguments, `advance_app_attest_counter`) ; `0093` ; `tests_11a_rights.sql`, `tests_11a_bounds.sql`, `tests_execute_grants.sql`.
3. Secrets et démarrage : `apps/api/src/config/config.ts` (`ibanKeyring`, `vendorPinSettings`, `vendorPinUrl`) ;
   `apps/api/src/main.vendor-pin.ts`, `processes/vendor-pin.module.ts`, `vendors/vendor-pin.client.ts`.
4. Contrôles d'approbation et masque : `apps/api/src/payouts/payout-action.ts` (`checkSealed`, `guardDecision`),
   `late-claims/late-claim-action.ts` (l. 286-317), `approval/approval.mapper.ts` ; `errors/redact.ts`. B-1 se corrige ici.
5. Test : `packages/ledger-sql/tests/tests_refund_insert_guard.sql` (octroi de test limité à une transaction annulée).
6. Hors dépôt (déploiement, à la charge du porteur avant la production) : secrets distincts pour `VENDOR_PIN_SECRET`,
   `VENDOR_PIN_CALL_KEY` et l'anneau d'IBAN ; mot de passe du rôle `cashless_pin` ; `pg_hba` ; OP-N155 avant la première donnée réelle.

---

## Dérive du plan ou de la spec

Aucune dérive non consignée relevée sur le code. Les amendements (NFR-003, FR-010, FR-012, FR-016, CL058 dans `interfaces.md`) et
les trois décisions du porteur du 18/11/2026 sont tous consignés (plan, ADR-223). Écarts de périmètre déclarés et acceptés :
cinq lignes de `commands-other.spec.ts` au lieu de trois, `test/support/*`, `sqlstate-map.ts`. Un seul point de dossier est
inexact : l'affirmation du masque falsifié refusé à l'exécution des versements (B-1).

## Synthèse pour le porteur

1. FAIL : un bloquant (B-1) au titre de la règle 4 ; correctif léger ou consignation, puis la mission passe PASS WITH NOTES.
2. Périmètre complet : 21 FR et 5 NFR avec code et test réels, contrat inchangé (71 admises, 0 refusée), fichiers générés intacts.
3. Sécurité : tous les écarts acceptés sont consignés (OP-N150 à N162, ADR-216 à ADR-224, reports 11, 12, 12b, 13) ; OP-N155 bloque la production.
4. Aucun faux nouveau ; clés de test et secret du PIN refusés en production, démarrage de `vendor-pin` refusé sans secret.
5. À faire relire par une personne : IBAN vault, assertions App Attest, appel signé `vendor-pin`, `post-roles.sql` §13, migrations `0091` à `0095`.

## Addendum du 20/11/2026 : constats traités, verdict révisé PASS WITH NOTES

- **B-1 corrigé** (décision du porteur : corriger plutôt que consigner) : commit `ae432316`. `checkSealed`
  (`apps/api/src/payouts/payout-action.ts`) exige `iban_mask === maskIban(IBAN ouvert)` à l'exécution ; un masque
  falsifié fait passer la demande `FAILED` (`VALIDATION_FAILED`). Test : cas « masque falsifié » de
  `payout-batch.spec.ts` (13/13 verts). Relecture distincte : APPROUVÉ (seul chemin d'exécution couvert ; pas de
  faux refus, masque et enveloppe calculés sur le même clair normalisé). Consigné dans `POINTS_OUVERTS.md` §11
  (renforcements) ; la phrase « masque falsifié refusé » y distingue désormais réclamations tardives et versements.
- **N-3 traité** : portée d'OP-N151 et d'ADR-217 précisée (remplacement du PIN par `POST hash` puis
  `set_vendor_pin` par un processus d'API entièrement compromis ; audité `VENDOR_PIN_CHANGED`).
- Corrections de CI du même commit, hors constats : import inutilisé (lint) ; mot de passe de `cashless_pin`
  transmis à la migration du banc e2e de la passerelle (28P01 sur cluster neuf).
- Notes N-1, N-2, N-4 à N-7 : inchangées, non bloquantes.

**Verdict révisé : PASS WITH NOTES** (aucun constat bloquant ouvert).
