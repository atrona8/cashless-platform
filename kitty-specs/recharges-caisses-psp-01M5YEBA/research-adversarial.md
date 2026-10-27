# Passe contradictoire du plan (27/10/2026)

Agent distinct de l'auteur du plan (Sonnet), lecture seule ; 34 constats (4 bloquants, 17 majeurs, 13 mineurs).
Rapport complet : `docs/passation-6/rapports/plan-adversarial.md`. Chaque constat a une suite ; aucun n'est écarté.
« Changed » = le plan est corrigé ; « accepted » = constat fondé, intégré tel quel ; « deferred_with_rationale » =
report nommé. Les corrections font foi sur le texte antérieur de `research.md`, `data-model.md` et `contracts/`
quand ils divergent (section R-20 de `research.md`).

| # | Gravité | Constat (résumé) | Suite | Disposition |
|---|---|---|---|---|
| A1 | Bloquant | La garde de caisse casse les suites de référence générées (comptes `CASH_DESK` sans session) | La garde ne vaut que pour les caisses inscrites dans `cash_desk` (créées par `open_cash_session`) ; suites générées inchangées | changed |
| A2 | Bloquant | Notification avant l'enregistrement de la référence : succès perdu | Référence marchande = `psp_topup_id` envoyée au PSP et corrélée ; notification sans recharge résolue conservée `UNMATCHED`, retraitée par le travailleur, jamais consommée en `PSP_MISMATCH` d'office | changed |
| A3 | Bloquant | Succès après un état final ignoré ; échec carte final trop tôt ; course d'expiration | Succès authentifié sur `FAILED`/`EXPIRED`/`CANCELLED` : crédité s'il est recevable, sinon `PSP_TOPUP_NOT_CREDITED` ; `PAYMENT_FAILED` ne finalise pas une recharge (seule l'échéance après relecture du statut, sous verrou de ligne) ; échec d'`initiate` → reste `PENDING` jusqu'à l'interrogation ; tableau état × notification au data-model | changed |
| A4 | Bloquant | Erreur déterministe du moteur → `500` en boucle sans trace | Notification conservée d'abord (transaction propre), `200` ; traitement ensuite ; refus définitifs du moteur → `PSP_TOPUP_NOT_CREDITED` (motif nommé) ; erreurs inattendues → événement `RETRY`, retraité par le travailleur, alerte au-delà de 5 essais | changed |
| A5 | Majeur | La garde de production ferait refuser toute l'API, espèces comprises | En production, aucun faux n'est construit : fournisseur « indisponible » (réel) → `503 PSP_UNAVAILABLE`, notifications `404`, travailleur inactif ; test : chaque faux refusé ET processus public démarre en production avec les routes espèces | changed |
| A6 | Majeur | `cashless_app` peut créer un compte `CASH_DESK` | Déclencheur `BEFORE INSERT ON account` : `current_user = cashless_app` et `purpose IN ('CASH_DESK','PSP')` → refus (les fonctions SECURITY DEFINER s'exécutent sous le propriétaire) ; test pgTAP | changed |
| A7 | Majeur | Marque de fermeture forgeable par `set_config` | État de ligne : `cash_session.status = 'CLOSING'` posé par `begin_cash_close` ; la garde n'admet l'écriture de fermeture que pour `type = 'CASH_CLOSE'` et clé `cash-close:<session>` ; test d'un `set_config` forgé | changed |
| A8 | Majeur | La garde ne lie pas l'écriture au terminal | La garde compare `journal_transaction.device_id` à celui de la session quand il est posé ; variantes `…_for_session` de `take_deposit`, `refund_deposit`, `refund_cash_due` qui dérivent le compte de la session (l'API ne passe plus de compte) ; test « caisse d'un autre terminal » | changed |
| A9 | Majeur | Aucune fonction pour résoudre le prestataire d'une notification ou lister les recharges à interroger | `psp_webhook_context(config)` (lecture neutre) et `psp_poll_candidates(limit)`, droits nommés, liste figée | changed |
| A10 | Majeur | `secret_ref` non lié au titulaire | `CHECK (secret_ref LIKE 'psp/' || holder_party_id || '/%')` ; titulaire partie du prestataire ; `PspSecretStore.get` refuse un segment différent ; test croisé | changed |
| A11 | Majeur | Carte sans empreinte ou sans 3-D Secure par l'interrogation | Même type normalisé pour `getStatus` et `verifyNotification` ; carte sans empreinte ou `three_ds` ≠ `SUCCEEDED` (absent compris) → non créditée (`THREE_DS`, `NO_FINGERPRINT`) | changed |
| A12 | Majeur | Course sur le plafond par carte et la vélocité | `pg_advisory_xact_lock(ledger, empreinte)` dans `complete_card_topup` ; jour civil UTC (comme les mois du schéma) ; test de concurrence | changed |
| A13 | Majeur | Notifications d'identifiants différents du même paiement en concurrence | `FOR UPDATE` sur la recharge en tête du traitement ; `CHECK (status = 'SUCCEEDED') = (topup_tx_id IS NOT NULL)`, anomalie exclusive du crédit ; test de 100 rejeux mêlés | changed |
| A14 | Majeur | Contestation sans recharge créditée | `record_chargeback` exige `SUCCEEDED`, `topup_tx_id`, `CARD`, même devise ; plafond = montant net crédité ; sinon `PSP_MISMATCH` | changed |
| A15 | Majeur | Configuration suspendue/expirée non revérifiée ; recharges en attente orphelines | `resolve_psp_configuration` revérifie toujours statut, validité, organisateur, titulaire, moyen ; configuration suspendue : notifications refusées et signalées, recharges `PENDING` suivies par interrogation ; transitions listées ; approbation liée à la version | changed |
| A16 | Majeur | Argent encaissé non crédité sans trace comptable | Pas d'écriture d'attente en V1 : OP-N82 complété (écart « grand livre = relevé » attendu, anomalies à exclure du rapprochement) ; report explicite à la mission 9 | deferred_with_rationale |
| A17 | Majeur | Garde de caisse et synchronisations hors ligne | La garde vaut pour toutes les sources dans cette mission (aucune synchronisation servie) ; la mission 7 doit définir la session d'une recharge hors ligne : report PROMPTS/PRD | deferred_with_rationale |
| A18 | Majeur | Frais nuls par défaut ; convention d'ADR-82 retirée sans migration | Activation refusée sans règle de frais explicite (même 0 %) ; test qu'aucune règle `PSP:<canal>` n'existe (migration qui les refuse) | changed |
| A19 | Majeur | Contradictions non signalées | Ajoutées au plan : traitement asynchrone (contrat appliqué), clé de fermeture, `signature_valid`, contrôle des comptes chauds | changed |
| A20 | Majeur | Recharge d'un portefeuille bloqué | Refus à l'initiation (`409 WALLET_BLOCKED`) et à la notification (non créditée) ; test | changed |
| A21 | Majeur | Ordre des verrous fermeture/recharge | La garde lit sans verrou ; `begin_cash_close` verrouille le solde de la caisse avant `CLOSING` ; test « fermeture pendant une recharge » | changed |
| A22 | Mineur | Refus signalés seulement en journal | Compteur durable agrégé (configuration, motif, minute) écrit en base sans corps ; alerte à la première occurrence et au seuil | changed |
| A23 | Mineur | Ancien secret valable sans limite | Le port rend l'échéance du secret précédent ; refus au-delà ; test | changed |
| A24 | Mineur | Corps brut : données personnelles, conservation | Corps purgé après 400 jours (métadonnées gardées) ; purge par le travailleur ; lecture auditée par fonction (`OPERATOR_ADMIN`) | changed |
| A25 | Mineur | Recharges `PENDING` sans borne | Au plus 3 `PENDING` par portefeuille et 20 par terminal ; `Idempotency-Key` obligatoire | changed |
| A26 | Mineur | Règle « dernier comptage » contournable | Le fermeur ne doit avoir fait aucun comptage de la session ; au plus 10 comptages, audités | changed |
| A27 | Mineur | Le théorique lisible ailleurs | Inventaire des lectures de solde ; test qu'aucune route accessible à `CASHIER` ne rend le solde d'un compte `CASH_DESK` | changed |
| A28 | Mineur | NFR-007 contre le cas « tout nul » | NFR-007 reformulé | changed |
| A29 | Mineur | Dette consignée en dernier lot | OP-N81, OP-N82, ADR-131 à ADR-133 et reports écrits au plan ; IC-11 vérifie ; FR-031 et NFR-010 rattachés aux concerns | changed |
| A30 | Mineur | Preuves manquantes | Version d'une configuration (nouvelle version = nouvelle ligne, approbation liée) ; frais estimés par la règle de la configuration ; test du code de sortie du travailleur ; isolation route par route ; quickstart complété | changed |
| A31 | Mineur | Clés `wave:`/`om:` sans configuration | Toutes les clés qualifiées par la configuration (`wave:<config>:<paiement>`…) : contradiction avec le contrat signalée, plus sûre | changed |
| A32 | Mineur | Ouverture hors `LIVE` ; transition avec sessions ouvertes | Ouverture refusée hors `LIVE`/`CLOSING` ; contrôle « aucune session `OPEN` » avant `RECONCILING` reporté à la mission 9 | changed / deferred_with_rationale |
| A33 | Mineur | Caution due jamais reprise | Appel aussi sur le chemin doublon et par le travailleur (idempotent) | changed |
| A34 | Mineur | Activation sans attestation d'agrément | `compliance_ref` obligatoire dans la demande `PSP_CONFIGURATION` | changed |
