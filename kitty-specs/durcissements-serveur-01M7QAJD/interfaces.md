# Interfaces partagées entre lots (mission 11a)

Fichier de référence pour les lots : noms, signatures, propriétaires, codes. Un lot ne change pas une interface qu'il
ne possède pas ; il signale le besoin à l'orchestrateur. Les signatures SQL exactes sont fixées par le lot
propriétaire ; une fois fusionnées, **les signatures réelles font foi** sur ce fichier.

## Lots et propriétaires

| Lot | Objet | Dépend de |
|---|---|---|
| WP01 | Migrations `0090` (clé vendeur-session) et `0091` (fonctions des lots de bracelets) | — |
| WP02 | Migrations `0092` (garde d'insertion de `refund_request`), `0093` (`CHECK` IBAN chiffré), `0094` (`register_edge_gateway` rend le grand livre), `0095` (`device_app_attest_key`, `enroll_device`, `advance_app_attest_counter`) | — |
| WP03 | `roles.sql`, `post-roles.sql` (section 13), rôle `cashless_pin`, listes figées de droits, suites pgTAP de droits, rôles des tests et de la CI, `db/process-db.module.ts` | WP01, WP02, WP04 |
| WP04 | `apps/api/src/config/config.ts` : réglages et gardes de production nouveaux | — |
| WP05 | Lots de bracelets côté API (OP-N60) | WP03 |
| WP06 | Processus `vendor-pin` (serveur) | WP03, WP04 |
| WP07 | Client interne et route `POST /vendor-sessions` (OP-N76) | WP06 |
| WP08 | Coffre et masque d'IBAN (`iban-vault.ts`, `redact.ts`) | WP04 |
| WP09 | Remboursements et réclamations tardives : IBAN chiffré, garde d'insertion côté tests, masque des approbations | WP02, WP03, WP08 |
| WP10 | Versements : IBAN chiffré, décisions gardées, rejeu audité (OP-N137) | WP03, WP08 |
| WP11 | Plafond de la régularisation `OPERATOR_FEE` (OP-N141) | — |
| WP12 | Inscription des passerelles (`tools/edge-admin`, OP-N116) | WP03 |
| WP13 | App Attest côté API (OP-N64) | WP03 |
| WP14 | Preuves, consignation, documentation | tous |

## Base de données

| Objet | Signature ou forme | Propriétaire |
|---|---|---|
| `vendor_session_id_vendor_key` | `UNIQUE (id, vendor_id)` sur `vendor_session` | WP01 |
| `sale_attribution_session_vendor_fkey` | `FOREIGN KEY (vendor_session_id, vendor_id) REFERENCES vendor_session (id, vendor_id)` | WP01 |
| `create_media_batch(p_organizer uuid, p_event uuid, p_kind text, p_quantity int, p_key_index int, p_print_order_ref text, p_preload_promo_amount bigint, p_deposit_amount bigint, p_deposit_mode text, p_key_mode text, p_reuse_policy text, p_actor uuid) RETURNS uuid` | `DEFINER`, statut `ORDERED` imposé ; `p_actor` obligatoire (`media_set_actor`, CL001 si nul) : l'historique `→ORDERED` porte l'auteur (signature réelle, WP01 `e4d3d620`) | WP01 |
| `update_media_batch(p_batch uuid, p_changes jsonb, p_actor uuid) RETURNS void` | `DEFINER` ; clés permises : `quantity`, `print_order_ref`, `preload_promo_amount`, `deposit_amount`, `deposit_mode`, `reuse_policy` ; toute autre clé : `CL056` | WP01 |
| `set_media_batch_status`, `media_set_status`, `issue_claim_codes` | même signature, passent `DEFINER` ; `media_set_status` : `p_to` ∈ {`SUSPENDED`, `BLACKLISTED`}, sinon `CL020` | WP01 |
| `refund_request_insert_guard()` | déclencheur `BEFORE INSERT` ; session `cashless_app` : état initial seulement, colonnes de transition nulles, sinon `CL057` | WP02 |
| `refund_deposit_for_session(uuid, uuid)` | **retirée** (`DROP FUNCTION`) | WP02 |
| `refund_deposit(uuid, uuid)` | gardée, `EXECUTE` à aucun rôle applicatif (droits : WP03) | WP02, WP03 |
| `refund_request_iban_sealed`, `payout_iban_sealed` | `CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID` | WP02 |
| `register_edge_gateway(...)` | mêmes arguments qu'en `0058` ; `RETURNS TABLE (gateway_id uuid, ledger_id uuid)` ; aucun grand livre ou plusieurs : `CL058` | WP02 |
| `device_app_attest_key` | `device_id uuid PK`, `operator_id`, `key_id bytea UNIQUE`, `public_key bytea` (SPKI), `counter bigint ≥ 0`, `created_at`, `updated_at` ; RLS forcée | WP02 |
| `enroll_device(...)` nouvelle version | arguments d'`0035` + `p_app_attest_key_id bytea DEFAULT NULL`, `p_app_attest_public_key bytea DEFAULT NULL` ; l'ancienne signature est retirée dans la même migration | WP02 |
| `advance_app_attest_counter(p_device uuid, p_key_id bytea, p_counter bigint) RETURNS boolean` | `DEFINER` ; vrai si mise à jour (`counter < p_counter`), faux sinon ; appareil d'un autre prestataire ou révoqué : `CL059` | WP02 |
| Rôle `cashless_pin` | connexion du processus `vendor-pin` ; `EXECUTE` de `begin_vendor_pin_check`, `open_vendor_session` et des fonctions de PIN nécessaires (création, changement), rien d'autre | WP03 |
| Codes `SQLSTATE` | `CL056` changement de lot non permis ; `CL057` insertion de demande refusée ; `CL058` grand livre d'inscription introuvable ou ambigu ; `CL059` appareil App Attest refusé | WP01, WP02 (mappage HTTP : WP05, WP09, WP12, WP13 dans `errors/sqlstate-map.ts`, sans code exposé nouveau au contrat) |

`EXECUTE` de `cashless_app` après la mission : liste d'avant **moins** `begin_vendor_pin_check`,
`open_vendor_session`, `refund_deposit_for_session(uuid, uuid)` **plus** `create_media_batch`, `update_media_batch`,
`advance_app_attest_counter` (rien d'autre). Droits de table : `media_batch` sans `INSERT` ni `UPDATE` ; `media` :
`UPDATE (claim_code_used_at, claim_attempts)` ; `refund_request` : `INSERT` sur les seules colonnes écrites par l'API
(liste établie par WP03 à partir de `refund-backoffice-create.service.ts` et `refund-requests.service.ts`).

## Configuration (WP04)

| Variable | Lue par | Règle |
|---|---|---|
| `VENDOR_PIN_SECRET` | processus `vendor-pin` **seul** (plus l'API à la fin de WP07) | absente : `vendor-pin` refuse de démarrer |
| `VENDOR_PIN_CALL_KEY` | API et `vendor-pin` | clé HMAC ≥ 32 octets, base64 ; absente : les deux refusent de démarrer en production |
| `VENDOR_PIN_URL` | API | URL du processus (défaut local `http://127.0.0.1:3003`) |
| `DATABASE_URL_PIN` | `vendor-pin` | rôle `cashless_pin` |
| `IBAN_KEYRING` | API | `kid:base64(32 octets)[,kid:…]` ; absent ou invalide en production : démarrage refusé ; hors production : clé de test nommée, refusée en production |
| `IBAN_ACTIVE_KID` | API | `kid` d'écriture, présent dans l'anneau |
| `VENDOR_PIN_IDEMPOTENCY_SECRET` (existante, ADR-126) | API | dérivé d'idempotence du PIN, inchangé |
| `VENDOR_PIN_PORT` | `vendor-pin` | port d'écoute, défaut 3003 |

Champs d'`AppConfig` (WP04) : `vendorPinCallKey`, `vendorPinUrl`, `pinDatabaseUrl`, `ibanKeyring` (`ReadonlyMap<kid,
Buffer>`), `ibanActiveKid` ; `vendorPinSecret` reste, facultatif en production, jusqu'à WP07 qui le retire.
Fonction `vendorPinSettings(env)` (WP04) : `{ production, port, vendorPinSecret, vendorPinCallKey, pinDatabaseUrl }`,
consommée par WP06. En production, `loadConfig` exige `VENDOR_PIN_CALL_KEY` et `IBAN_KEYRING` pour tout processus.

## TypeScript

| Interface | Fichier | Propriétaire |
|---|---|---|
| `IbanVault.seal(iban, operatorId): string`, `.open(envelope, operatorId): string`, `.isSealed(v): boolean` | `apps/api/src/common/iban-vault.ts` | WP08 |
| Format chiffré | `enc:v1:<kid>:<base64url(iv12 ‖ chiffré ‖ tag16)>`, AES-256-GCM, AAD `CASHLESS/IBAN/v1|<operator_id>` | WP08 |
| Payload d'approbation | `iban` chiffré + `iban_mask` (valeur de `maskIban`) ; `maskPaymentData` rend `iban_mask` | WP09 (mapper), WP10 (lots), WP09 (réclamations tardives) |
| Routes internes de `vendor-pin` | `POST /internal/vendor-pin/open` (`{ vendorId, deviceId, operatorId, pin, … }` → session ou refus), `POST /internal/vendor-pin/hash` (`{ pin }` → empreinte) ; en-têtes `x-pin-ts`, `x-pin-sig` = HMAC-SHA256(clé, `ts + "\n" + méthode + " " + chemin + "\n" + corps`), fenêtre 30 s | WP06 (serveur), WP07 (client) |
| `VendorPinClient.open(...)`, `.hash(pin)` | `apps/api/src/vendors/vendor-pin.client.ts` | WP07 |
| `ApprovalActionDefinition.guardDecision?(ctx, decision: 'APPROVE' \| 'REJECT')` | `apps/api/src/approval/action-registry.ts` | WP10 |
| Action d'audit `PAYOUT_CONFIRM_REPLAYED` | union `AuditAction` | WP10 |
| `AttestationResult.appAttestKey?: { keyId: Buffer; publicKey: Buffer }` | `apps/api/src/attestation/` | WP13 |
| `IosAppAttestAssertionVerifier.verify({ deviceId, assertion, clientDataHash })` | `apps/api/src/attestation/ios-app-attest-assertion.ts` ; importé par aucun contrôleur | WP13 |

## Processus

| Processus | Entrée | Rôle | Port |
|---|---|---|---|
| `vendor-pin` | `apps/api/src/main.vendor-pin.ts` | `cashless_pin` | 3003 (écoute locale) |

## Fichiers partagés (une seule propriété)

- `apps/api/test/unit/architecture.spec.ts` : WP06 (règle « seul `vendor-pin` lit `VENDOR_PIN_SECRET` »). WP13 met sa
  règle dans un fichier de test à lui.
- `apps/api/src/errors/sqlstate-map.ts` : WP05 ; les autres lots y ajoutent **une ligne** hors carte, signalée.
- `apps/api/src/approval/approval.mapper.ts` : WP09.
- `packages/ledger-sql/tests/tests_media_claims.sql` (test 9 : `issue_claim_codes` passe `DEFINER`) : retouche hors carte de WP03.
- `apps/api/test/support/db.ts`, `tools/dev-db/env.sh`, `.github/workflows/ledger-tests.yml`, `apps/api/src/db/process-db.module.ts` : WP03.
- `apps/api/test/support/app.ts` : WP06. `apps/api/src/config/config.ts` : WP04 (WP07 y retire `vendorPinSecret`, hors carte).
- `apps/api/src/approval/action-registry.ts` (`ApprovalActionDefinition`), `apps/api/src/audit/audit.service.ts` (`AuditAction`) : WP10.
- `apps/api/src/ledger/builders/closing/fees.ts` : WP11.
- Lane de WP02 : tant que WP03 n'a pas fusionné, `post-roles.sql` nomme encore l'ancienne `enroll_device` et
  `refund_deposit_for_session(uuid, uuid)` ; WP02 les retouche localement pour ses tests, sans les commiter.
