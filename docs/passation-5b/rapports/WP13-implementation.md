# Compte rendu du lot WP13 (Paiement par QR) — implémentation

Lane : `.worktrees/terminaux-paiement-en-ligne-01M52QB9-lane-m`. Base de test : `cashless_wp13`. Pas de `move-task`.

## Livré (T061 à T065)
- `apps/api/src/payment-requests/` : `qr-token.ts`, `payment-request.dto.ts`, `payment-request.service.ts`,
  `terminal-payment-requests.controller.ts` (create, get, cancel), `customer-payment-requests.controller.ts` (pay,
  createCustomerQrToken), `payment-requests.module.ts` (importé par `AppModule`).
- Cinq opérations servies, `x-process: public` posé, `404` retiré de `payPaymentRequest` (report WP01 cycle 1).
- Tests : `unit/payment-requests/qr-token.spec.ts`, `unit/payment-requests/customer-routes-production.spec.ts`,
  `integration/payment-requests/{merchant-qr,customer-qr}.spec.ts` (+ `qr-fixtures.ts`),
  `device-auth-cases/payments.qr.cases.ts`, aide `createCustomerWallet` dans `support/fake-customer.ts`.

## Écarts au plan (et leur sens)
1. **Fichier de cas de la matrice nommé `payments.qr.cases.ts`** (le prompt dit `payment-requests.cases.ts`). Le registre
   amorce les cas dans l'ordre alphabétique ; ces cas dépendent de la session de vendeur ouverte par `payments.cases.ts`
   et une seconde ouverture la REMPLACE (`open_vendor_session`, `REPLACED`). `payments.qr.cases.ts` passe après
   `payments.cases.ts` et avant `vendors.cases.ts`. Sens : ordre d'amorçage, aucune incidence sur la sécurité.
2. **`createPaymentRequest` ne rend pas de champ `token` à part** : le contrat (`PaymentRequestObject`, source
   prioritaire sur le prompt) ne porte le jeton que dans `qr_payload` (`https://<CLAIM_CODE_DOMAIN>/r/<id>#t=<jeton>`) ;
   le validateur de contrat refuse `token` (hors contrat). Contradiction prompt/contrat signalée, tranchée en faveur du
   contrat (même exposition : le jeton n'apparaît qu'une fois, dans la réponse de création). `createCustomerQrToken`
   rend `token` et `qr_payload` (`CSHL1:<jeton>`) comme au contrat.
3. **`vendor_session_id` laissé optionnel au schéma** (report WP01 mineur 3) : le contrat dit « absente → 409
   VENDOR_SESSION_INVALID », la base l'exige via `assert_vendor_session` ; absent donne donc le `409` du contrat.
4. **Transport du jeton festivalier** : en-tête `X-Payment-Request-Token` (arbitrage WP01), jamais en chaîne de requête
   (test : `?token=` n'est pas lu, `404`). Aucun écart de secret.
5. **Festivalier sur `GET`/`cancel`, jeton absent, faux ou demande inconnue : `404`** (contrat), distinct du `409`
   d'une demande non `PENDING` avec le bon jeton. Obtenu en contrôlant d'abord le jeton par `payment_request_for_token`
   (même `CL037` → `404`), puis `cancel_payment_request` (`CL037` → `409`). Terminal : propriété lue d'abord (`404` si
   autre terminal), puis `cancel_payment_request` (`CL037` → `409`).
6. **`createCustomerQrToken`** : `CL037` (portefeuille d'autrui, bloqué, inconnu) traduit en `404 NOT_FOUND`, un seul
   corps, sans dire lequel.
7. **`payPaymentRequest` : identifiant mal formé** → le même `409 PAYMENT_REQUEST_NOT_PENDING` (le contrat n'a plus de `404`).
8. Contenu chaîné du registre pour les nouvelles opérations (non défini par le protocole) : `type` = `PAYMENT_REQUEST`
   (champs `amount, currency, ttl_seconds, lines`) et `PAYMENT_REQUEST_CANCEL` (`payment_request_id`) ; jamais le jeton, ni
   `vendor_session_id`. À confirmer avec la forme des lots hors ligne (mission 7). Le numéro est enregistré `ACCEPTED`
   sans vente (`transaction_id` nul), par un appel direct à `record_device_seq` (le `accept` de WP11 exige une vente).
9. Long-polling `?wait` : relecture toutes les 250 ms, une transaction courte par lecture (aucune ouverte entre deux),
   borne 25 s ; pas de `LISTEN/NOTIFY`. Le `GET` du festivalier n'attend pas.

## Retouches hors carte (une ligne chacune)
- `apps/api/src/app.module.ts` : import + `PaymentRequestsModule` (2 lignes).
- `apps/api/src/idempotency/idempotent.decorator.ts` et `idempotency.interceptor.ts` : option `deviceSeq: 'when-device'`
  (route partagée terminal/festivalier : la clé `<serial>:<seq>` n'est contrôlée que si la garde exclusive a prouvé un
  terminal). `deviceSeq: true` inchangé. **Conflit probable avec WP12** (`reversePayment` terminal ou personne) : fusionner
  les deux modifications ; l'option `'when-device'` peut servir aux deux.
- `packages/contracts/openapi.yaml` : `x-process: public` sur les 5 opérations, `404` retiré de `payPaymentRequest` ;
  `packages/contracts/generated/openapi.ts` régénéré (`npm run generate`) ; `node scripts/check.mjs` et le contrôle Dart : à jour.
- `apps/api/test/integration/end-to-end/media-isolation.spec.ts` : `x-process: public` fait entrer les 5 opérations dans le
  balayage d'isolation : 5 cas ajoutés, demande de A amorcée, `{payment_request_id}` dans `url()`, compte 41 → 46
  (**conflit de ligne probable avec WP12** : additionner les deux).
- `apps/api/test/support/fake-customer.ts` : dans la carte.

## Points soumis au porteur / à l'orchestrateur
- Aucun écart qui affaiblit la sécurité n'a été codé. Rien à soumettre au porteur.
- Signalé, non tranché (comme prévu) : `humanBearer` au contrat contre `CustomerAuth` (faux du port, refusé en production
  — test `customer-routes-production.spec.ts`). Aucun nouveau faux.
- La pile `X-Payment-Request-Token` : masquage de journaux déjà couvert par `redactSecrets` (`request-token: …`) ; aucun
  journal de requête n'existe aujourd'hui.

## Fichiers à faire relire par une personne
`apps/api/src/payment-requests/qr-token.ts` (tirage des jetons, empreinte) et `payment-request.service.ts` (ordre des
verrous, enchaînement verrou → moteur → confirmation dans une seule transaction, traduction des refus sans oracle).

## Critères d'acceptation et preuves (base `cashless_wp13`, Jest `--runInBand`)
- FR-018 (QR commerçant, jeton une fois, `nonce_hash` = SHA-256, vente à la confirmation) : `merchant-qr.spec.ts`
  « FR-018, NFR-008 : 201… » et « FR-018, SC-002 : PURCHASE écrite… ».
- FR-019 (QR client) : `customer-qr.spec.ts` « FR-019, NFR-008… », « encaissement par POST /payments… ».
- FR-020 (même `409`, même corps) : `merchant-qr.spec.ts` « FR-020, NFR-008 : rejeu du jeton, expirée, annulée, inconnue,
  mauvais jeton… » (+ test « pas de 404 pour payPaymentRequest ») ; QR client : `customer-qr.spec.ts` « jeton expiré,
  inconnu ou d'un autre événement → 422 QR_TOKEN_INVALID ».
- NFR-005 : `merchant-qr.spec.ts` « 20 paiements simultanés du même jeton → exactement une vente » (20 festivaliers) et
  « …par le MÊME portefeuille » ; `customer-qr.spec.ts` « 20 encaissements simultanés du même QR client » ; annulation et
  paiement simultanés (une seule issue).
- NFR-008 (local) : base sans jeton (`payment_request`, `payment_request_detail`, `api_idempotency`, `audit_log`) et
  `transient` sans réponse gardée : « A3, NFR-008 : route transient… » (deux routes). Balayage complet : WP14.
- NFR-009 : `unit/payment-requests/customer-routes-production.spec.ts` (graphe de production refuse de démarrer, routes
  derrière `CustomerGuard` / `DeviceOrCallerGuard`).
- C-003 : `device-auth-matrix.spec.ts` (3 cas de `payments.qr.cases.ts`), `<serial>` d'un autre terminal → `422` rien d'écrit.
- C-001 / verrous : « garde de session… » et « ordre terminal → session » (mutation « garde avant le terminal » essayée :
  le test échoue ; restaurée) ; report WP05 : « refus du moteur… aucun wallet_id posé » ; numéro déjà rangé (CL002) :
  refus tel quel, rien d'ajouté au registre.
- Reports WP11 : refus du registre ne masque rien (modèle `refuse` : le refus est rangé en transaction séparée ; une
  erreur du registre est relancée telle quelle).

## Résultat des suites
Voir la fin de ce fichier (passe complète `npx jest --runInBand` sur `cashless_wp13`).

### Passe complète (base `cashless_wp13`, `npx jest --runInBand`)
130 suites, 2096 tests : 127 suites vertes, 3 échecs, tous de latence indicative (`NFR-009 p95`) : `devices/config.spec.ts`,
`devices/heartbeat.spec.ts`, `end-to-end/device-latency.spec.ts`. Les deux premiers échouent aussi à l'identique sans mes
changements (`git stash`), la troisième passe isolément ; instables connus du poste, sans lien avec le lot.
`npx eslint` sur les fichiers touchés, `tsc --noEmit`, `prettier` : propres. pgTAP : aucune migration touchée, non rejoué.
Commit : `ee6d78ce` dans la lane-m. Sous-tâches T061 à T065 marquées `done`. Base `cashless_wp13` à supprimer par l'orchestrateur
(`dropdb`) ou par moi si demandé.
