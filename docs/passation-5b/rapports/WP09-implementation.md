# Compte rendu du lot WP09 — Vendeurs : back-office et sessions

Lane `lane-i`, commit **`10d9d59f`** (`feat(WP09): vendeurs, back-office et sessions de vendeur`).
T039 à T043 marquées `done` (`mark-status`, accepté). Pas de `move-task`. Base `cashless_wp09`
(toutes les `DATABASE_URL_*` posées : OWNER, APP, PLATFORM, TAGKEYS, PERSO, TAGCHECK, KEYADMIN,
plus `PGDATABASE`), supprimée à la fin.

## Livré
- `src/vendors/` : `vendors.dto.ts`, `vendors.service.ts`, `vendors.controller.ts` (5 routes du
  back-office), `vendor-sessions.service.ts`, `vendor-sessions.controller.ts` (3 routes de
  terminal), `vendor-session-guard.ts` (`VendorSessionGuard.assert(client, device, id)`, exportée),
  `pin-attempt-lock.ts` (un essai à la fois par terminal), `vendors.module.ts`.
- Tests : `test/unit/vendors/vendors.dto.spec.ts`, `test/unit/vendors/vendor-sessions.service.spec.ts`,
  `test/integration/vendors/{vendors,vendor-sessions}.spec.ts`, `test/integration/vendors/vendor-fixtures.ts`
  (amorçage commun, aussi utilisé par la matrice), `device-auth-cases/vendors.cases.ts`.

## Écarts au plan (et leur sens)
1. **PIN mal formé sur `openVendorSession` : `422 VALIDATION_FAILED` (sans écho), pas `401`.**
   Contradiction de sources : le prompt propose `401` ; `openapi.yaml` (`openVendorSession` et
   `VendorSessionOpen.pin`) dit `422`. Règle §0.3 appliquée (openapi > plan). Neutre pour la
   sécurité : le contrôle a lieu avant toute lecture, identique pour tout vendeur, rien n'est compté.
2. **Renvoi de la même clé d'ouverture** : `409 CONFLICT_STATE` après un succès (transient),
   `401` rejoué (`Idempotency-Replayed: true`) après un échec, jamais recompté. Contradiction
   signalée : `contracts/vendors.md` dit « un renvoi refait l'essai » ; `openapi.yaml`,
   l'arbitrage et l'intercepteur disent `409` : suivis.
3. **Liste du terminal : vendeurs `ACTIVE` ET non bloqués** (prompt). Le contrat dit « ACTIVE » et
   « ni statut de blocage » : l'absence d'un vendeur bloqué révèle indirectement son blocage au
   terminal. Plus étroit que le contrat, à confirmer par le porteur (option : lister aussi les
   bloqués, l'ouverture rendant de toute façon `401`).
4. **5e essai avec le bon PIN** : bloqué par A (`locked = true`), B n'est pas appelée (elle
   refuserait), audit `VENDOR_PIN_FAILED` + `VENDOR_LOCKED`. Conforme à WP02 (« compter d'abord »).
5. **Renforcements** : champs inconnus refusés (`additionalProperties: false`) sans citer leur nom ;
   empreinte calculée hors transaction et après le contrôle de périmètre (404 avant argon2) ;
   unicité `vendor_session_open_per_device` (`23505`) traduite en `429` (report WP02, mineur 2),
   prouvée par test unitaire (la concurrence ne peut plus l'atteindre via l'API grâce au verrou).
6. Audit des essais : un essai compté qui n'aboutit pas (PIN faux, blocage, refus CL033 de B,
   `23505`) écrit `VENDOR_PIN_FAILED` dans une transaction C validée ; essai non compté : aucune
   ligne. Origine `device:<id>`, acteur `NULL`.

## Mécanisme du `429` retenu
Verrou consultatif de **session** PostgreSQL pris sans attente (`pg_try_advisory_lock`, clé
`hashtextextended('vendor-pin-attempt:' || device_id, 0)`), tenu sur une **connexion dédiée d'un
pool séparé** pendant A → argon2 → B → C, relâché dans `finally` (connexion détruite si le
relâchement échoue). Pool séparé : tenu sur le pool principal, une rafale d'essais pourrait
l'épuiser (chaque essai tenant une connexion en attendant une seconde → interblocage de l'API).
Réponse : `429 RATE_LIMITED`, `Retry-After: 1`, rien lu ni écrit. Aucun verrou en mémoire.

## Retouches hors carte (une ligne chacune)
- `apps/api/src/app.module.ts` : import de `VendorsModule` (autorisé).
- `apps/api/src/audit/audit.service.ts` : ajout de 8 actions `VENDOR_*` à `AuditAction` (autorisé).
- **`apps/api/src/db/session-lock.ts` (nouveau fichier, NON pré-autorisé)** : le test
  d'architecture interdit d'importer `pg` hors de `src/db/` ; la connexion dédiée du verrou y est
  donc placée (classe `SessionLock`, fournie par `VendorsModule`). Aucun fichier existant de `db/`
  modifié. À valider par l'orchestrateur.
- `x-process` : **non posé** (arbitrage « Pas de `x-process` ») ; `media-isolation.spec.ts` exige
  39 opérations et casserait.

## Points soumis au porteur / à l'orchestrateur
1. **`vendor_pin_check` a bien une purge** : `0031` §5 remplace `purge_device_enrollment_attempts()`
   (signature égale) qui supprime aussi les essais de PIN de plus de 24 h, et le travailleur
   `device-maintenance.ts` l'appelle déjà. La dette « aucune purge » relevée au WP07 semble donc
   inexacte ; ce lot n'a besoin de rien de plus. Réserve : la fonction tourne sans prestataire et
   compte sur un propriétaire qui ignore la RLS (même hypothèse que 0022) ; avec un propriétaire
   non superutilisateur et `FORCE ROW LEVEL SECURITY`, elle ne supprimerait rien.
2. **PIN dans l'empreinte de requête d'idempotence** : `api_idempotency.request_hash` est un HMAC
   (clé `IDEMPOTENCY_HMAC_KEY`) du corps, PIN compris. Base + clé HMAC volées → PIN retrouvable en
   10^6 essais HMAC (contre 10^6 argon2 avec `VENDOR_PIN_SECRET`). Mécanisme existant (ADR-99,
   même cas que les codes d'enrôlement), imposé par le contrat (`@Idempotent`) ; non modifié.
   Options : exclure `pin` du corps haché pour ces routes, ou l'accepter et le consigner.
3. NFR-004 et temps : un essai compté fait une transaction d'audit C de plus qu'un vendeur inconnu
   (~ms, contre ~dizaines de ms d'argon2 commun). Inhérent à la règle « essai non compté sans
   audit » du prompt ; à accepter ou à niveler (transaction factice) par décision.
4. Liste des vendeurs bloqués (écart 3) et `422` du PIN mal formé (écart 1) : à confirmer.
5. Aucun écart affaiblissant la sécurité n'a été codé. Limite OP-N76 non élargie : seule lecture de
   `pin_hash` = `begin_vendor_pin_check` ; seule ouverture = `open_vendor_session`.

## Fichiers à faire relire par une personne
`apps/api/src/vendors/vendor-sessions.service.ts` (PIN, comptage, empreinte factice, OP-N76),
`apps/api/src/vendors/vendor-session-guard.ts`, `apps/api/src/vendors/pin-attempt-lock.ts`,
`apps/api/src/db/session-lock.ts` (verrou, connexions), `apps/api/src/vendors/vendors.service.ts`
(portée et 404).

## Critères couverts (preuve)
Commandes depuis la lane : `npx eslint .` → 0 problème ; `npx tsc --noEmit -p apps/api/tsconfig.json`
→ 0 erreur ; Prettier appliqué. `reset-db.sh` sur `cashless_wp09` puis
`npx jest --runInBand` : **114 suites, 1908 réussis, 4 échecs, aucun dans le lot** :
- `devices/config.spec.ts` et `devices/heartbeat.spec.ts` (« NFR-009 p95 … 200 appels ») :
  délai Jest de 5 s ; échouent **à l'identique sans `VendorsModule`** (app.module.ts d'avant le lot) :
  antérieurs, tests de latence que la CI lance à part ;
- `media/claim-code-order.spec.ts` (2 tests, délai de 5 s, instabilité connue) : verts seuls après
  `reset-db` ; `device-latency.spec.ts` (surcoût 20,6 ms > 20 ms au 1er passage) : vert seul.
- Ciblé : `npx jest test/unit/architecture.spec.ts test/unit/vendors test/integration/vendors
  test/integration/end-to-end/device-auth-matrix.spec.ts` → 6 suites, 100 tests verts.
- pgTAP non rejoué : le lot ne touche aucun SQL.

| Critère | Preuve (fichier : cas) |
|---|---|
| FR-001 | `vendors.spec.ts` : « création par le MERCHANT_ADMIN, 201 + Location… », « liste et fiche : MERCHANT_ADMIN et OPERATOR_ADMIN… », « désactivation puis réactivation… » |
| FR-002 | `vendors.spec.ts` : « nouveau PIN (OPERATOR_ADMIN) débloque… », « PIN mal formé → 422 sans écho » ; `vendors.dto.spec.ts` (formats 5, 7 chiffres, lettres, espaces, nombre JSON) |
| FR-003 | `vendor-sessions.spec.ts` : « bon PIN → 201 VendorSession (12 h)… », « seconde ouverture → la première REPLACED… » |
| FR-004 / NFR-003 | `vendor-sessions.spec.ts` : « 5 échecs → bloqué… 6e bon PIN refusé sur deux terminaux ; nouveau PIN débloque », « compter d'abord : 4 PIN faux puis le bon PIN… », « 20 essais simultanés… même terminal », « essais simultanés depuis 5 terminaux », « verrou tenu → 429… » |
| FR-005 | `vendor-sessions.spec.ts` : « désactivation, nouveau PIN, suspension et révocation du terminal → garde 409 » (routes 5a), « session expirée (12 h, amorçage) », « fermeture : 204 et LOGOUT… » |
| FR-006 | `vendor-sessions.spec.ts` : « garde : autre identifiant, session d'un autre terminal, session close, non UUID » ; contrat d'usage en tête de `vendor-session-guard.ts` |
| FR-026 (vendeurs) | `vendors.spec.ts` : « audit VENDOR_CREATED… », « …audit débloqué » ; `vendor-sessions.spec.ts` : audit OPENED / PIN_FAILED / LOCKED / CLOSED ; `vendor-sessions.service.spec.ts` |
| NFR-002 (réponses, audit) | `vendors.spec.ts` : registre d'idempotence et audit sans PIN ni `$argon2` ; `vendor-sessions.spec.ts` : « renvoi de la même clé… » (registre sans PIN) ; `vendors.dto.spec.ts` (liste blanche) |
| NFR-004 | `vendor-sessions.spec.ts` : « PIN faux, inconnu, autre commerçant, désactivé, bloqué → même statut, même corps » ; `vendor-sessions.service.spec.ts` : empreinte factice quand A ne rend rien |
| NFR-007 (vendeurs) | `vendors.spec.ts` : « hors périmètre ou autre prestataire → 404 neutre, rien écrit », « rôle non admis → 403 » ; `vendor-sessions.spec.ts` : « liste = vendeurs actifs non bloqués de SON commerçant » |
| C-003 | `device-auth-matrix.spec.ts` vert avec `vendors.cases.ts` (3 routes, dont « routes du contrat non servies : 404 ») |
| Relecture WP02 (23505) | `vendor-sessions.service.spec.ts` : « 23505 sur une session ouverte du terminal : 429 RATE_LIMITED, jamais 500 » |
