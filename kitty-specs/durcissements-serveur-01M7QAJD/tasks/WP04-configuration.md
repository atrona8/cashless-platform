---
work_package_id: WP04
title: Configuration et gardes de production (PIN des vendeurs, anneau de clés d'IBAN)
dependencies: []
requirement_refs: [C-006]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: Planning artifacts for this mission were generated on feat/durcissements-serveur. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
subtasks: [T015, T016, T017]
phase: Phase 1 - Configuration
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/config/config.ts
create_intent: []
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/config/config.ts
- apps/api/test/unit/config.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 : Configuration et gardes de production

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce prompt, puis seulement :

- `interfaces.md` de la mission, table « Configuration (WP04) » et ligne « Dérivé d'idempotence du PIN » ; `plan.md`
  IC-03 (secret, clé d'appel) et IC-07 (anneau) ; `spec.md` C-006 ;
- `research/R-N76-N79-pin-vendeurs.md` §1 (« `VENDOR_PIN_SECRET` : où il est lu »), §2 (« Secret » : `hmacKey`,
  `assertNoFakeInProduction`), §4 (« Appel par l'API », « Latence ») ; `research/R-9b-iban-remboursements-versements.md`
  §1.4 point 2 (anneau, production refusée sans anneau) ;
- `apps/api/src/config/config.ts` : l. 100-135 (champs), 195-262 (URL locales, secrets de test, `TEST_HMAC_KEYS`),
  264-290 (`hmacKey`), 383-414 (`required`), 615-745 (`assertDistinctHmacKeys`, `deviceSettings`), 796-850
  (`loadConfig`, `tagUrl`) ;
- `apps/api/test/unit/config.spec.ts` en entier (507 lignes ; surtout l. 1-25, 296-330, 352-425) ;
  `apps/api/test/support/tls.ts` l. 140-175 (`DEVICE_PRODUCTION`, fixture partagée de production) ;
- `apps/api/src/vendor-pin/vendor-pin.module.ts` et `vendor-pin.hasher.ts` (consommateurs actuels de `vendorPinSecret`,
  à ne pas modifier : WP06 et WP07).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

Rendre la configuration conforme au découpage de la mission : l'API ne lit plus ni n'exige `VENDOR_PIN_SECRET` (seul le
processus `vendor-pin` le lira) ; elle gagne la clé d'appel interne, l'URL du processus, l'adresse de base du rôle
`cashless_pin` et l'anneau de clés d'IBAN. Toute absence en production refuse le démarrage, et un test le prouve
(C-006 : aucun faux en production). Ce lot ne touche aucun autre fichier de production.

## Context

- Seuls `config.ts` et `config.spec.ts` t'appartiennent. WP06 (processus `vendor-pin`) et WP08 (coffre d'IBAN)
  **consomment** ce que tu exposes : leurs noms sont figés ci-dessous, ne les change pas sans signaler.
- **Noms exposés** (ajoute-les à `AppConfig` et au retour de `loadConfig`, sauf mention) : `vendorPinCallKey: Buffer`
  (`VENDOR_PIN_CALL_KEY`) ; `vendorPinUrl: string` (`VENDOR_PIN_URL`) ; `pinDatabaseUrl: string` (`DATABASE_URL_PIN`) ;
  `ibanKeyring: ReadonlyMap<string, Buffer>` (`IBAN_KEYRING`) ; `ibanActiveKid: string` (`IBAN_ACTIVE_KID`). **Garde**
  `vendorPinSecret` dans `AppConfig` pour l'instant (transition, décision de l'orchestrateur) : il n'est plus **exigé**
  en production par `loadConfig` (lu seulement s'il est posé) ; **WP07** le retire d'`AppConfig` quand l'API ne s'en
  sert plus. Fonction exportée nouvelle :
  `vendorPinSettings(env?)` pour le processus du PIN (T015).
- **Correction à la consigne de planification** : le dérivé d'idempotence du PIN a **déjà** son secret propre dans
  l'API, `VENDOR_PIN_IDEMPOTENCY_SECRET` (`vendorPinIdempotencySecret`, ADR-126, avec valeur de test, refus en
  production et distinctions déjà testés). **Garde ce nom et ce champ tels quels** : renommer en `…_KEY` casserait les
  déploiements et les tests sans gain. Aucune variable nouvelle pour l'idempotence, donc rien à ajouter à
  `interfaces.md` sur ce point (signale-le dans ta note).
- Précédent à suivre : `hmacKey()` exige le secret en production, accepte l'hexadécimal ou le base64, 32 octets au
  moins, refuse en production les valeurs de `TEST_HMAC_KEYS` même posées ; `tagUrl()` rend `''` en production quand une
  adresse manque (c'est le processus qui s'en sert qui la refuse), l'adresse locale sinon.
- Décision du porteur du 18/11/2026 applicable : la clé de chiffrement de l'IBAN vient de la **configuration de l'API**
  (anneau de clés), pas du service de clés ; limite résiduelle (clé dans le processus public) consignée par WP14.
- **Aucune compilation cassée** : `vendor-pin.module.ts` et `payment-secrets.spec.ts` lisent encore
  `config.vendorPinSecret` ; le champ reste (facultatif en production) jusqu'à WP07. `tsc` doit rester sans erreur.
- Retouche hors carte nommée (à lister dans la note) : `apps/api/test/support/tls.ts`, objet `DEVICE_PRODUCTION` (l.
  ~147-175) : ajoute-y `VENDOR_PIN_CALL_KEY` (`'06'.repeat(32)`, distinct des autres), `IBAN_KEYRING`
  (`'k1:' + base64 de 32 octets`) et `IBAN_ACTIVE_KID: 'k1'`, sans retirer `VENDOR_PIN_SECRET` (le processus du PIN en a
  besoin dans les tests de WP06). Sans cela, tous les tests qui chargent une configuration de production échouent.

## Subtasks

### T015 : réglages nouveaux, valeurs par défaut et fonction du processus du PIN

1. **`VENDOR_PIN_CALL_KEY`** : via `hmacKey()` (même format, mêmes refus), avec une valeur de test nommée
   `TEST_VENDOR_PIN_CALL_KEY` (texte « …de-test-uniquement », ≥ 32 octets) **ajoutée à `TEST_HMAC_KEYS`** : refusée en
   production même posée. Obligatoire en production pour `loadConfig` (précédent : les autres clés HMAC, que tous les
   processus exigent déjà). Ajoute-la à `assertDistinctHmacKeys` de `deviceSettings` : distincte de
   `CLAIM_CODE_HMAC_KEY`, `IDEMPOTENCY_HMAC_KEY`, `ENROLLMENT_CODE_HMAC_KEY`, `CUSTOMER_AUTH_HMAC_KEY`,
   `VENDOR_PIN_IDEMPOTENCY_SECRET`. **Retire `VENDOR_PIN_SECRET` de ce contrôle et de `DeviceSettings`.**
2. **`VENDOR_PIN_URL`** : défaut local `http://127.0.0.1:3003` hors production ; en production, absente : `''` (c'est le
   client de WP07 qui refuse de démarrer, comme `tagUrl`) ; posée : analysée par `new URL`, refus si l'analyse échoue ;
   **en production, seul `https:` est accepté** (le PIN voyage dans ce corps). Pas de chemin ni de paramètres : refus si
   `pathname` n'est pas `/` ou si une requête est présente (message nommant la variable).
3. **`DATABASE_URL_PIN`** : ajoute
   `DATABASE_URL_PIN: 'postgres://cashless_pin:cashless_pin_local@127.0.0.1:5433/ cashless_test'` à `LOCAL_TAG_URLS` et
   `pinDatabaseUrl: tagUrl('DATABASE_URL_PIN')` au retour (WP03 l'utilise dans `process-db.module.ts`).
4. **Anneau d'IBAN** : fonction `ibanKeyring(env, production)` :
   - format `kid:base64(32 octets)[,kid:base64(32 octets)…]` ; `kid` = `^[A-Za-z0-9_-]{1,32}$` (ni `:` ni `,`) ;
     décodage base64 **strict** : après décodage, la longueur est exactement 32 et le ré-encodage redonne l'entrée (aux
     `=` près) ; `kid` en double refusé ; élément vide ou sans `:` refusé ; aucun message ne reproduit la clé.
   - `IBAN_ACTIVE_KID` : doit désigner un `kid` de l'anneau ; obligatoire dès que `IBAN_KEYRING` est posé et en
     production ; refus nommant la variable sinon.
   - Production : `IBAN_KEYRING` absent ou vide :
     `IBAN_KEYRING manquant : anneau de clés d'IBAN obligatoire en production` ; la clé de test (`kid` `test`, 32 octets
     fixes nommés `TEST_IBAN_KEY`) est refusée en production **même posée** (comparaison d'octets, comme
     `TEST_HMAC_KEYS`), avec le message `IBAN_KEYRING : clé de test refusée en production`.
   - Hors production : absent, anneau `{test: TEST_IBAN_KEY}` et `ibanActiveKid = 'test'`.
   - Rends `ReadonlyMap<string, Buffer>` ; l'anneau n'est jamais journalisé (pas de `toJSON`, pas de champ dans un
     message).
5. **`vendorPinSettings(env = process.env)`** exportée, pour le processus du PIN (WP06) : rend
   `{ production, port, vendorPinSecret, vendorPinCallKey, pinDatabaseUrl }`. `port` : `VENDOR_PIN_PORT`, défaut 3003
   (`positiveInt`). `vendorPinSecret` via `hmacKey()` avec `TEST_VENDOR_PIN_SECRET` (secret de test conservé dans
   `TEST_HMAC_KEYS`, refusé en production), **obligatoire en production** (« `VENDOR_PIN_SECRET manquant` »).
   `vendorPinCallKey` : même clé que l'API (valeur de test comprise). `pinDatabaseUrl` : `DATABASE_URL_PIN` ; en
   production absente : refus
   `DATABASE_URL_PIN manquant : chaîne de connexion du rôle cashless_pin obligatoire en production`. Distinctions :
   `VENDOR_PIN_SECRET` ≠ `VENDOR_PIN_CALL_KEY` ; et, **si ces variables figurent dans l'environnement du processus**
   (déploiement sur une seule machine), ≠ `VENDOR_PIN_IDEMPOTENCY_SECRET`, `CLAIM_CODE_HMAC_KEY`,
   `IDEMPOTENCY_HMAC_KEY`, `ENROLLMENT_CODE_HMAC_KEY`, `CUSTOMER_AUTH_HMAC_KEY`. Cette fonction **ne charge pas** le
   reste de la configuration : le processus du PIN ne doit exiger ni OIDC, ni certificats, ni anneau d'IBAN. Elle lit
   `NODE_ENV` par la même fonction que `loadConfig` (`nodeEnv`). Réutilise `hmacKey`, `positiveInt` et
   `assertDistinctHmacKeys` ; ne duplique pas leur code.
- Piège : `assertDistinctHmacKeys` compare des octets : une clé écrite en hexadécimal et la même en base64 sont égales
  (cas déjà testé l. 335-340) ; garde ce comportement.
- Piège : `loadConfig` est appelé par **tous** les processus (tag-keys, edge, maintenance…) : ils exigent désormais en
  production `VENDOR_PIN_CALL_KEY` et `IBAN_KEYRING` comme ils exigent déjà les autres clés ; consigne cette conséquence
  de déploiement dans ta note, ne la contourne pas.
- Validation : T017.

### T016 : gardes de production

Récapitule, dans le code et dans les messages, chaque refus (tous testés en T017) :
1. production sans `VENDOR_PIN_CALL_KEY` : `VENDOR_PIN_CALL_KEY manquant : …` (API **et** `vendorPinSettings`) ;
2. production avec une clé de test de la liste (`VENDOR_PIN_CALL_KEY`, `VENDOR_PIN_SECRET`, clé d'IBAN) : refus ;
3. `vendorPinSettings` en production sans `VENDOR_PIN_SECRET`, sans `DATABASE_URL_PIN` : refus ;
4. production sans `IBAN_KEYRING` ou sans `IBAN_ACTIVE_KID`, anneau invalide : refus ;
5. `VENDOR_PIN_URL` en `http:` en production : refus ; absente en production : `''` (refus par le client, WP07).
- **L'API n'exige plus `VENDOR_PIN_SECRET`** : `loadConfig` ne doit pas échouer en production quand elle est absente
  (test T017). Le retrait du champ est fait par WP07 ; la preuve finale « seul `vendor-pin` lit le secret » est le
  test d'architecture de WP06 complété par WP07.
- Ne modifie ni `assertNoFakeInProduction`, ni `production-guard` (autres fichiers) : la garde de démarrage du processus
  `vendor-pin` est à WP06. Aucun faux nouveau.

### T017 : `config.spec.ts`

Fichier existant (`apps/api/test/unit/config.spec.ts`, vérifié) : mets à jour les tests qui nomment `VENDOR_PIN_SECRET`
et `vendorPinSecret` (l. 222, 243, 311-323, 352-379, 399-421) : ils passent sur `vendorPinSettings` ou sont inversés
(l'API n'exige plus le secret). Complète la fixture `PRODUCTION` si besoin (elle étend `DEVICE_PRODUCTION`). Ajoute :
- `loadConfig(PRODUCTION)` sans `VENDOR_PIN_SECRET` : **réussit** ;
- `VENDOR_PIN_CALL_KEY` : manquante en production refusée ; `'abcd'` et 31 octets refusés (`32 octets`) ; valeur de test
  refusée en production ; distincte de chaque autre secret (boucle sur les noms, regex `… secrets distincts`) ; défaut
  de test hors production et différent des autres ;
- `VENDOR_PIN_URL` : défaut local ; `https://pin.internal:3003` accepté en production ; `http://…` refusé en production
  ; chemin ou requête refusés ; absente en production : `''` ;
- anneau d'IBAN : un `kid`, deux `kid` (rotation : le `kid` actif est celui désigné) ; production sans anneau refusée ;
  clé de test posée en production refusée ; clé de 31 et de 33 octets refusées ; base64 invalide refusé ; `kid` en
  double ; `IBAN_ACTIVE_KID` absent de l'anneau ; `IBAN_ACTIVE_KID` absent en production ; défaut hors production
  (`test`) ; aucun message d'erreur ne contient la clé posée (`not.toContain`) ;
- `vendorPinSettings` : production complète acceptée ; sans secret, sans `DATABASE_URL_PIN`, sans clé d'appel, secret de
  test, secret égal à la clé d'appel, secret égal à `VENDOR_PIN_IDEMPOTENCY_SECRET` posé dans l'environnement : refus ;
  hors production : valeurs de test et port 3003 ; `VENDOR_PIN_PORT` invalide refusé ;
- **mutation (NFR-004, C-006)** : retire la garde « production sans `IBAN_KEYRING` » (ou le refus de la clé de test) ;
  le test correspondant doit échouer ; remets-la. Note le test qui échoue.

## Tests et preuves

Aucune base n'est nécessaire (tests unitaires). Depuis `apps/api` de la lane :

```bash
SKIP_LATENCY=1 npx jest test/unit/config.spec.ts test/unit/config-device-authorities.spec.ts --runInBand --forceExit
npx tsc --noEmit -p tsconfig.json   # aucune erreur
```

`test/unit/production-guard.spec.ts`, `processes.spec.ts` et `config-device-authorities.spec.ts` chargent
`DEVICE_PRODUCTION` : relance-les, ils doivent rester verts grâce à la retouche de `tls.ts`. Note les durées : les
latences de `config.spec` sous Docker sont une instabilité connue (fiche).

## Branch Strategy

- Planification et fusion : `feat/durcissements-serveur`. Worktree de lane calculé par `lanes.json`.
- Commande :
  `LC_ALL=C LANG=C spec-kitty agent action implement WP04 --agent claude --mission durcissements-serveur-01M7QAJD`.

## Definition of Done

- [ ] `AppConfig` : `vendorPinCallKey`, `vendorPinUrl`, `pinDatabaseUrl`, `ibanKeyring`, `ibanActiveKid` ;
      `vendorPinSecret` gardé, facultatif en production (retiré par WP07) ; `VENDOR_PIN_IDEMPOTENCY_SECRET` inchangée.
- [ ] `vendorPinSettings(env)` exportée, indépendante du reste de la configuration, avec ses gardes de production.
- [ ] Gardes de production : clé d'appel, secret du PIN (processus seul), `DATABASE_URL_PIN` (processus), anneau d'IBAN,
      `https` de l'URL ; clés de test refusées même posées ; aucun faux nouveau ; aucun secret dans un message.
- [ ] `config.spec.ts` couvre chaque garde et chaque valeur par défaut ; mutation rejouée et notée.
- [ ] `tls.ts` (`DEVICE_PRODUCTION`) complété ; `tsc` sans erreur ; note de lane :
      ces erreurs, la conséquence de déploiement (tous les processus exigent la clé d'appel et l'anneau en production),
      les noms exposés pour WP06, WP07 et WP08.

## Risks

- Casser le démarrage d'un autre processus en production : tout processus qui appelle `loadConfig` exige les nouvelles
  variables. C'est voulu (précédent des autres clés) ; documente-le, ne fais pas d'exception silencieuse.
- Un anneau mal analysé qui accepte une clé tronquée (base64 permissif de `Buffer.from`) : vérifie le ré-encodage.
- Un message d'erreur qui reproduit une valeur de secret : interdit.
- Régression des distinctions de secrets de l'ADR-126 (idempotence et PIN) : l'API ne connaît plus le secret du PIN, la
  distinction ne se vérifie plus que dans `vendorPinSettings` quand les deux sont dans l'environnement ; consigne cette
  limite dans la note (WP14 la reprend).

## Ce que le relecteur doit casser

- Démarrer en production sans `VENDOR_PIN_CALL_KEY`, sans `IBAN_KEYRING`, avec la clé d'IBAN de test posée
  explicitement, avec un anneau d'une clé de 31 octets, avec `IBAN_ACTIVE_KID` hors anneau : chacun doit refuser.
- `loadConfig` de production sans `VENDOR_PIN_SECRET` doit réussir et ne rien exposer ; `vendorPinSettings` sans lui
  doit refuser ; avec la valeur de test posée, refuser.
- `VENDOR_PIN_URL` en `http://` en production, avec un chemin, avec des identifiants dans l'URL ; la clé d'appel égale
  au secret du PIN ou à un autre secret, écrite en base64 au lieu de l'hexadécimal.
- Un test qui ne prouve rien : un refus testé par `toThrow()` sans motif, une valeur par défaut non comparée, une
  mutation non rejouée, un message qui contient la clé.
- Un fichier modifié hors `config.ts`, `config.spec.ts` et `tls.ts` ; un écart de sécurité non signalé.

## Fichiers à faire relire par une personne

- `apps/api/src/config/config.ts` : lecture des secrets, de l'anneau de clés d'IBAN et refus de production.
