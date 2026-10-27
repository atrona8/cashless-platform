# Revue post-fusion, mission 5b `terminaux-paiement-en-ligne-01M52QB9`

Revue sur HEAD 0d20837a (feat/terminaux-paiement-en-ligne), base a1acdc53. Les 14 lots sont `done`. Aucun test lancé (consigne) : preuves de l'orchestrateur reprises (pgTAP 39 fichiers / 2931 verts ; Jest 133/135 suites, 2 échecs de délai du poste connus, verts seuls). Les 4 « gates » du skill (contract/architectural/e2e/issue-matrix) visent le dépôt spec-kitty : sans objet ici.

## Verdict : PUBLIABLE AVEC RÉSERVES

Aucun constat bloquant ni majeur. Aucun écart de sécurité non consigné. Réserves : un point ouvert sans test de borne (OP-N80, accepté par le porteur), documents périmés (OP-N69, spec FR-017, docs-status), mineurs de WP14 tous encore présents, confirmation de NFR-010 par la CI de la PR.

## Constats

1. MINEUR (consignation) : `docs/POINTS_OUVERTS.md:50` et `:600-614` (OP-N69) décrivent encore neuf colonnes de `device` modifiables dont `event_id`, `pos_id`, `app_mode`, `nfc_enabled`, `personal_phone`. `packages/ledger-sql/post-roles.sql` (A12, WP07) ne laisse plus que `station_name`, `last_snapshot_version`, `last_seen_at`, `next_seq_floor`. C'est un renforcement (règle 1 : « se fait, puis se consigne ») consigné seulement dans le commentaire de `post-roles.sql`, `contracts/database-rights.md` et la matrice. Scénario : la mission 7 lit OP-N69, croit le risque d'affectation toujours ouvert (ou perd la trace du renforcement). Correction : mettre à jour OP-N69 (constat, risque, test `tests_device_rights.sql` §1) et ajouter une ligne dans ADR-127 ou un ADR de renforcement.
2. MINEUR (règle 3) : OP-N80 / ADR-130 n'ont aucun test de borne (« Test : aucun à ce jour »). La règle 3 exige un test qui échoue si la limite s'élargit. Déjà décidé par le porteur le 26/10 (disponibilité, aucun droit élargi) ; à lever mission 13. Réserve, pas un blocage.
3. MINEUR (spec) : `kitty-specs/.../spec.md:235` FR-017 ne cite que le `SUPERVISOR` ; ADR-122 (droit élargi à `ORGANIZER_ADMIN`, consigné) dit « FR-017 à compléter dans spec.md à la clôture ». Non fait. Correction : compléter FR-017 (demande par `ORGANIZER_ADMIN` ou `SUPERVISOR`, exécution à deux).
4. MINEUR (matrice) : `acceptance-matrix.json` : `overall_verdict` = « pending » alors que tous les critères sont `pass` ; les `notes` gardent « Reste la partie API/service avant pass » (FR-003, FR-017, FR-025, ...). Cosmétique, à nettoyer avec le rattrapage documentaire.
5. MINEUR (spec) : FR-004/NFR-003 : « 5 PIN faux puis blocage ». Le livrable (`0031_vendors.sql:255-262`, `begin_vendor_pin_check`) compte l'essai avant vérification : 4 PIN faux puis le bon PIN bloquent le vendeur. Signalé comme « plus strict que la lettre de FR-004 » dans le commentaire SQL et `contracts/vendors.md:35`, mais pas dans un ADR ni dans `spec.md`. Renforcement (disponibilité : un vendeur légitime à 4 fautes est bloqué) ; à consigner en une ligne dans ADR-121 ou spec.
6. MINEUR (WP14, constat 1) : TOUJOURS PRÉSENT. `apps/api/test/integration/end-to-end/payment-secrets.spec.ts` : aucun « canari » (secret planté retrouvé par la fonction de recherche) ; `grep canari|canary` ne donne rien dans `apps/api/test`.
7. MINEUR (WP14, constat 2) : TOUJOURS PRÉSENT. `media-isolation.spec.ts:271` : la note de `getPaymentRequest` dit « sans le jeton » alors que le cas envoie `X-Payment-Request-Token: tokenA` (l.267-268) ; `payment-isolation.spec.ts:35` : `DENIED = [401, 403, 404, 409, 422]` admis pour toute opération (un 422 de validation peut masquer un défaut d'isolation). La vérification « getCatalogVersion/1 existe pour A » n'a pas été refaite (non relue ici).
8. MINEUR (WP14, constat 3) : TOUJOURS PRÉSENT. `merchant-qr.spec.ts:391` : le commentaire du test « report WP13 » ne dit pas qu'il prouve l'issue (409) et non la garde `written.replayed` (mutant équivalent, garde à conserver).
9. MINEUR (WP14, constat 4) : TOUJOURS PRÉSENT, et plus large : 927 lignes de plus de 100 caractères dans 95 fichiers .ts touchés par la mission (pires : `config.ts` 46, `merchant-qr.spec.ts` 38, `payment-journey.spec.ts` 31, `payment-request.service.ts` 31). Prettier (printWidth 100) est prévu à la fusion (REPRISE) : non lancé.
10. MINEUR (process) : `docs/06-docs-status.md` (l.38, 41) dit encore « relue, non fusionnée » ; `spec-kitty-docs-maintain` (statut mergée), le .docx de la mission et la PR (CI = preuve de NFR-010) restent à faire, comme noté dans `REPRISE.md`. Règle de `CLAUDE.md` : ligne « Résultat: Mis à jour » du jalon post-fusion à vérifier.
11. INFO : NFR-010 « en pass sur preuve locale » : à confirmer par la CI de la PR ; la latence NFR-001 est une mesure locale (p95 ~68-81 ms), indicative.

## Écarts de sécurité ouverts et état de leur consignation

| Écart | Point ouvert | ADR | Test de borne | Report PROMPTS / PRD | État |
|---|---|---|---|---|---|
| Vérification du PIN dans l'API, la base croit l'API (droit plus large) | OP-N76 (mission 11, avec OP-N56) | ADR-121 | `tests_execute_grants.sql:104-106`, `tests_payment_rights.sql:367-391` (seul `cashless_app`), `tests_vendors.sql` | PROMPTS:347 ; PRD:113,120 | Conforme |
| Secrets de l'API reçus par tous les processus, dont `VENDOR_PIN_SECRET` et `VENDOR_PIN_IDEMPOTENCY_SECRET` (secret plus exposé) | OP-N77 (mission 13) | ADR-125 (+ complément ADR-126) | `config.spec.ts` (liste fermée, distincts, refus en production) | PROMPTS:430 ; PRD:304 | Conforme |
| `vendor_pin_check` sans purge | OP-N78 (mission 13) | ADR-127 | Borne partielle : `tests_payment_rights.sql:161` (colonnes lisibles, aucun secret) ; pas de test de croissance | PROMPTS:436 ; PRD:297 | Conforme (dette de volume) |
| `vendor_id` hors de la clé composite de `vendor_session` (contrôle reporté) | OP-N79 (mission 11) | ADR-127 | `tests_payment_rights.sql` (aucun INSERT/UPDATE de `cashless_app` sur `sale_attribution`) | PROMPTS:353 ; PRD:120,288 | Conforme |
| Pool du verrou d'essai de PIN non dimensionné (500 au lieu de 429) | OP-N80 (mission 13) | ADR-130 | AUCUN (constat 2) | PROMPTS:440 ; PRD:121 | Consigné, sans test : réserve acceptée par le porteur |
| `SALE_REVERSAL` demandable par `ORGANIZER_ADMIN` (droit plus large que FR-017) | (borné, « Bloque : non ») | ADR-122, ADR-129 | tests WP12 (`reversal-backoffice.spec.ts`), `assert_reversible` BACKOFFICE (2 personnes distinctes, rôle et portée) | PRD/PROMPTS (mission 5b) | ADR et test présents ; spec.md non mis à jour (constat 3) |
| Idempotence : refus `DEBIT_AUTHORITY_*` relâche la clé sur toutes les routes | sans point ouvert (aucune écriture) | ADR-124 | `device-key.spec.ts` (liste `NON_FINAL_CODES` exacte) | SPECIFICATION §10.2 | Conforme |
| Identité du festivalier = faux ; routes `payPaymentRequest` et `createCustomerQrToken` ajoutées | OP-N43 (complété, mission 10) | ADR existant (mission 4) | `customer-routes-production.spec.ts` (démarrage refusé en production, routes derrière `CustomerGuard`) | OP-N43 complété | Conforme |
| OP-N74 (enrôlement sur événement clos) | LEVÉ | ADR-120 | `tests_enrollment_event_state.sql`, `enrollment.spec.ts` | PROMPTS:181 ; PRD:100 | Levé avec migration 0035 |
| Renforcements sans écart : ADR-123 (codes de refus), ADR-126 (dérivé argon2 du PIN dans l'empreinte), ADR-128 (solde rendu, empreinte du contenu), ADR-129 | sans point ouvert | présents | tests nommés dans les ADR | — | Conformes |
| OP-N69 restreint (affectation et mode de `device` retirés à `cashless_app`) | OP-N69 non mis à jour | aucun | `tests_device_rights.sql` §1 | — | Renforcement non consigné dans le point ouvert (constat 1) |

Faux en production (règle 2) : la mission 5b n'ajoute aucun nouveau port-faux. Le seul faux atteint par les nouvelles routes est l'identité du festivalier (OP-N43), refusé au démarrage en production, avec test. Les deux secrets de test du PIN sont refusés en production (manquant, vide, égal à un autre secret) : `config.spec.ts:344-415`. Le faux du terminal reste remplacé par l'identité réelle (mission 5a).

## Couverture FR/NFR (spec.md → code → test)

| Exigence | Code | Test (preuve de la matrice, recoupée par grep) | Verdict |
|---|---|---|---|
| FR-001 à FR-005 vendeurs, PIN, session, blocage | `0031_vendors.sql`, `apps/api/src/vendors/`, `vendor-pin/` | `tests_vendors.sql`, `vendors.spec.ts`, `vendor-sessions.spec.ts`, `vendor-pin.hasher.spec.ts` | Couvert (constat 5 sur le seuil) |
| FR-006, FR-009 à FR-015 paiement | `payments.service.ts` (une transaction, ordre des verrous), `0033_payments.sql` | `payments*.spec.ts`, `tests_payments.sql`, `payment-journey` | Couvert |
| FR-007, FR-008, FR-011, FR-012 catalogue et lignes | `0032_catalog.sql`, `apps/api/src/catalog/`, `sql-config-resolver` | `tests_catalog.sql`, `catalog*.spec.ts` | Couvert |
| FR-016, FR-017 annulation | `assert_reversible` (VENDOR, SUPERVISOR_DEVICE, BACKOFFICE), `reversals/` | `reversal-*.spec.ts`, `tests_payments.sql` §7 | Couvert (texte spec.md à compléter, constat 3) |
| FR-018 à FR-020 QR | `0034_payment_requests.sql`, `payment-requests/`, `qr-token-hash.ts` | `merchant-qr.spec.ts`, `customer-qr.spec.ts`, `tests_payment_requests.sql` | Couvert |
| FR-021 à FR-023 | Aucun code (`kyc_verification` : INSERT/UPDATE retirés à `cashless_app`) | — | Retirés de la matrice, « Deferred (mission 10) » dans spec.md, droit fermé ; décision du porteur : conforme |
| FR-024 (OP-N74) | `0035_enrollment_event_state.sql` | `tests_enrollment_event_state.sql`, `enrollment.spec.ts` | Couvert |
| FR-025 consultation | `payment-read.service.ts`, `payments.controller.ts` | `get-payment.spec.ts` | Couvert |
| FR-026 audit | `vendor-sessions.service.ts`, services catalogue et annulation | `vendors.spec.ts`, `catalog.spec.ts`, `reversal-*.spec.ts` | Couvert |
| FR-027 contrat et types | `openapi.yaml`, types TS/Dart régénérés | `npm run check -w @cashless/contracts`, `payment-isolation` (contrat = cas) | Couvert (pas de test nommé FR-027 : preuve par contrôle de génération) |
| NFR-001 latence | — | `payment-latency.spec.ts`, étape CI dédiée | Mesure locale (p95 ~68-81 ms) ; indicatif |
| NFR-002, 004, 008 secrets et énumération | hasher, intercepteur, `qr-token-hash` | `payment-secrets`, `device-secrets`, specs vendeurs/QR | Couvert (canari manquant, constat 6) |
| NFR-003, 005, 006 concurrence, tout ou rien | verrous (terminal puis vendeur puis session puis demande puis bracelet puis portefeuille) | `payment-concurrency`, `payments-locks`, `vendor-sessions.spec.ts` | Couvert |
| NFR-007 isolation | RLS des 13 tables | `payment-isolation`, `media-isolation` (47 opérations) | Couvert |
| NFR-009 pas de faux en production | `config.ts`, `CustomerIdentityModule` | `config.spec.ts`, `customer-routes-production.spec.ts` | Couvert |
| NFR-010 tests existants verts | — | rejeu local ; étape CI | Preuve locale ; confirmation CI attendue |

Dérives non consignées : aucune trouvée au-delà des constats 1, 3, 5. Code mort : tous les modules (`VendorPinModule`, `VendorsModule`, `PaymentsModule`, `ReversalsModule`, `PaymentRequestsModule`) sont dans `app.module.ts` ; les contrôleurs portent des gardes (`DeviceAuth`, `DeviceOrCallerAuth`, `CustomerAuth`). Les 43 fonctions `SECURITY DEFINER` de 0031 à 0035 ont toutes un `search_path` (43/43) et un `REVOKE ALL … FROM PUBLIC`. Aucun `catch` qui avale une erreur en silence dans le code nouveau lu (les `catch` relancent ou traduisent ; `settleRefusal` garde l'erreur du registre).

Lecture de sécurité faite (échantillon, pas exhaustive) : `begin_vendor_pin_check`, `open_vendor_session`, `assert_vendor_session`, `assert_reversible`, `payments.service.ts`, `device-or-caller.guard.ts`, `post-roles.sql` section 6. Rien d'affaiblissant non consigné. Limite assumée : le blocage à 5 essais permet à quiconque tient un terminal enrôlé de bloquer un vendeur du même commerçant (déni de service voulu par la spec, déblocage par le commerçant).

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0031_vendors.sql` (PIN, sessions, blocage), `0033_payments.sql` (`assert_reversible`, `sale_attribution`), `0034_payment_requests.sql` (jetons QR, `lock_customer_qr_token`), `0035_enrollment_event_state.sql`.
- `packages/ledger-sql/post-roles.sql` (section 4a et section 6 : droits de `cashless_app`, colonnes lisibles de `vendor` et `payment_request`, retrait des UPDATE de `device`).
- `apps/api/src/vendor-pin/` (argon2id, secret, dérivé d'idempotence), `apps/api/src/vendors/pin-attempt-lock.ts` et `db/session-lock.ts`.
- `apps/api/src/config/config.ts` (secrets, refus en production).
- `apps/api/src/device-identity/device-or-caller.guard.ts` (garde exclusive, sans repli).
- `apps/api/src/idempotency/idempotency.interceptor.ts` (ordre UUID, numéro de terminal, réservation ; ADR-124/126).
- `apps/api/src/payment-requests/qr-token.ts`, `payments/qr-token-hash.ts` (empreinte du jeton).
- `apps/api/src/reversals/sale-reversal-action.ts` (exécution à deux personnes).

Aucune revue indépendante n'est remplacée par cette lecture : l'agent qui revoit n'est pas une personne.

## Suites recommandées (avant la PR)

Corriger les constats 1, 3, 4 (documents) ; lancer Prettier (constat 9) ; traiter les mineurs de test 6 à 8 à la mission 7 ou en passant ; lancer `spec-kitty-docs-maintain` (constat 10) ; confirmer NFR-010 par la CI de la PR.

## Retrospective Reminder

`kitty-specs/terminaux-paiement-en-ligne-01M52QB9/retrospective.yaml` existe (426 lignes, écrit à la fusion `a953d4ec`). Pour la suite : `spec-kitty retrospect summary` puis `spec-kitty agent retrospect synthesize --mission terminaux-paiement-en-ligne-01M52QB9` (dry-run).
