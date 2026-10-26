# Compte rendu du lot WP14 (implémenteur) : preuves de bout en bout, CI, consignation

Lane `…-lane-n`, commit `90044837` (un seul commit). Base `cashless_wp14` (supprimée). T066 à T072 marquées `done`. Pas de `move-task`.

## Travaux de fusion (faits en premier)
1. **Intercepteur d'idempotence.** `deviceSeq: 'when-device'` de WP13 est gardé (`deviceSeq: true` reste terminal seul). Le contrôle UUID de WP12 est rétabli sans élargir un autre chemin : nouvelle option `keyUuid: 'without-device'` (`idempotent.decorator.ts`, `idempotency.interceptor.ts`), posée sur `reversePayment` seulement ; le chemin terminal garde `<serial>:<seq>`, le chemin festivalier de WP13 garde sa clé libre (le contrat ne lui demande pas d'UUID ; le contrat de `reversePayment` demande « libre (UUID) » pour la personne). Tests (`device-key.spec.ts`) : route `deviceSeq: true` sans terminal refusée par sa garde (401, rien réservé) ; route partagée : personne + clé non UUID → 422 avant réservation, personne + UUID admis, terminal + UUID refusé, terminal + bonne clé admis.
2. **`x-process: public`** remis sur `reversePayment` (`openapi.yaml`, `npm run generate` rejoué : fichiers générés non suivis par git). `media-isolation.spec.ts` : cas `reversePayment` ajouté, compte 47 (41 + 5 + 1). Cas `createPayment` resserré à `refused: [404]` (report WP11 cycle 2, constat 3).
3. **Mineurs WP13.** (1) `media-isolation` : la demande de A est amorcée avec un jeton connu (`newMerchantToken` / `nonceHash`), envoyé depuis un festivalier de B en en-tête `X-Payment-Request-Token` (`getPaymentRequest`, `cancelPaymentRequest` : 404 ; `payPaymentRequest` : 409), `snapshot()` couvre désormais `payment_request` ; `send` applique aussi les en-têtes propres aux GET. (2) Test du rejeu : `merchant-qr.spec.ts` « report WP13 » (vente de même clé déjà au grand livre → 409, demande intacte, aucune vente). **Mutation `if (false)` sur `written.replayed` : survit** (équivalent : sans la garde, la confirmation SQL refuse aussi par le même 409). La garde est une seconde barrière non atteignable par une route publique ; je ne peux pas la tuer par comportement.

## Autres reports traités
- **`sql-config-resolver.ts`** (retouche hors carte, décision du porteur déjà prise, non faite par WP11 : l'avertissement était toujours là) : requêtes séquentielles. Preuve : `payment-journey.spec.ts` espionne `pg.Client.prototype.query` et échoue sur tout chevauchement (79 requêtes chevauchées avant la correction, 0 après ; l'écoute de `process.on('warning')` ne voit pas l'avertissement sous Jest, d'où l'espion).
- **`argon2-supply-chain.spec.ts`** (hors carte, report WP08) : test de la fermeture transitive d'argon2 comparée à `EXPECTED_NEW_LOCK_ENTRIES` + six entrées déjà présentes avant la mission (cross-spawn, isexe, path-key, shebang-command, shebang-regex, which, vérifiées dans le verrou de la base de fusion). Toute entrée nouvelle fait échouer.
- **Reports WP11 N1/N3** : `payment-concurrency.spec.ts` « pannes pendant un refus » : panne du registre sur refus non-lecture (500, rien vendu), échec de `settleRefusal` sans erreur du registre (500, rien vendu).
- **Ordre des verrous en charge** : couvert par les cas croisés de `payment-concurrency` (20 envois, QR pendant annulation, annulation pendant suspension, 3 tours chacun, aucun 5xx).
- **Non faits** (consignés) : pool de `SessionLock` non mesuré (OP-N80 + ADR-130, proposés, à confirmer par le porteur) ; sonde de la mission 7 reportée dans le bloc mission 7 de `PROMPTS-A-ENVOYER.md` ; alignement de `contracts/vendors.md` (`kitty-specs`, hors lane) et propriétaire des fonctions de purge : toujours ouverts ; reformatage des commentaires > 100 caractères de WP09 : laissé à la fusion (décision du 14/10 ; Prettier ne coupe pas les commentaires) ; mes nouveaux fichiers de test ont aussi des chaînes et commentaires > 100 caractères (titres `it(...)`).

## Les cinq suites (`apps/api/test/integration/end-to-end/`)
- `payment-journey.spec.ts` (12 étapes) : vendeurs (MERCHANT_ADMIN), catalogue (ORGANIZER_ADMIN), caisse enrôlée par la route avec code lié au point de vente, configuration (version du catalogue servie), session, bracelet en un aller-retour puis `tap_id`, QR commerçant payé, QR client encaissé, annulation vendeur, annulation hors fenêtre par SUPERVISOR (jeton sur place), 5 PIN faux → bloqué sur le second terminal → nouveau PIN débloque, changement de prix (ancien prix servi accepté, puis refusé après relecture), contrôles finaux (attribution 100 %, Σ lignes = montant débité, aucune vente sans lignes, aucun passage perdu, refus pour fonds insuffisants ne consomme pas le passage). **Écritures directes en base après l'amorçage : une seule**, `rw.ageSale` (recul de `recorded_at` pour sortir de la fenêtre de 15 min), déclarée en tête du fichier.
- `payment-isolation.spec.ts` : opérations lues dans le contrat (tags Vendeurs, Catalogue, Paiements, Demandes de paiement QR + `createCustomerQrToken` = 23), chacune a un cas, aucun orphelin ; B (3 personnes, terminal enrôlé, festivalier) sur les objets de A : jamais 2xx, jamais 5xx, aucune donnée de A dans la réponse, snapshot A avant/après identique ; listes de B ; commerçant 1 contre commerçant 2 (même prestataire) ; 13 tables sous `cashless_app` avec B posé : 0 ligne de A, A en a bien (contrôle).
- `payment-secrets.spec.ts` : 5 PIN aléatoires (écartés s'ils sont déjà lisibles en base, recherche avec bornes de chiffres), jetons QR commerçant et client, `VENDOR_PIN_SECRET` et `VENDOR_PIN_IDEMPOTENCY_SECRET` (hex, base64, hex du texte) ; toutes les tables, journaux (Logger, console, stdout/stderr), toutes les réponses y compris d'erreur ; jetons rendus une seule fois (réponse de création) ; `$argon2id$` confiné à `vendor.pin_hash` (colonne par colonne) ; contrôle du balayage (empreintes `pin_hash`, `nonce_hash`, `audit_log`, `api_idempotency`, `device_seq_registry` non vides).
- `payment-latency.spec.ts` : 200 paiements en série (+1 d'échauffement hors mesure), mesure autour de `PaymentsService.create`, p95 ≤ 200 ms, p99 ≤ 500 ms, `SKIP_LATENCY`. Mesures : **p50 61,5 / p95 67,4 / p99 79,1 ms** (puis p95 81,1 / p99 96,6 ms à la passe finale).
- `payment-concurrency.spec.ts` : 20 envois → 1 vente pour : même lecture, même `tap_id`, même jeton QR commerçant, même QR client, même vente annulée ; croisés : paiement QR / annulation de la demande, annulation de vente / suspension du terminal ; chaque cas : aucun 5xx, aucune vente sans attribution ou sans écritures.

## CI
`.github/workflows/ledger-tests.yml` : étape « Latence du paiement, NFR-001 (suite seule, sans nouvel essai) » après les autres mesures (`--runInBand end-to-end/payment-latency`), rien retiré. pgTAP nouvelles (`tests_vendors`, `tests_catalog`, `tests_payments`, `tests_payment_requests`, `tests_payment_rights`, `tests_enrollment_event_state`) déjà lues par `test-pgtap.sh` (`tests/*.sql`) et `check:generated` ; `CI.md` : section de la mission, relevé de passes.

## Consignation vérifiée / complétée (T071)
- OP-N76 (risque, raison, mission 11, condition de levée, bornes `tests_execute_grants.sql`/`tests_vendors.sql`/`tests_payment_rights.sql`) + ADR-121 : cohérents ; mention « code non encore écrit » corrigée.
- OP-N43 : complété (`payAPaymentRequest`, `createCustomerQrToken`), présent. **OP-N74 levé** (ligne, section, ADR-120 statut « Levée », migration 0035, `tests_enrollment_event_state.sql`).
- OP-N77, 78, 79, ADR-124 à 129 : présents et cohérents avec les comptes rendus. **Ajoutés** : OP-N80 + ADR-130 (pool de `SessionLock`), bloc « Livré par la mission 5b » dans PROMPTS (mission 5b) et PRD, reports mission 7 (sonde) et mission 13 (OP-N80, consigne `VENDOR_PIN_*`). Reports missions 7, 10, 11 : présents (lignes « Hérité de la mission 5b »).
- Renforcements faits pendant la mission et consignés dans leurs comptes rendus : R-05, R-06, R-07, R-09, secret hors base, secret d'idempotence distinct (ADR-126), `keyUuid: 'without-device'` (ce lot : renforcement, contrôle UUID rétabli).
- **Aucun écart de sécurité sans entrée trouvé.**

## Points soumis au porteur / à l'orchestrateur (rien codé)
1. OP-N80 / ADR-130 : dimensionnement du pool de `SessionLock` (saturation = `500` après 10 s au lieu de `429`) ; proposé pour la mission 13, **à confirmer**. Pas de mesure en charge faite ici.
2. Garde `written.replayed` : défense en profondeur non testable par comportement (mutant équivalent) ; garder ou retirer, au choix.
3. `VENDOR_PIN_IDEMPOTENCY_SECRET` : aucun manifeste de déploiement dans le dépôt ; consigne ajoutée à `CI.md` et au bloc mission 13.
4. Toujours ouverts (hors carte) : `contracts/vendors.md` à aligner (422, 409 au renvoi, liste sans vendeurs bloqués) ; propriétaire des fonctions de purge sous RLS forcée.

## T072 : fichiers à faire relire par une personne
- `packages/ledger-sql/migrations/0031_vendors.sql` : droits, `set_device_status` remplacée, `begin_vendor_pin_check` / `open_vendor_session` (OP-N76).
- `0033_payments.sql` : `assert_reversible`, appelant terminal d'`approval_token_use`, droits de `sale_attribution`.
- `0034_payment_requests.sql` : fonctions SECURITY DEFINER des demandes QR, jeton lié par empreinte.
- `0035_enrollment_event_state.sql` : verrous `FOR SHARE`, refus selon états.
- `packages/ledger-sql/post-roles.sql` : droits de la base (`cashless_app`).
- `apps/api/src/vendor-pin/` (argon2id, secret, `SessionLock`), `apps/api/src/config/config.ts` (`VENDOR_PIN_SECRET`, `VENDOR_PIN_IDEMPOTENCY_SECRET`), `apps/api/src/vendors/`, `apps/api/src/approval/onsite/` (variante de garde), `apps/api/src/payment-requests/qr-token.ts`.
- Ajoutés par ce lot : `apps/api/src/idempotency/idempotency.interceptor.ts` et `idempotent.decorator.ts` (option `keyUuid`, `deviceSeq`), `apps/api/src/configuration/sql-config-resolver.ts` (ordre des requêtes), `payments.service.ts` (`refuse`, quelle erreur remonte), `device-seq-registry.ts`, `qr-token-hash.ts` (cryptographie, non modifiés).
L'agent qui a écrit le code ne vaut pas relecture indépendante.

## Retouches hors carte (une ligne chacune)
`idempotent.decorator.ts`, `idempotency.interceptor.ts`, `reversals.controller.ts` (travaux de fusion 1) ; `openapi.yaml` (fusion 2) ; `media-isolation.spec.ts`, `merchant-qr.spec.ts`, `device-key.spec.ts` (fusion 3 et tests de la fusion) ; `sql-config-resolver.ts` (décision du porteur, report WP11) ; `argon2-supply-chain.spec.ts` (report WP08) ; `docs/08-pile-logicielle.md` (mention du second secret).

## Critères couverts (fichier : cas) pour `acceptance-matrix.json`
- **SC-001** : `payment-journey.spec.ts` étapes 1 à 12 (une seule écriture directe après amorçage : `ageSale`, déclarée).
- **SC-002** : `payment-journey` 12 « contrôles finaux » (Σ lignes = débit, attribution 100 %, aucune vente sans lignes).
- **SC-003** : `payment-secrets.spec.ts` (base, journaux, réponses, `$argon2id$`).
- **SC-004** : `payment-journey` 10 (5 PIN faux, bloqué sur tous les terminaux, nouveau PIN débloque).
- **SC-006 / NFR-001** : `payment-latency.spec.ts` (200 paiements, p95/p99) ; étape CI dédiée.
- **SC-007 / NFR-007** : `payment-isolation.spec.ts` (contrat lu, 23 opérations, 13 tables, commerçants) + `media-isolation.spec.ts` (47 opérations).
- **NFR-002, NFR-008** : `payment-secrets.spec.ts`.
- **NFR-005** : `payment-concurrency.spec.ts` (7 cas dont 2 croisés).
- **NFR-006** : `payment-journey` 12 (refus ne consomme pas le passage) ; `payment-concurrency` (`noPartialWrite`, pannes pendant un refus).
- **NFR-010** : jeux complets rejoués (ci-dessous).
- SC-005, SC-008, C-010 : non couverts par un fichier propre à ce lot (SC-005/SC-008 relèvent des lots 11 à 13 ; C-010 par la liste T072 et la consignation).

## Passes rejouées (base `cashless_wp14`, supprimée)
- Lint et typecheck : 0 erreur.
- pgTAP après `reset-db` : 39 fichiers, 2931 assertions, PASS (deux fois : avant et après Jest, `reset-db` entre les deux).
- Jest complet après `reset-db` (`SKIP_LATENCY=1 npm test`, journal `WP14-jest-full.log`) : API 136 suites, 2195 tests, 2186 verts, 7 ignorés, 2 échecs = `claim-code-order.spec.ts` et `migrate-lock.spec.ts` (instables connus du poste), **verts seuls (20/20)** ; contracts et tag-format : 39 verts. Latence seule : verte (p95 81,1 ms, p99 96,6 ms).
