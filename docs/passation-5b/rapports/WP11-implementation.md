# Compte rendu du lot WP11 — Paiement par bracelet (implémenteur)

Mission `terminaux-paiement-en-ligne-01M52QB9`, lane-k, commit `71770dce` (`feat(WP11): …`, trailer `Co-Authored-By: Claude Opus 5.5`).
Sous-tâches T048 à T054 marquées `done` depuis le checkout principal. Pas de `move-task`. Base `cashless_wp11` supprimée. Aucun fichier SQL ajouté ou modifié : pgTAP et `reset-db` sans objet pour ce lot (la base a été recréée une fois au départ).

## 1. État

`POST /payments` (trois moyens) et `GET /payments/{transaction_id}` servis ; registre des numéros (`DeviceSeqRegistry`) et `qrTokenHash` exportés pour WP12/WP13.

Fichiers du lot (`apps/api/src/payments/`) : `payments.module.ts`, `payments.controller.ts`, `payments.service.ts`, `payments.dto.ts`, `payment-read.service.ts`, `device-seq-registry.ts`, `operation-time.ts`, `qr-token-hash.ts`. Tests : `test/integration/payments/{payments,payments-refusals,payments-concurrency,get-payment,heartbeat-etag}.spec.ts` + `payments-fixtures.ts` ; `test/unit/payments/{payments.dto,device-seq-registry,operation-time}.spec.ts` ; `test/integration/end-to-end/device-auth-cases/payments.cases.ts`.

Ordre dans `PaymentsService.write` (une transaction `IdempotentTx.run`) : terminal pris `SELECT … FOR UPDATE OF d` en première instruction (lit aussi mode, événement, devise, grand livre, époque, heure de la base) → mode du terminal / devise / époque / heure → `assert_device_active` → `VendorSessionGuard.assert` → moyen (`registerOrRefuse` | `assert_tap_payable` | `lock_customer_qr_token`) → `assert_wallet_payable` → moteur (`PURCHASE`, `ONLINE`, clé = `Idempotency-Key`) → anomalie `CLOCK_SKEW` éventuelle → `record_sale_lines` (un seul `jsonb`) → `record_sale_attribution(tx, session, canal)` → `consume_tap` | `confirm_payment_request` → `record_device_seq(…'ACCEPTED'…)` → relecture de la réponse (une requête). Ordre global des verrous tenu : terminal → vendeur/session → demande QR → bracelet → portefeuille.

## 2. Écarts au plan / contradictions de sources (à lire en premier)

Priorité §0.3 appliquée : schéma SQL / `openapi.yaml` > SPECIFICATION > prompt.

1. **Code du refus QR client.** Le prompt (T050) dit « toute issue refusée → `409 PAYMENT_REQUEST_NOT_PENDING` ». `openapi.yaml` (`createPayment`), `contracts/qr-payments.md` point 2 et ADR-123 disent `422 QR_TOKEN_INVALID`, réponse unique. J'ai suivi le contrat : `CL037` (levée par `lock_customer_qr_token` ou `confirm_payment_request`) est traduit sur cette route en `422 QR_TOKEN_INVALID`. Inconnu, expiré, utilisé, annulé, autre événement, portefeuille bloqué : même statut, même corps (test).
2. **Signature de `confirm_payment_request`** : la migration 0034 a trois arguments `(id, tx, nonce_hash)` ; le prompt en cite deux. Le schéma l'emporte : l'empreinte du jeton est passée.
3. **`vendor_session_id` absent** : le prompt dit « requis » ; `openapi.yaml` (description du champ) dit que l'absence donne `409 VENDOR_SESSION_INVALID`. Suivi : absent → 409 ; présent mais pas un UUID → `422 VALIDATION_FAILED` (garde de WP09).
4. **`x-process: public` NON ajouté** à `createPayment` et `getPayment` (point annoncé par le prompt). Je l'avais posé : `media-isolation.spec.ts` échoue (`Expected length: 39, Received: 41`, plus deux cas manquants). Marque retirée, `openapi.yaml` inchangé. **À trancher par l'orchestrateur** : (a) relever à 41 le compte de `media-isolation.spec.ts` et lui ajouter les deux cas (hors carte WP11) ; (b) laisser sans marque. Rien d'autre ne dépend de la marque (la matrice des preuves lit les contrôleurs, pas `x-process`).
5. **`ok: 201` de `POST /payments` dans la matrice : non tenu.** La matrice (`device-auth-matrix.spec.ts`) affecte le terminal au point de vente de `vendors.cases.ts` (WP09, fichier trié après `payments.cases.ts`) dont la participation n'a pas de compte de commerçant (`open_participation_account` non appelé) : le moteur refuse alors (422), pas de 201 possible sans toucher `vendors.cases.ts` (hors carte). Le cas `POST /payments` n'a donc pas de `ok` (donc « ni 401 ni 5xx, un nonce consommé » + toutes les variantes de preuves fausses refusées). Le 201 est prouvé dans `payments.spec.ts` (HTTPS réel, trois preuves). Correction possible plus tard : une ligne `open_participation_account` dans `vendors.cases.ts`, puis `ok: 201` ici (et un en-tête `X-Authority-Epoch`, que `RouteCase` ne sait pas porter). `GET /payments/{}` a bien `ok: 200` (la vente est faite par la route dans le `prepare`, avant l'affectation de WP09).
6. **Rejeu côté moteur** : si le moteur répond `replayed` (clé du grand livre déjà écrite alors que l'idempotence de l'API n'a pas rejoué), je lève `409 IDEMPOTENCY_KEY_REUSED` et rien n'est lié (renforcement, non prévu au prompt). Même chose si `record_device_seq` rend `replayed`.
7. **Mode du terminal contrôlé sur la base, dans la transaction** (ligne verrouillée : `app_mode`, `os`, `nfc_enabled`), pas sur le `DeviceContext` lu avant la transaction (renforcement : une reconfiguration entre la garde et l'écriture est vue).
8. **Extensions de problème** : `INSUFFICIENT_FUNDS` porte `available_balance` et `currency` (noms de l'exemple d'`openapi.yaml`). `STALE_AUTHORITY_EPOCH` porte `authority_epoch` (l'époque courante) : **nom non défini par le contrat**, à confirmer.
9. **`receipt_number`** : le plan ne le définit pas, non inventé (omis ; facultatif au schéma).
10. **`DEBIT_AUTHORITY_MOVING`** : aucune source en base ni en API aujourd'hui (pas de mission de bascule) ; il est traité comme non définitif par le socle (`NON_FINAL_CODES`, WP08) et par `isRegistrable` (test unitaire), mais je n'ai pas pu le produire de bout en bout. `DEBIT_AUTHORITY_EDGE` (CL006) est prouvé de bout en bout (rien au registre, même clé rejouable, vente au rejeu).

## 3. Points soumis au porteur (prompt, T051/T052)

- **En-tête `X-Authority-Epoch` absent** : refusé `422 VALIDATION_FAILED` (arbitrage de l'orchestrateur du 22/10, plus strict que `required: false` d'`openapi.yaml`). Valeur non entière : même refus. Différente de `ledger.authority_epoch` : `409 STALE_AUTHORITY_EPOCH` + époque courante. Les trois refus sont rangés au registre.
- **`record_device_seq` en premier ou en dernier** : retenu l'arbitrage — prise du terminal `FOR UPDATE OF d` en première instruction, `record_device_seq` en fin de transaction (verrou déjà tenu). Droits vérifiés par les tests réels : `cashless_app` garde un `UPDATE` de colonnes sur `device` (post-roles.sql), donc `SELECT … FOR UPDATE` est permis sous RLS ; aucune fonction de base demandée.
- **Corps mal formé** : si le corps est un objet JSON, le refus est rangé `REJECTED` (contenu = empreinte des champs chaînés tels que reçus, même mal typés) ; si ce n'est pas un objet (tableau, nombre…), `400` et **rien au registre** (aucun contenu calculable) — le numéro reste alors un trou à lever. Choix à valider.
- **`content_sha256` (à reporter pour la mission 7)** : SHA-256 de la forme canonique RFC 8785 de `{seq (nombre), type: "PURCHASE", occurred_at (chaîne telle que reçue), amount, currency, tap (objet tel que reçu), lines (tableau tel que reçu)}`, champs absents omis ; jamais `tap_id`, `customer_qr_token`, `vendor_session_id`, ni champ d'état. Deux vecteurs fixes calculés hors du code (Python) dans `device-seq-registry.spec.ts`. Limite : `seq` > 2^53 n'est pas exact en nombre JSON.
- **Anomalie `CLOCK_SKEW`** : `cashless_app` garde bien `INSERT` sur `anomaly` (vérifié, test vert) ; ouverte dans la transaction de la vente avec `transaction_id`, `device_id`, `ledger_id`, montant 0. Aucune fonction de base.
- **`balance_after` de `getPayment`** : solde du portefeuille après cette écriture, relu des écritures du portefeuille jusqu'à la dernière ligne de la vente (stable dans le temps). Annulation (FR-025) : aucun champ ajouté au schéma (WP12).
- **Vie privée (info)** : la réponse d'un paiement QR rend `wallet_id` et `balance_after` au terminal du commerçant, et `INSUFFICIENT_FUNDS` rend `available_balance` : c'est le contrat, mais c'est le solde d'un festivalier montré à un commerçant sans que le festivalier présente un bracelet. À confirmer.

## 4. Retouches hors carte (une ligne chacune)

- `apps/api/src/app.module.ts` : import et déclaration de `PaymentsModule` (2 lignes).
- `apps/api/src/idempotency/device-key.ts` : `seq ≤ 9223372036854775807` dans `parseDeviceKey` (report WP08, constat 3) ; `apps/api/test/unit/device-route/device-key.spec.ts` : test aux deux bornes, et le test de l'ancienne tolérance d'un seq > 2^63 est remplacé.
- `apps/api/src/devices/heartbeat/heartbeat.controller.ts` : `pickLanguage(Accept-Language)` passé à `configs.build` (report WP10) ; preuve : `test/integration/payments/heartbeat-etag.spec.ts` (rouge sans la retouche, vérifié), le battement n'écrit toujours rien dans `device_catalog_served`.
- Aucune autre : `openapi.yaml`, `media-isolation.spec.ts`, `vendors.cases.ts`, `registry.ts` et la matrice sont intacts.

## 5. Fichiers à faire relire par une personne

- `apps/api/src/payments/payments.service.ts` : ordre des verrous, tout-ou-rien, séparation de la transaction de refus (registre) de l'écriture, enrichissement de `INSUFFICIENT_FUNDS`.
- `apps/api/src/payments/device-seq-registry.ts` : choix des refus rangés ou non (`isRegistrable`), forme de `content_sha256`, `SELECT … FOR UPDATE` du terminal dans `reject`.
- `apps/api/src/payments/qr-token-hash.ts` (trois lignes, mais c'est la frontière du secret du QR) et la conversion `CL037` → `QR_TOKEN_INVALID`.
- `apps/api/src/payments/payment-read.service.ts` : périmètre des rôles de `getPayment` (chaîne EVENT → ORGANIZER → OPERATOR + MERCHANT, 404 neutre).
- Reports orchestrateur : `VendorSessionGuard` appelé dans la transaction de l'écriture, après la prise du terminal (refus `409`) — prouvé par `payments-refusals` (« VENDOR_SESSION_INVALID ») et `payments-concurrency`. `@RequestLock` : non utilisé (aucun PIN, aucun essai à compter ; le `FOR UPDATE` du terminal sérialise). `pinFields` : sans objet (aucun PIN dans ce corps).

Aucun écart n'affaiblit la sécurité (règle 1 de CLAUDE.md) ; aucun faux ajouté ; aucun secret exposé. Renforcements consignés : absence d'époque refusée, mode relu sur la ligne verrouillée, rejeu moteur refusé, `seq` borné, aucun jeton QR (ni empreinte) hors de l'appel SQL.

## 6. Défaut antérieur à la mission (signalé à part)

`apps/api/src/configuration/sql-config-resolver.ts:86/215` : `resolve` lance des requêtes en parallèle sur le même client `pg` de la transaction (`DeprecationWarning: Calling client.query() when the client is already executing a query`, retiré dans pg@9). Sans effet fonctionnel aujourd'hui ; chaque vente le déclenche. Aussi : les tests de latence (`NFR-009`, 5 s) de `heartbeat.spec.ts`/`config.spec.ts` dépassent leur délai hors `SKIP_LATENCY=1`, avec ou sans mes retouches (vérifié par `git stash`).

## 7. Critères d'acceptation et preuves

Commandes, depuis `apps/api` de la lane, `DATABASE_URL_*` sur `cashless_wp11` :

- `npx tsc --noEmit -p .` : propre. `npx eslint` (fichiers du lot) : propre. `npx prettier --write` sur les fichiers du lot : appliqué.
- `SKIP_LATENCY=1 npx jest test/integration/end-to-end test/integration/vendors test/integration/catalog test/integration/transverse/idempotency.spec.ts test/integration/payments test/unit --runInBand` : **74 suites passées, 1388 tests passés, 3 ignorés, 0 échec** (comprend `architecture.spec.ts`, la matrice des preuves — « routes du contrat non servies : 404 » reste verte —, `media-isolation.spec.ts` à 39, les suites des vendeurs, du catalogue et de la 5a).
- Suites du lot seules : `test/integration/payments` 5 suites / 43 tests ; `test/unit/payments` 3 suites / 36 tests.

| Critère | Preuve (fichier : cas) |
|---|---|
| FR-006 vendeur = session, jamais le corps | `payments.spec` « FR-006 : le vendeur … ignorés » ; `payments.dto.spec` « le vendeur, le canal, le terminal … jamais lus » ; `payments-refusals` « VENDOR_SESSION_INVALID » |
| FR-009 trois moyens, tout ou rien | `payments.spec` : lecture embarquée, tap_id, QR client ; `payments-refusals` (chaque refus : aucune vente/ligne/attribution) |
| FR-010 `tap_id` (A1, A18) | `payments.spec` « tap_id sur un TPE » ; `payments-refusals` « A1 — MEDIA_BLOCKED par tap_id », « A1, A18 — TAP_UNUSABLE » (consommée, ancienne, autre terminal, inconnue) |
| FR-011/FR-012 lignes, prix courant ou servi (A2) | `payments.spec` « CATALOG_POS … prix courant ET … dernière version servie » ; `payments-refusals` « A2 — SALE_LINES_INVALID » ; lignes copiées (`sale_line`) dans le premier cas |
| FR-013/FR-014 mode du terminal | `payments-refusals` « FR-015 — DEVICE_MODE_NOT_ALLOWED » (iOS, NFC coupé, TOPUP_DESK, payment_intent_id) + « VALIDATION_FAILED » (CATALOG_POS sans lignes, KEYPAD_TPE avec lignes, somme fausse, devise) |
| FR-015 iOS paie par QR ; téléphone personnel encaisse | `payments.spec` « un iOS paie par QR client », « un téléphone personnel » |
| FR-019/FR-020 QR client, réponse unique | `payments.spec` « FR-019 … QR client » ; `payments-refusals` « FR-020 — QR inconnu, expiré, déjà utilisé » (un seul corps), « QR d'un autre événement », « A17 … par QR » |
| FR-025 consultation | `get-payment.spec` (terminal, chaque rôle admis, 404 neutres, PURCHASE seulement, solde après) ; annulation : WP12 |
| NFR-005 passage / `tap_id` / QR | `payments-concurrency` : 20 simultanés, même lecture, même `tap_id`, même QR (3 terminaux) → exactement une vente ; 12 QR simultanés sur 5 000 → 5 ventes, solde 0, aucun interblocage |
| NFR-006 rien d'écrit sur refus | helper `refused` de `payments-refusals` sur chaque refus : ventes, lignes, attributions, passages consommés et lus, solde, registre `REJECTED` + code ; `DEBIT_AUTHORITY_EDGE` et corps non objet : rien au registre |
| NFR-007 (part paiements) | `get-payment` : 404 neutre, même corps que vente inexistante |
| NFR-008 (part paiement) | `payments.spec` : jeton ni empreinte (hex/base64/base64url) dans réponse, `api_idempotency`, `audit_log`, métadonnées, journaux stderr ; `payments.dto.spec` : pas d'écho du jeton ; empreinte hors `content_sha256` |
| A4/A14 registre | `payments.spec` (registre `ACCEPTED` lié à la vente, contenu = `purchaseContent`) ; `payments-refusals` (REJECTED, EDGE non rangé, CL002/CL021 non rangés, hors plage, autre serial, seq > 2^63) ; `device-seq-registry.spec` (vecteurs) |
| A5 heure, A27 époque | `operation-time.spec` (±120 s inclusif) ; `payments.spec` « A5 » (anomalie `CLOCK_SKEW`, heure base, `device_occurred_at`), « A27 » |
| A13 garde exclusive | `get-payment` « A13 — preuves mêlées » ; matrice : cas `GET /payments/{}` (`exclusive: 'person'`) |
| C-003 matrice des preuves | `device-auth-matrix.spec.ts` vert avec `payments.cases.ts` (deux routes, contrôleur `PaymentsController`) |
| Rejeu de la même clé | `payments.spec` « rejeu … Idempotency-Replayed, une seule vente » + même clé, autre contenu → `IDEMPOTENCY_KEY_REUSED` |
| Report WP08 constat 3 | `device-key.spec` aux deux bornes ; `payments-refusals` « constat 3 » |
| Report WP10 ETag du battement | `heartbeat-etag.spec` |

## 8. Cycle de retouches (26/10, décisions de l'orchestrateur et du porteur)

Commit de retouches (lane-k, après `71770dce`) ; base `cashless_wp11` recréée puis supprimée.

1. **`x-process: public`** posé sur `createPayment` et `getPayment` (`openapi.yaml`). Retouche hors carte de `media-isolation.spec.ts` : 41 opérations, deux cas ajoutés. `createPayment` : terminal de B présentant un bracelet de A, refus 409 (terminal sans point de vente), jamais 2xx, aucune fuite, instantané inchangé ; pour cela le cas porte un champ facultatif `headers` (clé `<serial>:<seq>` de B et `X-Authority-Epoch`). `getPayment` : vente de A (ligne `PURCHASE` du terminal de A) lue par le personnel de B, 404 neutre ; cas `who: 'staff'` car cette suite sert l'identité du terminal par les en-têtes de test, que la garde exclusive traite en chemin « personne » (le chemin terminal est prouvé par `get-payment.spec.ts`). `transaction_id` ajouté aux motifs d'objets ciblés/listes du test « chez lui, B ne vise aucun objet de A ».
2. **Matrice** : `vendors.cases.ts` ouvre le compte de la participation (`open_participation_account`) ; `RouteCase` reçoit un champ facultatif `headers?: (ctx, who) => Record<string,string>` (retouche de `registry.ts`, une ligne, et une ligne dans le `prepare` de la matrice) ; `POST /payments` a `ok: 201` (terminal passé en KEYPAD_TPE, session ouverte par le `prepare`, lecture neuve, clé neuve, `X-Authority-Epoch: 0`). Cas WP09 verts (suites `vendors/*` et matrice).
3. **`authority_epoch`** déclarée au contrat : propriété entière `authority_epoch` (≥ 0, int64) du schéma `Problem` (époque courante du grand livre, `409 STALE_AUTHORITY_EPOCH`). `npm run generate` et `generate:dart` rejoués ; `npm run check -w @cashless/contracts` : types et Dart à jour. Test : `payments.spec.ts` (« A27 ») valide le corps avec `contractViolations('Problem', …)` (et refuse une valeur non entière). Note : le serveur nomme `instance` ce que le schéma appelle `request_id` (défaut antérieur) : le test complète ce membre.
4. Décisions sans code prises en compte : contrat gardé pour le solde QR ; corps non objet → 400 sans registre ; `sql-config-resolver.ts` non touché (WP14).

Preuves : `tsc --noEmit` propre ; Prettier (vérifié) et ESLint propres ; `npm run check -w @cashless/contracts` vert ; `SKIP_LATENCY=1 npx jest test/integration/payments test/integration/end-to-end test/integration/vendors test/unit --runInBand` : 71 suites, 1359 tests passés, 3 ignorés, 0 échec (dont `media-isolation`, `device-auth-matrix`, `architecture.spec.ts`).
