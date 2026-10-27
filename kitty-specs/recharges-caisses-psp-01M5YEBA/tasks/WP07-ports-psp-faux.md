---
work_package_id: WP07
title: Ports PSP, faux et garde de production
dependencies: [WP01]
requirement_refs: [FR-020, FR-021, FR-022, NFR-003, NFR-004, C-003, C-005, C-006, C-007]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T031, T032, T033, T034, T035, T036]
phase: Phase 2 - Socle applicatif
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
authoritative_surface: apps/api/src/psp/
execution_mode: code_change
owned_files: [apps/api/src/psp/**, apps/api/src/processes/bootstrap.ts, apps/api/src/processes/public.module.ts, apps/api/src/app.module.ts, apps/api/src/errors/sqlstate-map.ts, apps/api/test/unit/psp/**, apps/api/test/unit/production-guard.spec.ts]
create_intent: [apps/api/src/psp/psp.types.ts, apps/api/src/psp/psp.tokens.ts, apps/api/src/psp/secret.ts, apps/api/src/psp/psp-errors.ts, apps/api/src/psp/hmac-signature.ts, apps/api/src/psp/psp-adapter.port.ts, apps/api/src/psp/psp-secret-store.port.ts, apps/api/src/psp/psp-adapter-registry.ts, apps/api/src/psp/psp.providers.ts, apps/api/src/psp/psp.module.ts, apps/api/src/psp/fake/fake-psp-adapter.ts, apps/api/src/psp/fake/fake-notification-signer.ts, apps/api/src/psp/fake/fake-psp-secret-store.ts, apps/api/src/psp/unavailable/unavailable-psp.ts, apps/api/test/unit/psp/hmac-signature.spec.ts, apps/api/test/unit/psp/fake-psp-adapter.spec.ts, apps/api/test/unit/psp/fake-secret-store.spec.ts, apps/api/test/unit/psp/psp-providers.spec.ts]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 – Ports PSP, faux et garde de production

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
`spec.md` (FR-020 à FR-022, NFR-003, NFR-004, C-003, C-005 à C-007), `research.md` R-08, R-09, R-10,
R-17, R-18 et **R-20** (sections « Notifications et recharges » et « Configurations, secrets, frais
»), `research-adversarial.md` (A5, A10, A11, A22, A23), `contracts/psp.md` (sections Notifications
et Faux), `plan.md` IC-06, `data-model.md` (`psp_configuration.secret_ref`, correspondances de
clés). Code de référence : `apps/api/src/kms/production-guard.ts` (`assertNoFakeInProduction`,
`FakeInProductionError`, `MaybeFake`), `apps/api/src/kms/kms.module.ts` et `fake-kms.ts` (fabrique
qui refuse le faux en production, `KMS_PROVIDER`),
`apps/api/src/customer-identity/customer-identity.module.ts` (module global + fabrique),
`apps/api/src/security/port-tokens.ts` (jetons de ports), `apps/api/src/processes/bootstrap.ts`
(`assertProcessIsSafe`), `apps/api/src/processes/public.module.ts`, `apps/api/src/app.module.ts`,
`apps/api/src/errors/problem.ts` (`ProblemException`), `apps/api/src/errors/sqlstate-map.ts`,
`apps/api/src/config/config.ts` (`APP_CONFIG`, `AppConfig.production`),
`apps/api/test/unit/production-guard.spec.ts` et `test/unit/processes.spec.ts` (bloc « aucun faux en
production (démarrage réel) »), `docs/08-pile-logicielle.md` (ADR-78 : pas de dépendance nouvelle ;
le HMAC utilise `node:crypto`). En cas de contradiction entre sources, applique la priorité de
SPECIFICATION §0.3 (tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` >
SPECIFICATION > `PRD.md`) et **signale-la**. Ne modifie jamais un `.sql` généré de
`packages/ledger-sql/`.

## Objective

Figer, avant les adaptateurs réels, l'interface commune des PSP (`PspAdapter`), le coffre à secrets
(`PspSecretStore`), un faux par fournisseur (Wave, Orange Money, PayDunya, Stripe) avec un outil de
notification signée pour les tests, un faux coffre, et le comportement de production : aucun faux
construit, fournisseur « indisponible » réel, garde de démarrage `assertProcessIsSafe` qui refuse
tout faux. Câbler le module. C'est la dette nommée OP-N81 / ADR-131 : les faux restent plus
longtemps que prévu, la borne est un test.

## Context

- Concern IC-06 du plan. Décision du porteur du 27/10/2026 : adaptateurs réels et coffre AWS
  reportés (FR-021 « Deferred »). Cette mission livre l'interface, les faux et la garde ; pas de
  recharge en ligne en production avant la mission qui livre les adaptateurs.
- **Règle 2 de `CLAUDE.md`** : un faux fait refuser le démarrage en production, et un test le
  prouve. Ici le faux n'est même pas construit : en production, le module enregistre un fournisseur
  « indisponible » (non faux, `isFake` absent) ; si un faux est malgré tout présent dans le
  processus, la garde refuse.
- **Constat de départ à connaître** : le processus public (`PublicProcessModule`) ne démarre déjà
  pas en production aujourd'hui, car l'identité du festivalier n'a que son faux
  (`createCustomerIdentity` lève `FakeInProductionError`, test existant « API publique : refuse de
  démarrer… »). R-20/A5 écrit « le processus public démarre en production avec les routes espèces »
  : cela n'est vrai que **pour la partie PSP**, tant que l'identité festivalier réelle n'existe pas.
  Ce lot ne la livre pas ; il prouve que ses propres fournisseurs n'ajoutent aucun refus (voir T036)
  et **signale la contradiction**.
- Dépendants de ce lot : WP08 à WP13 (ils importent leurs modules dans `app.module.ts` et ajoutent
  leurs codes dans `sqlstate-map.ts`, deux fichiers qui sont à toi), WP10 (titulaire du
  `secret_ref`), WP11 (`initiate`, `cancel`, `getStatus`), WP12 (`verifyNotification`,
  `PspSecretStore`, signeur de test, travailleur inactif), WP13 (signeur de test pour les
  contestations), WP14 (balayage des secrets avec canari).
- Les montants sont des `bigint` à l'intérieur (SPECIFICATION §5.5) ; le JSON des faux porte des
  entiers.

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé plus longtemps que prévu — c'est précisément OP-N81, déjà accepté et consigné),
**arrête-toi sur tout autre point de ce genre et soumets-le au porteur avant de coder**, avec le
risque et les options ; continue le reste. Un renforcement se fait, puis se consigne. Aucun faux en
production. Aucune nouvelle dépendance npm (R-18 : `axios` attend les adaptateurs réels). Aucun
secret PSP dans `loadConfig` (C-005, ADR-125).

## Arbitrages de l'orchestrateur (27/10/2026)

Tous dans le sens le plus strict ou de pure répartition ; ils priment sur le texte ci-dessus.

- **Noms figés** (les autres lots les citent) : jetons `PSP_ADAPTERS` (registre) et
  `PSP_SECRET_STORE` (coffre) dans `psp.tokens.ts` ; classes `PspAdapterRegistry`, `FakePspAdapter`,
  `FakePspSecretStore`, `UnavailablePspSecretStore`, `Secret`, `PspSecretError`, `PspProviderError`
  ; interfaces `PspAdapter`, `PspSecretStore` ; fonctions `signFakeNotification`,
  `verifyHmacSignature`, `createPspAdapters`, `createPspSecretStore` ; constante
  `WEBHOOK_TOLERANCE_SECONDS = 300`.
- **Types normalisés** : `getStatus` et `verifyNotification` rendent le **même** `NormalizedPayment`
  (R-20 A11) ; carte sans empreinte ou sans 3-D Secure `SUCCEEDED` (absent compris) y vaut
  `fingerprint: null` et `threeDs: 'NOT_PERFORMED'`, jamais une valeur flatteuse par défaut.
- **`cancel` est ajouté au port** (non listé par R-09, requis par `contracts/psp.md` règle 9 et
  `cancelPspTopup`) : `PENDING → CANCELLED` seulement si l'adaptateur confirme. Signale l'ajout.
- **`verifyNotification` fait tout, dans cet ordre, et rend `signedAt`** : (1) en-tête présent et
  bien formé, (2) signature sur `t.corps_brut` pour **les deux** secrets sans sortie anticipée, (3)
  secret précédent refusé après son échéance, (4) horodatage `|t − now| ≤ 300 s`, (5) seulement
  alors lecture du JSON et normalisation. Aucun champ du corps n'est lu avant (1) à (4). WP12
  enveloppe cet appel et applique ses refus ; il peut re-contrôler `signedAt`.
- **Pas de secret en clair dans un objet qui s'affiche** : tout secret voyage dans `Secret`
  (`reveal()` ; `toString`, `toJSON` et `util.inspect` rendent `[secret]`). Aucun message d'erreur,
  journal, `JSON.stringify` d'un objet contenant un secret ne doit le révéler (canari testé).
- **Comparaison à temps constant** : `timingSafeEqual` sur des tampons de même longueur ; longueur
  différente → comparer quand même à un tampon de remplissage, sans sortie anticipée. Les deux
  secrets sont toujours évalués, même si le premier correspond ou si le second est absent
  (secret factice aléatoire).
- **`secret_ref` lié au titulaire** (A10) : forme `psp/<holder_party_id>/<nom>` ; `get` refuse un
  segment différent du titulaire passé (`HOLDER_MISMATCH`) ; le message n'inclut pas le titulaire
  attendu.
- **Production** : `createPspAdapters({production:true})` ne construit **aucun** faux : registre
  vide, `available = false`, `isFake` absent ; `createPspSecretStore` rend
  `UnavailablePspSecretStore`. Appeler un fournisseur indisponible :
  `ProblemException('PSP_UNAVAILABLE', {status: 503})`. Aucun réglage d'environnement ne change
  cela.
- **Un seul fichier importe `psp/fake/`** : `psp.providers.ts`. Un test échoue si un autre fichier
  de `src/` l'importe (borne OP-N81 : les faux ne se répandent pas).
- **Retouches hors carte** : aucune attendue. `app.module.ts`, `bootstrap.ts`, `public.module.ts` et
  `sqlstate-map.ts` t'appartiennent (une ligne chacun, l'import de `PspModule` et la garde ; les
  codes SQL voir T035).

## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendance : WP01 (codes
`PSP_UNAVAILABLE`, `PSP_REJECTED`, `PSP_NOT_CONFIGURED`, `WEBHOOK_*` du contrat ;
`PAYLOAD_TOO_LARGE` ajouté par WP01). Le worktree est attribué par lane d'après `lanes.json`.
Commande : `spec-kitty agent action implement WP07 --agent claude --mission
recharges-caisses-psp-01M5YEBA`. Base de validation (si un test d'intégration est lancé) :
`cashless_wp07` (`PGDATABASE=cashless_wp07 bash packages/ledger-sql/scripts/reset-db.sh`) ;
`cashless_test` est réservée à l'orchestrateur. Worktree sans `node_modules` : fais les liens de
`node_modules/@cashless/*` (voir la mémoire du poste).

## Subtasks

### T031 — Port `PspAdapter`, types normalisés, erreurs

But : l'interface que les adaptateurs réels de la mission suivante n'auront qu'à implémenter.

1. `psp.types.ts` : `PSP_PROVIDERS = ['WAVE','ORANGE_MONEY','PAYDUNYA','STRIPE'] as const`,
   `PspProviderName`, `PspMethod = 'WAVE'|'ORANGE_MONEY'|'CARD'`, `PROVIDER_METHOD` (`PAYDUNYA` et
   `STRIPE` → `CARD`), `PROVIDER_PATH_SEGMENT` (`wave`, `orange-money`, `paydunya`, `stripe`, les
   segments de `receivePspWebhook`) et `providerFromPathSegment(segment): PspProviderName | null`.
2. Types : `PaymentAction = {kind:'REDIRECT', url:string} | {kind:'INSTRUCTION', text:string}` ;
   `PspInitiateRequest {pspTopupId, method, amount: bigint, currency, payerMsisdn: string|null,
   returnUrl: string|null, notificationUrl: string}` (`pspTopupId` = référence marchande, R-20 A2) ;
   `PspInitiateResult {providerPaymentRef, action, expiresAt: Date}` ; `NormalizedCard
   {fingerprint: string|null, threeDs: 'SUCCEEDED'|'FAILED'|'NOT_PERFORMED'}` ; `NormalizedPayment
   {merchantReference: string|null, providerPaymentRef, amount: bigint, currency, card:
   NormalizedCard|null}` ; `NormalizedNotification {notificationId, kind: 'PAYMENT_SUCCEEDED'|
   'PAYMENT_FAILED'|'PAYMENT_CANCELLED'|'DISPUTE'|'UNKNOWN', payment: NormalizedPayment, dispute:
   {providerDisputeId, amount: bigint}|null}` ; `PspStatusQuery {merchantReference,
   providerPaymentRef: string|null}` ; `PspStatusResult {state: 'PENDING'|'PAID'|'FAILED'|
   'CANCELLED'|'EXPIRED'|'UNKNOWN', payment: NormalizedPayment|null}` ; `PspStatementLine`
   (référence, montant `bigint`, devise, date) — signature seulement.
3. `psp-adapter.port.ts` : `interface PspAdapter { readonly provider; readonly isFake?: boolean;
   initiate(request, secrets): Promise<PspInitiateResult>; verifyNotification(input:
   {rawBody: Buffer; headers: Record<string, string|string[]|undefined>; secrets: PspSecrets;
   now: Date}): PspVerification; getStatus(query, secrets): Promise<PspStatusResult>;
   cancel(query, secrets): Promise<{cancelled: boolean}>; readStatement(period:{from:Date;to:Date},
   secrets): Promise<PspStatementLine[]> }`. `PspVerification` = `{ok:true, notification, signedAt:
   Date, secretUsed:'current'|'previous'}` ou `{ok:false, reason}` avec `reason` dans
   `SIGNATURE_MISSING`, `SIGNATURE_MALFORMED`, `SIGNATURE_INVALID`, `TIMESTAMP_OUT_OF_TOLERANCE`,
   `BODY_MALFORMED` (les noms que WP12 reprend dans `WebhookRejectionReason`). Documente en tête de
   fichier l'ordre (1) à (5) de l'arbitrage et que le faux n'est jamais un modèle de sécurité.
4. `psp-errors.ts` : `PspProviderError(kind: 'UNAVAILABLE'|'REJECTED', message)` lancé par un
   adaptateur ; `pspProblem(error): ProblemException` → `PSP_UNAVAILABLE` (503) ou `PSP_REJECTED`
   (422), message sans donnée du PSP ; toute autre erreur reste inconnue (`INTERNAL_ERROR`).
5. `psp.tokens.ts` : `export const PSP_ADAPTERS = Symbol('PSP_ADAPTERS')`, `PSP_SECRET_STORE`.

Cas limites : montant non entier ou hors `Number.MAX_SAFE_INTEGER` dans un JSON de notification →
`BODY_MALFORMED` ; devise absente → `BODY_MALFORMED`.

Validation :
- [ ] `tsc` propre ; aucune importation de `pg`, d'`axios` ni de dépendance nouvelle.
- [ ] Les noms de types et de raisons sont exactement ceux ci-dessus (grep).

### T032 — Faux par fournisseur et outil de notification signée

But : un faux par fournisseur au schéma de signature du contrat, pilotable par les tests.

1. `hmac-signature.ts` (utilisé aussi par WP12) : `WEBHOOK_TOLERANCE_SECONDS = 300` ;
   `parseSignatureHeader(value): {timestamp:number; signatures:string[]} | null` (format
   `t=<unix>,v1=<hex>`, plusieurs `v1` admis, espaces tolérés, hex strict, entier strict) ;
   `computeSignature(secret: Secret, timestamp, rawBody): string` (HMAC-SHA256 sur `t.corps_brut`,
   hex) ; `verifyHmacSignature({header, rawBody, secrets: PspSecrets, now}): {ok:true, signedAt,
   secretUsed} | {ok:false, reason}` — évalue **toujours** les deux secrets (le précédent absent est
   remplacé par un secret factice aléatoire) contre **toutes** les signatures reçues, accumule les
   résultats sans court-circuit, puis décide : courant → `current` ; précédent → `previous`
   seulement si `now ≤ previousValidUntil` (sinon `SIGNATURE_INVALID`, sans dire pourquoi) ; puis
   tolérance de l'horodatage (`TIMESTAMP_OUT_OF_TOLERANCE`). La signature est jugée avant
   l'horodatage (une signature fausse et un horodatage faux rendent `SIGNATURE_INVALID`).
2. `fake/fake-psp-adapter.ts`, `class FakePspAdapter implements PspAdapter` : `isFake = true` ;
   constructeur `(provider, options?: {expiresInSeconds = 900})` ; en-tête de signature
   `wave-signature` pour `WAVE`, `x-webhook-signature` pour les trois autres (recherche insensible à
   la casse). Corps JSON neutre : `{id, type, merchant_reference, payment_id, amount, currency,
   card?: {fingerprint, three_ds}, dispute?: {id, amount}}` avec `type` parmi `payment.succeeded`,
   `payment.failed`, `payment.cancelled`, `dispute.created` ; autre type → `kind: 'UNKNOWN'`
   (conservé, sans effet, WP12). `initiate` rend `providerPaymentRef` aléatoire, `action` `REDIRECT`
   (url factice `https://fake-psp.invalid/<provider>/<ref>`, jamais un domaine réel), `expiresAt` =
   maintenant + `expiresInSeconds`, et mémorise le paiement par `pspTopupId`.
3. Pilotage par les tests (méthodes publiques du faux) : `setStatus(merchantReference, state,
   {card?})`, `failNextInitiate('UNAVAILABLE'|'REJECTED')`, `acceptCancel(boolean)`, `initiated`
   (liste en lecture seule des demandes reçues, **sans** secret), `reset()`. `getStatus` rend le
   même `NormalizedPayment` que la notification ; référence inconnue → `state: 'UNKNOWN'`. `cancel`
   rend `{cancelled}` selon `acceptCancel`. `readStatement` rend `[]`.
4. `fake/fake-notification-signer.ts` : `signFakeNotification({provider, secret: string|Secret,
   event, timestamp?, rawBody?}) → {rawBody: Buffer, headerName, headers}` (horodatage par défaut =
   maintenant en secondes ; `rawBody` fourni = corps altéré après signature, pour tester un octet
   changé). Fabriques d'événements : `fakeEvents.succeeded({id, merchantReference, paymentId,
   amount, currency, card?})`, `.failed`, `.cancelled`, `.dispute({id, disputeId,
   merchantReference|null, paymentId, amount, disputeAmount})`. Carte avec 3-D Secure : `card:
   {fingerprint, threeDs: 'SUCCEEDED'}` ; sans : `threeDs: 'NOT_PERFORMED'`, ou carte absente.
5. Un faux par fournisseur : `FakePspAdapter('WAVE' | 'ORANGE_MONEY' | 'PAYDUNYA' | 'STRIPE')`.

Cas limites : corps vide ; JSON valide mais pas un objet ; montant négatif ou zéro (`BODY_MALFORMED`
pour un montant < 0, zéro admis pour un `DISPUTE` seulement si le contrat le dit — sinon refus et
signale-le) ; en-tête répété (premier pris, les autres ignorés — documente) ; `t` dans le futur.

Validation :
- [ ] Un paiement `initiate` puis `signFakeNotification` puis `verifyNotification` redonne le
      même `NormalizedPayment` que `getStatus`.
- [ ] Quatre fournisseurs, deux noms d'en-tête, vérifiés par test.

### T033 — Port `PspSecretStore`, faux coffre, échéance du secret précédent

But : lire les secrets d'une configuration par référence opaque, liés au titulaire des fonds.

1. `secret.ts` : `class Secret` (valeur privée, `reveal(): string`, `toString()`, `toJSON()` et
   `[util.inspect.custom]` rendent `[secret]`) ; `Secret.of(value)`
   refuse une valeur vide.
2. `psp-secret-store.port.ts` : `PspSecretBinding {configurationId, holderPartyId, secretRef}` ;
   `PspSecrets {adapter: Secret|null; notification: {current: Secret; previous: Secret|null;
   previousValidUntil: Date|null}}` ; `interface PspSecretStore {readonly isFake?: boolean;
   get(binding): Promise<PspSecrets>}` ; `class PspSecretError(code: 'NOT_FOUND'|'HOLDER_MISMATCH'|
   'REF_INVALID'|'UNAVAILABLE')` dont le message ne contient ni valeur, ni titulaire attendu.
3. `fake/fake-psp-secret-store.ts`, `FakePspSecretStore` : `isFake = true` ; mémoire du processus ;
   `put(secretRef, {adapter?, current, previous?, previousValidUntil?})` (chaînes ou `Secret`) ;
   `get` : (a) forme `^psp/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
   [A-Za-z0-9._-]+$` sinon `REF_INVALID` ; (b) segment = `holderPartyId` (insensible à la casse)
   sinon `HOLDER_MISMATCH` ; (c) présent sinon `NOT_FOUND` ; `previous` sans `previousValidUntil`
   est refusé à `put` (un précédent sans échéance vaudrait sans limite, A23). Aucune lecture de
   variable d'environnement, aucun fichier.
4. Contrôle de l'échéance : le coffre **rend** l'échéance ; c'est `verifyHmacSignature` (T032) qui
   refuse au-delà. Un test croisé le prouve avec un faux horloge fourni par `now`.
5. `unavailable/unavailable-psp.ts` : `UnavailablePspSecretStore.get` lève
   `PspSecretError('UNAVAILABLE')` (non faux : pas d'`isFake`) ; .

Validation :
- [ ] Un `secretRef` de titulaire A demandé avec le titulaire B : `HOLDER_MISMATCH`, sans valeur
  dans
      le message.
- [ ] Canari : une valeur de secret `CANARI-…` ne ressort ni de `String()`, `JSON.stringify`,
      `util.inspect`, ni d'aucun message d'erreur du lot.

### T034 — Production : fournisseur « indisponible » et garde `assertProcessIsSafe`

But : en production, aucun faux n'est construit ; si un faux est présent quand même, le démarrage
est refusé.

1. `psp-adapter-registry.ts`, `class PspAdapterRegistry` : constructeur `(adapters:
   readonly PspAdapter[], available: boolean)` ; `forProvider(provider)` : `available` faux ou
   fournisseur absent → `ProblemException('PSP_UNAVAILABLE', {status: 503})` ; `get isFake():
   true | undefined` vrai si **un** adaptateur contenu est un faux (la garde lit `isFake`) ;
   `readonly available`. Pas de singleton global.
2. `unavailable/unavailable-psp.ts` : `UnavailablePspSecretStore` seulement. Le « fournisseur
   indisponible » des adaptateurs est le registre vide `new PspAdapterRegistry([], false)` : pas de
   classe d'adaptateur indisponible séparée.
3. `psp.providers.ts` (seul fichier qui importe `./fake/…`) : `createPspAdapters(config:
   Pick<AppConfig,'production'>)` → production : `new PspAdapterRegistry([], false)` ; sinon quatre
   `FakePspAdapter`, `available = true` ; `createPspSecretStore(config)` → production :
   `UnavailablePspSecretStore` ; sinon `FakePspSecretStore`. Les deux fonctions n'ont aucun
   paramètre d'environnement : rien ne permet de demander un faux en production.
4. `processes/bootstrap.ts`, `assertProcessIsSafe` : ajoute `'les adaptateurs PSP': optional(app,
   PSP_ADAPTERS)` et `'le coffre des secrets PSP': optional(app, PSP_SECRET_STORE)` à la liste déjà
   lue ; importe les jetons de `../psp/psp.tokens`. Aucun autre changement du fichier.
5. Comportement documenté en tête de `psp.providers.ts` : « production : pas de recharge en ligne
   tant que les adaptateurs réels ne sont pas livrés (OP-N81, ADR-131) ; routes espèces non
   concernées ; notification → `404` côté WP12 ; travailleur inactif ». N'écris pas de lien vers un
   fichier qui n'existe pas.
6. Borne OP-N81 : un test (T036) échoue dès que `createPspAdapters({production:true})` rend un
   adaptateur : il force à mettre à jour OP-N81 / ADR-131 quand la mission des adaptateurs réels
   arrive.

Cas limites : `optional(app, token)` rend `null` pour un processus qui n'importe pas `PspModule`
(clés, personnalisation, contrôle quotidien) → pas de refus ; le registre est lu par `isFake` et non
par type : un faux de remplacement quelconque est attrapé.

Validation :
- [ ] `assertProcessIsSafe` sur un processus de production portant un registre avec un
      `FakePspAdapter` : `FakeInProductionError` nommant « les adaptateurs PSP » ; idem le faux
      coffre.
- [ ] Hors production, aucun refus.

### T035 — Codes SQLSTATE, problèmes et câblage des modules

But : rendre le socle injectable et traduire les codes de la base que ce lot peut connaître.

1. `psp.module.ts` : `@Global() @Module({ providers: [{ provide: PSP_ADAPTERS, inject: [APP_CONFIG],
   useFactory: createPspAdapters }, { provide: PSP_SECRET_STORE, inject: [APP_CONFIG], useFactory:
   createPspSecretStore }], exports: [PSP_ADAPTERS, PSP_SECRET_STORE] })`. `APP_CONFIG` est fourni
   par le module de configuration global existant (vérifie comment `CustomerIdentityModule`
   l'obtient).
2. `app.module.ts` : ajoute `PspModule` à `imports`, avec un commentaire d'une ligne (« mission 6 :
   ports PSP et coffre, faux hors production seulement »). Le processus des travailleurs
   `psp-poller` (WP12) importe `PspModule` lui-même.
3. `public.module.ts` : aucun changement fonctionnel. Mets à jour le commentaire d'en-tête pour dire
   que le processus public porte les ports PSP mais **aucun droit** sur le service de clés ; vérifie
   que `test/unit/architecture.spec.ts` reste vert.
4. `sqlstate-map.ts` : regarde si `packages/ledger-sql/migrations/0036_cash_sessions.sql`,
   `0037_psp_configurations.sql` et `0038_psp_topups.sql` sont présentes dans ta lane. **Oui** :
   relève les `ERRCODE = 'CLxxx'` nouveaux (au-delà de `CL040`), ajoute chacun à `SQLSTATE_MAP` avec
   le code de problème et le statut que les commentaires de la migration indiquent (conflit d'état →
   `409 CONFLICT_STATE`, garde de caisse → `409 CONFLICT_STATE`, validation → `422
   VALIDATION_FAILED`, fermeture par le compteur → `403 FORBIDDEN`, portefeuille bloqué → `422
   WALLET_BLOCKED`, etc.), un commentaire par entrée (migration, fonction). **Non** : n'invente
   aucun code ; liste dans le compte rendu les codes à ajouter par le premier lot qui les rencontre
   (WP08, WP09, WP11, WP13 ont une retouche d'une ligne autorisée). Ajoute les contraintes d'unicité
   traduites seulement si une migration dit qu'elles doivent l'être (`UNIQUE_CONSTRAINTS`, liste
   fermée). Codes attendus (arbitrage du 27/10/2026) : `CL041` (fermeur qui a compté, `403
   FORBIDDEN`), `CL042` (`PSP_NOT_CONFIGURED`, `409`), `CL043` et `CL044` (`409 CONFLICT_STATE`) ;
   `CL039` reste `422 WALLET_BLOCKED`.
5. Adapte `test/unit/errors/sqlstate-map.spec.ts` **uniquement** s'il énumère la table de façon
   exhaustive (c'est hors carte : retouche justifiée et consignée).
6. Aucune variable d'environnement nouvelle ; `config.ts` n'est pas touché (C-005).

Validation :
- [ ] L'application compile avec `PspModule` ; `app.get(PSP_ADAPTERS)` rend le registre de faux hors
  production.
- [ ] Chaque entrée ajoutée à `SQLSTATE_MAP` cite sa source ; sinon liste de report dans le compte
  rendu.

### T036 — Tests unitaires : garde de production, signature, normalisation, coffre

But : prouver les propriétés de sécurité, pas seulement le chemin heureux.

1. `test/unit/psp/hmac-signature.spec.ts` : en-tête bien formé / mal formé (sans `t`, `t` non
   entier, sans `v1`, hex invalide) ; signature du secret courant acceptée ; du précédent acceptée
   avant son échéance, **refusée après** ; signature fausse ; un octet du corps modifié ; `|t−now|`
   = 300 s accepté, 301 s refusé (passé et futur) ; plusieurs `v1` dont un bon ; longueur de
   signature fausse ; test d'évaluation des deux secrets (`jest.spyOn(crypto, 'timingSafeEqual')` :
   au moins deux comparaisons même si le courant correspond ; une comparaison au tampon de
   remplissage quand la longueur diffère) ; signature fausse + horodatage faux →
   `SIGNATURE_INVALID`.
2. `test/unit/psp/fake-psp-adapter.spec.ts` : quatre fournisseurs × cinq types ; normalisation
   (carte avec et sans 3-D Secure, carte absente, empreinte absente) ; `getStatus` rend le même type
   ; référence inconnue → `UNKNOWN` ; JSON invalide après bonne signature → `BODY_MALFORMED` ;
   **JSON non lu avant la signature** (`jest.spyOn(JSON, 'parse')` non appelé quand la signature est
   fausse) ; `cancel` ; `failNextInitiate` ; type inconnu → `UNKNOWN`.
3. `test/unit/psp/fake-secret-store.spec.ts` : titulaire croisé, forme invalide, absent, précédent
   sans échéance refusé à `put`, canari absent de `String`, `JSON.stringify`, `util.inspect` et de
   tous les messages d'erreur.
4. `test/unit/psp/psp-providers.spec.ts` : (a) **production** :
   `createPspAdapters({production:true})` registre vide, `available` faux, `isFake` indéfini,
   `forProvider('WAVE')` → `PSP_UNAVAILABLE` 503 ; `createPspSecretStore({production:true})` →
   `UnavailablePspSecretStore` (borne OP-N81, nomme-la dans le titre du test) ; (b) hors production
   : quatre faux, tous `isFake` ; (c) garde : pour chacun des cinq faux (quatre adaptateurs dans un
   registre, le coffre) `assertNoFakeInProduction(true, …)` lève `FakeInProductionError` et `false`
   ne lève pas ; (d) `assertProcessIsSafe` avec le registre ou le coffre faux dans un processus de
   production échoue, avec le registre indisponible passe ; (e) module : `Test.createTestingModule({
   imports: [PspModule] , providers: [APP_CONFIG …] })` compile en production sans lever et fournit
   un registre indisponible ; (f) le processus public complet en production lève
   `FakeInProductionError` dont le message ne cite **ni** « adaptateurs PSP » **ni** « coffre »
   (seule la cause préexistante, l'identité du festivalier, subsiste ; commentaire qui renvoie à la
   contradiction signalée) ; (g) balayage de `src/` : seul `psp/psp.providers.ts` importe
   `psp/fake/`.
5. `production-guard.spec.ts` : ajoute les deux lignes (`'les adaptateurs PSP'`, `'le coffre des
   secrets PSP'`) au tableau paramétré de la garde de démarrage, sur le modèle des trois ports de
   5a.

Validation :
- [ ] Chaque test de sécurité échoue si l'on retire la propriété qu'il prouve (essai local : sortie
      anticipée sur le premier secret, JSON lu avant la signature, précédent sans échéance).

## Test Strategy

- Unitaires (aucune base) : `cd apps/api && npx jest test/unit/psp
  test/unit/production-guard.spec.ts test/unit/architecture.spec.ts test/unit/errors`, **en série**.
  `test/unit/processes.spec.ts` (bloc de démarrage réel en production) peut exiger la base :
  lance-le sur `cashless_wp07`.
- Pas de pgTAP. `cashless_test` est réservée à l'orchestrateur.
- Horloge : `now` est un paramètre de `verifyNotification` ; aucun test ne s'appuie sur l'horloge de
  la base ni sur une attente réelle. Jamais de `setTimeout` pour l'échéance d'un secret.
- Lignes de 100 caractères, Prettier et lint propres sur les fichiers touchés.

## Definition of Done

- [ ] T031 à T036 faits ; `tsc`, lint, Prettier propres ; aucune dépendance ajoutée ; aucun `.sql`
      modifié ; `config.ts` intact.
- [ ] Tests nouveaux verts ; tests existants verts sans changement d'attente (hors les deux lignes
      ajoutées à `production-guard.spec.ts`).
- [ ] Aucun faux construit en production (preuve : registre vide, test de borne OP-N81) ; garde de
      démarrage prouvée par test pour les cinq faux.
- [ ] Matrice d'acceptation : FR-020, FR-022, NFR-003 (partie coffre), NFR-004, C-005, C-006 passés
  à
      `pass` avec commande et résultat ; FR-021 reste « Deferred ».
- [ ] Compte rendu du lot : écarts au plan avec leur sens (ajout de `cancel` ; `Secret` ; ordre
      interne de `verifyNotification` ; contradiction A5 / processus public) ; liste exacte des noms
      exportés pour WP10 à WP13 ; codes SQLSTATE ajoutés ou à ajouter ; points soumis au porteur ;
      fichiers à faire relire par une personne : `hmac-signature.ts`, `secret.ts`,
      `fake-psp-secret-store.ts`, `bootstrap.ts` (cryptographie et secrets : l'agent qui a écrit le
      code ne vaut pas relecture indépendante) ; critères couverts avec preuve.

## Risks

- Une sortie anticipée sur le premier secret, ou un `===` sur des chaînes de signature, fait fuiter
  la validité par le temps : le test d'évaluation des deux secrets est là pour ça.
- `isFake` porté par un objet interne que la garde ne voit pas : la garde lit le **registre**
  (getter), pas chaque adaptateur ; le test (d) le prouve avec un faux glissé dans le registre.
- Le faux ne doit jamais devenir une porte de service : le domaine factice est en `.invalid`, aucun
  secret par défaut dans le code (les tests posent les leurs).
- Un adaptateur qui lit le corps avant la signature rendrait la route exploitable par un appelant
  non authentifié : l'ordre (1) à (5) fait partie du contrat du port.
- `PspModule` global dans `AppModule` : un processus qui l'importe sans `APP_CONFIG` échoue au
  démarrage ; WP12 doit importer le module de configuration du processus avant.

## Reviewer Guidance

Tente de casser : (1) un faux construit en production par un chemin détourné (variable
d'environnement, second module, constructeur appelé ailleurs) ; (2) un secret visible dans un
message d'erreur, un `console.log`, un `JSON.stringify` d'un objet de configuration ; (3) la
comparaison de signatures hors temps constant ou avec sortie anticipée ; (4) un secret précédent
sans échéance qui vaut indéfiniment ; (5) un `secret_ref` d'un autre titulaire accepté ; (6) un
horodatage vérifié avant la signature (information donnée à un appelant non authentifié) ou un JSON
lu avant elle ; (7) un test de garde qui passe parce que `isFake` n'est jamais lu (registre non
branché dans `assertProcessIsSafe`) ; (8) un type normalisé différent entre `getStatus` et
`verifyNotification` (carte sans 3-D Secure créditée par l'interrogation) ; (9) une dépendance ou
une variable d'environnement ajoutée ; (10) un test de borne OP-N81 qui ne prouve rien parce qu'il
construit lui-même le registre.
