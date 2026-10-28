---
work_package_id: WP12
title: Notifications et travailleur `psp-poller`
dependencies: [WP11]
requirement_refs: [FR-014, FR-015, FR-019, NFR-002, NFR-006]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T060, T061, T062, T063, T064]
phase: Phase 4 - PSP
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
authoritative_surface: apps/api/src/webhooks/
execution_mode: code_change
owned_files: [apps/api/src/webhooks/**, apps/api/src/topups/poller/**, apps/api/src/main.psp-poller.ts, apps/api/src/processes/psp-poller.module.ts, apps/api/test/integration/webhooks/**, apps/api/test/integration/topups/poller-*.spec.ts]
create_intent: [apps/api/src/webhooks/webhooks.module.ts, apps/api/src/webhooks/webhooks.controller.ts, apps/api/src/webhooks/webhook-verifier.ts, apps/api/src/webhooks/webhook-rejections.ts, apps/api/src/webhooks/webhook-intake.service.ts, apps/api/src/webhooks/event-dispatcher.ts, apps/api/src/topups/poller/poller.module.ts, apps/api/src/topups/poller/psp-topup-poller.worker.ts, apps/api/src/topups/poller/psp-event-retry.worker.ts, apps/api/src/topups/poller/psp-event-purge.worker.ts, apps/api/src/main.psp-poller.ts, apps/api/src/processes/psp-poller.module.ts, apps/api/test/integration/webhooks/receive.spec.ts, apps/api/test/integration/webhooks/rejections.spec.ts, apps/api/test/integration/webhooks/verifier.spec.ts, apps/api/test/integration/webhooks/retry.spec.ts, apps/api/test/integration/topups/poller-status.spec.ts, apps/api/test/integration/topups/poller-expiry.spec.ts, apps/api/test/integration/topups/poller-alarm.spec.ts, apps/api/test/integration/topups/poller-purge.spec.ts]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 – Notifications et travailleur `psp-poller`

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
- `spec.md` : FR-014, FR-015, FR-019, NFR-002, NFR-006, Edge Cases, contradictions 1 et 2 ;
- `research.md` : R-10, R-11, R-12 et **R-20 en entier** (qui fait foi) ; `research-adversarial.md`
  (A2, A4, A9, A13, A19, A22, A23, A24, A30) ; `plan.md` IC-08 ;
- `data-model.md` : `psp_event`, `psp_webhook_rejection`, tableau des transitions de `psp_topup` ;
- `contracts/psp.md` : sections « Notifications » (10 à 12) et « Faux » ;
  `contracts/database-rights.md` (fonctions accordées : `psp_webhook_context`,
  `psp_poll_candidates`, `record_webhook_rejection`, `record_psp_event`, `read_psp_event_body`).

Code à lire : `apps/api/src/processes/worker.ts`, `bootstrap.ts` (`serve` active `rawBody`,
`runWorkers`, `assertProcessIsSafe`), `process-base.ts`, `tag-check.module.ts` et
`main.tag-check.ts` (modèle d'un processus sans route),
`apps/api/src/media/daily-check/daily-check.worker.ts` (modèle du travailleur et de ses codes
d'alerte), `apps/api/src/device-identity/device-maintenance.ts` (travailleur de l'API publique),
`apps/api/src/db/tenant-tx.ts` (`run`, `withoutTenant`), `db/db.module.ts`,
`identity/public.decorator.ts`. Le code de WP07 (`apps/api/src/psp/`) et de WP11
(`apps/api/src/topups/psp/`) est livré en amont (dépendance) : lis d'abord le compte rendu de chacun
(fin de leurs fichiers `tasks/WP07-*.md` et `tasks/WP11-*.md`) pour les noms exacts des classes que
ce prompt désigne par leur rôle. Migration `0038_psp_topups.sql` (WP04) pour les signatures SQL
réelles.

Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > `PRD.md` ; toute contradiction est **signalée** dans le compte
rendu, jamais tranchée en silence. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/` ; ce
lot ne touche à aucun fichier SQL.

## Objective

Servir la route publique `receivePspWebhook` : vérifier (taille, configuration, signature à temps
constant sur deux secrets, horodatage) avant toute lecture du corps, conserver toute notification
authentifiée, la traiter une fois, et signaler sans rien écrire toute notification refusée. Livrer
le processus `psp-poller` (`--once`, `--list`) : reprise des événements `UNMATCHED`/`RETRY`,
interrogation des recharges `PENDING`, expiration, purge des corps, codes de sortie d'alerte. C'est
le seul point d'entrée du PSP : un défaut ici est un crédit non authentifié ou un double crédit.

## Context

- Concern IC-08 (partie notifications et travailleur). Constats à tenir : **A2** (notification avant
  la référence : conservée `UNMATCHED`, jamais consommée), **A4** (jamais de `500` en boucle),
  **A9** (lecture neutre `psp_webhook_context`, `psp_poll_candidates`), **A13** (verrou de ligne,
  100 rejeux mêlés), **A19** (traitement après conservation : le contrat est appliqué), **A22**
  (compteur durable, alerte bornée), **A23** (échéance du secret précédent), **A24** (corps purgé
  après 400 jours), **A30** (code de sortie du travailleur testé).
- Ce que ce lot **ne fait pas** : le traitement d'un paiement (R-11, `FOR UPDATE` de la recharge,
  `TOPUP`, anomalies, caution due) est livré par WP11 ; ce lot l'**appelle**. Le traitement d'une
  contestation (`DISPUTE`) est livré par WP13 : ce lot fournit la **couture** (T061).
- Dépend de ce lot : WP13 (branche son gestionnaire sur la couture), WP14 (latence NFR-006,
  concurrence de 100 rejeux, isolation et secrets de bout en bout).
- Fonctions de la base (WP03/WP04/WP05, noms du contrat, signatures exactes dans `0038`) :
  `psp_webhook_context(config)` (prestataire, fournisseur, statut, validité, `secret_ref`),
  `record_webhook_rejection(...)` (compteur borné, sans corps), `record_psp_event(...)` (unique
  `(config, id de notification)`, rend le doublon), `psp_poll_candidates(limit)`,
  `expire_psp_topups(...)`, `read_psp_event_body` (audité, `OPERATOR_ADMIN`). **WP04 ajoute les
  fonctions que ce lot appelle (arbitrage du 27/10/2026)** : `mark_psp_event` (marquer un événement
  `PROCESSED`/`UNMATCHED`/`RETRY` avec `attempts`), `psp_events_to_retry` (lister ce qui est à
  reprendre), `purge_psp_event_bodies` (purge des corps après 400 jours) ; colonne
  `psp_event.normalized jsonb` (notification normalisée sans secret, relue à la reprise : le corps
  brut n'est pas lisible par `cashless_app`). Signatures exactes dans `0038`. Si l'une manque,
  arrête-toi et signale-le (lacune de WP04/WP05) : ce lot n'écrit aucun SQL et n'ouvre aucun
  `UPDATE` direct pour `cashless_app`.
- Processus : la route vit dans le processus **public** (`AppModule`) ; le travailleur vit dans un
  processus à part, `psp-poller`, lancé par l'ordonnanceur externe avec `--once` (document 08).

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et
les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu.
Aucun faux en production ; aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Tous dans le sens le plus strict ou de pure répartition. Ils priment sur le reste du prompt.

- **Ordre de la réception, sans exception** : (1) taille ; (2) configuration retrouvée par
  `psp_webhook_context`, `ACTIVE`, du fournisseur du chemin (sinon `404` neutre, même corps et même
  durée approximative pour « inconnue », « inactive », « suspendue », « autre fournisseur ») ; (3)
  secrets rendus par `PspSecretStore` ; (4) signature ; (5) horodatage ; (6) seulement alors,
  lecture du JSON. Aucun champ du corps n'est lu avant la signature.
- **Aucune écriture au grand livre ni au registre brut pour un refus** (NFR-002). Un refus n'écrit
  que le compteur `psp_webhook_rejection` (sans corps) et un journal de sécurité.
- **Temps constant** : les deux secrets sont toujours évalués, sans sortie anticipée ; comparaison
  par `timingSafeEqual` sur des tampons de même longueur (longueur différente : refus sans comparer,
  après avoir comparé quand même à un tampon de remplissage). Aucun secret, aucune signature reçue,
  aucun corps dans un message d'erreur, un journal ou une réponse ; le journal ne porte que
  l'empreinte SHA-256 du corps.
- **`200` dès la conservation** : une fois `record_psp_event` validé, la réponse est `200` quoi
  qu'il arrive au traitement. Le traitement qui échoue marque l'événement `RETRY` ; la requête ne
  rend jamais `500` à cause du traitement (A4).
- **Aucun appel réseau sous verrou** : le traitement d'une notification ne contacte pas le PSP. Le
  travailleur lit le statut chez le PSP **avant** d'ouvrir la transaction, puis applique sous
  verrou.
- **Production** : si le fournisseur est « indisponible » (WP07), la route répond `404`, le
  travailleur est inactif (`runOnce` rend 0, `describe` le dit, `alarm()` reste 0) ; le processus
  public démarre.
- **Rôle de base du travailleur** : `cashless_app` (les fonctions lui sont accordées nommément,
  contrat des droits). Le module du processus construit son propre pool applicatif **sans
  `PlatformTx`** (pas de chaîne de connexion de la plateforme dans ce processus). Un rôle dédié est
  une amélioration possible, hors carte : à signaler, pas à créer.
- Codes de sortie d'alerte du travailleur (distincts de ceux du contrôle quotidien, 2 et 3, qui
  vivent dans un autre processus) : `2` interrogation en échec (PSP injoignable ou erreur), `3`
  événement au-delà de 5 essais, `4` purge en échec. Constantes nommées exportées.

- **Contrat de WP11 consommé ici (noms exacts, à ne pas renommer ni recopier)** :
  `PspTopupLookup.findForUpdate(client, {configurationId, merchantRef?, providerRef?})` (recharge
  verrouillée, `null` si introuvable), `PspPaymentProcessor.process(client, PaymentInput):
  PaymentOutcome` (dans la transaction de ce lot), `PspPaymentProcessor.settleUnpaid(client,
  UnpaidInput)` (échec confirmé ou échéance, vu par l'interrogation), et
  `PspPaymentProcessor.afterCommit(operatorId, outcome, audit)` (après le COMMIT de la transaction
  qui a appelé `process`). Types dans `psp-payment-types.ts` (WP11).
- **Noms de WP07 (font foi)** : jetons `PSP_ADAPTERS` (`PspAdapterRegistry`) et
  `PSP_SECRET_STORE`, `FakePspAdapter`, `FakePspSecretStore`, `signFakeNotification`,
  `verifyHmacSignature`, `WEBHOOK_TOLERANCE_SECONDS`, types `NormalizedPayment`,
  `NormalizedNotification`, `Secret` ; `PspAdapter.cancel(query, secrets)` existe ;
  `verifyNotification` rend `signedAt` (aucune demande à WP07 à ce sujet).
- **Code d'erreur** : `PAYLOAD_TOO_LARGE` (`413`, WP01) ; codes `CL041` à `CL044` mappés dans
  `errors/sqlstate-map.ts` (retouche d'une ligne par le premier lot qui les rencontre).
- **Politique de lecture de `psp_webhook_rejection`** (`operator_id IS NULL OR` prestataire
  courant, accordée par WP05) : ce lot n'écrit que par `record_webhook_rejection` et ne relit pas
  les lignes d'un autre prestataire.
- **`AuditAction`** : ce lot n'ajoute aucune valeur (aucun audit propre) ; s'il en faut une, règle
  commune de `tasks.md`. Matrice d'authentification des terminaux : la route
  `receivePspWebhook` est publique (aucune garde de terminal) et le travailleur n'a pas de route ;
  aucun fichier `*.cases.ts` n'est attribué à ce lot.
## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendance : WP11 (donc WP07, WP09, WP10).
Worktree attribué par lane d'après `lanes.json`. Commande : `spec-kitty agent action implement WP12
--agent claude --mission recharges-caisses-psp-01M5YEBA`.

Retouches hors carte autorisées, d'une ligne chacune et consignées : `apps/api/src/app.module.ts`
(import de `WebhooksModule`, fichier de WP07) ; `apps/api/package.json` (script `start:psp-poller`,
sur le modèle de `start:tag-check`) ; `packages/contracts/openapi.yaml` seulement si
`receivePspWebhook` n'a pas déjà `x-process: public` comme `createPayment` (même convention). Toute
autre retouche : à demander.

## Subtasks

### T060 — Réception : corps brut, taille, configuration, signature, horodatage, compteur des refus

But : `POST /v1/webhooks/{provider}/{psp_config_id}` (préfixe global comme les autres routes),
public, qui n'accepte une notification que vérifiée de bout en bout.

1. `webhooks.controller.ts` : `@Controller('webhooks')`, `@Post(':provider/:psp_config_id')`,
   `@Public()` (pas de `@DeviceAuth`, pas de `CustomerAuth`, pas d'`@Idempotent` : l'idempotence est
   celle de l'événement). `@HttpCode(200)`. Lit `req.rawBody` (octets exacts ; `serve` crée Nest
   avec `rawBody: true`, le test doit faire de même, voir `test/support/app.ts`) et `req.headers`.
   Un `provider` ou un `psp_config_id` mal formé (pas un UUID) : `404` neutre, compté
   `UNKNOWN_CONFIG`.
2. Taille (≤ 65 536 octets, constante `WEBHOOK_MAX_BODY_BYTES`) : contrôlée sur `Content-Length`
   **et** sur la longueur réelle du corps brut ; au-delà, `413` problem+json avec le code
   `PAYLOAD_TOO_LARGE` (ajouté au contrat par WP01 ; pas
   `BATCH_TOO_LARGE`). Vérifie par test
   qu'un corps de 70 Kio **et** de 1 Mio donnent `413` problem+json (l'analyseur de Nest refuse
   au-delà de sa limite avant le contrôleur : si le filtre rend autre chose qu'un `413`
   problem+json, c'est une retouche d'une ligne de `errors/problem.filter.ts` à demander, pas à
   faire).
3. `webhook-verifier.ts`, fonction pure testable `verifyWebhook({rawBody, headers, secrets, now})` :
   délègue à `PspAdapter.verifyNotification` (WP07) le schéma propre au fournisseur (en-tête
   `Wave-Signature` ou `X-Webhook-Signature`, format `t=<unix>,v1=<hex>`, HMAC-SHA256 sur
   `t.corps_brut`), et **garantit ici** : temps constant sur les deux secrets, tolérance `|t − now|
   ≤ 300 s` (`WEBHOOK_TOLERANCE_SECONDS`), secret précédent refusé au-delà de son échéance (A23,
   valeur rendue par le port). Si l'adaptateur de WP07 ne rend pas l'horodatage signé, demande-le
   plutôt que de le relire toi-même hors de la signature. `now` : horloge de Node, seule tolérance
   de ce lot (±300 s est une marge de sécurité, pas une comparaison avec la base ; les tests ne
   s'appuient jamais sur l'horloge Docker).
4. Motifs de refus (liste fermée `WebhookRejectionReason`) : `BODY_TOO_LARGE`, `UNKNOWN_CONFIG`,
   `CONFIG_NOT_ACTIVE`, `PROVIDER_MISMATCH`, `SECRET_UNAVAILABLE`, `SIGNATURE_MISSING`,
   `SIGNATURE_MALFORMED`, `SIGNATURE_INVALID`, `TIMESTAMP_OUT_OF_TOLERANCE`, `BODY_MALFORMED`.
   Réponses : `404 NOT_FOUND` neutre pour les quatre premiers et `SECRET_UNAVAILABLE` ; `401
   WEBHOOK_SIGNATURE_INVALID` pour les signatures ; `401 WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE` ; `400`
   pour un corps signé mais illisible. Codes de problème : ceux de WP01 ; vérifie leur existence.
5. `webhook-rejections.ts` : `WebhookRejections.record(reason, ctx)` fait deux choses sans jamais
   lever : (a) `record_webhook_rejection(config|NULL, reason)` dans sa propre transaction (compteur
   par minute, sans corps ; configuration inconnue : `NULL`) ; (b) journal de sécurité structuré
   `psp.webhook.rejected` (Logger de Nest, JSON : motif, fournisseur, `psp_config_id` tel que reçu,
   taille, SHA-256 du corps, adresse `req.ip`) et alerte d'exploitation bornée : à la première
   occurrence du couple (motif, configuration) dans la minute et au seuil de 100 par minute, **au
   plus une alerte par minute et par motif** (limiteur en mémoire du processus ; le compteur durable
   fait foi pour l'agrégat). Si l'enregistrement du compteur échoue, le refus est quand même rendu
   (un compteur en panne ne doit pas ouvrir la route) et l'échec est journalisé.
6. Aucune écriture dans `psp_event`, `journal_transaction`, `posting`, `psp_topup`, `anomaly` pour
   un refus.

Validation :
- [ ] Les six étapes de l'arbitrage s'exécutent dans cet ordre (test qui espionne le port de secrets
      : jamais appelé pour une configuration inconnue ou suspendue).
- [ ] `404` neutres indiscernables (corps et en-têtes identiques, hors `X-Request-Id`).
- [ ] Aucune valeur secrète, signature reçue ou corps dans les journaux (canari, WP14 le
      généralise).

### T061 — Conservation puis traitement (`RECEIVED`, `UNMATCHED`, `RETRY`)

But : `webhook-intake.service.ts`, deux transactions, et une couture pour les contestations.

1. **Transaction 1** (`TenantTx.run(operatorId)`, prestataire tiré de `psp_webhook_context`) :
   `record_psp_event(config, id de notification du PSP, corps brut, type normalisé, ...)`. Doublon
   (même `(config, id)`) : `200 {received: true, duplicate: true}`, **aucun traitement** (le
   travailleur reprend ce qui est resté `RECEIVED`/`RETRY`). Nouveau : événement `RECEIVED`
   conservé.
2. **Transaction 2** (même requête, après le commit de la 1) : `EventDispatcher.dispatch(client,
   event, notification)` (`event-dispatcher.ts`) :
   - `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `PAYMENT_CANCELLED` → le processeur de paiement de WP11
     (verrou `FOR UPDATE` de la recharge pris par lui, A13) ; corrélation par référence marchande
     `psp_topup_id` d'abord, puis référence du PSP (A2) ;
   - `DISPUTE` → couture `PSP_DISPUTE_HANDLER` (point suivant) ;
- toute issue est traduite : `PROCESSED` (avec `outcome`), `UNMATCHED` (recharge introuvable :
  l'événement est repris pendant 24 h par `PspEventRetryWorker`, puis `PSP_MISMATCH` — jamais
  d'office, A2), `RETRY` (erreur inattendue ; `attempts` +1). Un refus **définitif** du moteur
  (`PERIOD_CLOSED`, `DEBIT_AUTHORITY_EDGE`, portefeuille bloqué ou fermé, compte inactif, frais ≥
  montant, `CL002`) est déjà traduit par WP11 en `FAILED` + `PSP_TOPUP_NOT_CREDITED` ; ici il ne
  doit **jamais** devenir `RETRY` ni `500`. Si le processeur laisse remonter une erreur
  déterministe, c'est un défaut de WP11 : ne le masque pas, signale-le.
3. Toute exception de la transaction 2 est attrapée : la transaction est annulée, puis une
   **troisième** transaction courte marque l'événement `RETRY` (`attempts` +1, motif sans donnée
   sensible). La réponse reste `200`.
4. Couture : `export const PSP_DISPUTE_HANDLER = Symbol('PSP_DISPUTE_HANDLER')` et l'interface
   `DisputeHandler { handle(client, event, notification): Promise<DispatchOutcome> }`. Fournisseur
   facultatif (`@Optional()`). **Sans gestionnaire** (état de ce lot avant WP13), un `DISPUTE` est
   conservé, reste `RECEIVED`, n'est pas compté comme essai et n'alerte pas ; le test le prouve.
   WP13 branche le sien.
5. Succès découvert par interrogation et notification : même chemin de traitement, même clé
   d'écriture (c'est WP11 qui la porte) ; ce lot ne reconstruit aucune clé.
6. Réponse : `200 {received: true, duplicate: boolean}`. Latence : aucune requête par champ, une
   lecture de contexte, une écriture d'événement ; NFR-006 est mesurée par WP14 (p95 ≤ 500 ms).

Cas limites : deux notifications d'identifiants différents pour le même paiement en concurrence (le
verrou de WP11 sérialise, une seule écrit) ; notification d'une configuration `SUSPENDED` (refusée
en T060) alors que la recharge `PENDING` correspondante est suivie par le travailleur (T062) ; corps
signé dont le type est inconnu du fournisseur : conservé, `NO_EFFECT`, signalé.

Validation :
- [ ] Rejeu : `duplicate: true`, une seule ligne `psp_event`, aucun second traitement.
- [ ] `UNMATCHED` puis recharge créée puis reprise par le travailleur : `SUCCEEDED`, un seul
      `TOPUP`.
- [ ] Erreur injectée dans le processeur : `200`, événement `RETRY`, aucune écriture au grand livre.

### T062 — Processus `psp-poller` : reprises, interrogation, expiration

But : `PspTopupPollerWorker`, `PspEventRetryWorker` (ProcessWorker de `processes/worker.ts`), module
et point d'entrée.

1. `main.psp-poller.ts` : copie de `main.tag-check.ts` avec `PspPollerProcessModule` ;
   `processes/psp-poller.module.ts` : `ProcessBaseModule`, `AuditModule`, module de pool applicatif
   local (voir l'arbitrage : `APP_CONFIG`, `PG_POOL` sur `config.databaseUrl`, `TenantTx`, fermeture
   du pool), modules de WP07 (registre des adaptateurs et coffre) et le module de traitement de
   WP11, puis `PspPollerModule` (travailleurs).
2. `PspTopupPollerWorker.name = 'psp-poller'`. `runOnce()` : `psp_poll_candidates(limite)` (lecture
   neutre, sans prestataire) rend les recharges `PENDING` de plus de 2 minutes ; pour chacune,
   **hors transaction** : `adapter.getStatus(référence)` (la recharge dont l'`initiate` a échoué n'a
   pas de référence : interroge par référence marchande) ; puis `TenantTx.run(operatorId)` : le
   processeur de WP11 prend `FOR UPDATE` la recharge, relit son état et applique (R-12). Succès :
   traitement R-11, clé d'écriture identique à la notification. Échec confirmé : `FAILED`. Échéance
   dépassée (`expires_at` ; 15 minutes pour les faux) et statut non payé : `expire_psp_topups` →
   `EXPIRED`, **après** relecture du statut ; payé entre-temps : traité comme un succès. Rend le
   nombre de recharges tranchées ; une recharge dont l'adaptateur ne répond pas n'est pas comptée
   (le drain s'arrête, comme `daily-check`).
3. Une configuration `SUSPENDED` ne bloque pas l'interrogation de ses recharges `PENDING` (A15) : ne
   filtre pas sur le statut de la configuration ; le fournisseur doit rester joignable.
4. `PspEventRetryWorker.name = 'psp-event-retry'` : reprend les événements `RECEIVED` de plus d'une
   minute, `RETRY`, et `UNMATCHED` de moins de 24 h par le même `EventDispatcher` (même code que la
   réception, pas de copie) ; `UNMATCHED` de plus de 24 h → `PSP_MISMATCH` (via WP11) ; `RETRY` à
   plus de 5 essais : plus repris automatiquement, `alarm()` = 3. Les dispositifs de reprise sont
   idempotents (mêmes clés).
5. `describe()` : une ligne par recharge à interroger et par événement à reprendre, sans donnée
   sensible (`--list`). `--once` : `runWorkers` rend `workers.alarm()`.
6. En production avec fournisseur « indisponible » : `runOnce` rend 0, aucune erreur.

Validation :
- [ ] Succès découvert par interrogation = une seule écriture, même clé que la notification du même
      paiement.
- [ ] Aucune requête vers l'adaptateur pendant qu'une transaction tient un verrou (test : l'espion
      de l'adaptateur vérifie qu'il n'est pas appelé dans le callback de `TenantTx.run`).
- [ ] `--once` rend 0 sans travail ; `--list` n'écrit rien.

### T063 — Purge des corps, alertes et codes de sortie

1. `PspEventPurgeWorker.name = 'psp-event-purge'` : purge le corps (octets) des événements de plus
   de 400 jours, métadonnées gardées (A24), par la fonction de la base (voir Context : si elle
   n'existe pas, arrêt et signalement). Passage au plus toutes les heures (modèle
   `DevicePurgeWorker`, `PSP_PURGE_INTERVAL_SECONDS`, entier 60 à 86 400, 3 600 par défaut ; valeur
   invalide : le démarrage échoue avec un message qui nomme la variable).
2. Alertes : constantes `ALARM_POLL_FAILURE = 2`, `ALARM_EVENT_RETRY_EXHAUSTED = 3`,
   `ALARM_PURGE_FAILED = 4`. `alarm()` de chaque travailleur rend son code ; une erreur d'un passage
   ne s'avale jamais en silence : elle est journalisée (sans secret) et fixe le code.
3. Le journal d'alerte de la réception (T060) et celui des travailleurs partagent un même format
   (`event`, `severity`, `reason`, champs non sensibles) pour qu'un seul filtre d'exploitation les
   attrape.
4. Lecture d'un corps brut : fonction auditée de la base pour l'`OPERATOR_ADMIN`, **sans route**
   dans ce lot (aucune opération au contrat). Ne crée pas de route ; signale le besoin.

Validation :
- [ ] Un corps de 401 jours est vidé, un de 399 jours intact ; la ligne et ses métadonnées restent.
- [ ] Code de sortie non nul (2) quand l'adaptateur échoue ; 0 sinon ; 3 pour un événement à 6
      essais.

### T064 — Tests (notifications refusées, rejeux, reprises, travailleur)

Suites Jest d'intégration (vraie base `cashless_wp12`, serveur HTTPS de test, faux PSP signeur de
WP07, fixtures de WP11 réutilisées sans copie) :
- `webhooks/receive.spec.ts` : succès Wave puis Orange Money puis carte (`200`, `TOPUP`, recharge
  `SUCCEEDED`) ; doublon (`duplicate: true`) ; deux identifiants pour un même paiement ; nouvelle
  notification après `SUCCEEDED` (sans effet) ; configuration `SUSPENDED` (refusée, recharge
  `PENDING` encore suivie).
- `webhooks/rejections.spec.ts` : **NFR-002** — 100 notifications refusées (mélange : signature
  fausse, horodatage à +301 s et −301 s, configuration inconnue, inactive, autre fournisseur, corps
  de 70 Kio) : 0 ligne `psp_event`, 0 transaction, 0 anomalie, compteur durable agrégé, un journal
  par refus, alerte bornée (au plus une par minute et par motif : 100 refus du même motif → une
  alerte, test avec horloge de Node simulée, jamais celle de la base).
- `webhooks/verifier.spec.ts` : signature avec le secret courant, avec le précédent dans sa fenêtre,
  avec le précédent hors fenêtre (refus), longueur de signature fausse, en-tête mal formé ; test de
  temps constant par construction (les deux secrets sont comparés même si le premier correspond :
  espion sur `timingSafeEqual` appelé deux fois).
- `webhooks/retry.spec.ts` : `UNMATCHED` repris ; `UNMATCHED` de 25 h → `PSP_MISMATCH` ; erreur
  injectée → `RETRY` puis succès à la reprise ; 6e essai → alarme 3 ; `DISPUTE` sans gestionnaire
  conservé sans essai.
- `topups/poller-status.spec.ts`, `poller-expiry.spec.ts`, `poller-alarm.spec.ts`,
  `poller-purge.spec.ts` selon T062 et T063 ; production : fournisseur indisponible → travailleur
  inactif, notifications `404`. Mutations que tes tests doivent tuer : horodatage non vérifié ; un
  seul secret évalué ; refus qui écrit un événement ; `500` sur erreur du traitement ; interrogation
  sous verrou.

## Test Strategy

Pgtap n'est pas touché par ce lot. Jest ciblé sur ta base propre : `npm run reset-db -w
@cashless/ledger-sql` (base `cashless_wp12`, variables d'environnement du worktree), puis `cd
apps/api && npx jest --runInBand webhooks topups/poller` et `npm run lint && npm run typecheck`.
`cashless_test` est réservée à l'orchestrateur, qui rejoue en série. Aucune comparaison entre
l'horloge de Node et celle de la base (Docker, qui peut reculer) ; la tolérance de ±300 s se teste
avec des horodatages construits à partir de l'horloge de Node seule. Lignes de 100 caractères.

## Definition of Done

- [ ] Sous-tâches T060 à T064 faites ; `spec-kitty agent tasks mark-status Txxx --status done
      --mission recharges-caisses-psp-01M5YEBA` pour chacune.
- [ ] Lint, types, Jest ciblé verts ; aucune suite existante cassée ; aucune nouvelle dépendance.
- [ ] Aucun secret, signature ou corps dans une réponse ou un journal (revue de chaque
      `Logger`/`console`).
- [ ] Compte rendu du lot, en fin de ce fichier : écarts au plan (avec leur sens), retouches hors
      carte justifiées, points soumis au porteur, **fichiers à faire relire par une personne** (au
      moins `webhook-verifier.ts` et `webhooks.controller.ts` : cryptographie et route sans
      identité), critères couverts (FR-014, FR-015, FR-019, NFR-002, NFR-006 partiel) avec
      **commande et résultat** pour la matrice d'acceptation, lacunes de la base constatées.

## Risks

- Route publique sans identité : tout contrôle oublié est un crédit non authentifié.
- Comparaison non constante ou sortie anticipée sur le premier secret.
- Corps lu (JSON analysé par Nest) avant la signature : l'analyseur lit le corps, le contrôleur ne
  doit jamais en tirer un champ avant la vérification.
- Événement conservé mais jamais retraité (travailleur absent) : couvert par l'alarme et `--list`.
- Boucle de `500` ou de reprises sur une erreur déterministe (A4).
- Compteur de refus non borné (déni de service) ; alertes en rafale.
- Interrogation du PSP sous verrou de ligne (blocage de tout le portefeuille).
- Lacune de la base (fonctions de marquage, de reprise, de purge) : à remonter, pas à contourner.

## Reviewer Guidance

Tenter de casser : ordre des vérifications (une requête sans signature atteint-elle le port des
secrets ou la base ?) ; `404` distinguables par le corps, le temps ou un en-tête ; signature valide
avec un corps modifié d'un octet ; horodatage de la limite exacte (300 s) ; secret précédent expiré
encore accepté ; refus qui laisse une ligne en base ; rejeu concurrent (100 requêtes) qui écrit deux
fois ; `200` perdu quand le traitement échoue ; `DISPUTE` consommé sans gestionnaire ; travailleur
qui appelle le PSP dans `TenantTx.run` ; code de sortie de `--once` ignoré ; purge qui vide un corps
de moins de 400 jours ; test qui « prouve » le temps constant en mesurant du temps réel ; test qui
s'appuie sur l'horloge de la base. Vérifier que chaque mutation listée en T064 est réellement tuée.
