# Relecture WP01 — Contrat d'API et types — cycle 1

Relecteur : claude (distinct de l'implémenteur). Lane `lane-a`, commit `60b24a43` (seul commit du lot ; il ne touche
que `packages/contracts/**` et les deux catalogues de messages). Prompt runtime suivi
(`spec-kitty agent action review WP01`). Aucune base créée.

## Verdict : APPROUVÉ (3 constats mineurs, non bloquants)

## Vérifications refaites (affirmations du compte rendu)
- `npm run check -w @cashless/contracts` (lane, liens node_modules en place) : « types à jour », « types Dart à jour ».
  Seul avertissement : `LATE_CLAIM_INVALID` sans puce, antérieur à la mission.
- `generated/problem-statuses.ts` : ENROLLMENT_EVENT_CLOSED 422, VENDOR_SESSION_INVALID 409, VENDOR_PIN_INVALID 401,
  SALE_LINES_INVALID 422 ; REVERSAL_NOT_ALLOWED 422, PAYMENT_REQUEST_NOT_PENDING 409. Conforme au YAML.
- Script de contrôle (yaml du checkout principal) : les 15 opérations ajoutées existent avec les bons chemins et
  méthodes ; `listTerminalVendors`, `openVendorSession`, `closeVendorSession` : une seule entrée
  `{deviceMtls, deviceToken, deviceSignature}` ; les 12 autres héritent de `humanBearer`. Tags `Vendeurs`/`Catalogue`
  seulement. `x-process` : 39 (inchangé). Opérations portant un tag de `MISSION_TAGS` : 48 (inchangé).
  `operationId` en double : aucun. Aucun chemin ajouté ne correspond à `MISSION_PATHS`.
- Champs secrets lisibles dans une réponse (parcours récursif des schémas de toutes les réponses : `pin`, `pin_hash`,
  `failed_attempts`, `token`, `nonce_hash` sans `writeOnly`) : seul `createCustomerQrToken:201.token`, voulu (jeton
  rendu une fois, route non conservée). `Vendor`, `VendorSession`, `TerminalVendor`, `SaleVendor`, `PaymentResult` :
  ni PIN, ni empreinte, ni compteur. `pin` `writeOnly` + `^[0-9]{6}$` dans `VendorCreate`, `VendorPinChange`,
  `VendorSessionOpen` ; `additionalProperties: false`.
- Réponses uniques : `VENDOR_PIN_INVALID` (401, même corps pour PIN faux, inconnu, bloqué, désactivé, autre
  commerçant, bon PIN après blocage) ; `listTerminalVendors` ne dit rien du blocage ; détails des messages neutres
  (« Le code PIN est refusé. », « n'est plus payable ») ; `payPaymentRequest` → 409 unique ; QR client → 422 unique ;
  jeton festivalier absent/faux = demande inconnue (404).
- Non rejouées : `openVendorSession`, `closeVendorSession` (UUID, renvoi → 409, arbitrage), `createPaymentRequest`
  (en-tête `Idempotency-Replayed` retiré), `createCustomerQrToken` ; `createDeviceEnrollmentCode` était déjà
  `transient`.
- `supervisor_pin_proof` refusé (422) ; `ApprovalToken` ajouté à `reversePayment` ; `202` back-office et
  `SALE_REVERSAL` dans `ApprovalAction` ; garde exclusive décrite sur getPayment, reversePayment, getPaymentRequest,
  cancelPaymentRequest ; jeton festivalier en en-tête `X-Payment-Request-Token`, jamais en requête ni chemin.
- `vendor_session_id` non `required` (description) : conforme au prompt (un `required` casserait le back-office).
- `npm test -w @cashless/api -- test/unit/errors/sqlstate-map.spec.ts` : 83/83 ; `prettier --check` messages :
  conforme ; `npm run typecheck` : 0.
- Non rejoués ici (base partagée, à l'orchestrateur) : `device-auth-matrix`, `configuration-isolation`,
  `media-isolation`, `isolation-sweep`, `device-isolation`, `settings-catalog`. Le DELETE de `closeVendorSession`
  passe dans la boucle « non servies : 404 » (méthode transmise telle quelle, sans corps ni clé) : à confirmer au
  Jest complet.

## Contradictions §0.3 (déjà remontées) — effet de sécurité
Aucune n'affaiblit la sécurité : le refus a lieu dans les trois cas, seuls le statut ou le nom changent.
- `REVERSAL_NOT_ALLOWED` 422 au lieu de 403 : même refus.
- `QR_TOKEN_INVALID` 422 au lieu de 409 `PAYMENT_REQUEST_NOT_PENDING` : réponse unique gardée, aucun oracle.
- `REVERSAL_WINDOW_EXPIRED` 409 distinct : seule fuite possible, la fenêtre d'une vente révélée à un autre vendeur
  si la fenêtre était contrôlée avant le vendeur et le terminal (voir constat 2).

## Constats
1. **Mineur** — `packages/contracts/openapi.yaml`, `payPaymentRequest`, réponses : `'404'` reste listé alors que la
   description (et `qr-payments.md` §2 : « toute autre issue ») veut `409 PAYMENT_REQUEST_NOT_PENDING` pour une
   demande inconnue. Scénario : WP13 lit la liste des réponses et rend 404 pour un identifiant inconnu → distingue
   « inconnue » de « payée/annulée/expirée » (FR-020). Correction : retirer `'404'` de cette opération, ou dire dans
   la description à quoi il sert (aucun cas n'est prévu). À faire au plus tard par WP13.
2. **Mineur** — `reversePayment`, description (chemin terminal) : l'ordre des contrôles n'est pas dit. Pour qu'un
   autre vendeur ou un autre terminal n'apprenne pas l'âge de la vente, contrôler vendeur et terminal avant la
   fenêtre (autre vendeur hors fenêtre → `422 REVERSAL_NOT_ALLOWED`, pas `409 REVERSAL_WINDOW_EXPIRED`).
   Correction : une phrase dans la description, ou consigne à WP12.
3. **Mineur** — `createPaymentRequest`, corps en ligne (route de terminal uniquement) : `vendor_session_id` aurait pu
   être `required` sans casser le back-office (contrairement à `ReversalRequest`). Sans effet de sécurité (le refus
   409 est décrit) ; à laisser tel quel ou durcir dans un lot ultérieur.

## Liste anti-motifs
1. Code mort : N/A (contrat et types générés ; consommateurs WP08-WP13). 2. Test à faux : N/A (aucun test ajouté ;
preuve = `npm run check`). 3. Retour vide silencieux : N/A. 4. Couverture FR : PASS pour FR-027/C-004 (check, types) ;
FR-017, FR-024, C-003, C-007 documentés au contrat, prouvés par les lots de routes. 5. Surface figée : PASS (aucun
`.sql` de `packages/ledger-sql/`, aucun test du contrat modifié). 6. Décision verrouillée : PASS (aucun `x-process`,
aucun tag de `MISSION_TAGS`). 7. Fichiers partagés : PASS (aucun autre WP ne possède ces fichiers). 8. Fragilité :
N/A (aucun `raise`).

## Écarts de sécurité ouverts introduits par le lot
Aucun. Renforcements constatés : jeton `payPaymentRequest` `writeOnly`, expiration fondue dans la réponse unique,
clés UUID non rejouables des sessions. Fichiers à faire relire par une personne : aucun.
