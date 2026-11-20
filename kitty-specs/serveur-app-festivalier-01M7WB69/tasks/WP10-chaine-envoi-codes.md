---
work_package_id: WP10
title: Chaîne d'envoi des codes (WhatsApp, SMS principal, SMS de repli)
dependencies: [WP04, WP07]
requirement_refs:
- FR-011
- FR-012
- FR-013
- NFR-001
- NFR-002
- NFR-005
- C-003
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
subtasks: [T041, T042, T043, T044, T045]
phase: Phase 2 - API
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/customer-auth/otp-chain.ts
create_intent:
- apps/api/src/customer-auth/otp-chain.ts
- apps/api/src/customer-auth/otp-providers.ts
- apps/api/test/unit/customer-auth/otp-chain.spec.ts
- apps/api/test/integration/customer-auth/otp-chain.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/customer-auth/otp-sender.ts
- apps/api/src/customer-auth/otp-chain.ts
- apps/api/src/customer-auth/otp-providers.ts
- apps/api/src/customer-auth/customer-auth.module.ts
- apps/api/src/customer-auth/customer-auth.service.ts
- apps/api/src/processes/bootstrap.ts
- apps/gateway/test/e2e/production-refusals.spec.ts
- apps/api/test/unit/customer-auth/otp-chain.spec.ts
- apps/api/test/integration/customer-auth/otp-chain.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 : Chaîne d'envoi des codes (WhatsApp, SMS principal, SMS de repli)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/otp-sender-chain.md`, `interfaces.md` (lignes `OtpProvider`, `ChainedOtpSender`, faux,
  configuration, `otp_channel_attempt`), `research.md` R-08 ; la migration `0099` **telle que
  fusionnée** (colonnes, `CHECK` éventuel de `failed_reason`, droits de `cashless_app` : `INSERT`,
  `UPDATE (confirmed_at, failed_reason)`, `SELECT`) ;
- `apps/api/src/customer-auth/otp-sender.ts` en entier (53 lignes : port l. 16-20, `FakeOtpSender`
  l. 32-48, `createOtpSender` l. 50-53) ;
- `apps/api/src/customer-auth/customer-auth.service.ts` : constructeur l. 77-86, `senderIsFake`
  l. 88-91, `requestOtp` l. 106-133, `issueChallenge` (code du titulaire, `linkFor`) l. 141-164,
  `createChallenge` l. 166-224 (transaction du défi l. 180-218, **envoi après validation du défi**
  l. 219-223) ; `customer-auth.controller.ts` l. 26 (`X-Test-Otp-Code` posé si `senderIsFake`) ;
  `customer-auth.module.ts` en entier (18 lignes) ;
- `apps/api/src/processes/bootstrap.ts` l. 44-65 (`assertProcessIsSafe`, libellé l. 52) et
  `apps/api/src/kms/production-guard.ts` l. 6-29 (`FakeInProductionError`,
  `assertNoFakeInProduction`) ;
- `apps/gateway/test/e2e/production-refusals.spec.ts` l. 378-450 (`centralFakes()` lit les libellés
  dans `bootstrap.ts` par l'expression `/'([^']+)': optional/`, `COVERAGE` l. 394-443 ; l. 427-430
  pour l'entrée actuelle) ;
- `apps/api/test/unit/production-guard.spec.ts` l. 100-130 et 185-215 (`processWith`) ;
  `test/integration/end-to-end/device-latency.spec.ts` l. 280-373 (jeux de faux en production) ;
  `test/integration/customer-auth/otp.spec.ts` l. 185-230 (envoyeur de remplacement) ;
  `test/integration/refunds/holder-link.spec.ts` l. 15-45 (`lastSent()` du faux).

Priorité des sources (SPECIFICATION §0.3). Contradiction ou manque : tu le signales, tu ne tranches
pas en silence.

## Objective

Remplacer l'envoyeur unique par `ChainedOtpSender` : le même code part par WhatsApp, puis par le SMS
principal (sans confirmation à 10 s, ou numéro sans WhatsApp), puis par le SMS de repli (sans
confirmation à 20 s), avec des délais réglables. Le code reste en mémoire du processus seulement,
jamais en base, journal ni réponse ; chaque essai est noté sans code ; les trois faux refusent le
démarrage en production (FR-011, FR-012, FR-013, NFR-001, NFR-002, NFR-005, C-003).

## Context

- **Décision du porteur (20/11/2026)** : code gardé en mémoire du processus seulement pendant la
  chaîne ; bascule perdue au redémarrage (le festivalier redemande ou choisit `SMS`).
  `X-Test-Otp-Code` inchangé (OP-N120, ADR-180). Règle 2 de `CLAUDE.md` : aucun faux en production,
  prouvé par un test.
- **Interfaces possédées** (`interfaces.md`) : `OtpProvider { name; isFake?; send(phone, code,
  link?): Promise<{ accepted; noWhatsApp?; deliveryRef? }>; onDelivery(listener: (deliveryRef) =>
  void) }` ; `OtpSender.send` gagne un **5e argument facultatif**
  `context?: { challengeId, operatorId }` (le service le passe ; pas d'`AsyncLocalStorage`) ;
  `ChainedOtpSender`, `FakeWhatsAppProvider`, `FakeSmsPrimaryProvider`, `FakeSmsFallbackProvider`,
  libellés de refus (ci-dessous). `OTP_SENDER` garde son nom.
- **Interfaces consommées** : `AppConfig.otpWhatsappTimeoutMs`, `otpSmsPrimaryTimeoutMs` (WP07) ;
  `otp_channel_attempt` (WP03/WP04).
- **Décisions de l'orchestrateur (`interfaces.md`)** : délais bornés (WhatsApp 1 000 à 15 000 ms,
  SMS principal 1 000 à 20 000 ms) ; code effacé à la confirmation ou **dès le dernier envoi**, 35 s
  au plus (plafond dur, constante nommée) : ce n'est plus un écart à soumettre. Les accusés se
  corrèlent par `deliveryRef` rendu par `send` ; le lien du titulaire est passé au fournisseur par
  `send(phone, code, link?)`.
- **Retouches hors carte à nommer** (la garde change de libellés) :
  `test/unit/production-guard.spec.ts` l. 7 (import), 117-126 et 200 (`createOtpSender`, libellé,
  `FakeOtpSender`) ; `test/integration/end-to-end/device-latency.spec.ts` l. 286, 296, 333, 365-373
  (le faux « de l'envoi des codes » devient trois entrées, `NEUTRAL` reçoit les trois jetons de
  fournisseur) ; `docs/POINTS_OUVERTS.md` (OP-N120 cite l'ancien libellé : WP11).

## Subtasks

### T041 : `OtpProvider`, trois faux réglables, refus en production

1. `otp-providers.ts` : jetons `OTP_WHATSAPP_PROVIDER`, `OTP_SMS_PRIMARY_PROVIDER`,
   `OTP_SMS_FALLBACK_PROVIDER` (symboles) ; type `OtpProvider` (dans `otp-sender.ts` ou ici, une
   seule définition) ; trois classes `Fake…Provider` avec `isFake = true`, `name` (`whatsapp-fake`,
   `sms-primary-fake`, `sms-fallback-fake`) et un **comportement réglable** : `'CONFIRMS'` (accepte,
   puis notifie l'accusé), `'SILENT'` (accepte, jamais d'accusé), `'REFUSES'` (`accepted: false`),
   `'THROWS'` ; pour WhatsApp aussi `'NO_WHATSAPP'` (`{ accepted: false, noWhatsApp: true }`).
   **Défaut : `'CONFIRMS'`** (en développement, aucune minuterie ne court). `confirm(deliveryRef)`
   notifie un accusé tardif (le faux rend un `deliveryRef` unique par envoi) ; `sent()` garde les
   envois reçus (phone, code, link) **pour les tests seulement**.
2. Trois fabriques (`createWhatsAppProvider(config)`, …) sur le modèle de l'ancien `createOtpSender`
   : en production, `throw new FakeInProductionError([libellé])`. Libellés **exacts**, apostrophe
   typographique `’` (l'expression de `production-refusals.spec.ts` interdit l'apostrophe droite) :
   `l’envoi des codes par WhatsApp`, `l’envoi des codes par SMS (principal)`,
   `l’envoi des codes par SMS (repli)`.
3. `otp-sender.ts` : retire `createOtpSender` (remplacé par les trois fabriques et la fabrique de la
   chaîne) ; garde `FakeOtpSender` et ses types (des tests le citent) ; ajoute le 5e argument
   facultatif au port.

### T042 : `ChainedOtpSender` (ordre, délais, mémoire bornée, `close()`)

1. `otp-chain.ts` : `constructor({ whatsapp, smsPrimary, smsFallback, whatsappTimeoutMs,
   smsPrimaryTimeoutMs, recorder, now? })`. `isFake` vrai si l'un des trois l'est. S'abonne à
   `onDelivery` des trois fournisseurs.
2. `send(phone, code, channel, link?, context?)` : `context` (défi et prestataire) sert aux essais
   notés. Canal `AUTO` ou `WHATSAPP` : démarre à WhatsApp ; `SMS` : démarre au SMS principal
   (**aucun essai WhatsApp**). Envoie au premier fournisseur et **retourne dès que cet envoi est
   rendu** (la route ne doit pas attendre 30 s) ; la suite se déroule par minuteries : après l'envoi
   WhatsApp, attendre `whatsappTimeoutMs` sans accusé, puis SMS principal ; après le SMS principal,
   `smsPrimaryTimeoutMs`, puis SMS de repli. `{ accepted: false }` (refus ou `noWhatsApp`) ou une
   exception : passer **aussitôt** au suivant ; le dernier échoue : la chaîne s'arrête, sans erreur
   rendue à l'appelant (le défi reste valide).
3. Accusé : `onDelivery(deliveryRef)` du fournisseur de l'étape courante ou **d'une étape passée** :
   note la confirmation ; si c'est l'étape courante, arrête la chaîne et efface le code ; un accusé
   tardif d'une étape passée ne relance rien et n'envoie **aucun second message**.
4. **Mémoire** : une entrée par défi (clé `challengeId`, sinon `phone`), un seul code par entrée, le
   même code à chaque étape. Effacement (`code = ''`, minuteries annulées) : dernier envoi tenté,
   confirmation, remplacement (nouvel envoi pour le même défi), plafond dur de 35 s, `close()`.
   **Bornée** : 1 000 entrées au plus (constante nommée) ; la suivante efface la plus ancienne.
   Minuteries `unref()`. `close()` annule toutes les minuteries, efface tous les codes, refuse les
   envois suivants ; branché sur `onModuleDestroy` (l'arrêt du processus).
5. `lastSent(): SentOtp | null` : **seulement si `isFake`** (tests existants :
   `holder-link.spec.ts`), `null` sinon. `inFlightCount()` pour les tests.
6. **Jamais** le code ni un message d'erreur de fournisseur dans un journal : une erreur de
   fournisseur est notée par `provider.name` et une raison fermée (`ERROR`, `REFUSED`,
   `NO_WHATSAPP`), rien de plus.

Validation : unitaires de T045. Cas limites : deux demandes rapprochées du même numéro (la seconde
remplace la première, la première ne se déclenche plus) ; code d'un titulaire (`link`) et connexion
du même numéro en même temps : deux défis, deux entrées, aucun écrasement mutuel.

### T043 : canaux notés dans `otp_channel_attempt` ; bascules hors limites

1. Interface `AttemptRecorder { start(ctx, channel, provider): Promise<string | null>; confirm(id):
   Promise<void>; fail(id, reason): Promise<void> }`. Implémentation de base dans
   `customer-auth.module.ts` ou `otp-chain.ts` par `TenantTx.run(operatorId, …)` : `INSERT INTO
   otp_channel_attempt (id, operator_id, challenge_id, channel, provider, sent_at)` (`channel` ∈
   `WHATSAPP`, `SMS_PRIMARY`, `SMS_FALLBACK`), puis `UPDATE … SET confirmed_at` ou `failed_reason`
   (seules colonnes modifiables). **Aucun code, aucune empreinte.** Une erreur du journal de canaux
   est avalée (jamais elle ne bloque l'envoi) et notée sans code.
2. Les bascules **ne créent aucun `otp_challenge`** et ne passent pas par `waitBeforeRequest` : les
   limites (`customer-auth.service.ts` l. 226-261) ne bougent pas. Le test d'intégration le prouve.
3. `customer-auth.service.ts` l. 219-223 : passer `{ challengeId, operatorId }` en 5e argument de
   `this.sender.send(…)` (4e : `link`, éventuellement `undefined`), sans autre changement de
   réponse.

### T044 : branchement du module et de `bootstrap.ts` ; `COVERAGE`

1. `customer-auth.module.ts` : trois fournisseurs de jetons (fabriques de T041) et `{ provide:
   OTP_SENDER, inject: [APP_CONFIG, WA, SP, SF, TenantTx], useFactory }` qui construit la chaîne.
2. `bootstrap.ts` : **remplacer** l'entrée `'l’envoi des codes à usage unique': optional(app,
   OTP_SENDER)` (l. 52) par les trois entrées `optional(app, OTP_WHATSAPP_PROVIDER)` etc., avec les
   trois libellés de T041 (importer les jetons, retirer l'import d'`OTP_SENDER` s'il devient
   inutile).
3. `production-refusals.spec.ts` : dans `COVERAGE`, retirer l'entrée de l'ancien libellé (le test «
   sansFaux » échouerait) et ajouter les trois, `{ edgeProcess: false, suite:
   'test/unit/customer-auth/otp-chain.spec.ts' }`.
4. Retouches hors carte de « Context », faites et listées.

### T045 : unitaires (horloge simulée, NFR-001) et intégration (code absent)

**Unitaires** `test/unit/customer-auth/otp-chain.spec.ts` (`jest.useFakeTimers()`,
`advanceTimersByTimeAsync`, enregistreur en mémoire) : (1) `AUTO` avec WhatsApp qui confirme : aucun
SMS ; (2) WhatsApp muet : le SMS principal part à **10 000 ms** (borne 11 000, NFR-001), le repli à
**+20 000 ms** ; (3) `NO_WHATSAPP` : SMS principal sans attendre ; (4) `SMS` demandé : WhatsApp
jamais appelé ; (5) même code aux trois étapes, un seul défi ; (6) accusé tardif d'une étape passée
: aucun envoi de plus, `confirmed_at` noté ; (7) tous échouent : `send` n'échoue pas, plus rien en
mémoire ; (8) mémoire : `inFlightCount()` revient à 0 après confirmation, fin de chaîne, `close()` ;
borne de 1 000 (la 1 001ᵉ efface la plus ancienne, qui ne se déclenche plus) ;
`jest.getTimerCount()` vaut 0 après `close()` ; plafond dur ; (9) l'enregistreur ne reçoit
**jamais** le code (`JSON.stringify` des appels) ; (10) une erreur de fournisseur dont le message
contient le code : sorties standard et d'erreur espionnées, 0 occurrence ; (11) production : les
trois fabriques lèvent `FakeInProductionError` avec leur libellé exact, et `assertProcessIsSafe`
nomme chaque faux seul (modèle `processWith`, `production-guard.spec.ts` l. 206-212).

**Intégration** `test/integration/customer-auth/otp-chain.spec.ts` (`createTestApp` avec les
fournisseurs de jetons remplacés par des faux réglés, `OTP_WHATSAPP_TIMEOUT_MS=1000`,
`OTP_SMS_PRIMARY_TIMEOUT_MS=1000`, **minuteries réelles** : « une passe réelle ») : WhatsApp et SMS
principal muets, repli qui confirme : `POST /customer-auth/otp` (`AUTO`) rend `202`, après ~2,5 s
`otp_channel_attempt` porte trois lignes (`WHATSAPP`, `SMS_PRIMARY`, `SMS_FALLBACK`), `confirmed_at`
sur la dernière seulement, un seul `otp_challenge`, **le même code** reçu par les trois faux, et
l'échange de ce code rend les jetons (SC-005, FR-013). Limites : trois demandes puis une quatrième :
`429 OTP_RATE_LIMITED` comme avant ; les bascules n'ont pas compté. NFR-002 : le code est cherché
dans toutes les colonnes texte du prestataire de l'essai, `audit_log`, `api_idempotency`, et dans
les sorties espionnées : 0 occurrence ; `X-Test-Otp-Code` encore présent avec des faux ; absent avec
un fournisseur non factice (modèle `otp.spec.ts` l. 188-230). Arrêt : `app.close()` pendant une
chaîne en cours : aucune minuterie vivante, aucune écriture après. Comptages limités au prestataire
de l'essai.

**Mutations obligatoires** (note de lane) : (a) n'efface pas le code à la confirmation : test 8
échoue ; (b) échange les deux délais : test 2 échoue ; (c) retire l'annulation des minuteries de
`close()` : `getTimerCount` échoue ; (d) supprime la borne de 1 000 : test 8 échoue ; (e) retire un
libellé de `bootstrap.ts` : le test de `COVERAGE` et le test 11 échouent ; (f) écris le code dans
`failed_reason` : test 9 échoue.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP04 et WP07 (donc WP01 à WP03).
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP10 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Commandes de preuve

```
cd <lane>/apps/api
export PGDATABASE=cashless_wp10; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/unit/customer-auth test/unit/production-guard.spec.ts \
  test/integration/customer-auth --runInBand --forceExit
npx eslint src/customer-auth src/processes && npx tsc --noEmit -p tsconfig.json
```

## Definition of Done

- [ ] Ordre, délais (10 s, 20 s, tolérance 1 s), `noWhatsApp`, canal `SMS`, accusé tardif : prouvés
  (NFR-001).
- [ ] Un seul code, un seul défi, limites inchangées ; code absent de la base et des journaux
  (NFR-002).
- [ ] Mémoire bornée, aucune minuterie qui fuit, `close()` ; plafond dur et effacement prouvés.
- [ ] Trois faux refusés en production, libellés exacts, `COVERAGE` à jour (NFR-005) ; six mutations
  consignées.
- [ ] Note de lane : décisions de `interfaces.md` appliquées, retouches hors carte, fichiers à faire
  relire (`bootstrap.ts`, `otp-chain.ts` : gestion du code en mémoire).
- [ ] Lignes de 100 caractères au plus ; `eslint` et `tsc` propres.

## Risks

1. Minuteries qui fuient (suites bloquées, écritures après la fermeture du pool) ; `await` de toute
   la chaîne dans la route (30 s de latence).
2. Libellé avec apostrophe droite : `centralFakes()` ne le lit plus, `COVERAGE` casse.
3. Code dans un message d'erreur ou un `failed_reason` : fuite par la base ou les journaux ; tests
   existants qui lisent `OTP_SENDER` comme un `FakeOtpSender` : `lastSent()` reste sur la chaîne.

## Ce que le relecteur doit casser

- Demander un code `AUTO`, `WHATSAPP`, `SMS` avec chaque combinaison de faux ; redemander pendant
  une chaîne ; arrêter le processus pendant une chaîne ; saturer la borne de 1 000 entrées.
- Chercher le code en base, dans `otp_channel_attempt`, `audit_log`, les journaux et les erreurs
  d'un fournisseur qui lève avec le code dans son message.
- Démarrer en production avec chacun des trois faux (le central doit refuser et nommer le bon
  libellé).
- Vérifier le temps de réponse de `POST /customer-auth/otp` avec un WhatsApp muet (immédiat) et les
  bascules en temps réel ; vérifier qu'une bascule ne compte pas dans les limites.
- Retirer chaque contrôle de la liste des mutations et vérifier que le test échoue.
