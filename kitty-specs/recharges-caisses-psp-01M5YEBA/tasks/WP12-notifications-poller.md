---

work_package_id: WP12

title: Notifications et travailleur `psp-poller`

dependencies: [WP11]

requirement_refs: [FR-014, FR-015, FR-019, NFR-002, NFR-006]

planning_base_branch: feat/recharges-caisses-psp

merge_target_branch: feat/recharges-caisses-psp

branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.

base_branch: kitty/mission-recharges-caisses-psp-01M5YEBA

base_commit: e29d9298794ee181a92243b28c62a0c3b80c5a59

created_at: '2026-10-28T16:29:31.154093+00:00'

subtasks: [T060, T061, T062, T063, T064]

phase: Phase 4 - PSP

agent: claude

history:

- timestamp: '2026-10-27T15:00:00Z'

  agent: claude

  action: Prompt generated via /spec-kitty.tasks

agent_profile: implementer-ivan

authoritative_surface: apps/api/src/webhooks/

create_intent: [apps/api/src/webhooks/webhooks.module.ts, apps/api/src/webhooks/webhooks.controller.ts, apps/api/src/webhooks/webhook-verifier.ts, apps/api/src/webhooks/webhook-rejections.ts, apps/api/src/webhooks/webhook-intake.service.ts, apps/api/src/webhooks/event-dispatcher.ts, apps/api/src/topups/poller/poller.module.ts, apps/api/src/topups/poller/psp-topup-poller.worker.ts, apps/api/src/topups/poller/psp-event-retry.worker.ts, apps/api/src/topups/poller/psp-event-purge.worker.ts, apps/api/src/main.psp-poller.ts, apps/api/src/processes/psp-poller.module.ts, apps/api/test/integration/webhooks/receive.spec.ts, apps/api/test/integration/webhooks/rejections.spec.ts, apps/api/test/integration/webhooks/verifier.spec.ts, apps/api/test/integration/webhooks/retry.spec.ts, apps/api/test/integration/topups/poller-status.spec.ts, apps/api/test/integration/topups/poller-expiry.spec.ts, apps/api/test/integration/topups/poller-alarm.spec.ts, apps/api/test/integration/topups/poller-purge.spec.ts]

execution_mode: code_change

model: sonnet

owned_files: [apps/api/src/webhooks/**, apps/api/src/topups/poller/**, apps/api/src/main.psp-poller.ts, apps/api/src/processes/psp-poller.module.ts, apps/api/test/integration/webhooks/**, apps/api/test/integration/topups/poller-*.spec.ts]

role: implementer

tags: []

tracker_refs: []

---



# Work Package Prompt: WP12 â€“ Notifications et travailleur `psp-poller`



## âš¡ Do This First: Load Agent Profile



Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :

implementer / Agent : claude). Lis ensuite la fiche de contexte d'implÃ©mentation fournie par

l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :

- `spec.md` : FR-014, FR-015, FR-019, NFR-002, NFR-006, Edge Cases, contradictions 1 et 2 ;

- `research.md` : R-10, R-11, R-12 et **R-20 en entier** (qui fait foi) ; `research-adversarial.md`

  (A2, A4, A9, A13, A19, A22, A23, A24, A30) ; `plan.md` IC-08 ;

- `data-model.md` : `psp_event`, `psp_webhook_rejection`, tableau des transitions de `psp_topup` ;

- `contracts/psp.md` : sections Â« Notifications Â» (10 Ã  12) et Â« Faux Â» ;

  `contracts/database-rights.md` (fonctions accordÃ©es : `psp_webhook_context`,

  `psp_poll_candidates`, `record_webhook_rejection`, `record_psp_event`, `read_psp_event_body`).



Code Ã  lire : `apps/api/src/processes/worker.ts`, `bootstrap.ts` (`serve` active `rawBody`,

`runWorkers`, `assertProcessIsSafe`), `process-base.ts`, `tag-check.module.ts` et

`main.tag-check.ts` (modÃ¨le d'un processus sans route),

`apps/api/src/media/daily-check/daily-check.worker.ts` (modÃ¨le du travailleur et de ses codes

d'alerte), `apps/api/src/device-identity/device-maintenance.ts` (travailleur de l'API publique),

`apps/api/src/db/tenant-tx.ts` (`run`, `withoutTenant`), `db/db.module.ts`,

`identity/public.decorator.ts`. Le code de WP07 (`apps/api/src/psp/`) et de WP11

(`apps/api/src/topups/psp/`) est livrÃ© en amont (dÃ©pendance) : lis d'abord le compte rendu de chacun

(fin de leurs fichiers `tasks/WP07-*.md` et `tasks/WP11-*.md`) pour les noms exacts des classes que

ce prompt dÃ©signe par leur rÃ´le. Migration `0038_psp_topups.sql` (WP04) pour les signatures SQL

rÃ©elles.



PrioritÃ© des sources (SPECIFICATION Â§0.3) : tests exÃ©cutables > schÃ©ma SQL, `openapi.yaml`,

`sync_protocol.md` > SPECIFICATION > `PRD.md` ; toute contradiction est **signalÃ©e** dans le compte

rendu, jamais tranchÃ©e en silence. Ne modifie jamais un `.sql` gÃ©nÃ©rÃ© de `packages/ledger-sql/` ; ce

lot ne touche Ã  aucun fichier SQL.



## Objective



Servir la route publique `receivePspWebhook` : vÃ©rifier (taille, configuration, signature Ã  temps

constant sur deux secrets, horodatage) avant toute lecture du corps, conserver toute notification

authentifiÃ©e, la traiter une fois, et signaler sans rien Ã©crire toute notification refusÃ©e. Livrer

le processus `psp-poller` (`--once`, `--list`) : reprise des Ã©vÃ©nements `UNMATCHED`/`RETRY`,

interrogation des recharges `PENDING`, expiration, purge des corps, codes de sortie d'alerte. C'est

le seul point d'entrÃ©e du PSP : un dÃ©faut ici est un crÃ©dit non authentifiÃ© ou un double crÃ©dit.



## Context



- Concern IC-08 (partie notifications et travailleur). Constats Ã  tenir : **A2** (notification avant

  la rÃ©fÃ©rence : conservÃ©e `UNMATCHED`, jamais consommÃ©e), **A4** (jamais de `500` en boucle),

  **A9** (lecture neutre `psp_webhook_context`, `psp_poll_candidates`), **A13** (verrou de ligne,

  100 rejeux mÃªlÃ©s), **A19** (traitement aprÃ¨s conservation : le contrat est appliquÃ©), **A22**

  (compteur durable, alerte bornÃ©e), **A23** (Ã©chÃ©ance du secret prÃ©cÃ©dent), **A24** (corps purgÃ©

  aprÃ¨s 400 jours), **A30** (code de sortie du travailleur testÃ©).

- Ce que ce lot **ne fait pas** : le traitement d'un paiement (R-11, `FOR UPDATE` de la recharge,

  `TOPUP`, anomalies, caution due) est livrÃ© par WP11 ; ce lot l'**appelle**. Le traitement d'une

  contestation (`DISPUTE`) est livrÃ© par WP13 : ce lot fournit la **couture** (T061).

- DÃ©pend de ce lot : WP13 (branche son gestionnaire sur la couture), WP14 (latence NFR-006,

  concurrence de 100 rejeux, isolation et secrets de bout en bout).

- Fonctions de la base (WP03/WP04/WP05, noms du contrat, signatures exactes dans `0038`) :

  `psp_webhook_context(config)` (prestataire, fournisseur, statut, validitÃ©, `secret_ref`),

  `record_webhook_rejection(...)` (compteur bornÃ©, sans corps), `record_psp_event(...)` (unique

  `(config, id de notification)`, rend le doublon), `psp_poll_candidates(limit)`,

  `expire_psp_topups(...)`, `read_psp_event_body` (auditÃ©, `OPERATOR_ADMIN`). **WP04 ajoute les

  fonctions que ce lot appelle (arbitrage du 27/10/2026)** : `mark_psp_event` (marquer un Ã©vÃ©nement

  `PROCESSED`/`UNMATCHED`/`RETRY` avec `attempts`), `psp_events_to_retry` (lister ce qui est Ã 

  reprendre), `purge_psp_event_bodies` (purge des corps aprÃ¨s 400 jours) ; colonne

  `psp_event.normalized jsonb` (notification normalisÃ©e sans secret, relue Ã  la reprise : le corps

  brut n'est pas lisible par `cashless_app`). Signatures exactes dans `0038`. Si l'une manque,

  arrÃªte-toi et signale-le (lacune de WP04/WP05) : ce lot n'Ã©crit aucun SQL et n'ouvre aucun

  `UPDATE` direct pour `cashless_app`.

- Processus : la route vit dans le processus **public** (`AppModule`) ; le travailleur vit dans un

  processus Ã  part, `psp-poller`, lancÃ© par l'ordonnanceur externe avec `--once` (document 08).



**RÃ¨gle de sÃ©curitÃ© du projet (`CLAUDE.md`, rÃ¨gle 1)** : si un point de ce lot ne peut Ãªtre tenu

qu'en affaiblissant la sÃ©curitÃ© (droit plus large, contrÃ´le retirÃ© ou reportÃ©, secret plus exposÃ©,

faux gardÃ©), **arrÃªte-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et

les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu.

Aucun faux en production ; aucune nouvelle dÃ©pendance npm (R-18).



## Arbitrages de l'orchestrateur (27/10/2026)



Tous dans le sens le plus strict ou de pure rÃ©partition. Ils priment sur le reste du prompt.



- **Ordre de la rÃ©ception, sans exception** : (1) taille ; (2) configuration retrouvÃ©e par

  `psp_webhook_context`, `ACTIVE`, du fournisseur du chemin (sinon `404` neutre, mÃªme corps et mÃªme

  durÃ©e approximative pour Â« inconnue Â», Â« inactive Â», Â« suspendue Â», Â« autre fournisseur Â») ; (3)

  secrets rendus par `PspSecretStore` ; (4) signature ; (5) horodatage ; (6) seulement alors,

  lecture du JSON. Aucun champ du corps n'est lu avant la signature.

- **Aucune Ã©criture au grand livre ni au registre brut pour un refus** (NFR-002). Un refus n'Ã©crit

  que le compteur `psp_webhook_rejection` (sans corps) et un journal de sÃ©curitÃ©.

- **Temps constant** : les deux secrets sont toujours Ã©valuÃ©s, sans sortie anticipÃ©e ; comparaison

  par `timingSafeEqual` sur des tampons de mÃªme longueur (longueur diffÃ©rente : refus sans comparer,

  aprÃ¨s avoir comparÃ© quand mÃªme Ã  un tampon de remplissage). Aucun secret, aucune signature reÃ§ue,

  aucun corps dans un message d'erreur, un journal ou une rÃ©ponse ; le journal ne porte que

  l'empreinte SHA-256 du corps.

- **`200` dÃ¨s la conservation** : une fois `record_psp_event` validÃ©, la rÃ©ponse est `200` quoi

  qu'il arrive au traitement. Le traitement qui Ã©choue marque l'Ã©vÃ©nement `RETRY` ; la requÃªte ne

  rend jamais `500` Ã  cause du traitement (A4).

- **Aucun appel rÃ©seau sous verrou** : le traitement d'une notification ne contacte pas le PSP. Le

  travailleur lit le statut chez le PSP **avant** d'ouvrir la transaction, puis applique sous

  verrou.

- **Production** : si le fournisseur est Â« indisponible Â» (WP07), la route rÃ©pond `404`, le

  travailleur est inactif (`runOnce` rend 0, `describe` le dit, `alarm()` reste 0) ; le processus

  public dÃ©marre.

- **RÃ´le de base du travailleur** : `cashless_app` (les fonctions lui sont accordÃ©es nommÃ©ment,

  contrat des droits). Le module du processus construit son propre pool applicatif **sans

  `PlatformTx`** (pas de chaÃ®ne de connexion de la plateforme dans ce processus). Un rÃ´le dÃ©diÃ© est

  une amÃ©lioration possible, hors carte : Ã  signaler, pas Ã  crÃ©er.

- Codes de sortie d'alerte du travailleur (distincts de ceux du contrÃ´le quotidien, 2 et 3, qui

  vivent dans un autre processus) : `2` interrogation en Ã©chec (PSP injoignable ou erreur), `3`

  Ã©vÃ©nement au-delÃ  de 5 essais, `4` purge en Ã©chec. Constantes nommÃ©es exportÃ©es.



- **Contrat de WP11 consommÃ© ici (noms exacts, Ã  ne pas renommer ni recopier)** :

  `PspTopupLookup.findForUpdate(client, {configurationId, merchantRef?, providerRef?})` (recharge

  verrouillÃ©e, `null` si introuvable), `PspPaymentProcessor.process(client, PaymentInput):

  PaymentOutcome` (dans la transaction de ce lot), `PspPaymentProcessor.settleUnpaid(client,

  UnpaidInput)` (Ã©chec confirmÃ© ou Ã©chÃ©ance, vu par l'interrogation), et

  `PspPaymentProcessor.afterCommit(operatorId, outcome, audit)` (aprÃ¨s le COMMIT de la transaction

  qui a appelÃ© `process`). Types dans `psp-payment-types.ts` (WP11).

- **Noms de WP07 (font foi)** : jetons `PSP_ADAPTERS` (`PspAdapterRegistry`) et

  `PSP_SECRET_STORE`, `FakePspAdapter`, `FakePspSecretStore`, `signFakeNotification`,

  `verifyHmacSignature`, `WEBHOOK_TOLERANCE_SECONDS`, types `NormalizedPayment`,

  `NormalizedNotification`, `Secret` ; `PspAdapter.cancel(query, secrets)` existe ;

  `verifyNotification` rend `signedAt` (aucune demande Ã  WP07 Ã  ce sujet).

- **Code d'erreur** : `PAYLOAD_TOO_LARGE` (`413`, WP01) ; codes `CL041` Ã  `CL044` mappÃ©s dans

  `errors/sqlstate-map.ts` (retouche d'une ligne par le premier lot qui les rencontre).

- **Politique de lecture de `psp_webhook_rejection`** (`operator_id IS NULL OR` prestataire

  courant, accordÃ©e par WP05) : ce lot n'Ã©crit que par `record_webhook_rejection` et ne relit pas

  les lignes d'un autre prestataire.

- **`AuditAction`** : ce lot n'ajoute aucune valeur (aucun audit propre) ; s'il en faut une, rÃ¨gle

  commune de `tasks.md`. Matrice d'authentification des terminaux : la route

  `receivePspWebhook` est publique (aucune garde de terminal) et le travailleur n'a pas de route ;

  aucun fichier `*.cases.ts` n'est attribuÃ© Ã  ce lot.

## Branch Strategy



Planification et fusion sur `feat/recharges-caisses-psp`. DÃ©pendance : WP11 (donc WP07, WP09, WP10).

Worktree attribuÃ© par lane d'aprÃ¨s `lanes.json`. Commande : `spec-kitty agent action implement WP12

--agent claude --mission recharges-caisses-psp-01M5YEBA`.



Retouches hors carte autorisÃ©es, d'une ligne chacune et consignÃ©es : `apps/api/src/app.module.ts`

(import de `WebhooksModule`, fichier de WP07) ; `apps/api/package.json` (script `start:psp-poller`,

sur le modÃ¨le de `start:tag-check`) ; `packages/contracts/openapi.yaml` seulement si

`receivePspWebhook` n'a pas dÃ©jÃ  `x-process: public` comme `createPayment` (mÃªme convention). Toute

autre retouche : Ã  demander.



## Subtasks



### T060 â€” RÃ©ception : corps brut, taille, configuration, signature, horodatage, compteur des refus



But : `POST /v1/webhooks/{provider}/{psp_config_id}` (prÃ©fixe global comme les autres routes),

public, qui n'accepte une notification que vÃ©rifiÃ©e de bout en bout.



1. `webhooks.controller.ts` : `@Controller('webhooks')`, `@Post(':provider/:psp_config_id')`,

   `@Public()` (pas de `@DeviceAuth`, pas de `CustomerAuth`, pas d'`@Idempotent` : l'idempotence est

   celle de l'Ã©vÃ©nement). `@HttpCode(200)`. Lit `req.rawBody` (octets exacts ; `serve` crÃ©e Nest

   avec `rawBody: true`, le test doit faire de mÃªme, voir `test/support/app.ts`) et `req.headers`.

   Un `provider` ou un `psp_config_id` mal formÃ© (pas un UUID) : `404` neutre, comptÃ©

   `UNKNOWN_CONFIG`.

2. Taille (â‰¤ 65 536 octets, constante `WEBHOOK_MAX_BODY_BYTES`) : contrÃ´lÃ©e sur `Content-Length`

   **et** sur la longueur rÃ©elle du corps brut ; au-delÃ , `413` problem+json avec le code

   `PAYLOAD_TOO_LARGE` (ajoutÃ© au contrat par WP01 ; pas

   `BATCH_TOO_LARGE`). VÃ©rifie par test

   qu'un corps de 70 Kio **et** de 1 Mio donnent `413` problem+json (l'analyseur de Nest refuse

   au-delÃ  de sa limite avant le contrÃ´leur : si le filtre rend autre chose qu'un `413`

   problem+json, c'est une retouche d'une ligne de `errors/problem.filter.ts` Ã  demander, pas Ã 

   faire).

3. `webhook-verifier.ts`, fonction pure testable `verifyWebhook({rawBody, headers, secrets, now})` :

   dÃ©lÃ¨gue Ã  `PspAdapter.verifyNotification` (WP07) le schÃ©ma propre au fournisseur (en-tÃªte

   `Wave-Signature` ou `X-Webhook-Signature`, format `t=<unix>,v1=<hex>`, HMAC-SHA256 sur

   `t.corps_brut`), et **garantit ici** : temps constant sur les deux secrets, tolÃ©rance `|t âˆ’ now|

   â‰¤ 300 s` (`WEBHOOK_TOLERANCE_SECONDS`), secret prÃ©cÃ©dent refusÃ© au-delÃ  de son Ã©chÃ©ance (A23,

   valeur rendue par le port). Si l'adaptateur de WP07 ne rend pas l'horodatage signÃ©, demande-le

   plutÃ´t que de le relire toi-mÃªme hors de la signature. `now` : horloge de Node, seule tolÃ©rance

   de ce lot (Â±300 s est une marge de sÃ©curitÃ©, pas une comparaison avec la base ; les tests ne

   s'appuient jamais sur l'horloge Docker).

4. Motifs de refus (liste fermÃ©e `WebhookRejectionReason`) : `BODY_TOO_LARGE`, `UNKNOWN_CONFIG`,

   `CONFIG_NOT_ACTIVE`, `PROVIDER_MISMATCH`, `SECRET_UNAVAILABLE`, `SIGNATURE_MISSING`,

   `SIGNATURE_MALFORMED`, `SIGNATURE_INVALID`, `TIMESTAMP_OUT_OF_TOLERANCE`, `BODY_MALFORMED`.

   RÃ©ponses : `404 NOT_FOUND` neutre pour les quatre premiers et `SECRET_UNAVAILABLE` ; `401

   WEBHOOK_SIGNATURE_INVALID` pour les signatures ; `401 WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE` ; `400`

   pour un corps signÃ© mais illisible. Codes de problÃ¨me : ceux de WP01 ; vÃ©rifie leur existence.

5. `webhook-rejections.ts` : `WebhookRejections.record(reason, ctx)` fait deux choses sans jamais

   lever : (a) `record_webhook_rejection(config|NULL, reason)` dans sa propre transaction (compteur

   par minute, sans corps ; configuration inconnue : `NULL`) ; (b) journal de sÃ©curitÃ© structurÃ©

   `psp.webhook.rejected` (Logger de Nest, JSON : motif, fournisseur, `psp_config_id` tel que reÃ§u,

   taille, SHA-256 du corps, adresse `req.ip`) et alerte d'exploitation bornÃ©e : Ã  la premiÃ¨re

   occurrence du couple (motif, configuration) dans la minute et au seuil de 100 par minute, **au

   plus une alerte par minute et par motif** (limiteur en mÃ©moire du processus ; le compteur durable

   fait foi pour l'agrÃ©gat). Si l'enregistrement du compteur Ã©choue, le refus est quand mÃªme rendu

   (un compteur en panne ne doit pas ouvrir la route) et l'Ã©chec est journalisÃ©.

6. Aucune Ã©criture dans `psp_event`, `journal_transaction`, `posting`, `psp_topup`, `anomaly` pour

   un refus.



Validation :

- [ ] Les six Ã©tapes de l'arbitrage s'exÃ©cutent dans cet ordre (test qui espionne le port de secrets

      : jamais appelÃ© pour une configuration inconnue ou suspendue).

- [ ] `404` neutres indiscernables (corps et en-tÃªtes identiques, hors `X-Request-Id`).

- [ ] Aucune valeur secrÃ¨te, signature reÃ§ue ou corps dans les journaux (canari, WP14 le

      gÃ©nÃ©ralise).



### T061 â€” Conservation puis traitement (`RECEIVED`, `UNMATCHED`, `RETRY`)



But : `webhook-intake.service.ts`, deux transactions, et une couture pour les contestations.



1. **Transaction 1** (`TenantTx.run(operatorId)`, prestataire tirÃ© de `psp_webhook_context`) :

   `record_psp_event(config, id de notification du PSP, corps brut, type normalisÃ©, ...)`. Doublon

   (mÃªme `(config, id)`) : `200 {received: true, duplicate: true}`, **aucun traitement** (le

   travailleur reprend ce qui est restÃ© `RECEIVED`/`RETRY`). Nouveau : Ã©vÃ©nement `RECEIVED`

   conservÃ©.

2. **Transaction 2** (mÃªme requÃªte, aprÃ¨s le commit de la 1) : `EventDispatcher.dispatch(client,

   event, notification)` (`event-dispatcher.ts`) :

   - `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `PAYMENT_CANCELLED` â†’ le processeur de paiement de WP11

     (verrou `FOR UPDATE` de la recharge pris par lui, A13) ; corrÃ©lation par rÃ©fÃ©rence marchande

     `psp_topup_id` d'abord, puis rÃ©fÃ©rence du PSP (A2) ;

   - `DISPUTE` â†’ couture `PSP_DISPUTE_HANDLER` (point suivant) ;

- toute issue est traduite : `PROCESSED` (avec `outcome`), `UNMATCHED` (recharge introuvable :

  l'Ã©vÃ©nement est repris pendant 24 h par `PspEventRetryWorker`, puis `PSP_MISMATCH` â€” jamais

  d'office, A2), `RETRY` (erreur inattendue ; `attempts` +1). Un refus **dÃ©finitif** du moteur

  (`PERIOD_CLOSED`, `DEBIT_AUTHORITY_EDGE`, portefeuille bloquÃ© ou fermÃ©, compte inactif, frais â‰¥

  montant, `CL002`) est dÃ©jÃ  traduit par WP11 en `FAILED` + `PSP_TOPUP_NOT_CREDITED` ; ici il ne

  doit **jamais** devenir `RETRY` ni `500`. Si le processeur laisse remonter une erreur

  dÃ©terministe, c'est un dÃ©faut de WP11 : ne le masque pas, signale-le.

3. Toute exception de la transaction 2 est attrapÃ©e : la transaction est annulÃ©e, puis une

   **troisiÃ¨me** transaction courte marque l'Ã©vÃ©nement `RETRY` (`attempts` +1, motif sans donnÃ©e

   sensible). La rÃ©ponse reste `200`.

4. Couture : `export const PSP_DISPUTE_HANDLER = Symbol('PSP_DISPUTE_HANDLER')` et l'interface

   `DisputeHandler { handle(client, event, notification): Promise<DispatchOutcome> }`. Fournisseur

   facultatif (`@Optional()`). **Sans gestionnaire** (Ã©tat de ce lot avant WP13), un `DISPUTE` est

   conservÃ©, reste `RECEIVED`, n'est pas comptÃ© comme essai et n'alerte pas ; le test le prouve.

   WP13 branche le sien.

5. SuccÃ¨s dÃ©couvert par interrogation et notification : mÃªme chemin de traitement, mÃªme clÃ©

   d'Ã©criture (c'est WP11 qui la porte) ; ce lot ne reconstruit aucune clÃ©.

6. RÃ©ponse : `200 {received: true, duplicate: boolean}`. Latence : aucune requÃªte par champ, une

   lecture de contexte, une Ã©criture d'Ã©vÃ©nement ; NFR-006 est mesurÃ©e par WP14 (p95 â‰¤ 500 ms).



Cas limites : deux notifications d'identifiants diffÃ©rents pour le mÃªme paiement en concurrence (le

verrou de WP11 sÃ©rialise, une seule Ã©crit) ; notification d'une configuration `SUSPENDED` (refusÃ©e

en T060) alors que la recharge `PENDING` correspondante est suivie par le travailleur (T062) ; corps

signÃ© dont le type est inconnu du fournisseur : conservÃ©, `NO_EFFECT`, signalÃ©.



Validation :

- [ ] Rejeu : `duplicate: true`, une seule ligne `psp_event`, aucun second traitement.

- [ ] `UNMATCHED` puis recharge crÃ©Ã©e puis reprise par le travailleur : `SUCCEEDED`, un seul

      `TOPUP`.

- [ ] Erreur injectÃ©e dans le processeur : `200`, Ã©vÃ©nement `RETRY`, aucune Ã©criture au grand livre.



### T062 â€” Processus `psp-poller` : reprises, interrogation, expiration



But : `PspTopupPollerWorker`, `PspEventRetryWorker` (ProcessWorker de `processes/worker.ts`), module

et point d'entrÃ©e.



1. `main.psp-poller.ts` : copie de `main.tag-check.ts` avec `PspPollerProcessModule` ;

   `processes/psp-poller.module.ts` : `ProcessBaseModule`, `AuditModule`, module de pool applicatif

   local (voir l'arbitrage : `APP_CONFIG`, `PG_POOL` sur `config.databaseUrl`, `TenantTx`, fermeture

   du pool), modules de WP07 (registre des adaptateurs et coffre) et le module de traitement de

   WP11, puis `PspPollerModule` (travailleurs).

2. `PspTopupPollerWorker.name = 'psp-poller'`. `runOnce()` : `psp_poll_candidates(limite)` (lecture

   neutre, sans prestataire) rend les recharges `PENDING` de plus de 2 minutes ; pour chacune,

   **hors transaction** : `adapter.getStatus(rÃ©fÃ©rence)` (la recharge dont l'`initiate` a Ã©chouÃ© n'a

   pas de rÃ©fÃ©rence : interroge par rÃ©fÃ©rence marchande) ; puis `TenantTx.run(operatorId)` : le

   processeur de WP11 prend `FOR UPDATE` la recharge, relit son Ã©tat et applique (R-12). SuccÃ¨s :

   traitement R-11, clÃ© d'Ã©criture identique Ã  la notification. Ã‰chec confirmÃ© : `FAILED`. Ã‰chÃ©ance

   dÃ©passÃ©e (`expires_at` ; 15 minutes pour les faux) et statut non payÃ© : `expire_psp_topups` â†’

   `EXPIRED`, **aprÃ¨s** relecture du statut ; payÃ© entre-temps : traitÃ© comme un succÃ¨s. Rend le

   nombre de recharges tranchÃ©es ; une recharge dont l'adaptateur ne rÃ©pond pas n'est pas comptÃ©e

   (le drain s'arrÃªte, comme `daily-check`).

3. Une configuration `SUSPENDED` ne bloque pas l'interrogation de ses recharges `PENDING` (A15) : ne

   filtre pas sur le statut de la configuration ; le fournisseur doit rester joignable.

4. `PspEventRetryWorker.name = 'psp-event-retry'` : reprend les Ã©vÃ©nements `RECEIVED` de plus d'une

   minute, `RETRY`, et `UNMATCHED` de moins de 24 h par le mÃªme `EventDispatcher` (mÃªme code que la

   rÃ©ception, pas de copie) ; `UNMATCHED` de plus de 24 h â†’ `PSP_MISMATCH` (via WP11) ; `RETRY` Ã 

   plus de 5 essais : plus repris automatiquement, `alarm()` = 3. Les dispositifs de reprise sont

   idempotents (mÃªmes clÃ©s).

5. `describe()` : une ligne par recharge Ã  interroger et par Ã©vÃ©nement Ã  reprendre, sans donnÃ©e

   sensible (`--list`). `--once` : `runWorkers` rend `workers.alarm()`.

6. En production avec fournisseur Â« indisponible Â» : `runOnce` rend 0, aucune erreur.



Validation :

- [ ] SuccÃ¨s dÃ©couvert par interrogation = une seule Ã©criture, mÃªme clÃ© que la notification du mÃªme

      paiement.

- [ ] Aucune requÃªte vers l'adaptateur pendant qu'une transaction tient un verrou (test : l'espion

      de l'adaptateur vÃ©rifie qu'il n'est pas appelÃ© dans le callback de `TenantTx.run`).

- [ ] `--once` rend 0 sans travail ; `--list` n'Ã©crit rien.



### T063 â€” Purge des corps, alertes et codes de sortie



1. `PspEventPurgeWorker.name = 'psp-event-purge'` : purge le corps (octets) des Ã©vÃ©nements de plus

   de 400 jours, mÃ©tadonnÃ©es gardÃ©es (A24), par la fonction de la base (voir Context : si elle

   n'existe pas, arrÃªt et signalement). Passage au plus toutes les heures (modÃ¨le

   `DevicePurgeWorker`, `PSP_PURGE_INTERVAL_SECONDS`, entier 60 Ã  86 400, 3 600 par dÃ©faut ; valeur

   invalide : le dÃ©marrage Ã©choue avec un message qui nomme la variable).

2. Alertes : constantes `ALARM_POLL_FAILURE = 2`, `ALARM_EVENT_RETRY_EXHAUSTED = 3`,

   `ALARM_PURGE_FAILED = 4`. `alarm()` de chaque travailleur rend son code ; une erreur d'un passage

   ne s'avale jamais en silence : elle est journalisÃ©e (sans secret) et fixe le code.

3. Le journal d'alerte de la rÃ©ception (T060) et celui des travailleurs partagent un mÃªme format

   (`event`, `severity`, `reason`, champs non sensibles) pour qu'un seul filtre d'exploitation les

   attrape.

4. Lecture d'un corps brut : fonction auditÃ©e de la base pour l'`OPERATOR_ADMIN`, **sans route**

   dans ce lot (aucune opÃ©ration au contrat). Ne crÃ©e pas de route ; signale le besoin.



Validation :

- [ ] Un corps de 401 jours est vidÃ©, un de 399 jours intact ; la ligne et ses mÃ©tadonnÃ©es restent.

- [ ] Code de sortie non nul (2) quand l'adaptateur Ã©choue ; 0 sinon ; 3 pour un Ã©vÃ©nement Ã  6

      essais.



### T064 â€” Tests (notifications refusÃ©es, rejeux, reprises, travailleur)



Suites Jest d'intÃ©gration (vraie base `cashless_wp12`, serveur HTTPS de test, faux PSP signeur de

WP07, fixtures de WP11 rÃ©utilisÃ©es sans copie) :

- `webhooks/receive.spec.ts` : succÃ¨s Wave puis Orange Money puis carte (`200`, `TOPUP`, recharge

  `SUCCEEDED`) ; doublon (`duplicate: true`) ; deux identifiants pour un mÃªme paiement ; nouvelle

  notification aprÃ¨s `SUCCEEDED` (sans effet) ; configuration `SUSPENDED` (refusÃ©e, recharge

  `PENDING` encore suivie).

- `webhooks/rejections.spec.ts` : **NFR-002** â€” 100 notifications refusÃ©es (mÃ©lange : signature

  fausse, horodatage Ã  +301 s et âˆ’301 s, configuration inconnue, inactive, autre fournisseur, corps

  de 70 Kio) : 0 ligne `psp_event`, 0 transaction, 0 anomalie, compteur durable agrÃ©gÃ©, un journal

  par refus, alerte bornÃ©e (au plus une par minute et par motif : 100 refus du mÃªme motif â†’ une

  alerte, test avec horloge de Node simulÃ©e, jamais celle de la base).

- `webhooks/verifier.spec.ts` : signature avec le secret courant, avec le prÃ©cÃ©dent dans sa fenÃªtre,

  avec le prÃ©cÃ©dent hors fenÃªtre (refus), longueur de signature fausse, en-tÃªte mal formÃ© ; test de

  temps constant par construction (les deux secrets sont comparÃ©s mÃªme si le premier correspond :

  espion sur `timingSafeEqual` appelÃ© deux fois).

- `webhooks/retry.spec.ts` : `UNMATCHED` repris ; `UNMATCHED` de 25 h â†’ `PSP_MISMATCH` ; erreur

  injectÃ©e â†’ `RETRY` puis succÃ¨s Ã  la reprise ; 6e essai â†’ alarme 3 ; `DISPUTE` sans gestionnaire

  conservÃ© sans essai.

- `topups/poller-status.spec.ts`, `poller-expiry.spec.ts`, `poller-alarm.spec.ts`,

  `poller-purge.spec.ts` selon T062 et T063 ; production : fournisseur indisponible â†’ travailleur

  inactif, notifications `404`. Mutations que tes tests doivent tuer : horodatage non vÃ©rifiÃ© ; un

  seul secret Ã©valuÃ© ; refus qui Ã©crit un Ã©vÃ©nement ; `500` sur erreur du traitement ; interrogation

  sous verrou.



## Test Strategy



Pgtap n'est pas touchÃ© par ce lot. Jest ciblÃ© sur ta base propre : `npm run reset-db -w

@cashless/ledger-sql` (base `cashless_wp12`, variables d'environnement du worktree), puis `cd

apps/api && npx jest --runInBand webhooks topups/poller` et `npm run lint && npm run typecheck`.

`cashless_test` est rÃ©servÃ©e Ã  l'orchestrateur, qui rejoue en sÃ©rie. Aucune comparaison entre

l'horloge de Node et celle de la base (Docker, qui peut reculer) ; la tolÃ©rance de Â±300 s se teste

avec des horodatages construits Ã  partir de l'horloge de Node seule. Lignes de 100 caractÃ¨res.



## Definition of Done



- [ ] Sous-tÃ¢ches T060 Ã  T064 faites ; `spec-kitty agent tasks mark-status Txxx --status done

      --mission recharges-caisses-psp-01M5YEBA` pour chacune.

- [ ] Lint, types, Jest ciblÃ© verts ; aucune suite existante cassÃ©e ; aucune nouvelle dÃ©pendance.

- [ ] Aucun secret, signature ou corps dans une rÃ©ponse ou un journal (revue de chaque

      `Logger`/`console`).

- [ ] Compte rendu du lot, en fin de ce fichier : Ã©carts au plan (avec leur sens), retouches hors

      carte justifiÃ©es, points soumis au porteur, **fichiers Ã  faire relire par une personne** (au

      moins `webhook-verifier.ts` et `webhooks.controller.ts` : cryptographie et route sans

      identitÃ©), critÃ¨res couverts (FR-014, FR-015, FR-019, NFR-002, NFR-006 partiel) avec

      **commande et rÃ©sultat** pour la matrice d'acceptation, lacunes de la base constatÃ©es.



## Risks



- Route publique sans identitÃ© : tout contrÃ´le oubliÃ© est un crÃ©dit non authentifiÃ©.

- Comparaison non constante ou sortie anticipÃ©e sur le premier secret.

- Corps lu (JSON analysÃ© par Nest) avant la signature : l'analyseur lit le corps, le contrÃ´leur ne

  doit jamais en tirer un champ avant la vÃ©rification.

- Ã‰vÃ©nement conservÃ© mais jamais retraitÃ© (travailleur absent) : couvert par l'alarme et `--list`.

- Boucle de `500` ou de reprises sur une erreur dÃ©terministe (A4).

- Compteur de refus non bornÃ© (dÃ©ni de service) ; alertes en rafale.

- Interrogation du PSP sous verrou de ligne (blocage de tout le portefeuille).

- Lacune de la base (fonctions de marquage, de reprise, de purge) : Ã  remonter, pas Ã  contourner.



## Reviewer Guidance



Tenter de casser : ordre des vÃ©rifications (une requÃªte sans signature atteint-elle le port des

secrets ou la base ?) ; `404` distinguables par le corps, le temps ou un en-tÃªte ; signature valide

avec un corps modifiÃ© d'un octet ; horodatage de la limite exacte (300 s) ; secret prÃ©cÃ©dent expirÃ©

encore acceptÃ© ; refus qui laisse une ligne en base ; rejeu concurrent (100 requÃªtes) qui Ã©crit deux

fois ; `200` perdu quand le traitement Ã©choue ; `DISPUTE` consommÃ© sans gestionnaire ; travailleur

qui appelle le PSP dans `TenantTx.run` ; code de sortie de `--once` ignorÃ© ; purge qui vide un corps

de moins de 400 jours ; test qui Â« prouve Â» le temps constant en mesurant du temps rÃ©el ; test qui

s'appuie sur l'horloge de la base. VÃ©rifier que chaque mutation listÃ©e en T064 est rÃ©ellement tuÃ©e.

