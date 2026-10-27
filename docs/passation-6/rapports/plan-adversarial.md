# Passe contradictoire du plan — mission 6 `recharges-caisses-psp-01M5YEBA`

Lecture seule. Réf. : `K/` = `kitty-specs/recharges-caisses-psp-01M5YEBA/`. `[SÉCU-ÉLARGIT]` = le plan affaiblit ou prétend un contrôle qu'il n'apporte pas (règle 1 de CLAUDE.md : à soumettre au porteur avant codage).
Vérifications faites dans le code : `schema_grand_livre_cashless.sql` (post_transaction l.515-610, take_deposit l.1596, anomaly l.842), `roles.sql` (l.13-45), `scenario_reference_test.sql`, `tests_grand_livre_cashless.sql`, `openapi.yaml` (receivePspWebhook l.3006-3070), `db/tenant-tx.ts`, `processes/worker.ts`.

Bilan : 4 bloquants, 17 majeurs, 12 mineurs.

---

## BLOQUANTS

### A1 — La garde de caisse casse les suites de référence générées (rang 1 de §0.3), non signalé — bloquant
- Réf. : `K/research.md` R-02 « Conséquence », `K/data-model.md` `posting_cash_desk_guard`, `K/plan.md` IC-01 Risks (ne cite que « les tests de la mission 4 »).
- Constat : `scenario_reference_test.sql` (l.19 crée `A-CAISSE-C1`, purpose `CASH_DESK` ; l.57 `TOPUP_CASH`, l.58 `DEPOSIT_TAKEN`, l.77 `CASH_CLOSE`) et `tests_grand_livre_cashless.sql` (2 occurrences de `CASH_DESK`) écrivent sur une caisse sans aucune session. `test-pgtap.sh` les joue sur la base migrée (`reset-db.sh` applique les migrations). Le déclencheur `BEFORE INSERT ON posting` les fait échouer. Ces fichiers sont générés (C-002 : on ne les édite pas, on change `gen_tests.py` / `gen_golden.py` / `scenario_reference.json`), et les tests exécutables priment sur le plan (§0.3). NFR-010 (100 % des tests existants verts) est violée à la livraison de la migration 0036.
- Scénario : la CI pgTAP est rouge dès IC-01 ; l'implémenteur est tenté d'exempter les comptes de test ou d'éditer les `.sql` générés.
- Correction : choisir et consigner AVANT les tâches. Option propre : la garde ne vaut que pour les comptes enregistrés par `open_cash_session` (table `cash_desk(account_id, device_id)` ou colonne `account.cash_session_guard`), et les `CASH_DESK` créés autrement sont refusés à l'insertion (voir A6). Sinon, modifier les générateurs pour ouvrir une session dans le scénario, et le signaler comme modification d'une source de rang 1 (contradiction à lister au plan). Ajouter aux « Contradictions » du plan et au IC-01.

### A2 — Notification qui arrive avant l'enregistrement de `provider_payment_ref` : succès classé `PSP_MISMATCH`, doublon ensuite : argent perdu — bloquant
- Réf. : `K/contracts/psp.md` §7 (create → commit → `adapter.initiate` → `mark_psp_topup_initiated`), `K/research.md` R-11 étape 1, R-10 (`record_psp_event` avant traitement), `K/spec.md` Edge Cases « arrivée avant la fin de la transaction de création » (non traité par le plan), `openapi.yaml` l.3023 (`200` sur mismatch : le PSP ne réessaie pas).
- Scénario : Wave répond à `initiate`, le payeur paie en 2 s, la notification de succès atteint l'API avant que `mark_psp_topup_initiated` ait posé `provider_payment_ref` (ou l'API tombe entre `initiate` et `mark`). R-11.1 : recharge introuvable par `(configuration, référence)` → `PSP_MISMATCH`, `200`, et `psp_event (config, id)` est consommé : le rejeu du PSP répond `duplicate`. Le payeur a payé, rien n'est crédité, le seul vestige est une anomalie de type « écart ». La recharge reste `PENDING` sans référence, donc le poller (R-12, `getStatus(référence)`) ne la voit pas non plus, puis `EXPIRED`.
- Correction : (1) envoyer au PSP l'identifiant `psp_topup_id` comme référence marchande (`client_reference`, déjà dans l'exemple du contrat) et corréler dessus, pas seulement sur la référence du PSP ; (2) ne jamais consommer `psp_event` pour une notification dont la recharge n'est pas encore résolue : répondre `5xx`/`409` pour réessai, ou conserver l'événement `UNMATCHED` et le retraiter ; (3) le poller doit aussi traiter les `PENDING` sans référence (`getStatus` par référence marchande) ; (4) test de concurrence « notification avant `mark_psp_topup_initiated` ».

### A3 — Machine d'états : un succès après un état final n'est ni crédité ni signalé ; échecs carte non finaux ; course poller/expiration — bloquant
- Réf. : `K/data-model.md` psp_topup « aucune sortie d'un état final », psp_event `outcome IGNORED_STATUS`, `K/research.md` R-09/R-12, `K/contracts/psp.md` §9 (seul `CANCELLED` prévu).
- Scénarios (argent reçu, non crédité, SANS anomalie, donc sans remboursement possible) :
  a. `PAYMENT_FAILED` carte (Stripe émet un échec par tentative sur un même paiement) puis succès de la 2e tentative : la recharge est déjà `FAILED` (final) → `IGNORED_STATUS`.
  b. Le poller passe `EXPIRED` (échéance 15 min du faux ; Wave/Orange réels autorisent un paiement tardif) puis la notification de succès arrive : même issue. Pire, `expire_psp_topups` est ensembliste (liste de fonctions) et n'appelle pas `getStatus` juste avant : course entre `getStatus` (appel réseau, forcément hors verrou) et `expire`.
  c. `initiate` en timeout : le plan passe `FAILED` (final) alors que le PSP a peut-être créé le paiement.
  d. Recharge `CANCELLED` : seul ce cas a une anomalie (`motif CANCELLED`).
- Correction : tout succès authentifié sur une recharge `FAILED`/`EXPIRED`/`CANCELLED` doit soit être crédité si recevable (échéance dépassée mais grand livre `LIVE`/`CLOSING`, mêmes contrôles R-11), soit ouvrir `PSP_TOPUP_NOT_CREDITED` avec le montant à rendre. Les statuts « `FAILED` par notification d'échec carte » ne sont pas terminaux tant que le paiement n'est pas clos chez le PSP (ajouter un état intermédiaire ou ne pas finaliser sur `PAYMENT_FAILED` carte). `expire` : relire `getStatus` puis expirer sous verrou de ligne, ou garder `EXPIRED` réouvrable en `SUCCEEDED`. Supprimer `IGNORED_STATUS` sans anomalie. Ajouter le tableau complet « état × type de notification » au data-model.

### A4 — Notification « empoisonnée » : toute erreur déterministe du moteur donne `500` en boucle — bloquant
- Réf. : `K/contracts/psp.md` §11 (« erreur interne → tout annulé, `500`, le PSP réessaie ; la notification n'est pas conservée »), `K/research.md` R-11 (seuls plafonds, 3-D Secure, statut du grand livre sont traités).
- Constat : le contrat `openapi.yaml` (l.3041) dit « persistance de l'événement brut puis traitement asynchrone » ; le plan fait l'inverse (synchrone, rien conservé en cas d'échec), écart non signalé (voir A19). D'où : `CL005 PERIOD_CLOSED`, `CL006 DEBIT_AUTHORITY_EDGE`, portefeuille `BLOCKED`/`CLOSED` (après contestation), compte inactif, frais supérieurs au montant avec `psp_fee_bearer=CUSTOMER` (net ≤ 0), `CL002` (même clé, lignes différentes : le hash de `post_transaction` inclut les lignes, donc un changement de règle de frais entre deux livraisons du même paiement), bracelet remplacé… : chaque notification repart en `500`, indéfiniment, argent encaissé sans anomalie ni trace en base.
- Correction : classer les refus du moteur en « définitifs » (→ `PSP_TOPUP_NOT_CREDITED`, motif nommé, `200`) et « transitoires » (→ `5xx`). Après N essais, ou pour toute erreur inattendue, conserver l'événement authentifié en état `FAILED_TO_PROCESS` (le corps authentifié est déjà admis en base par R-10) et lever une alerte d'exploitation ; ne pas dépendre de la seule insistance du PSP.

---

## MAJEURS

### A5 — Garde de production : l'API entière refuse de démarrer, ce qui annule la levée d'OP-N49 en production — majeur
- Réf. : `K/plan.md` Summary (« pas de recharge en ligne en production avant… ») et IC-06, `K/research.md` R-08/R-17, `K/contracts/psp.md` §15 (« `assertProcessIsSafe` refuse le démarrage en production (processus public et travailleur) »), `apps/api/src/processes/bootstrap.ts` (`assertNoFakeInProduction`).
- Scénario : le registre des fournisseurs ne contient que des faux (`isFake`). Si le module PSP est importé par le processus public, `assertProcessIsSafe` fait refuser TOUT le processus public en production, y compris la caisse espèces et la caution (le but même d'OP-N49, « bloque la production : Oui »). SC-008 suppose le contraire (« les recharges en ligne ne sont pas servies »).
- Correction : en production, ne pas construire de faux : `PspModule` enregistre un fournisseur « indisponible » (réel, non faux) qui répond `503 PSP_UNAVAILABLE`, la route `/webhooks/...` répond `404`, le poller se désactive ; le test de borne vérifie que chaque faux est refusé ET que le processus démarre en production avec les seules routes espèces. Écrire les deux comportements dans OP-N81.

### A6 — « La création par la base empêche l'API de créer un compte `CASH_DESK` arbitraire » est faux — majeur [SÉCU-ÉLARGIT : contrôle annoncé, non apporté]
- Réf. : `K/research.md` R-01 Rationale ; `roles.sql` l.13-14 (`GRANT INSERT, UPDATE ON ALL TABLES` à `cashless_app`, `account` non retiré en INSERT ; seul `UPDATE` limité à `(is_active, hot)`, l.35-36).
- Scénario : toute route ou injection exécutée en `cashless_app` peut `INSERT INTO account (… purpose='CASH_DESK', code='A-CAISSE-x' …)`. Sans la garde de A1/A8 liée à un enregistrement fait par la fonction, ce compte est soit gardé par erreur (blocage), soit un compte d'espèces hors session (si la garde est liée à une table). Et `take_deposit(p_media, p_money_account)` / `refund_cash_due` acceptent n'importe quel compte (les contrôles de `refund_cash_due` sont purpose + ledger, l.1898).
- Correction : `REVOKE INSERT ON account` ne tient pas (autres comptes créés par l'API) ; ajouter un déclencheur `BEFORE INSERT ON account` refusant `purpose IN ('CASH_DESK','PSP')` hors fonctions SECURITY DEFINER (marque de contexte non forgeable, voir A7), plus un test pgTAP « `cashless_app` ne crée pas de `CASH_DESK` ni de `PSP` ». Corriger R-01 et la mention du IC-01.

### A7 — Exception de fermeture « marque de transaction » forgeable — majeur
- Réf. : `K/contracts/database-rights.md` « Garde de caisse » (« transaction de fermeture marquée par `begin_cash_close` dans la transaction »), `K/plan.md` IC-01 Risks (« marque de transaction, jamais un paramètre de l'API »). Le dépôt marque déjà par `set_config('app.*', …, true)` (schéma l.1448-1450, `tenant-tx.ts` l.38).
- Scénario : une marque GUC se pose par `SELECT set_config(...)` depuis n'importe quelle session SQL de `cashless_app` : la garde de caisse est contournable par injection SQL ou par un chemin d'API qui accepte un nom de paramètre.
- Correction : ne pas se fier à un GUC. État ligne : `cash_session.status = 'CLOSING'` posé par `begin_cash_close` (non modifiable hors fonction), la garde accepte l'écriture sur la caisse si sa session est `OPEN` ou `CLOSING` ET que `journal_transaction.type = 'CASH_CLOSE'` ET que la clé d'idempotence est `cash-close:<session>`. Test : un `set_config` forgé n'ouvre rien.

### A8 — La garde ne lie pas l'écriture au terminal de la caisse — majeur
- Réf. : `K/data-model.md` `cash_session_tx` / `posting_cash_desk_guard` (« session `OPEN` de ce compte »), `K/research.md` R-01 alternative écartée (« un compte mal rattaché permet de rendre des espèces sur la caisse d'un autre poste »).
- Constat : la garde accepte toute écriture sur un `CASH_DESK` dont la session est ouverte, quel que soit le terminal/l'agent qui l'écrit. `take_deposit` ne passe aucun `device` (`post_transaction(... now(), 'ONLINE' ...)`, l.1612) : un appel avec le compte d'une autre caisse ouverte passe la garde. Le lien terminal ↔ caisse reste uniquement dans `counter-access.ts`. La sentence « la base garantit » (R-02) est donc partielle.
- Correction : (1) la garde compare `journal_transaction.device_id` (quand présent) à `cash_session.device_id` ; (2) pour les fonctions sans `device_id` (`take_deposit`, `refund_*`), ajouter un paramètre ou une variante `…_for_session(p_media, p_session)` qui dérive le compte de la session, et retirer le compte du paramètre de l'API ; (3) test pgTAP « écriture sur la caisse d'un autre terminal ouverte → refus ».

### A9 — Résolution du tenant des webhooks et du poller : aucune fonction prévue — majeur
- Réf. : `K/contracts/database-rights.md` (liste des fonctions : aucune ne permet de lire une configuration par id sans tenant ni de lister les `PENDING` de tous les prestataires), `K/research.md` R-10/R-12, `db/tenant-tx.ts` (le tenant est le GUC `app.operator_id` posé par l'appelant ; RLS forcée l.902-904).
- Constat : la route publique reçoit `psp_config_id` sans identité ; `psp_configuration` est sous RLS par `operator_id` ; sans fonction SECURITY DEFINER, l'API ne peut ni retrouver l'`operator_id` de la configuration ni son statut/fournisseur (étape 1 du contrat) ; idem pour `PspTopupPoller`. Le modèle de `daily-check` (liste des prestataires) existe mais n'est pas cité.
- Correction : ajouter `psp_webhook_context(p_config uuid) → (operator_id, provider, status, secret_ref_holder)` (lecture seule, retour neutre), `psp_poll_candidates(limit)`, avec droits nommés, `search_path` fixé, test « n'expose rien d'autre que ces colonnes ». Les ajouter à la liste figée de `tests_execute_grants.sql`.

### A10 — `secret_ref` non lié au titulaire : lecture/usage des secrets d'un autre détenteur — majeur
- Réf. : `K/contracts/psp.md` §1 (« `secret_ref` de forme `psp/<holder>/<nom>` … contrôle de forme »), `K/data-model.md` psp_configuration, FR-022 / ADR-70 (« jamais partagés entre détenteurs »).
- Scénario : un `OPERATOR_ADMIN` (ou un script) crée pour l'organisateur B une configuration avec `holder_party_id = B` mais `secret_ref = psp/<A>/wave` ; la notification est authentifiée avec les secrets de A, et l'adaptateur initie les paiements sur le compte marchand de A (les fonds d'un événement de B arrivent chez A). Le contrôle de forme ne l'empêche pas. Rien dans le plan ne lie non plus `holder_party_id` à l'organisateur/prestataire.
- Correction : `CHECK (secret_ref LIKE 'psp/' || holder_party_id || '/%')` en base, vérifier que `holder_party_id` est une partie du prestataire et un détenteur de fonds possible de l'organisateur, et que `PspSecretStore.get(secret_ref, holder)` refuse tout `secret_ref` dont le segment ne correspond pas. Test d'isolation croisée dans le faux coffre.

### A11 — Carte : empreinte absente et chemin « interrogation » sans 3-D Secure ni empreinte — majeur [SÉCU-ÉLARGIT]
- Réf. : `K/research.md` R-09 (`getStatus(référence)` : type de retour non défini), R-11.3 et R-12 (« un succès découvert suit le même chemin »), FR-024/FR-025.
- Scénarios : (a) `getStatus` ne renvoie ni `three_ds` ni `card_fingerprint` ni montant/devise : le poller soit crédite une carte sans preuve 3-D Secure, soit ne peut pas appliquer R-11.3 ; (b) notification carte dont l'empreinte est nulle/absente : R-11.3 compare « une empreinte qui dépasserait » : une empreinte absente passe, le plafond par carte est contourné ; (c) `three_ds` absent plutôt que `NOT_PERFORMED` n'est pas traité.
- Correction : `getStatus` et `verifyNotification` retournent le MÊME type normalisé (montant, devise, `three_ds`, `card_fingerprint`, référence marchande) ; pour `CARD`, empreinte nulle ou `three_ds ≠ SUCCEEDED` (y compris absent) = non créditée (`PSP_TOPUP_NOT_CREDITED`, motif `THREE_DS` / `NO_FINGERPRINT`). Tests faux PSP : empreinte absente, `three_ds` absent, succès par interrogation avec/sans 3DS.

### A12 — Plafond par carte et par jour : course entre deux notifications de la même carte — majeur
- Réf. : `K/research.md` R-11.3 (lecture de `card_topups_today` puis écriture), `K/contracts/database-rights.md` `card_topups_today`.
- Scénario : deux recharges `PENDING` de la même carte (empreinte connue seulement à la notification) sont notifiées en parallèle ; chacune lit une somme du jour inférieure au plafond, les deux sont créditées : le plafond réglementaire par carte est dépassé. Le verrou de `wallet_topup_headroom` protège le portefeuille, pas la carte. Même chose pour `CARD_VELOCITY` (comptage d'empreintes).
- Correction : `pg_advisory_xact_lock(hash(ledger_id, card_fingerprint))` avant la lecture et pour la même transaction que l'écriture, dans une fonction unique `complete_card_topup`. Test de concurrence (2 notifications simultanées, plafond à 1,5 recharge). Définir aussi la borne du « jour » (UTC ou fuseau de l'événement) : le schéma compte les mois en UTC (l.1807).

### A13 — Rejeux concurrents de notifications distinctes pour le même paiement : verrou de ligne absent — majeur
- Réf. : `K/research.md` R-10/R-11, `K/data-model.md` psp_event, psp_topup ; NFR-001.
- Constat : l'unicité `(config, provider_event_id)` ne protège que les rejeux d'un même identifiant. Deux notifications d'ids différents du même paiement (succès + mise à jour), ou succès concurrent d'un poll et d'un webhook, lisent chacune la recharge `PENDING` ; la clé d'idempotence du moteur empêche le double `TOPUP`, mais l'une peut conclure `FAILED`/anomalie pendant que l'autre crédite (états `FAILED` + `topup_tx_id` non nul, ou anomalie « à rendre » alors que le portefeuille est crédité = double paiement au payeur).
- Correction : `SELECT … FROM psp_topup WHERE id = … FOR UPDATE` en première étape de R-11 (et dans le poller), puis machine d'états sous verrou ; contraintes `CHECK (status='SUCCEEDED') = (topup_tx_id IS NOT NULL)` et anomalie exclusive de `topup_tx_id` ; test « 100 rejeux concurrents, notifications d'ids différents, succès + échec mêlés » (NFR-001 ne couvre aujourd'hui que le même identifiant).

### A14 — Contestation : aucune précondition sur la recharge d'origine — majeur
- Réf. : `K/research.md` R-14 (« recharge retrouvée … ; `record_chargeback` ; montant ≤ montant de la recharge − contestations »), FR-027.
- Scénario : une contestation arrive pour une recharge `FAILED`/`EXPIRED`/non créditée (aucun `TOPUP` écrit) ou pour `WAVE`/`ORANGE_MONEY` : `CHARGEBACK` débite le portefeuille et crédite `A-PSP-*` pour un montant jamais crédité, et bloque le portefeuille d'un tiers ; `A-PSP-*` (négatif permis) ne le détectera pas. Aucune vérification de devise non plus.
- Correction : `record_chargeback` exige `psp_topup.status = 'SUCCEEDED'`, `topup_tx_id IS NOT NULL`, `method = 'CARD'` et la même devise, sinon `PSP_MISMATCH` sans écriture. Plafond : somme `CHARGEBACK` ≤ montant net crédité (pas la valeur brute si frais client). Test. Préciser aussi si un portefeuille `BLOCKED` peut encore être rechargé (A20).

### A15 — Configuration : statut, validité et suspension non revérifiés ; recharges en attente orphelines — majeur
- Réf. : `K/research.md` R-07 (« `resolve_psp_configuration` applique le même contrôle au défaut »), `K/contracts/psp.md` §6/§10, spec US6.3 (404 si inactive).
- Constat : (1) le choix explicite d'un événement est contrôlé à l'insertion seulement ; si la configuration est ensuite `SUSPENDED`, expirée (`valid_until`) ou si `ledger.funds_holder_id` change, la résolution à la recharge ne revérifie que le défaut ; `valid_from/valid_until` ne sont lues nulle part. (2) Suspendre une configuration (réponse à un secret divulgué) fait répondre `404` à toute notification : les recharges déjà payées et `PENDING` ne seront jamais créditées et n'ont pas d'anomalie. (3) Transitions `DRAFT/ACTIVE/SUSPENDED` non listées (réactivation ?), et `activate_psp_configuration` ne dit pas qu'il recheck que la demande approuvée porte l'identifiant ET la version vues par le valideur.
- Correction : une seule fonction `resolve_psp_configuration` revérifie TOUJOURS statut, validité, organisateur, titulaire, moyen, que le choix soit explicite ou par défaut. Définir la politique des notifications sur configuration suspendue (accepter + signaler pour les `PENDING` existants avec le secret, ou mettre en file `HELD`), table de transitions, liaison approbation ↔ version.

### A16 — Argent encaissé et non crédité : aucune trace comptable ; le contrôle « grand livre = relevé » sonnera — majeur
- Réf. : `K/plan.md` (OP-N82), `K/research.md` R-11 fin, `K/spec.md` Assumptions, SPECIFICATION §12.2 (« PSP : grand livre = relevé » quotidien), `K/contracts/psp.md` Écritures (rien pour le non-crédité).
- Constat : le PSP encaisse 10 000 ; le grand livre n'écrit rien (`A-PSP-*` à 0 contre un relevé à 10 000). Chaque cas non crédité fait diverger l'écart jusqu'à ce que quelqu'un l'enregistre hors plateforme (OP-N82), et le `PSP_SETTLEMENT` de la mission 9 (débit banque, crédit `A-PSP-*`) rendra `A-PSP-*` négatif à tort. La question Q7 de la fiche (quelle écriture représente cet argent détenu ?) est écartée sans réponse écrite.
- Correction : ou bien écrire à la notification `A-PSP-<moyen>` → compte d'attente `L-PSP-A-RENDRE` (analogue de `L-ESP-A-RENDRE`, exige moteur + builder) clos par la résolution à deux ; ou bien documenter explicitement dans OP-N82 que le contrôle « PSP » de la mission 9 doit exclure ces anomalies, et ajouter le type d'anomalie au calcul du rapprochement. Ne pas laisser ce choix à la mission 9 sans mention dans son report PROMPTS.

### A17 — La garde de caisse s'applique aussi aux synchronisations hors ligne/passerelle — majeur
- Réf. : `K/plan.md` IC-03 (découpage `OFFLINE_SYNC`/`EDGE_SYNC`), `K/research.md` R-02, SPECIFICATION §9.3, ADR-52.
- Scénario : une recharge espèces hors ligne (missions 7/8) est rejouée à la synchronisation, hors session (session fermée depuis, ou jamais ouverte côté terminal hors ligne) : `CL…` ou refus de la garde, donc batch refusé (`EDGE_REPLAY_FAILED`) et espèces réellement encaissées non écrites. FR-006 force pourtant à tester `OFFLINE_SYNC` dans cette mission, ce qui ouvre une contradiction dans les tests du moteur.
- Correction : décider maintenant : la garde vaut pour `source = ONLINE/BACKOFFICE` seulement, ou elle évalue la session à `occurred_at` ; consigner l'hypothèse comme contrainte pour les missions 7 et 8 (PROMPTS/PRD) et tester `OFFLINE_SYNC` dans `tests_cash_sessions.sql`. Sinon l'argent hors ligne devra traverser une exemption non prévue.

### A18 — Frais PSP : repli silencieux à zéro et convention d'ADR-82 retirée sans migration des règles — majeur
- Réf. : `K/research.md` R-13 (« Sans règle, frais nuls »), ADR-82 §3, `sql-config-resolver.ts` l.14-16/106-113.
- Constat : une configuration activée sans règle de frais crédite le brut au portefeuille alors que le PSP prélève des frais : `A-PSP-*` surestimé de façon permanente, jamais détecté avant la mission 9 ; les règles existantes `EVENT` + `PSP:<canal>` cessent d'être lues sans migration ni alerte.
- Correction : refuser l'activation (`PSP_CONFIGURATION`) sans règle de frais explicite (même à 0 %), ou signaler. Migrer/convertir les règles `PSP:<canal>` existantes ou prouver qu'il n'y en a pas (test).

### A19 — Contradictions réelles avec le contrat non signalées — majeur (C-001)
- Réf. : `K/plan.md` Charter Check (liste de contradictions), `openapi.yaml` l.3041 et closeCashSession.
- Écarts absents de la liste : (a) le contrat dit « traitement lourd asynchrone après persistance de l'événement brut » (réponse < 2 s) ; le plan traite en synchrone dans la même transaction et ne conserve rien en cas d'échec (cause d'A4) ; (b) clé d'écriture de `closeCashSession` : contrat `bo:<Idempotency-Key>`, plan `cash-close:<session>` (meilleure, mais écart) ; (c) la table `psp_event.signature_valid` de S14 devient constante (toujours vrai) ; (d) `psp_topup.status` non étendu mais `failure_reason` ajouté (listé) ; (e) `A-PSP` « Négatif permis : Non » en §5.2 est listé mais pas l'effet sur `hot_account_side_check` (Q15 de la fiche).
- Correction : ajouter (a)-(c), (e) à la liste du plan avec la règle §0.3 appliquée.

### A20 — Portefeuille bloqué : recharge toujours possible — majeur [SÉCU-ÉLARGIT possible]
- Réf. : `K/research.md` R-14 (blocage), `K/contracts/psp.md` §7 (aucun contrôle du statut portefeuille à l'initiation).
- Scénario : fraude à la carte volée : contestation → portefeuille bloqué ; le fraudeur recharge à nouveau le même bracelet avec une autre carte volée : le crédit est accepté (dépenses refusées mais l'argent de la 2e carte entre, nouvelle contestation, nouveau trou, `CARD_VELOCITY` seulement signalé).
- Correction : refus à `initiatePspTopup` et à la notification (non créditée + anomalie) pour un portefeuille `BLOCKED`/`CLOSED`, ou décision explicite consignée. Tester le cas.

### A21 — Fermeture de caisse pendant une recharge : verrouillage correct mais non prouvé ; piège de l'ordre des verrous — majeur
- Réf. : `K/plan.md` IC-01 Risks (« ordre des verrous session → caisse »), IC-11 (concurrence : seulement notifications et contestations), schéma l.600-603 (les soldes sont verrouillés `FOR UPDATE` AVANT l'insertion des `posting`).
- Constat : l'ordre actuel (topup : solde → déclencheur ; close : session → solde) est sans interblocage car le déclencheur ne verrouille pas la session. Si l'implémenteur ajoute `FOR SHARE` sur la session dans la garde pour « plus de sûreté », il crée un interblocage (topup tient le solde et attend la session, close tient la session et attend le solde).
- Correction : inscrire la règle « la garde lit sans verrou ; `begin_cash_close` verrouille le solde de la caisse avant d'écrire `CLOSING` » dans IC-01, et ajouter un test de concurrence pgTAP/Jest « fermeture pendant une recharge » (aucune écriture après `CLOSED`, théorique = solde, pas d'interblocage). Idem `refund_cash_due` / `take_deposit`.

---

## MINEURS

### A22 — Refus de notification : « signalement » seulement dans les journaux (FR-015/FR-031) — mineur [SÉCU-ÉLARGIT partiel]
- Réf. : `K/research.md` R-10, FR-031, SPEC §11.1 (« conservé et signalé »). La contradiction est signalée (bon point), mais la trace est un journal structuré plus une alerte à une par minute et par motif : pas d'audit durable, et une rafale masquée par la limite d'alerte. Correction : compteur agrégé durable (par configuration, motif, minute, sans corps) écrit en base, alerte distincte « première occurrence + seuil ».

### A23 — Rotation des secrets : l'ancien secret reste valable sans limite — mineur [SÉCU-ÉLARGIT]
- Réf. : `K/research.md` R-08/R-10. Rien ne date ni n'expire le second secret ; un secret fuité reste accepté tant qu'il est chargé. Correction : date d'expiration du secret précédent dans le port, refus au-delà, test.

### A24 — Corps brut des notifications : PII et durée de conservation — mineur
- Réf. : `K/data-model.md` psp_event.body. Il contient msisdn/empreinte ; aucune durée de conservation, aucune fonction de lecture (donc inutilisable pour l'exploitation et la mission 9). Correction : colonne de rétention, purge planifiée, fonction de lecture auditée pour `OPERATOR_ADMIN`.

### A25 — Pas de borne sur les recharges `PENDING` ni de limitation de débit à l'initiation — mineur
- Réf. : `K/contracts/psp.md` §7. Un festivalier/agent peut créer des milliers de recharges `PENDING` (appels PSP, lignes, poller). Correction : plafond de `PENDING` par portefeuille et par terminal, `Idempotency-Key` obligatoire, limitation de débit par route (pile : `@nestjs/throttler` « cible »).

### A26 — Comptage et fermeture : la règle « dernier comptage ≠ fermeur » se contourne — mineur
- Réf. : `K/research.md` R-03, `K/data-model.md` cash_session_count. Le fermeur peut compter lui-même une valeur quelconque puis laisser un comptage sans contrôle du « dernier » par un collègue qui le suit (ordre libre) ; aucun plafond du nombre de comptages ; aucun lien entre l'auteur du comptage et celui qui a ouvert. Correction : le fermeur ne doit avoir compté AUCUN comptage de la session (pas seulement le dernier) ; nombre de comptages borné et audité ; écart de comptages successifs consigné.

### A27 — « Aveugle » : d'autres lectures du solde de caisse exposent le théorique — mineur
- Réf. : `K/contracts/cash.md` règle 4/5, SC-005. Le théorique = solde du compte `A-CAISSE-<série>` ; toute route existante qui lit un solde de compte ou une balance (back-office, exports) le montre. Correction : inventaire des lectures (`account_balance`, balance d'essai) et masque pour `CASHIER` ; test d'isolation « aucune route accessible à `CASHIER` ne renvoie le solde du compte `CASH_DESK` ».

### A28 — NFR-007 contredit le cas « théorique et compté nuls » — mineur
- Réf. : `K/spec.md` NFR-007 (« 100 % des sessions fermées ont une écriture `CASH_CLOSE` ») vs Edge Case et `data-model.md` (`close_tx_id` NULL). Correction : reformuler NFR-007 (« hors sessions à théorique et compté nuls »).

### A29 — Jalons de documentation et dette : tout repoussé à IC-11 — mineur
- Réf. : `K/plan.md` IC-11, CLAUDE.md règle 3. OP-N81/OP-N82, ADR-131 à ADR-133 et reports PROMPTS/PRD sont planifiés en dernier lot ; une mission interrompue laisse des écarts sans OP/ADR. Les reports PROMPTS/PRD de la mission « Adaptateurs PSP réels » sont annoncés comme faits par le commit `c1bf43ac`, à vérifier. Correction : rédiger OP/ADR au premier lot qui introduit l'écart (IC-06/IC-01), IC-11 ne fait que les vérifier. Ajouter aussi FR-031 aux IC-01/02/08/10 (seul IC-05 le porte) et NFR-010 à un concern.

### A30 — Preuves manquantes pour certains FR/NFR — mineur
- FR-009 « versionnée » : aucune fonction de modification ni mécanisme de version dans `database-rights.md` (create/activate seulement) ; FR-012 « frais estimés » : source non définie ; FR-019 « tout échec alerte » : pas de test de code de sortie ; NFR-005 : pgTAP couvre l'isolation par prestataire (RLS) mais l'isolation par organisateur/événement (IDOR `getCashSession`, `getPspConfiguration`, `getPspTopup`) n'est qu'applicative, à tester route par route ; `quickstart.md` omet contestation et carte alors que SC-001 les exige.

### A31 — Clés d'idempotence : `wave:`/`om:` sans identifiant de configuration — mineur
- Réf. : `K/data-model.md` Correspondances, C-009. Clé unique par `(ledger_id, key)`. Deux configurations Wave successives d'un même événement (changement en `LIVE`) partageant un identifiant de paiement homonyme se heurtent (`CL002` ou crédit fusionné). Le contrat le dicte, mais préférer `wave:<config>:<paiement>` en contradiction signalée, ou prouver l'unicité globale des identifiants Wave/Orange.

### A32 — Garde de caisse : ouverture sur un grand livre qui n'est plus `LIVE`, sessions ouvertes au passage de statut — mineur
- Réf. : `K/contracts/cash.md` règle 3. `open_cash_session` ne vérifie pas le statut du grand livre ; le passage vers `RECONCILING` ne vérifie pas l'absence de session `OPEN` (condition « caisses à 0 » : contrôle de clôture, mission 9/11 « avant l'appel »). Correction : refuser l'ouverture hors `LIVE`/`CLOSING`, ajouter un contrôle base « session `OPEN` → pas de transition » ou le consigner comme report à la mission 9.

### A33 — Caution due après un crédit par notification : jamais rejouée — mineur
- Réf. : `K/research.md` R-06. `takeDueDeposit` est appelée après validation, dans la requête ; si l'API tombe entre commit et appel, le rejeu de la notification répond `duplicate` sans reprendre la caution, qui reste `DUE` jusqu'au prochain crédit. Correction : appeler aussi sur le chemin `duplicate`/poller (idempotent car `DUE` seulement).

### A34 — Activation d'un PSP sans attestation d'agrément — mineur
- Réf. : SPEC §11.1 (« avant d'activer un PSP, le prestataire DOIT vérifier agrément BCEAO / compte XOF »), `K/contracts/psp.md` §2. Rien dans l'approbation `PSP_CONFIGURATION` ne porte cette vérification. Correction : champ obligatoire `compliance_ref` dans la demande, vérifié non vide.

---

## Points vérifiés, sans constat
- Les soldes sont verrouillés (`post_transaction` l.600) avant l'insertion des `posting` : la sérialisation topup/close tient (à condition de A21).
- `request_hash` n'inclut pas `occurred_at` : un TOPUP rejoué à une heure de réception différente n'échoue pas en `CL002` (il peut échouer si les lignes de frais changent, A4).
- `UNIQUE (ledger_id, idempotency_key)` : les clés `psp:<config>:<paiement>` ne collisionnent pas entre prestataires.
- Les anomalies `PSP_MISMATCH`, `PSP_TOPUP_OVER_LIMIT`, `CARD_VELOCITY`, `LATE_CHARGEBACK`, `CASH_DIFF` sont déjà dans le `CHECK` (schéma l.846-854) ; `PSP_TOPUP_NOT_CREDITED` exige bien une migration (modifie une contrainte du schéma de référence : à écrire comme extension de source de rang 2, comme `fee_rule` et `approval_request.action`).
- Renforcements du plan (comptage aveugle, fermeture par une autre personne, sessions par terminal+personne, taille et temps constant des notifications) vont dans le bon sens.
