# Fiche commune — implémentation et relecture des lots (mission 12b-1)

Dépôt : `/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform` (`<R>`). Mission :
`adaptateurs-fournisseurs-choisis-01M8BXJA` (`<M>` = `<R>/kitty-specs/<mission>`). Planification et fusion sur
`feat/adaptateurs-fournisseurs-choisis`. Ne relis pas CLAUDE.md, README ni la SPECIFICATION en entier : l'essentiel
est ici. **Toute commande `spec-kitty` se lance avec `LC_ALL=C LANG=C`**.

## Démarrer
1. `cd <R>` puis `LC_ALL=C LANG=C spec-kitty agent action implement WPxx --agent claude --mission
   adaptateurs-fournisseurs-choisis-01M8BXJA` (implémenteur) ou `… action review WPxx …` (relecteur). La commande
   affiche le prompt du lot : c'est la source du lot. Lis aussi `<M>/interfaces.md` (fait foi sur les noms).
   **Prends le lot (claim) avant ton premier commit** : un commit fait avant n'est pas attribuable (leçon de la 11b).
2. Travaille **uniquement** dans le worktree de la lane (`<R>/.worktrees/adaptateurs-fournisseurs-choisis-01M8BXJA-lane-x`) :
   `cd <lane> || exit 1` avant toute commande. Écrire dans le checkout principal est une faute grave.
3. Si ta lane dépend d'autres lanes : `bash <R>/docs/passation-12b-1/scripts/merge-deps.sh <lettre>` d'abord.
4. Si `node_modules/@cashless/{api,contracts,ledger-sql,shared-rules}` manque dans la lane : `mkdir -p
   node_modules/@cashless` puis liens `ln -s ../../apps/api` et `../../packages/{shared-rules,contracts,ledger-sql}`.
   Les dépendances nouvelles (WP01) s'installent dans le checkout principal par l'orchestrateur après la fusion de
   WP01 ; une lane qui en a besoin le signale si elles manquent.

## Ce que fait la mission
Adaptateurs réels, conformes aux documentations publiques, des fournisseurs déjà choisis : Wave, PayDunya, Stripe
(`PspAdapter`), AWS Secrets Manager (`PspSecretStore`), AWS KMS (5 ports), S3 Object Lock (`SealExternalCopy`). Port PSP
révisé : verdict `NOTIFICATION` ou `SIGNAL` ; un crédit après un signal ou une notification « à relire » ne vient que
d'un `getStatus` authentifié. Garde : un service réel ne tourne en production que s'il figure dans
`PRODUCTION_ENABLED_SERVICES` (vide). Commande d'essai par service. **Aucun appel réseau en test.**

## Règles du projet (résumé obligatoire)
- **Sécurité (règle 1)** : tout écart qui affaiblit la sécurité (droit plus large, contrôle retiré ou reporté, secret
  plus exposé, faux gardé) est soumis au porteur **avant d'être codé** : décris-le dans ton compte rendu (risque,
  options), ne le code pas, continue le reste. Un renforcement se fait puis se signale.
- **Décisions du porteur (26/11/2026)** : D1 Orange Money hors périmètre (n'y touche pas) ; D2 notification PayDunya =
  signal, crédit après `checkout-invoice/confirm/{token}` ; D3/D6 refus en production jusqu'à l'essai réel, liste dans
  le code ; D4 Stripe inclus ; D5 aucun remboursement au payeur ; D7 carte PayDunya sans preuve 3-D Secure : non
  créditée ; D8 rétention 10 ans ; D9 ajout rétrocompatible à `receivePspWebhook` (WP04 seul).
- **Sources** : tests exécutables > schéma SQL, `openapi.yaml` > SPECIFICATION > PRD. Dans la mission, `interfaces.md`
  fait foi ; pour un fournisseur, `research.md` (pages lues le 26/11/2026). Ce que la documentation ne dit pas est
  « à confirmer à l'essai » : isole-le dans une constante commentée, ne l'invente pas.
- **Aucune migration**, aucun `.sql` généré modifié, aucun `GRANT`. **Dépendances** : seulement celles de WP01
  (`axios` 1.21.1, `@aws-sdk/client-{kms,secrets-manager,s3}` 3.1172.0).
- **Aucun secret** (clé, jeton, secret de notification, corps complet, référence de secret) dans un journal, un message
  d'erreur, une note de lane ou un compte rendu ; tout secret reste dans `Secret` jusqu'à l'appel.
- **Tests sans réseau** : faux serveurs locaux (`test/support/fake-servers/`), jamais un hôte externe ; les vecteurs
  de signature viennent des exemples publiés quand la documentation en donne.
- Fichiers : seulement les `owned_files` du lot (+ retouches de compilation nommées dans la note de lane). Lignes de
  100 caractères au plus.
- **Chaque contrôle ajouté a une mutation vérifiée** : retire-le, constate l'échec du test, remets-le ; note la mutation.

## Base de données (Docker, partagée)
- Serveur : `PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres`. **`cashless_test` est réservée à l'orchestrateur.** Chaque
  lot utilise `cashless_wpXX`. Avant tout test : `docker ps` montre `cashless-platform-pg17`, sinon arrête-toi.
- Remise à zéro depuis la lane : `PGDATABASE=cashless_wpXX bash packages/ledger-sql/scripts/reset-db.sh`.
- Jest, depuis `apps/api` de la lane, **dans le même appel Bash** : `export PGDATABASE=cashless_wpXX; source
  ../../tools/dev-db/env.sh; env | grep DATABASE_URL` (**toutes** les URL doivent viser ta base : `test/support/db.ts`
  lit `DATABASE_URL_*`, pas `PGDATABASE`) puis `SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit`.
- Jamais de batterie complète, jamais en tâche de fond. **API partagée du porteur (ngrok, `exports/cashless-api`) :
  n'y touche jamais.** Aucun `pkill`.
- Instabilités connues : `claim-code-order.spec.ts`, `auth-keys.spec.ts`, `transverse/migrate-lock.spec.ts`,
  `tests_offline_snapshot_source_no_stats.sql`.

## Fin d'implémentation
1. `npx eslint <tes fichiers>`, `npx prettier --check <tes fichiers>` et `npx tsc --noEmit -p apps/api/tsconfig.json`.
2. Dans la lane : `git add <tes fichiers>`, `git commit -m "feat(WPxx): …"` (terminer par `Co-Authored-By: Claude
   Sonnet 5.5 <noreply@anthropic.com>`). Jamais de push.
3. `LC_ALL=C LANG=C spec-kitty agent tasks mark-status <Txxx…> --status done --mission
   adaptateurs-fournisseurs-choisis-01M8BXJA`.
4. `bash <R>/docs/passation-12b-1/scripts/align-lane.sh <lettre>` avant `move-task`. Garde `kitty-specs` bloquant :
   **pas de `--force`**, signale-le.
5. `LC_ALL=C LANG=C spec-kitty agent tasks move-task WPxx --to for_review --mission
   adaptateurs-fournisseurs-choisis-01M8BXJA --note "…"` : retouches hors carte, écarts, mutations.
6. Compte rendu final (≤ 25 lignes) : commits, fichiers, retouches hors carte, écarts (renforce ou affaiblit), points
   soumis au porteur, points « à confirmer à l'essai », fichiers à faire relire par une personne, preuves.

## Relecture (agent distinct de l'implémenteur)
- Compare chaque appel à `research.md` et au contrat du lot : chemin, méthode, en-têtes, forme du corps, statuts. Un
  écart à la documentation est bloquant.
- Tente de casser : notification forgée, rejouée, hors délai, signature du mauvais schéma (point ou non), entrée
  inconnue, secret précédent échu, crédit sur un signal, secret dans un journal, appel réseau réel en test, nouvel
  essai d'une création non idempotente, isolement des détenteurs de fonds dans le coffre.
- **Gardes transverses à relancer** : `test/unit/architecture.spec.ts`, `test/unit/production-guard.spec.ts`,
  `test/unit/psp`, `test/integration/webhooks`, `test/integration/topups`.
- Verdict : `… move-task WPxx --to approved --note "…"` ou `--to planned --review-feedback-file <fichier>`. Pas de
  `--force`. Compte rendu final (≤ 20 lignes).

## Consignes issues de l'analyse et des relectures
(Complété par l'orchestrateur au fil de la mission.)
- **Analyse (26/11/2026, verdict `ready` après corrections `426cdf0c`)** :
  - **WP08 (L4)** : un secret PayDunya dont `notification` diffère de `credentials.master_key` est refusé
    (`REF_INVALID`), avec un test et sa mutation.
  - **WP01 (L3)** : une suite existante qui appelle le réseau n'est jamais affaiblie ; nomme-la dans ta note de lane,
    l'orchestrateur décide.
  - **WP03 (L5)** : le cas « JSON envoyé à `/webhooks/paydunya` » de T015 passe par le faux du registre de test ; la
    preuve réelle est en WP06 et WP10.
  - **Règle de production (I1, fait foi)** : en production, réglage absent = `real` ; `fake` posé → refus ; `real` hors
    liste : PSP et coffre indisponibles (démarrage permis), KMS et copie des scellements refusent de démarrer.
- **WP13 (relecture de WP12, approuvé le 26/11/2026)** : consigner (OP + ADR + report PROMPTS/PRD, règle 3) l'écart
  **déjà présent** d'App Attest : `apple_validation_category_01` et `apple_bundle_version_01` de `authData.extensions`
  ne sont pas contrôlés (une attestation de catégorie invalide est acceptée aujourd'hui) ; décision du porteur
  attendue (proposition : contrôle en mission 12 avec un vecteur réel). Consigner aussi le point Android (certificats
  d'usine expirés sous la racine `f92009e853b6b045` : refus gardé, échec fermé) et, en mineur, l'aaguid de production
  admis en environnement `development`. Fichiers à faire relire par une personne : `android-key-attestation.ts`,
  `ios-app-attest.ts`, `ios-app-attest-assertion.ts`.
- **WP13 (WP04, 26/11/2026)** : écrire l'ADR de D9 (ajout rétrocompatible à `receivePspWebhook` : contenu en
  formulaire, description par fournisseur, description de `pspHmac`) avec la ligne « Décision du porteur : 26/11/2026 »
  lue par `check-baseline-decision.mjs` (aujourd'hui satisfait par ADR-169 seulement). Fichier à faire relire par une
  personne : `tools/contract-stability/contract-baseline.json`.
- **WP03 (livraison de WP02, `2947b882`)** : WP02 a retouché, pour la compilation, `webhook-verifier.ts` (refus
  provisoire `BODY_MALFORMED` de `SIGNAL` et de `confirmationRequired` : **à remplacer** par T011),
  `webhook-intake.service.ts`, `psp-topup-poller.worker.ts`, `topups/psp/psp-topups.service.ts`,
  `dev/psp-simulation.service.ts` (`provider` passé au coffre) et des tests de `test/integration/webhooks/`. Pars de ces
  versions (ta lane fusionne la lane b). Le faux coffre accepte `key` et encore `adapter` (ancien nom, utilisé par
  `test/integration/topups/psp-fixtures.ts`) : ne le retire pas sans adapter ces tests.
- **WP10 (livraison de WP01, `c6544602`)** : `loadConfig` n'exige `SEAL_COPY_BUCKET` que si `SEAL_COPY=real` est posé ;
  en production (mode absent = `real`), c'est `createSealCopy` qui refuse de démarrer sans compartiment, et seulement
  dans les processus qui construisent la copie (scellement). Tester les deux cas. `PspHttpClient` accepte un 2e
  paramètre facultatif `sleep` (tests).
- **WP13 (relecture de WP01, approuvé le 26/11/2026)** : consigner (OP, limite des tests) que la garde réseau
  `test/support/no-external-network.ts` se contourne par `http.request({ host: 'localhost', lookup: <personnalisé> })`
  (rien dans la mission ne l'utilise) ; durcissement proposé : refuser `options.lookup` ou contrôler l'adresse résolue.
  Fichiers à faire relire par une personne : `no-external-network.ts`, `package-lock.json`.
- **Tous les lots (orchestrateur)** : les dépendances de WP01 sont installées dans le checkout principal
  (`node_modules`, sans changement de fichier suivi) ; une lane qui fusionne la lane a les résout donc.

## Décisions du porteur (26/11/2026, après les premières relectures)
- **Android** : exception limitée à la racine `f92009e853b6b045` pour les certificats d'usine expirés (assouplissement
  décidé ; WP12 cycle 2 ; test de borne). **WP13** : OP + ADR + report PROMPTS/PRD.
- **Apple** : contrôle de `apple_validation_category_01` / `apple_bundle_version_01` en **mission 12** avec un vecteur
  réel ; d'ici là écart ouvert. **WP13** : OP + ADR + report dans la section Mission 12 de PROMPTS et dans PRD.
- **Stripe 3-D Secure** : `attempt_acknowledged` → `NOT_PERFORMED` (non crédité) ; seul `authenticated` vaut réussi
  (WP07 cycle 2). **WP13** : ADR (lecture stricte de l'ADR-77).
- **Litige Stripe** : rattaché à la recharge par relecture (WP07 cycle 2 : `resolvePaymentReference?` facultatif au port ;
  puis **WP03 cycle suivant** : la réception conserve le litige « à relire », le confirmateur résout la référence par
  l'adaptateur puis passe le litige normalisé (référence marchande remplie) au répartiteur existant ; sans résolution :
  anomalie sans correspondance, comme aujourd'hui).
- **Stripe, session `open` après un refus** : reste `PENDING` (le payeur peut réessayer) ; l'orchestrateur corrige le
  tableau de `contracts/psp-fournisseurs.md`.
- **WP03 cycle 2 (après l'approbation de WP07 cycle 2)** : brancher le litige Stripe (ci-dessus) ; et, issus de la
  relecture de WP03 (approuvé le 26/11/2026) : relecture déclenchée aussi sur `close` de la réponse (connexion coupée
  avant `finish`), avec un test ; borne par minute posée seulement après une relecture aboutie (`APPLIED`/`PENDING`), pas
  après `FAILED` ; fichier à faire relire par une personne : `psp-status-confirmer.ts`.
- **WP13 (relecture de WP12 cycle 2, approuvé le 26/11/2026)** : dans l'OP/ADR de l'exception Android, noter que
  l'exception exclut les chaînes RKP (OID 1.3.6.1.4.1.11129.2.1.30), plus strict que la décision, mais sans test
  (mutation survivante) : test à ajouter en mission 12 (report PROMPTS/PRD). Le certificat racine lui-même est aussi
  exempté de sa date de fin (dans la racine exemptée).
- **Orchestrateur** : `test/integration/webhooks/receive.spec.ts` a échoué une fois (3 tests, « request entity too
  large ») sur la lane l, vert en relance isolée ; à surveiller sur la lane c (WP03) et à la fusion.
- **Décision du porteur (26/11/2026, WP03 cycle 3)** : un litige Stripe non rattaché par relecture garde la voie
  « sans correspondance » (`UNMATCHED`, nouvelles tentatives, anomalie `UNMATCHED_EXPIRED` à 24 h), comme les autres
  litiges ; le cycle 2 (journal seul) retirait ce contrôle et a été refusé. **WP13** : à mentionner dans l'ADR du
  litige Stripe. `event-dispatcher.ts` modifié hors carte par WP03 (à surveiller à la fusion).
- **WP13 (relecture de WP03 cycles 2-3, approuvé le 26/11/2026)** : consigner (OP, limites des tests) : aucun test ne
  prouve l'absence de transaction ouverte pendant `resolvePaymentReference` (vérifié par lecture) ; cas limite où la
  borne d'une résolution par minute coïncide avec la reprise des 24 h (litige rattachable devenu anomalie : échec
  sûr, à traiter à la main) ; mutation survivante sur le contrôle « déjà vu » de `expireUnmatchedDispute` (code
  antérieur). Fichiers à faire relire par une personne : `psp-status-confirmer.ts`, `event-dispatcher.ts`.
- **WP13 (relecture de WP10 cycle 2, approuvé le 26/11/2026)** : `PRODUCTION_ENABLED_SERVICES` vide (D3/D6) ; marques
  §6 ajoutées hors carte sur `S3SealCopy`, `PayDunyaPspAdapter`, `AwsKms` ; test d'architecture des sites de
  construction (preuve d'injection sur `S3SealCopy` seul). Fichiers à faire relire par une personne :
  `kms/production-guard.ts`, `external-services/production-enabled.ts`, `kms/kms.module.ts`,
  `sealing/sealing.module.ts`, `psp/psp.providers.ts`, `s3-seal-copy.ts`, `aws-kms.ts`, `paydunya-adapter.ts`.
