# Research: Encaissement en ligne

Sources : études de l'existant du 22/10/2026 (base `packages/ledger-sql`, API `apps/api`, contrat), décisions du
porteur (`decisions/`), `docs/08-pile-logicielle.md`.

## R-01 — argon2id : dépendance `argon2@0.44.0`

- **Decision**: paquet `argon2` (ranisalt/node-argon2), version exacte `0.44.0`, sous Node.js 22. Paramètres argon2id :
  `memoryCost = 19456` (19 Mio), `timeCost = 2`, `parallelism = 1`, sel aléatoire de 16 octets, secret
  `VENDOR_PIN_SECRET` (option `secret` d'argon2, 32 octets au moins). Format PHC stocké (`$argon2id$v=19$…`).
- **Rationale**: le document 08 (ADR-78) arrête Node 22 et `argon2` ; la 0.45 ne livre plus de binaire `darwin-x64`
  (poste du porteur, `ignore-scripts=true`) et n'apporte aucun correctif de sécurité (journal : abandon de Node 18/20,
  compilation Solaris, types). Paramètres = minimum recommandé par OWASP pour argon2id ; vérification mesurée à 33 ms
  sur le poste (Intel), 10 essais.
- **Alternatives considered**: Node 24 et `crypto.argon2` (contraire au document 08) ; `@node-rs/argon2`, `hash-wasm`
  (non retenues par le document 08) ; `argon2@0.45.1` (pas de binaire darwin-x64).
- **Chaîne d'approvisionnement** (règle du document 08, comme pour `jose`) :
  - registre officiel npm ; mainteneur unique `ranisalt`, dépôt `github.com/ranisalt/node-argon2`, `gitHead`
    `cd4eae514b41b1098f2e2d8a32a4b4a1fe0848a9` ; publiée le 10/08/2025 (plus de 14 mois) ;
  - intégrité `sha512-zHPGN3S55sihSQo0dBbK0A5qpi2R31z7HZDZnry3ifOyj8bZZnpZND2gpmhnRGO1V/d555RwBqIK5W4Mrmv3ig==` ;
  - script `install` (`cross-env ZERO_AR_DATE=1 node-gyp-build`) **non exécuté** (`ignore-scripts=true`, vérifié en CI) :
    les binaires N-API précompilés du paquet (`prebuilds/linux-x64`, `darwin-x64`, …) sont chargés à l'exécution par
    `node-gyp-build` ; chargement et vérification testés sur le poste avec `npm install --ignore-scripts` ;
  - dépendances : `@phc/format@1.0.0` (2022), `node-addon-api` (8.x, en-têtes C++, sans script), `node-gyp-build@4.8.4`
    (2024, sans script), `cross-env` (10.x, sans script, inutile à l'exécution) ; aucune n'a de script d'installation ;
  - à figer dans `package-lock.json` (intégrités), version exacte dans `apps/api/package.json` ;
  - **provenance** (A16) : attestation SLSA v1 publiée sur le registre (`/-/npm/v1/attestations/argon2@0.44.0`,
    construite par GitHub Actions) ; `npm audit signatures` : attestations vérifiées. Empreintes SHA-256 des binaires
    chargés : `prebuilds/linux-x64/argon2.glibc.node` `d573da575d5c8a1ad71edd066d8222a7d99e590bf09daa9204847143b3ba8cd0`,
    `prebuilds/linux-x64/argon2.musl.node` `90d12fb13b719fcb8deae23607d093166bc2ba44791a2fd51c966f626e0ec47a`,
    `prebuilds/darwin-x64/argon2.glibc.node` `1698dae58318847337fac1e9c24b9f455ceb5e15f7578ca96558b4d821bdc166` ;
    un test compare ces empreintes au paquet installé ;
  - **au démarrage** : chargement et vecteur connu vérifiés, démarrage refusé sinon ; la CI (linux-x64 glibc) le
    prouve ; la plateforme de production n'est pas arrêtée (OP-N11) : le test de démarrage y sera rejoué ;
  - `cross-env` devient une dépendance installée en production (inutile à l'exécution, sans script) : signalé.
  - **Complément du 23/10/2026 (WP08)** : `cross-env` tire une entrée non prévue ci-dessus,
    `@epic-web/invariant@1.0.0` (MIT, sans script d'installation, intégrité
    `sha512-lrTPqgvfFQtR/eY/qkIzp98OGdNJu0m5ji3q/nJI8v3SXkRKEnWiOxMmbvcSoAIzv/cGiuvRy57k4suKQSAdwA==`, signature
    du registre vérifiée par `npm audit signatures`). Signalée par l'implémenteur selon la consigne du lot ;
    **acceptée par le porteur** le 23/10/2026. La liste des transitives attendues de WP08 l'inclut désormais.
- **Passe contradictoire**: faite sur le plan après rédaction (R-11) ; constats et suites consignés là.

## R-02 — Session de vendeur

- **Decision**: au plus une session ouverte par terminal (`vendor_session`, index unique partiel `WHERE closed_at IS
  NULL` sur `device_id`). L'ouverture ferme la session précédente du terminal (motif `REPLACED`). Le terminal renvoie
  `vendor_session_id` (non secret) dans chaque vente, annulation et demande QR ; le serveur relit la session ouverte du
  terminal : absente, close, expirée (12 h) ou différente de l'identifiant reçu → `409 VENDOR_SESSION_INVALID`, rien
  n'est écrit. Fin de session : déconnexion, 12 h, ouverture d'une autre, suspension ou révocation du terminal (relue à
  chaque vente, sans tâche planifiée), désactivation ou blocage du vendeur.
- **Rationale**: décision du porteur (attribution par le serveur, aucun jeton) ; l'identifiant renvoyé évite
  d'attribuer à B une vente composée par A pendant un relais.
- **Alternatives considered**: jeton de session (refusé par le porteur) ; identifiant de vendeur envoyé par le terminal
  (le serveur croirait le terminal).

## R-03 — Prestataire d'une route de terminal seul (idempotence)

- **Decision**: `IdentityTenantContext.current` accepte un terminal quand la route est gardée par `@DeviceAuth` et ne
  porte ni personne ni festivalier : le prestataire est celui du terminal (`req.device.operatorId`). Portée de clé
  `device:<deviceId>:` (comme `counterScope`). La clé du contrat (`<serial>:<seq>`) est contrôlée par son motif.
- **Rationale**: aucune route `@Idempotent` de terminal seul n'existe (étude de l'API, point 5) ; `createPayment` en a
  besoin.
- **Alternatives considered**: idempotence par le seul moteur d'écritures (ne couvre ni les lignes de vente ni la
  réponse rejouée).

## R-04 — Catalogue versionné et prix contrôlés

- **Decision**: `catalog_version` (point de vente, numéro croissant, contenu figé en lignes `catalog_version_item`) créée
  par chaque modification (fonction de la base) ; `catalog_category` et `catalog_item` portent l'état courant.
  `device_catalog_served (device_id, pos_id, version, served_at)` en ajout seul, écrit par la construction de la
  configuration. `record_sale_lines(tx, device, lines)` accepte une ligne si l'article est actif dans la version
  courante **ou** dans une version servie à ce terminal, au prix et au taux de cette version ; somme = montant.
- **Révisé après R-11 (A2)** : seulement la version courante et la **dernière** version servie au terminal, une
  seule version par vente (contracts/catalog.md) ; le texte initial (« toute version servie ») élargissait la décision.
- **Rationale**: décision du porteur (prix servi ou actuel) ; `record_config_served` ne voit pas le catalogue (étude
  de la base, point 7) et sa déduplication ne doit pas changer.
- **Alternatives considered**: historique des prix par intervalle de temps (dépend de l'horloge du terminal) ; version
  dans `terminal_settings` (mélange deux sujets).

## R-05 — Annulation unique et garde d'annulation

- **Decision**: migration : index unique sur `journal_transaction(reverses_id) WHERE reverses_id IS NOT NULL` ;
  fonction `assert_reversible(p_tx, p_device, p_vendor_session, p_now)` qui contrôle : vente `PURCHASE` du même
  prestataire, pas encore annulée, même terminal, même vendeur (session ouverte de ce vendeur), dans la fenêtre
  `reversal_window_minutes` de l'événement (heure de la base). Le `SUPERVISOR` passe par le back-office ou par le jeton
  d'approbation sur place (`X-Approval-Token`, mécanisme existant) qui sert `supervisor_pin_proof`. Le moteur écrit le
  `REVERSAL` (lignes miroir de l'original, constructeur existant).
- **Révisé après R-11 (A5, A8, A9)** : fenêtre ancrée sur `recorded_at` (heure de la base), heure lue dans la base ;
  `assert_reversible` sur tous les chemins ; `SUPERVISOR` au terminal par jeton sur place adapté à un appelant
  terminal, au back-office par demande à deux personnes (`SALE_REVERSAL`, source `BACKOFFICE`) — décision
  `DM-01M5HRNBX5CTP7CAKN4JRCY3F9` (contracts/payments.md).
- **Rationale**: la base ne garantit aujourd'hui ni l'unicité ni la cible d'une annulation (étude de la base, point 6) :
  renforcement, consigné.
- **Alternatives considered**: contrôle dans l'API seule (deux annulations simultanées passeraient).

## R-06 — Paiement par bracelet : frontières de transaction

- **Decision**: une transaction (`IdempotentTx`) : contrôle de la session de vendeur → `assert_device_active` →
  `register_tap` (ou `tap_id` du même terminal) → moteur `PURCHASE` (`source ONLINE`, `deviceId`, `mediaId`,
  `metadata.vendor_id`, `metadata.vendor_session_id`) → `record_sale_lines` → `consume_tap`. Refus à effets durables
  (`UID_MISMATCH`, `SIGNATURE_MISMATCH`, `CLONE_SUSPECTED`) : `TapService.settleRefusal` existant. Mode : `CATALOG_POS`
  exige des lignes, `KEYPAD_TPE` les refuse ; `TOPUP_DESK` ne vend pas. `nfcOnly` sur la lecture. Le vendeur de la vente
  est aussi écrit dans une table `sale_attribution (transaction_id, vendor_id, vendor_session_id, device_id)` en ajout
  seul, pour les relevés.
- **Rationale**: §7.6 (frontières), C-001 ; `metadata` n'entre pas dans l'empreinte de `post_transaction` (étude de la
  base) : l'attribution est aussi rangée dans une table interrogeable.
- **Alternatives considered**: tout dans une seule fonction SQL (le moteur d'écritures TypeScript calcule les lignes et
  les frais : il resterait à dupliquer).

## R-07 — Identification au guichet : reportée à la mission 10

- **Decision**: reportée à la mission 10 (décision du porteur au plan, 22/10/2026, `DM-01M5HQE0V4PC23YBJKEZTEQVET`).
  La 5b retire à `cashless_app` l'`INSERT` et l'`UPDATE` directs sur `kyc_verification` (aucun usage dans l'API).
- **Rationale**: la base n'a ni numéro vérifié pour une partie `CUSTOMER` (pas de téléphone ; comptes festivaliers en
  mission 10) ni lien entre une personne (`app_user`) et un festivalier : « compte au numéro vérifié » et « l'agent
  n'identifie pas son propre portefeuille » ne sont pas tenables. Sans identification, tout portefeuille reste `NONE` :
  plafonds les plus stricts, aucun affaiblissement.
- **À reprendre en mission 10** : fonction de la base qui écrit l'identification et refuse un agent titulaire ; action
  d'approbation `KYC_REVOCATION` (le registre n'accepte qu'un rôle par action ; le contrat en demande deux) ;
  contradiction §6.3 / contrat (C-011).
- **Alternatives considered**: servir en 5b avec deux contrôles en dette (écarté par le porteur : un agent pourrait
  relever ses propres plafonds).

## R-08 — Côté festivalier du QR

- **Decision**: `payPaymentRequest` et `createCustomerQrToken` gardés par `CustomerAuth` (port d'identité du
  festivalier, mission 4). Seul le faux existe ; il est refusé en production (garde existante). OP-N43 est complété :
  ces deux routes s'ajoutent à celles qui attendent l'identité réelle (mission 10). L'écart `humanBearer` (contrat)
  contre `CustomerAuth` est le même que pour `claimMedia` : signalé, non tranché ici.
- **Rationale**: décision du porteur du 22/10/2026.

## R-09 — OP-N74 et point de vente « supprimé »

- **Decision**: `create_device_enrollment_code` et `enroll_device` (remplacées par migration) lisent `event.status` :
  `CLOSED` → refus `422 ENROLLMENT_EVENT_CLOSED` (nouveau code `CL031`) ; `CLOSING`, `RECONCILING`, `SETTLING`,
  `REFUND_WINDOW` → refus pour `CATALOG_POS` et `KEYPAD_TPE`, permis pour `TOPUP_DESK`. Le point de vente doit exister et
  appartenir à l'événement du code (déjà contrôlé à la création ; relu à l'enrôlement). Aucune suppression de point de
  vente n'existe en base : la partie « point de vente supprimé » de FR-024 est sans objet (signalé). `UPDATE (event_id,
  pos_id)` sur `device` est retiré à `cashless_app`, qui n'en a aucun usage (aucune requête de l'API ne l'écrit) : la
  réaffectation directe ne contourne plus ces refus (part d'OP-N69).
- **Rationale**: décision du porteur (états bloquants) ; étude de la base, points 4 et 5.

## R-10 — Secret `VENDOR_PIN_SECRET`

- **Decision**: lu par `hmacKey` (32 octets au moins, hexadécimal ou base64) ; obligatoire en production, secret de
  test refusé ; distinct des autres secrets (`assertDistinctHmacKeys`). Rotation : invalide toutes les empreintes ; le
  commerçant redonne un PIN à chaque vendeur (consigné dans un ADR).
- **Rationale**: décision du porteur du 22/10/2026.

## R-11 — Passe contradictoire (22/10/2026)

Relecteur distinct, lecture seule ; rapport complet : 27 constats (5 bloquants, 12 importants, 10 mineurs). Tous
traités ; aucun abandonné. Décisions du porteur demandées pour A8/A9 (`DM-01M5HRNBX5CTP7CAKN4JRCY3F9`) et A15
(`DM-01M5HRNFEFWDG47YEGE5N3C3GN`).

| # | Gravité | Constat | Disposition |
|---|---|---|---|
| A1 | Bloquant | Bracelet bloqué payé par son `tap_id` (`byId` sans relecture) | changed : `assert_tap_payable` (bracelet `ACTIVE`, terminal, fenêtre) |
| A2 | Bloquant | Toute version servie admise : la décision du porteur était élargie | changed : version courante ou dernière servie, une version par vente |
| A3 | Bloquant | Jetons QR en clair dans `api_idempotency` | changed : routes à jeton en `transient` ; recherche des secrets étendue |
| A4 | Bloquant | `record_device_seq` absent (sync_protocol §3.2) | changed : intégré à toute route de terminal à clé, refus 4xx compris |
| A5 | Bloquant | Fenêtre d'annulation ancrée sur l'heure du terminal | changed : `recorded_at` ; `occurred_at` borné à ±120 s (`CLOCK_SKEW`) |
| A6 | Important | Compteur de PIN annulable, verrou tenu pendant argon2 | changed : « compter d'abord » (transactions A et B), essai unique par terminal |
| A7 | Important | Ordre des verrous ; sessions non fermées à la suspension | changed : ordre global ; `set_device_status` remplacée |
| A8 | Important | Jeton sur place inutilisable par un terminal | changed : variante d'appelant terminal (décision du porteur) |
| A9 | Important | Annulation au back-office : source et type non réglés | changed : `SALE_REVERSAL` à deux, `BACKOFFICE` ; `assert_reversible` partout |
| A10 | Important | Paiement QR : SQL ne peut appeler le moteur ; contrôles manquants | changed : verrouiller → moteur → `confirm_payment_request` |
| A11 | Important | Vendeur passé par l'API à l'attribution | changed : vendeur retrouvé par la session |
| A12 | Important | `app_mode`, `nfc_enabled`, `personal_phone` encore modifiables | changed : retirés |
| A13 | Important | Routes « terminal ou personne » sans garde | changed : garde exclusive, sans repli |
| A14 | Important | `<serial>` non lié ; 409 non définitifs enregistrés | changed : `serial` contrôlé ; ces refus non enregistrés |
| A15 | Important | Limite du PIN non consignée et plus large | accepted : OP-N76, ADR-121, levée avec OP-N56 (décision du porteur) |
| A16 | Important | Provenance du binaire argon2 ; plateforme de production | changed : provenance SLSA vérifiée, empreintes, vecteur au démarrage |
| A17 | Important | Statut du portefeuille lu sans verrou | changed : `assert_wallet_payable` sur les trois moyens |
| A18 | Mineur | Terminal de la lecture contrôlé par l'API seule | changed : `consume_tap` remplacée et `assert_tap_payable` |
| A19 | Mineur | Seconde annulation traduite par `23505` générique | changed : traduction par le nom de la contrainte |
| A20 | Mineur | `REVOKE SELECT (colonne)` sans effet | changed : `REVOKE` de la table puis `GRANT` par colonne ; vue `vendor_public` |
| A21 | Mineur | Versions de catalogue concurrentes ; délégation en API seule | changed : verrou du point de vente ; délégation revérifiée par la base |
| A22 | Mineur | Le terminal ne connaît pas les vendeurs | changed : `listTerminalVendors` |
| A23 | Mineur | `openVendorSession` sans clé | changed : `transient` |
| A24 | Mineur | Consultation d'une demande par le festivalier | changed : servie, jeton exigé |
| A25 | Mineur | Événement d'un QR client | changed : événement du grand livre du portefeuille |
| A26 | Mineur | Test NFR-002 trop faible | changed : PIN de test reconnaissables, préfixe `$argon2id$`, `api_idempotency`, `audit_log` |
| A27 | Mineur | `X-Authority-Epoch` flou | changed : contrôlé (`STALE_AUTHORITY_EPOCH`) |

Fichiers à faire relire par une personne (règle 4), selon le relecteur : `0031_vendors.sql`, `post-roles.sql`,
`0033_payments.sql`, `0034_payment_requests.sql`, `set_device_status` remplacée, `apps/api/src/vendors/`, la garde
d'approbation sur place adaptée.
