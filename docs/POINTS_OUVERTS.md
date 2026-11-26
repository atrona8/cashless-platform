# Points ouverts — système cashless multi-tenant

État au 2 octobre 2026 (après la revue de cohérence n° 2). Ce document liste ce qui n'est pas encore décidé. Chaque point indique s'il **bloque le code** et s'il **bloque la mise en production**, qui décide, et ce que l'agent code en attendant.

**Deux catégories :**

- **Bloque le code (OP-Bn).** Sans la réponse, l'agent ne peut pas écrire le module concerné correctement. Il code l'interface (port) et un faux pour les tests, puis s'arrête sur ce module.
- **Ne bloque pas le code (OP-Nn).** Une valeur par défaut sûre existe. L'agent la code, la rend paramétrable, et la décision la remplacera sans refonte. Beaucoup de ces points bloquent en revanche la **mise en production**.

Quand un point est tranché : on ajoute une fiche dans `DECISIONS_ADR.md`, on met à jour `SPECIFICATION.md` (§17 pour les valeurs par défaut) et on retire le point d'ici.

## Vue d'ensemble

| Point | Sujet | Bloque le code | Bloque la production | Qui décide |
|---|---|---|---|---|
| OP-N3 | Taxes, caution acquise, correspondance SYSCOHADA (la casse est tranchée : ADR-67) | Non | **Oui** | Expert-comptable |
| OP-N11 | Région d'hébergement AWS : Paris (`eu-west-3`) retenue à titre provisoire (ADR-65) | Non | **Oui** (confirmation) | Mesure de latence et juriste |
| OP-N12 | Durées de conservation des données | Non | **Oui** | Juriste |
| OP-N13 | Algorithme de signature des snapshots | Non | Non | Agent (vérification technique) |
| OP-N36 | Capture différée dans la cible V2 (reporté au cadrage V2) | Non | Non | Porteur du projet, avec le premier partenaire de caisse |
| OP-N37 | Outils de sécurité en CI (reporté) | Non | Non | Porteur du projet |
| OP-N41 | Service de clés des bracelets : faux seulement, adaptateur AWS KMS à écrire | Non | **Oui** | Mission 12b (déplacée de la mission 7 le 29/10/2026, ADR-138), après OP-N11 |
| OP-N42 | Identité du terminal — **levé** le 21/10/2026 par la mission 5a (jeton lié, mTLS et signature de chaque requête, ADR-107 ; `device-auth-matrix.spec.ts`, `production-guard.spec.ts`) | Non | Non | — |
| OP-N43 | Identité du festivalier : **jeton d'accès réel disponible depuis le 10/11/2026** (`/customer-auth/*`, `TokenCustomerIdentity`, hors Spec Kitty, ADR-180) ; en production le jeton seul est cru (en-têtes `X-Test-*` ignorés), hors production les en-têtes restent admis en l'absence d'`Authorization`. KYC au guichet et OP-N47 **levés par la mission 10a le 20/11/2026** (ADR-226, ADR-228) ; reste l'envoi réel du code (OP-N120, mission 12b) | Non | **Oui** (tant qu'OP-N120 n'est pas levé : le faux envoyeur refuse le démarrage en production) | Mission 12b (la 10a a levé le reste, 20/11/2026) |
| OP-N44 | `EXECUTE` hérité de `PUBLIC` — **levé** le 21/10/2026 par la mission 5a (droits rôle par rôle, `tests_execute_grants.sql`) | Non | Non | — |
| OP-N45 | Aiguillage par chemin devant les processus de l'API | Non | **Oui** | Mission 13 (recette V1) (confirmé par le porteur le 15/10/2026) |
| OP-N46 | Signature d'originalité NXP vérifiée par le poste seulement | Non | Non | Mission 12 (app terminal), avec l'auditeur sécurité (confirmé par le porteur le 15/10/2026) |
| OP-N47 | Rotation du secret d'empreinte des codes de rattachement — **LEVÉ le 20/11/2026 par la mission 10a** : rotation immédiate, version du secret sur chaque empreinte, réémission par la commande `reissue-claim-codes` sous le rôle `cashless_claimadmin` (ADR-228 ; test de levée `media/claim-rotation.spec.ts`, `cli/reissue-claim-codes.spec.ts`, `tests_claim_key_version.sql`) | Non | Non | Levé (décision du porteur du 20/11/2026 : rotation immédiate, sans double empreinte ; ADR-104 réalisée par la mission 10a) |
| OP-N48 | Fichier de commande des codes de rattachement perdu en route : pas de nouvelle émission | Non | Non | Agent (choix laissé par le porteur) ; à revoir en exploitation |
| OP-N49 | Caution en espèces et espèces dues : aucune caisse avant la mission des caisses (`409`) — **levé** le 29/10/2026 par la mission 6 (migration `0036_cash_sessions.sql` ; `tests_cash_sessions.sql`, `deposit.spec.ts`, `cash-due.spec.ts`, `release.spec.ts`, `cash-desk-guard.spec.ts`, cas `SC-002 : OP-N49 levé` de `topup-journey.spec.ts`) | Non | Non | — |
| OP-N50 | Lecture liée à une demande de rattachement utilisable par `consume_tap` — **levé** le 21/10/2026 par la mission 5a (migrations 0024, 0026 ; `tests_consume_tap_claim.sql`, `tap-claim-race.spec.ts`) | Non | Non | — |
| OP-N51 | Guichet de retour : enchaînement des étapes servi par la mission 9 (décidé le 15/10/2026, ADR-91) — **levé** le 16/11/2026 par la mission 9a (`release-chaining.spec.ts`, `journey.spec.ts` SC-004) | Non | Non | — |
| OP-N52 | Sortie de liste noire : valideur non vérifié par la base — **levé** le 15/10/2026 (migration 0017, ADR-94), avec une limite résiduelle : OP-N56 | Non | Non | — |
| OP-N53 | Limite de la consultation anonyme par adresse sans réglage `trust proxy` — **levé** le 15/10/2026 (`TRUST_PROXY_HOPS`, ADR-95) | Non | Non | Exploitation (valeur du déploiement) |
| OP-N54 | Empreinte de requête sans clé au registre d'idempotence — **levé** le 21/10/2026 par la mission 5a (HMAC `IDEMPOTENCY_HMAC_KEY`, ADR-99 ; `request-hash.spec.ts`, `personalization.spec.ts`) ; consigne de déploiement à appliquer (purge des lignes antérieures) | Non | Non | Exploitation (consigne de déploiement) |
| OP-N55 | `replace_media` ne fait pas suivre les espèces dues au bracelet neuf (ADR-100) — **levé** le 16/11/2026 par la mission 9a (migration `0082_replace_media_cash_due.sql` ; `tests_replace_cash_due.sql`, `cash-due-after-replace.spec.ts`) | Non | Non | — |
| OP-N56 | Décision d'une demande d'approbation : la base ne vérifie pas l'identité de la personne qui décide (limite résiduelle d'ADR-94) | Non | Non (limite acceptée, ADR-94) | Mission 11 (back-office), avec le serveur d'identité réel |
| OP-N57 | `offline_snapshot` : une version très grande plantée par la connexion de l'API bloquait les snapshots suivants du grand livre — **levé** le 04/11/2026 par la mission 7 (migration `0044_offline_snapshots.sql`, `publish_offline_snapshot` calcule la version ; `post-roles.sql` ; `tests_offline_snapshots.sql`, `tests_offline_rights.sql`, `tests_definer_trigger_writers.sql` §3) | Non | Non | — |
| OP-N58 | `offline_policy_history` : trace des politiques hors ligne falsifiable — **levé** le 04/11/2026 par la mission 7 (migration `0043_offline_policy.sql`, `log_offline_policy` en SECURITY DEFINER, écritures par `set_offline_policy` et `clear_offline_policy` ; `tests_offline_policy.sql`, `tests_definer_trigger_writers.sql` §3 inversé, `tests_offline_rights.sql`) | Non | Non | — |
| OP-N59 | Fonctions SECURITY DEFINER sans `pg_temp` — **levé** le 21/10/2026 par la mission 5a (migration 0021 et `TEMPORARY` retiré ; `tests_definer_search_path.sql`, `tests_device_rights.sql` §5, `tests_definer_trigger_writers.sql` §4 à 0) | Non | Non | — |
| OP-N60 | **LEVÉ le 19/11/2026 par la mission 11a** : lots créés et modifiés par `create_media_batch` et `update_media_batch`, statut d'un bracelet par `media_set_status` (`SUSPENDED` et `BLACKLISTED` seulement) ; `INSERT` et `UPDATE` directs de `cashless_app` retirés (migration 0091, `post-roles.sql` §13 ; `tests_media_batch_functions.sql`, `tests_11a_rights.sql`, `blacklist.spec.ts` « OP-N60 levée » ; ADR-216) | Non | **Non** (levé ; ADR-97 le disait bloquant) | Levé |
| OP-N61 | Traitements par tranches (NFR-008) : clôture, rattrapage du préchargement et rechiffrement non prouvés sur un lot de 5 000 bracelets (ADR-98) | Non | **Oui** (preuve attendue de la recette, avant la production) | Mission 13 (recette V1), décision du porteur du 15/10/2026 |
| OP-N62 | Retrait d'une clé dédiée sans travail ; demande approuvée périmée — **levé** le 21/10/2026 par la mission 5a (migration 0025 ; `tests_tag_key_retire_guard.sql`) | Non | Non | — |
| OP-N63 | Clé d'accord d'un terminal réécrite par l'API — **levé** le 21/10/2026 par la mission 5a (clé écrite à l'enrôlement seulement, ADR-105 ; `tests_device_rights.sql` §1 et §2) | Non | Non | — |
| OP-N64 | **Côté serveur prêt, NON LEVÉ** (mission 11a, ADR-222) : clé App Attest gardée à l'enrôlement (`0095`), vérificateur d'assertions interne non branché, **borne iOS gardée** (`/media/auth-keys` refuse toujours iOS) ; reste : assertions envoyées par l'app, vérificateur branché, borne retirée, **vecteur réel d'Apple exigé avant la mission 12** ; clé de signature ECDSA non attestée jusque-là (ADR-106) | Non | Non (limite acceptée par le porteur le 19/10/2026) | Mission 12 (app terminal) |
| OP-N65 | Rafraîchissement d'un jeton d'appareil : une représentation du jeton consommé tolérée 60 s pour le même terminal (ADR-108) | Non | Non (limite acceptée par le porteur le 19/10/2026) | Mission 13 (recette V1) |
| OP-N66 | Import du fichier de l'imprimeur lent quand la table des bracelets est volumineuse (> 5 s avec ~100 000 bracelets) ; antérieur à la mission 5a | Non | À évaluer | Porteur du projet (point ouvert du 19/10/2026, hors mission 5a) |
| OP-N67 | Attestation Android : `attestationApplicationId` lu dans la liste logicielle de Key Attestation (seul champ ; écart accepté au plan, ADR-110) | Non | Non (limite acceptée par le porteur le 19/10/2026) | Mission 13 (recette V1) |
| OP-N68 | Fonction créée à la main, hors de `migrate.ts`, exécutable par `PUBLIC` — **levé** le 04/11/2026 par la mission 7 (`post-roles.sql` §8a : droit par défaut global, ADR-111 ; `tests_execute_grants.sql` §4 inversé, `migrate-rights.spec.ts`) | Non | Non | — |
| OP-N69 | `cashless_app` modifiait directement des colonnes de `device` — **levé** le 04/11/2026 par la mission 7 (migration `0048_offline_device_vendor.sql` et `post-roles.sql` : liste des colonnes modifiables VIDE, écritures par fonctions ; ADR-112 ; `tests_device_rights.sql` §1) | Non | Non | — |
| OP-N70 | Suites de la mission 4 sous le faux d'identité du terminal — **levé** le 21/10/2026 par WP18 de la mission 5a (chaque route de terminal en HTTPS réel, test de couverture : `device-auth-matrix.spec.ts`) | Non | Non | — |
| OP-N71 | Idempotence : rejeu sur une autre ressource et entre personnes — **levé** le 21/10/2026 par WP18 de la mission 5a (chemin concret et appelant dans l'empreinte, ADR-116 ; `admin.spec.ts`, `request-hash.spec.ts`) ; même consigne de déploiement qu'OP-N54 | Non | Non | Exploitation (consigne de déploiement) |
| OP-N72 | Enrôlement : chaque refus d'un code inconnu prend le verrou de la chaîne d'audit de la plateforme, et la limite par adresse (/64 en IPv6) ne borne pas un attaquant qui dispose de nombreuses adresses ; aucune limite en amont (répartiteur) sur `POST /v1/device-enrollments` (ADR-117) | Non | Non (limite résiduelle acceptée) | Mission 13 (recette V1) : proposée par l'agent, confirmée par le porteur le 21/10/2026 |
| OP-N73 | Autorité des terminaux (`DEVICE_CA`) et signataire des jetons d'appareil (`TOKEN_SIGNER`) : faux seulement, aucun adaptateur réel (C-004 de la mission 5a, ADR-119) | Non | **Oui** (démarrage refusé en production) | Mission 12b, avec OP-N41 (déplacée de la mission 7 le 29/10/2026, ADR-138) |
| OP-N74 | Enrôlement sur un code lié à un événement clos ou à un point de vente supprimé — **levé** le 26/10/2026 par la mission 5b (migration `0035_enrollment_event_state.sql` : `create_device_enrollment_code` et `enroll_device` refusent `CLOSED` pour tout mode et, dès `CLOSING`, `CATALOG_POS`/`KEYPAD_TPE`, et un point de vente absent de l'événement du code ; `tests_enrollment_event_state.sql`, ADR-120) | Non | Non | — |
| OP-N76 | **LEVÉ le 19/11/2026 par la mission 11a** : processus `vendor-pin` et rôle `cashless_pin`, seuls à lire l'empreinte et ouvrir la session ; `cashless_app` sans `EXECUTE` ; API sans `VENDOR_PIN_SECRET`, appel signé HMAC sans repli, anti-rejeu (`vendor-pin-process.spec.ts`, `vendor-sessions.spec.ts`, `tests_11a_rights.sql` ; ADR-217). Reste nommé : PIN en transit (OP-N151) | Non | Non (levé) | Levé |
| OP-N75 | Purges des nonces et des essais d'enrôlement exécutées par `cashless_app` — **levé** le 04/11/2026 par la mission 7 (rôle `cashless_maint` et processus `maintenance`, `post-roles.sql` §8g ; ADR-114 ; `tests_device_purge_window.sql`, `tests_execute_grants.sql`) | Non | Non | — |
| OP-N77 | Secrets de l'API (`IDEMPOTENCY_HMAC_KEY`, `ENROLLMENT_CODE_HMAC_KEY`, `VENDOR_PIN_SECRET`, `VENDOR_PIN_IDEMPOTENCY_SECRET` depuis le 26/10) exigés et reçus par tous les processus, y compris ceux qui ne s'en servent pas (clés, personnalisation) ; antérieur à la mission 5b (ADR-125) | Non | Non (exposition acceptée par le porteur le 23/10/2026) | Mission 13 (recette V1), proposée par l'agent |
| OP-N78 | `vendor_pin_check` (registre des essais de PIN des vendeurs) sans fonction de purge : la table grossit sans limite (relecture WP07 de la mission 5b ; ADR-127) | Non | Non (décision du porteur du 26/10/2026) | Mission 13 (recette V1) |
| OP-N79 | **LEVÉ le 18/11/2026 par la mission 11a** : clé étrangère `sale_attribution_session_vendor_fk` sur `(vendor_session_id, vendor_id)` (migration 0090 ; `tests_vendor_session_key.sql` ; ADR-216) | Non | Non (levé) | Levé |
| OP-N80 | Ouverture de session de vendeur : le verrou d'essai de PIN (`SessionLock`) tient une connexion du pool dédié pendant toute la requête (argon2 compris) ; au-delà de `poolSize` terminaux qui ouvrent une session en même temps, `pool.connect` attend 10 s puis rend `500` au lieu de `429` (relecture WP09 cycle 3, mission 5b) | Non | Non (dimensionnement, aucun droit élargi) | Mission 13 (recette V1) : mesure en charge, puis taille du pool ou `429` ; report accepté par le porteur le 26/10/2026 (ADR-130) |
| OP-N81 | Adaptateurs PSP réels (Wave, Orange Money, PayDunya, Stripe) et coffre des secrets AWS non livrés : la mission 6 ne livre que l'interface commune, un faux par fournisseur et un faux coffre, refusés au démarrage en production (ADR-131) | Non | **Oui** (aucune recharge en ligne en production) | Mission « Adaptateurs PSP réels », dès les accès de test obtenus (action 11) ; décision du porteur du 27/10/2026 |
| OP-N82 | Paiement réussi chez le PSP mais non crédité (plafond, 3-D Secure, plafond de carte, grand livre fermé) : remboursement au payeur fait hors de la plateforme (tableau de bord du PSP), clôturé par résolution d'anomalie à deux ; aucun canal intégré | Non | Non (rien n'est crédité ; argent suivi par l'anomalie) | Mission « Adaptateurs PSP réels » (remboursement par l'adaptateur). **Partie rapprochement levée le 17/11/2026 par la mission 9b** (anomalies PSP prises en compte par le contrôle « grand livre = relevé », ADR-210) |
| OP-N83 | Cause d'un blocage de portefeuille : corrigée par la migration `0042` (WP14 cycle 2, décision du porteur du 29/10/2026) ; reste : un chemin qui écrit lui-même `ACTIVE` lève aussi la cause de contestation | Non | Non | Levé pour l'ordre des événements ; ADR-134 |
| OP-N84 | LEVÉ le 29/10/2026 (WP14 cycle 2) : `take_deposit`, `refund_deposit`, `refund_cash_due` ne sont plus accordées à `cashless_app` | Non | Non | Levé ; ADR-135 |
| OP-N85 | Caution due non prise si le processus s'arrête entre le COMMIT du crédit et l'appel qui la prend (fenêtre étroite, reprise au rejeu d'une autre notification seulement) | Non | Non | Mission 13 (recette V1) ou lot de reprise ; ADR-135 |
| OP-N86 | Droits de `cashless_app` plus larges que nécessaire : `psp_poll_candidates(int)` et `psp_events_to_retry(int)` (0038) voient les recharges et notifications de tous les prestataires ; le `psp-poller` tourne sous `cashless_app` sans rôle dédié ; INSERT direct sur `anomaly` gardé (5 sites de la mission 6) | Non | Non (limite connue, bornée par tests) | Mission 13 (recette V1) : rôle dédié au `psp-poller`, retrait des deux fonctions et de l'INSERT sur `anomaly` au profit d'une fonction de la base ; décision du porteur du 29/10/2026 (ADR-136) |
| OP-N87 | `posting_cash_desk_guard` (0036) lit `cash_desk` sous RLS forcée : la garde « aucune espèce sans session » ne vaut que si le propriétaire de la fonction contourne la RLS ; sinon elle laisse passer sans bruit | Non | Non (dépend du déploiement, borné par un test) | Mission 13 (déploiement) : rôle propriétaire contrôlé, ou garde qui refuse si la recherche est impossible ; décision du porteur du 29/10/2026 (ADR-136) |
| OP-N88 | Soldes lus sans verrou avant l'écriture : `CHARGEBACK` verrouille le solde payé en détournant `wallet_topup_headroom` (correctif de la PR #8) ; `PURCHASE` (mission 5b) lit encore les soldes promo et payé sans verrou | Non | Non (aucun argent créé : la base refuse le découvert ; refus à tort sous concurrence) | Mission 13 : fonction SQL dédiée qui verrouille les comptes de l'écriture dans l'ordre des identifiants avant la lecture, utilisée par `CHARGEBACK` et `PURCHASE` ; décision du porteur du 29/10/2026 |
| OP-N89 | Signature des snapshots hors ligne et clés de contenu par un faux KMS (`SignPort`, `DataKeyPort` simulés) : aucun snapshot servi en production avant la mission 12b (plan de la mission 7, ADR-138) | Non | **Oui** (démarrage refusé en production) | Mission 12b |
| OP-N90 | Rejet réessayable d'un lot (4e `CL007`) : un numéro sans résultat final admis à la clôture du lot sur une trace `offline_batch_retry` écrite par la base (écart à l'invariant I2, décision du porteur du 30/10/2026, ADR-139) | Non | Non (alerte à 24 h) | — (écart permanent, revu en mission 13) |
| OP-N91 | Droits ajoutés au contrat de la mission 7 : `cashless_snapsign` exécute `discard_offline_snapshot_draft` et `mark_offline_retry_alerted` ; `cashless_snapcontent` jette ses brouillons ; `cashless_app` lit les identifiants des imports de journal en cours de tous les prestataires (`device_journal_imports_processing`) (décisions du porteur du 30/10/2026, ADR-140) | Non | Non | — (écart permanent, revu en mission 13) |
| OP-N92 | Clés de signature des snapshots : `cashless_keyadmin` lit cinq colonnes de `snapshot_signing_key`, `cashless_snapsign` exécute `snapshot_public_keys`, rotation sans approbation à deux et acteur non vérifié (décisions du porteur des 30/10 et 02/11/2026, ADR-142 et ADR-143) | Non | Non (limite acceptée) | Mission 13 (recette V1), avec OP-N56 |
| OP-N93 | Snapshots hors ligne : limites des processus de contenu et de signature (clés publiques par prestataire, entrée sans mot de passe, clé d'emballage sans référence, verrou et délai d'orphelin, référence de clé erronée ; ADR-144) | Non | Non | Mission 13 (recette V1) ; clés par prestataire : mission 12b (confirmé par le porteur le 04/11/2026) |
| OP-N94 | Lots et import de journal : choix consignés (vente hors catalogue sans lignes, `config_id` inconnu, annulation du back-office sans réduction de l'anomalie, migration `0050`, acteurs non contrôlés par la base ; ADR-145 et ADR-146) | Non | Non | Mission 13 (recette V1) |
| OP-N95 | Limites de corps et de démarrage : `500` au lieu de `413` au-delà de 100 ko, corps d'import jusqu'à 21 037 056 octets, `DATABASE_URL_MAINT` vers le propriétaire ou un superutilisateur : refusé au démarrage en production, point (3) levé le 04/11/2026 (ADR-147) | Non | Non | Mission 13 (recette V1) pour (1), (2), (4) |
| OP-N96 | Remontée des terminaux d'un événement : migration `0051` hors plan, enveloppe `event_device_sync_status_api` (DEFINER, lecture seule) ouverte à `cashless_app` ; les fonctions sous-jacentes restent fermées (ADR-148) | Non | Non | Mission 13 (recette V1) |
| OP-N116 | **LEVÉ le 19/11/2026 par la mission 11a** : `register_edge_gateway` rend `(gateway_id, ledger_id)` (0094, `CL058`), `edge-admin register` refuse `--ledger` (`tests_edge_gateway.sql`, `register.spec.ts` ; ADR-221) | Non | Non (levé) | Levé |
| OP-N98 | NFR-005 : un changement ordinaire (non bloquant) est visible en 60 s plus la boucle, soit 60,9 à 62,2 s mesurés (`DELTA_AFTER_MS` = 60 s gardé ; les changements bloquants tiennent 5 s ; ADR-151) | Non | Non | Mission 13 (recette V1) |
| OP-N99 | FR-024 : le refus hors ligne `LEDGER_LOCKED` / `SYNC_DEADLINE_PASSED` est prouvé en unitaire (`period.spec.ts`) mais son câblage depuis le lecteur de conformité n'est pas prouvé en intégration (seul `PERIOD_CLOSED` l'est) ; la base refuse déjà un grand livre verrouillé (`CL003`) | Non | Non | Mission 13 (recette V1) |
| OP-N100 | Clés de la passerelle (stockage matériel, autorité des passerelles) simulées par des faux jusqu'à la mission 12b ; la passerelle n'est pas utilisable en production avant (mission 8, ADR-155) | Non | **Oui** | Mission 12b |
| OP-N101 | Jetons d'appareil de la passerelle signés par une clé propre, valables sur elle seule (mission 8, décision 2, ADR-156) | Non | **Oui** | Mission 12b |
| OP-N102 | Renouvellement du jeton d'appareil sans rotation du jeton de rafraîchissement sur la passerelle (mission 8, décision 11, ADR-157) | Non | **Oui** | Porteur (contrat) |
| OP-N103 | Jeton de personne expiré toléré au guichet de la passerelle, 12 h après la bascule, avec `exp >= activated_at` ajouté (mission 8, décision 3, ADR-158) | Non | **Oui** | Porteur (mission à fixer) |
| OP-N104 | Ventes `EDGE_ONLINE` sans signature du terminal : perte maximale `min(soldes ; T × H × plafond horaire ; passages réels × plafond par vente)`, valeurs des plafonds à soumettre (mission 8, décision 13, ADR-159) | Non | **Oui** | Porteur (plafonds) |
| OP-N105 | Inscription d'une passerelle par une seule personne, alerte et délai avant les mots de passe (mission 8, décision 16, ADR-160) | Non | **Oui** | Porteur (délai) |
| OP-N106 | Purge des secrets du site : mini-PC volé avant la purge (mission 8, décision 17, ADR-161) | Non | **Oui** | Mission d'exploitation |
| OP-N107 | Passerelle perdue : pas de rejeu automatique des activations et cautions, anomalie `EDGE_REPLAY_FAILED`, résolution à deux (mission 8, décision 4, ADR-162) | Non | Non | Mission 13 |
| OP-N108 | Recharge espèces au rejeu : dépassement temporaire d'un plafond réglementaire, à signaler au juriste (mission 8, décision 14, ADR-163) | Non | **Oui** (avis du juriste) | Juriste |
| OP-N109 | « Même moteur » (SPECIFICATION §9) devient « mêmes modules » : base locale à schéma réduit (mission 8, décision 1, ADR-164) | Non | Non | Porteur |
| OP-N110 | `STALE` persisté seulement si l'époque est confirmée ou plausible (au plus +2) ; levée locale à deux (mission 8, décision 15, ADR-165) | Non | Non | Porteur |
| OP-N111 | Base locale de la passerelle : le rôle unique `edge_app` peut couper les déclencheurs ou supprimer les tables d'autorité, de file et d'audit (mission 8, décision 19, ADR-166) | Non | **Oui** | Mission 13 |
| OP-N112 | Ordres à deux personnes : une même personne détenant les deux clés de site n'est pas détectable (mission 8, décision 27, ADR-167) | Non | Non | Porteur |
| OP-N113 | Clé TLS client de la passerelle vers le central en fichier, jusqu'à la mission 12b (mission 8, décision 32, ADR-168) | Non | **Oui** | Mission 12b |
| OP-N114 | Retour de l'autorité au central : une seconde demande `CENTRAL` à autre clé abandonne le rendu en cours (mission 8, décision 34, ADR-170) | Non | Non | Porteur |
| OP-N115 | Colis de mots de passe : une page de 200 bracelets illisibles arrête le service de la passerelle (mission 8, WP15, ADR-184) | Non | Non | Mission 12b |
| OP-N137 | **LEVÉ le 19/11/2026 par la mission 11a** : crochet `guardDecision` (mauvais rôle `403`, refus par classe), audit `PAYOUT_CONFIRM_REPLAYED`, auto-approbation exactement `409 APPROVAL_INVALID` (`payout-guard-decision.spec.ts`, `payout-confirm.spec.ts`, `payout-batch.spec.ts` ; ADR-220) | Non | Non (levé) | Levé |
| OP-N117 | LEVÉ le 11/11/2026 (WP25 partie A, borne haute `completed_at` + 120 s) : reprise forcée, anomalies en trop après la fin de la reprise (mission 8, WP14) | Non | Non | Levé |
| OP-N118 | Purge des secrets de la passerelle : WAL et blocs libres non effacés, tables d'ajout seul non vidées, purge hors de la transaction de la file (mission 8, WP24, décision 49, ADR-186) | Non | **Oui** | Mission 12b |
| OP-N140 | **LEVÉ le 19/11/2026 par la mission 11a** : masque d'IBAN dans `redact.ts`, IBAN chiffré (AES-256-GCM) aux trois emplacements, `CHECK` en base (0093 ; `redact.spec.ts`, `iban-vault.spec.ts`, `tests_iban_sealed.sql`, `limits-9b.spec.ts` ; ADR-218). Écart accepté : clé dans le processus public (OP-N150) | Non | Non (levé) | Levé |
| OP-N122 | Ventes relayées par la passerelle : le central croit `pack_verified` sans pouvoir le vérifier, seule la passerelle détient la clé des colis (mission 8, revue post-fusion C1, décision du 12/11/2026, ADR-188) | Non | **Oui** | Mission 12b |
| OP-N123 | **LEVÉ le 17/11/2026 par la mission 9b** : création par le back-office d'une demande `BANK_TRANSFER` avec IBAN (`createRefundRequest`, `create-backoffice.spec.ts`, ADR-210) (avant : Demande de remboursement créée par le back-office) | Non | Non | Levé
| OP-N124 | **LEVÉ le 17/11/2026 par la mission 9b** : code consommé seulement si la décision est écrite (`journey-limits.spec.ts` OP-N124 inversé, `verify-then-consume.spec.ts`, ADR-210) (avant : Remboursement : le code du titulaire est consommé avant l'écriture de sa décision) | Non | Non | Levé
| OP-N125 | Remboursement : quota de codes par numéro commun à tous les usages ; alerte de `BLOCK` réduite à une ligne d'audit (mission 9a, décision 12b du 16/11/2026, ADR-193) | Non | Non | Mission 12b (confirmé par le porteur le 16/11/2026) |
| OP-N126 | **LEVÉ le 17/11/2026 par la mission 9b** : recrédit d'un `FAILED` borné par le rapprochement bancaire, verrou de `refund_request` en base (`failed-recredit-bound.spec.ts`, `concurrency.spec.ts` décision 14, `tests_statements.sql`, ADR-203, ADR-210) (avant : Remboursement : une seule personne habilitée recrédite un `FAILED` ; il faut un troisième administrateur sur l'événement) | Non | Non | Levé
| OP-N127 | Contradiction C-001 : FR-012 / scénario 5 « sans titulaire vérifié → REQUESTED » — **clos** le 16/11/2026 (décision 15 du porteur, ADR-194 : spec amendée, comportement strict gardé : `422 REFUND_NOT_ALLOWED`) | Non | Non | — |
| OP-N128 | **LEVÉ le 17/11/2026 par la mission 9b** : `approved_by` porté par l'écriture, cumul sous verrou du portefeuille (`journey.spec.ts` OP-N128 (a), `release-cumul-lock.spec.ts`, ADR-210) (avant : Guichet enchaîné : `approved_by` nul sur la caution seule au-dessus du seuil ; cumul lu sous le verrou du bracelet) | Non | Non | Levé
| OP-N129 | Décision du titulaire : lien du contrat (`otp_request_id`, `refund_request_id`) — **levé** le 16/11/2026 par la mission 9a (décision 14 : l'envoyeur de codes les reçoit ; `holder-link.spec.ts`, `journey.spec.ts`) | Non | Non | — |
| OP-N130 | **LEVÉ le 17/11/2026 par la mission 9b** : déclencheur `refund_request_transition_guard`, montant et frais figés après `PROCESSING` (`tests_refund_transitions.sql`, 169 assertions ; ADR-210) (avant : Remboursement : l'ordre des états d'une demande n'est gardé que par l'API ; la base laisse `cashless_app` modifier les colonnes de transition) | Non | Non | Levé
| OP-N131 | Copie externe des scellements simulée jusqu'à la 12b : un scellement et sa copie sont dans la même base (mission 9b, WP12, décision du porteur du 17/11/2026, ADR-197) | Non | Oui (le faux refuse le démarrage en production) | Mission 12b |
| OP-N132 | Alertes d'exploitation sans envoi à une personne : audit, `pg_notify` et journal seulement (mission 9b, WP12, C-010, ADR-198) | Non | Oui | Mission 12b |
| OP-N133 | Propriétaire des fonctions `ops_*` : superutilisateur ou `BYPASSRLS` exigé ; `pg_read_all_stats` à lui accorder (mission 9b, WP05 et WP06, ADR-199) | Non | Oui (réglage de déploiement) | Mission 12b |
| OP-N134 | Relevé importé : `closing_balance` déclaré jamais recoupé avec la somme des lignes (mission 9b, WP02, ADR-200) | Non | Non | À proposer au porteur |
| OP-N135 | Une transaction peut être rapprochée par plusieurs lignes de relevé (règlement PSP en plusieurs virements, non modélisé) (mission 9b, WP02) | Non | Non | À proposer au porteur |
| OP-N136 | `explained_by_anomalies` calculé en base mais absent d'`AccountReconciliation` ; deux lignes de relevé rapprochées à la même anomalie (mission 9b, WP09) | Non | Non | À proposer au porteur |
| OP-N137 | Versements : approbateur du mauvais rôle fait passer la demande en `FAILED` ; rejet sans rôle par classe ; `confirm` rejoué sans audit ; test d'auto-approbation `[403, 409]` (mission 9b, WP08, ADR-204) | Non | Non | Mission 11a |
| OP-N138 | Réclamation tardive en `CASH` inatteignable sur un grand livre `LOCKED` (mission 9b, WP10, ADR-206) | Non | Non | — (règle voulue, consignée) |
| OP-N139 | Remboursement tardif en mobile money vers un autre numéro que celui du festivalier : accepté, sans code de vérification (mission 9b, WP10, décision 13 du 17/11/2026, ADR-207) | Non | Non | Mission 12b (envoi réel du code) |
| OP-N140 | `errors/redact.ts` ne masque pas l'IBAN ; IBAN de `refund_request.iban` stocké en clair au repos (mission 9b, WP11, ADR-203) | Non | Oui (avant tout journal de corps de requête) | Mission 11a |
| OP-N141 | **LEVÉ le 18/11/2026 par la mission 11a** : l'écart de régularisation `OPERATOR_FEE` ne dépasse pas les frais bruts (`closing-variants.spec.ts` ; ADR-220) | Non | Non (levé) | Levé |
| OP-N142 | Relevés et export comptable : pagination par numéro d'écriture sur plusieurs grands livres ; relevé et CSV festivalier non tracés ; risque de double compte de l'export (mission 9b, WP13, ADR-209) | Non | Non | À proposer au porteur |
| OP-N143 | `closing_balance` non servi dans le relevé JSON (index couvrant `posting(account_id) INCLUDE (amount)` à proposer) (mission 9b, WP13, décision 16 du 17/11/2026, ADR-209) | Non | Non | Mission ultérieure, à proposer au porteur |
| OP-N144 | Recrédit d'un `FAILED` refusé `409` si une ligne de relevé est rapprochée : aucune voie de contournement (mission 9b, WP11, ADR-203) | Non | Non | À proposer au porteur |
| OP-N145 | **LEVÉ le 19/11/2026 par la mission 11a** : déclencheur `refund_request_insert_guard` (`CL057`), `INSERT` par colonne, `refund_deposit_for_session(uuid, uuid)` retirée (0092 ; `tests_refund_insert_guard.sql`, `limits-9b.spec.ts` ; ADR-219). `refund_deposit(uuid, uuid)` gardée (OP-N153) | Non | Non (levé) | Levé |
| OP-N147 | **LEVÉ le 17/11/2026 par la mission 9b (WP14)** : `approvalRequestDto` masque aussi `result` (`maskPaymentData`) ; plus aucun numéro en clair dans `GET /approval-requests` ni dans l'audit `APPROVAL_EXECUTED` (`invariants-cloture/payment-data-exposure.spec.ts`, ADR-211) | Non | Non | Levé |
| OP-N146 | Renforcements de la mission 9b, faits puis consignés (liste dans la fiche, ADR-200 à ADR-203, ADR-205, ADR-206, ADR-209) | Non | Non | — (clos) |
| OP-N148 | Ligne de relevé importée après le recrédit d'un `FAILED` : reste « non rapprochée », seule l'alerte générique `statement-unmatched` ; recrédit possible tant que la ligne n'est pas importée (mission 9b, reste d'OP-N126, ADR-212) | Non | Non | Mission 12b (alertes) |
| OP-N149 | Aucun balayage d'isolation entre organisateurs d'un même prestataire pour les 20 opérations de la 9b : `isolation-9b.spec.ts` ne prouve que l'isolation entre prestataires (trou dans la preuve, pas un défaut constaté ; mission 9b, relecture) | Non | Non | Mission 13 |
| OP-N150 | Clé de l'IBAN (`IBAN_KEYRING`) dans le processus public : une API compromise lit la clé (écart accepté par le porteur le 18/11/2026 ; mission 11a, ADR-218) | Non | Non (limite acceptée) | Mission 12b (vrai KMS, OP-N41) |
| OP-N151 | PIN en transit : l'API voit le PIN avant de l'envoyer au processus `vendor-pin` (limite acceptée, désormais nommée ; mission 11a, ADR-217) | Non | Non (limite acceptée) | Mission 12 et 12b (preuve du PIN, avec OP-N56) |
| OP-N152 | Compteur App Attest : `cashless_app` peut le faire avancer (déni de service, sans gain d'accès) ; seul `EXECUTE` nouveau accepté (décision du 18/11/2026 ; mission 11a, ADR-222) | Non | Non (limite acceptée) | Mission 12 (aucune levée demandée) |
| OP-N153 | `refund_deposit(uuid, uuid)` gardée, exécutable par personne : écart à FR-012 (décision du 18/11/2026 ; mission 11a, ADR-219) | Non | Non | Mission 13 (confirmée par le porteur le 19/11/2026 : retrait avec le remaniement du générateur et du schéma) |
| OP-N154 | Secret du PIN réutilisé dans un autre processus : non détecté (inhérent à la séparation d'OP-N76 ; mission 11a, ADR-224) | Non | Non | Mission 12b (coffre des secrets) |
| OP-N155 | `CHECK` d'IBAN `NOT VALID` (une ancienne ligne en clair ne change plus d'état) ; superutilisateurs hors de la garde d'insertion (mission 11a, ADR-224) | Non | Oui | Mission 12b (décision du porteur du 19/11/2026) : condition bloquante de passage en production ; purge ou chiffrement des lignes anciennes de `refund_request` et `payout`, puis `VALIDATE CONSTRAINT` des deux `CHECK`, avant la première donnée réelle ; statut des superutilisateurs réexaminé alors |
| OP-N156 | **LEVÉ le 19/11/2026 par renforcement** (mission 11a, décision du porteur, commit `3c112821`) : IBAN à tirets, espaces insécables, collés et `msisdn` masqués par `redact.ts` (`redact.spec.ts`) ; limites résiduelles dans la fiche (ADR-218, ADR-224) | Non | Non (levé) | Levé |
| OP-N157 | `cashless_pin` : `INSERT` sur `audit_log` non restreint aux actions `VENDOR_*` ; rôle sans mot de passe en production (mission 11a, ADR-224) | Non | Non | Mission 12b |
| OP-N158 | Session de vendeur ouverte hors de la transaction de l'API : renvoi après une API tombée compté ; `x-pin-ts` en millisecondes ; cache anti-rejeu borné à 20 000 (mission 11a, ADR-217) | Non | Non | Mission 13 |
| OP-N159 | Tests faibles et mineurs de `vendor-pin` : `23505` vers `409` non testé, route non marquée `401` ou `404`, module argon2 chargé dans l'API (mission 11a, relectures de WP06 et WP07) | Non | Non | Mission 13 |
| OP-N160 | Versements : export illisible `500` sans valeur, `canSee` montre un lot mixte en lecture, contradiction de signature de `guardDecision` tranchée par `interfaces.md` (mission 11a, ADR-220) | Non | Non | Mission 11 (écrans, pour `canSee` ; report dans `PROMPTS-A-ENVOYER.md` et `PRD.md`) |
| OP-N161 | Lots de bracelets : verrou consultatif pris avant la RLS, un prestataire peut retarder le `PATCH` d'un lot d'un autre sans accès aux données (mission 11a, ADR-216) | Non | Non | Mission 13 |
| OP-N162 | `edge-admin register` refuse `--ledger` : un script de site qui la passe casse volontairement ; 5 lignes de `commands-other.spec.ts` au lieu de 3 (mission 11a, ADR-221) | Non | Non | Sans objet (voulu) |
| OP-N163 | Identification au guichet : la règle de l'agent titulaire ne détecte ni un agent sans téléphone ni un agent au téléphone différent du numéro du compte (mission 10a, décision du porteur du 20/11/2026, ADR-227) | Non | Non | Porteur du projet (lien agent ↔ compte festivalier, écarté au specify) |
| OP-N164 | Contradiction SPECIFICATION §6.3 point 5 (« un administrateur PEUT révoquer ») contre `openapi.yaml` (révocation par deux personnes) : le contrat prime (§0.3), **LEVÉ le 23/11/2026** : `SPECIFICATION.md` §6.3 point 5 amendé sur décision du porteur pour s'aligner sur le contrat (mission 10a, ADR-227) | Non | Non | Levé (décision du porteur du 23/11/2026) |
| OP-N165 | Identification et révocation : auteur de la révocation fixé par l'API et non contrôlé par la base, client sans portefeuille d'événement refusé en `403`, plafond non rejoué sur un second portefeuille après révocation (mission 10a, ADR-226) | Non | Non | Mission 11 (écrans) pour le message ; OP-N56 (preuve signée de la personne qui décide) pour l'auteur |
| OP-N166 | Chaîne d'envoi des codes : code gardé en mémoire du processus seulement (bascule perdue au redémarrage), chaîne arrêtée sans repli ni essai noté quand le plafond de 35 s tombe avant l'étape suivante, une instabilité d'intégration vue une fois sur 50 (mission 10a, ADR-229) | Non | Non | Mission 12b (fournisseurs réels, mesure des délais) |
| OP-N167 | Commande `reissue-claim-codes` : fichier de codes en clair (orphelin si le processus est tué entre le fichier et la base, conservé si l'issue du COMMIT est incertaine), disque plein et COMMIT d'issue incertaine sans test, spec d'intégration absent de la passe parallèle (mission 10a, ADR-228) | Non | Non | Mission 13 (recette : procédure jouée sur un lot réel) |
| OP-N168 | `pending_offline_notice` : approximation assumée (tous statuts de lot comptent, dernier lot du terminal sur le grand livre du portefeuille, grands livres ORGANIZER et OPERATOR_BILLING toujours faux) (mission 10a, ADR-230) | Non | Non | Mission 13 (recette) |
| OP-N169 | Mineurs de la 10a : course `CL065` non testée, personnalisation sans test du cas d'ancien code, `seed-demo` sans version de code, version du secret globale à la base (suite en série), compteurs d'adresse remis à zéro à la rotation, lignes de plus de 100 caractères (mission 10a, ADR-231) | Non | Non | Mission 13 |
| OP-N172 | Secret des codes de rattachement : rien ne vérifie qu'un changement de `CLAIM_CODE_HMAC_KEY` s'accompagne d'une hausse de `CLAIM_CODE_HMAC_KEY_VERSION` (seule une baisse de version est refusée au démarrage) ; un secret changé sans hausse rend inutilisables les codes émis, sans message clair (revue post-fusion de la 10a, M-5 ; consigné sur décision du porteur du 23/11/2026, ADR-232 ; numéros OP-N170 et OP-N171 réservés au dossier du back-office) | Non | Non | Mission 12b (secret porté par le KMS réel) |
| OP-N173 | Rendu partiel en espèces : un `REVERSAL` d'un rendu partiel n'est pas déduit du cumul du jour (choix prudent : le seuil de la seconde personne est atteint plus vite) (mission 9c, ADR-234) | Non | Non | Mission 13 (recette) |
| OP-N174 | Rendu partiel en espèces : les espèces dues (`L-ESP-A-RENDRE`) ne sont pas rendues par ce chemin (L2) ; `refundCashDue` reste la seule voie (mission 9c, ADR-234) | Non | Non | Sans objet (voulu, C-002 : guichet de retour inchangé) |
| OP-N175 | Rendu partiel en espèces : le refus `operator.cash_partial_refund_allowed` n'a pas de message localisé propre (message de repli qui cite la règle) (mission 9c, ADR-234) | Non | Non | Mission 11 (back-office, messages d'écran) |
| OP-N176 | Rendu partiel en espèces : `422 WALLET_BLOCKED` n'est pas listé dans la description de `refundPartialCash` (code existant du catalogue, contrat gelé) (mission 9c, ADR-234) | Non | Non | Mission 12 (écran du guichet) ; description à compléter par un ajout rétrocompatible signalé au porteur |
| OP-N177 | Rendu partiel en espèces : une `refund_policy` sans `channels` est refusée (renforcement par rapport au guichet de retour) (mission 9c, ADR-234) | Non | Non | Sans objet (renforcement voulu) ; mission 13 pour confirmer en recette |
| OP-N178 | Rendu partiel en espèces : pas de contrôle explicite du mode `TOPUP_DESK`, comme le guichet de retour (la session de caisse ouverte exigée n'existe que pour ce mode) (mission 9c, ADR-234) | Non | Non | Sans objet (aligné sur le guichet de retour) |
| OP-N179 | Rendu partiel en espèces : les phases d'événement sont tenues par la matrice du moteur (`status-matrix.ts`), non par le code de l'opération : `WALLET_REFUND` `ONLINE` permis de `LIVE` à `CLOSED` non verrouillé, refusé en `DRAFT` (mission 9c, ADR-234) | Non | Non | Mission 13 (recette des phases) |
| OP-N180 | Rendu partiel en espèces : deux tests absents, « paiement suivant accepté » (US1) et `VENDOR` explicite (mission 9c, ADR-234) | Non | Non | Mission 13 |
| OP-N181 | Rendu partiel en espèces : la mutation du verrou du solde payé n'est détectée qu'environ 4 fois sur 5 (test de concurrence probabiliste) (mission 9c, ADR-234) | Non | Non | Mission 13 |
| OP-N182 | Rendu partiel en espèces : le choix de l'index partiel `journal_transaction_partial_refund_idx` n'est pas mesuré à volume réel (sur 73 lignes le planificateur prend un autre index) (mission 9c, ADR-234) | Non | Non | Mission 13 (volume de recette) |
| OP-N183 | Rendu partiel en espèces : le filtre `p.amount > 0` du cumul est défensif et n'est couvert par aucun test (sa mutation ne fait échouer aucun test) (mission 9c, ADR-234) | Non | Non | Mission 13 |
| OP-N184 | Rendu partiel en espèces : des lignes de plus de 100 caractères (reformatage à la fusion) (mission 9c, ADR-234) | Non | Non | Fusion de la mission (Prettier, décision du 14/10/2026) |

Les points sont détaillés aux sections 2 (points non bloquants), 6 (reportés) et 9 (questions de la revue n° 2). OP-N21 à OP-N37 viennent de la revue de cohérence du 30 septembre 2026 (§8) : OP-N21 à OP-N35 sont tranchés, ainsi qu'OP-N38, né de la décision OP-N28 (§5) ; OP-N36 et OP-N37 sont reportés (§6). Aucun ne bloque le code. Q1 à Q6 viennent de la revue n° 2 du 2 octobre 2026 (§9) : toutes sont tranchées (ADR-72 à ADR-77).

---

## 1. Points qui bloquent le code

Aucun depuis le 2 octobre 2026 (OP-B1 : ADR-70 ; OP-B2 : ADR-66).

## 2. Points qui ne bloquent pas le code

### OP-N3 — Casse, taxes, caution acquise, correspondance SYSCOHADA

- **Questions.** La casse est-elle légale, après quel délai, et au profit de qui ? Taux et fait générateur des taxes sur frais et commissions ? Une caution acquise est-elle taxable ? La correspondance comptable indicative est-elle juste ?
- **Recommandation.** Coder avec les hypothèses actuelles, qui sont toutes paramétrables, puis faire valider par un expert-comptable SYSCOHADA avant la production. Questions détaillées : §3 (expert-comptable ; casse aussi au juriste).
- **Casse tranchée le 2 octobre 2026** (ADR-67) : réversible pendant 5 ans après le verrouillage ; reste à confirmer par l'expert-comptable et le juriste (si la date limite suffit : `late_claim_years = 0`).
- **Défaut codé.** TVA 18 % TTC ; casse à `refund_deadline`, partagée selon le contrat, réversible 5 ans ; caution acquise sans taxe ; `account_mapping` indicatif. **Bloque la production.**

### OP-N9 — Contestations de paiement par carte

- **Question.** Qui supporte une recharge par carte contestée quand le portefeuille est déjà dépensé ?
- **Options.** A : l'organisateur. B : le prestataire. C : selon le contrat. D : selon le contrat, avec une part au commerçant.
- **Recommandation.** C, l'organisateur par défaut, avec 3-D Secure obligatoire, un plafond de recharge par carte et par jour, et une alerte quand plusieurs cartes rechargent le même portefeuille. Le contrat doit porter la partie qui supporte les contestations.
- **Statut.** **Tranché le 2 octobre 2026** (ADR-77) : option C (selon le contrat, organisateur par défaut, avec 3-D Secure, plafond par carte et par jour, alerte multi-cartes) ; contestation tardive écrite dans le grand livre verrouillé.
- **Codé.** Le portefeuille est débité jusqu'à son solde et bloqué ; le reste va au compte de pertes de la partie désignée par `contract.chargeback_bearer`.

### OP-N11 — Région d'hébergement AWS

- **Préalables.** Mesurer la latence depuis Dakar vers Paris, l'Irlande, Milan et Le Cap, sur les réseaux Orange, Free et Expresso (protocole du banc). Obtenir l'avis d'un juriste sur la localisation des données (CDP, BCEAO).
- **Critère ajouté le 1er octobre 2026.** La région retenue DOIT proposer PostgreSQL 17 sur AWS RDS (ADR-55).
- **Statut.** Provisoire le 1er octobre 2026 : Paris (`eu-west-3`), ADR-65, à confirmer après ces deux préalables. La seconde région des sauvegardes reste à choisir.
- **Défaut codé.** Région paramétrable par prestataire, sauvegardes dans une seconde région. **Bloque la production.**

### OP-N12 — Durées de conservation des données

- **Question.** Combien de temps garder les historiques des festivaliers identifiés, pays par pays ?
- **Défaut codé.** Écritures comptables : 5 ans (à confirmer) ; données personnelles anonymisées 13 mois après la dernière activité. Paramètre `rules.retention_days`. **Bloque la production.**

### OP-N13 — Algorithme de signature des snapshots

- **Question.** Ed25519 si AWS KMS le propose dans la région retenue, sinon ECDSA P-256.
- **Défaut codé.** ECDSA P-256 (`ECC_NIST_P256`) ; l'algorithme et `key_id` sont dans l'en-tête, pour changer sans rupture. L'agent vérifie la disponibilité d'Ed25519 et ouvre une PR s'il est disponible.

### OP-N41 à OP-N47 — Dettes de sécurité de la mission des bracelets (13 octobre 2026)

Règle du projet (`CLAUDE.md`, « Écarts qui affaiblissent la sécurité ») : chaque écart accepté est nommé ici, avec son
risque, sa garde, ce qui le lève et la condition de levée. Les décisions correspondantes sont dans `DECISIONS_ADR.md`
(ADR-83 à ADR-92) : OP-N41, OP-N42, OP-N43 → ADR-88 ; OP-N44 → ADR-84 ; OP-N45 → ADR-83 ;
OP-N46 → ADR-85 ; OP-N47 → ADR-87.

Missions de levée d'OP-N41, OP-N44, OP-N45 et OP-N46 (15 octobre 2026, ADR-101) : proposées par
l'agent et
**confirmées par le porteur le 15/10/2026**, en remplacement de « porteur du projet » ou «
exploitation », qui ne sont pas des missions du découpage. Raisons :
- OP-N41 → mission 7 : première mission qui a besoin d'un vrai KMS pour autre chose que les bracelets (signature des
  snapshots, vérification d'Ed25519 dans KMS, OP-N13) ; l'adaptateur AWS des quatre ports s'y écrit avec celui de la
  signature, une fois la région arrêtée (OP-N11).
- OP-N44 → mission 5 : même correction de droits d'exécution sur les fonctions du schéma de référence que celle
  d'OP-N59 (`post-roles.sql`, générateur `gen_tests.py`), déjà confiée à la mission 5 (ADR-96).
- OP-N45 → mission 13 : l'aiguillage des routes relève du déploiement ; la recette V1 monte l'environnement proche de
  la production et y passe le test de cloisonnement sur toutes les routes.
- OP-N46 → mission 12 : elle ne part qu'après la validation de la puce sur de vrais bracelets (actions 1 et 2), qui
  fournit la clé publique NXP et des signatures réelles ; elle lit `READ_SIG` à chaque passage.

| Point | Dette | Risque si elle atteint la production | Garde en place | Levée par | Condition de levée |
|---|---|---|---|---|---|
| OP-N41 | Le service de clés est un faux (`apps/api/src/kms/fake-kms.ts`) : ses clés se dérivent d'une graine écrite dans le code | Tous les mots de passe de bracelets calculables par quiconque lit le code | Le faux refuse de se construire en production et la garde de démarrage refuse un processus qui le porte (`production-guard.spec.ts`) | **Mission 12b** (déplacée de la mission 7 le 29/10/2026, ADR-138) : adaptateur AWS KMS, une fois la région et les comptes arrêtés (OP-N11) (confirmé par le porteur le 15/10/2026 ; ADR-101) | Les ports `MacPort`, `DataKeyPort`, `DecryptPort`, `KeyAdminPort` ont une implémentation AWS, avec un rôle IAM par processus (§3.2) |
| OP-N42 | L'identité du terminal est un faux qui croit des en-têtes ; aucune requête de terminal n'est signée | Quiconque se dit terminal obtient le mot de passe d'un bracelet et enregistre des lectures ; rejeu et falsification d'une lecture | Même garde de production ; le terminal annoncé est toujours relu en base (statut, prestataire) | Mission 5 (terminaux) | `DeviceIdentityPort` vérifie le jeton d'appareil, le mTLS et la signature de chaque requête ; le faux n'est plus câblé hors des tests |
| OP-N43 | L'identité du festivalier est un faux qui croit des en-têtes (routes concernées complétées par le plan de la mission 5b, 22/10/2026 : `payPaymentRequest`, `createCustomerQrToken` ; 10/11/2026 : lectures `getMe`, `listMyWallets`, `listMyWalletTransactions`, `listMyMedia`, test `customer-app/me.spec.ts`) | Rattachement d'un bracelet à solde nul par un tiers qui connaît son code ; paiement QR depuis l'app impossible en production tant que le faux reste seul | Même garde de production ; le compte annoncé est relu en base ; un bracelet approvisionné exige toujours la confirmation au guichet | Mission 10 (app festivalier) | `CustomerIdentityPort` vérifie un jeton de compte festivalier ; le faux n'est plus câblé hors des tests | **Mise à jour du 10/11/2026 :** le jeton de compte est livré (`TokenCustomerIdentity`, ADR-180). En production l'identité par jeton ne croit plus les en-têtes (`production-guard.spec.ts`) ; hors production, les en-têtes ne sont admis que sans `Authorization` (un Bearer invalide donne 401, jamais de repli). Le démarrage en production reste refusé par le faux envoyeur de codes (OP-N120). **Mise à jour du 20/11/2026 (mission 10a) :** l'identification au guichet (ADR-227) et la rotation du secret des codes (OP-N47, ADR-228) sont livrées ; il reste l'envoi réel du code (OP-N120, mission 12b).
| OP-N44 | Les rôles `cashless_tagkeys`, `cashless_perso`, `cashless_tagcheck`, `cashless_keyadmin` héritent de `PUBLIC` le droit d'exécuter les fonctions d'API du schéma de référence (même limite que `cashless_platform`, ADR-80) | Un processus des clés compromis peut appeler ces fonctions pour un prestataire dont il pose l'identifiant — ni plus ni moins que le rôle de l'API publique | Aucun droit direct sur les tables du grand livre (`tests_media_roles.sql`) ; chaque fonction commence par `assert_tenant` | **Mission 5**, avec OP-N59 : modification du générateur de la suite de référence du kit (`gen_tests.py`) (confirmé par le porteur le 15/10/2026 ; ADR-101) | La suite de référence n'exige plus `EXECUTE` pour `PUBLIC` ; les droits d'exécution sont accordés rôle par rôle |
| OP-N45 | Les routes de la mission sont servies par trois processus (`x-process` du contrat) ; rien, dans le dépôt, n'aiguille une requête vers le bon | Une route de clés exposée par erreur sur l'API publique répondrait 404 (elle n'y est pas chargée) ; le risque est une indisponibilité, pas une fuite | Test d'isolation : chaque opération n'est servie que par son processus | **Mission 13** (recette V1) : aiguillage décrit et vérifié sur l'environnement de recette (confirmé par le porteur le 15/10/2026 ; ADR-101) | L'aiguillage par chemin est décrit et déployé ; `POST /media/auth-keys` et `/media-personalizations` n'atteignent que leur processus |
| OP-N46 | À la personnalisation, la signature d'originalité NXP est vérifiée par le poste, pas par le serveur, qui n'en garde que l'empreinte (comparée à chaque lecture) | Un poste compromis enregistre une puce contrefaite comme authentique | Rôle `PERSONALIZER` dédié ; toute personnalisation est tracée avec son auteur | **Mission 12** (app terminal), avec l'auditeur sécurité (ADR-44) (confirmé par le porteur le 15/10/2026 ; ADR-101) | Le kit fournit la clé publique NXP et des vecteurs de signature, et le serveur vérifie lui aussi |
| OP-N47 | Changer `CLAIM_CODE_HMAC_KEY` invalide toutes les empreintes de codes existantes ; aucune procédure de rotation | Une fuite de ce secret ne se répare qu'en réimprimant les codes | Le secret est hors de la base, obligatoire en production, 32 octets au moins | **Mission 10** (app festivalier) : proposée par l'agent le 16/10/2026, **à confirmer par le porteur** (ADR-104) ; elle reprend les flux qui lisent ces empreintes (rattachement, code de confirmation, consultation anonyme) | **Ancienne condition, écartée par la décision du porteur du 20/11/2026 :** une procédure de rotation (double empreinte pendant une période) est écrite et testée : un code émis sous l'ancien secret se rattache pendant la période, plus après. **LEVÉ le 20/11/2026 par la mission 10a, par une rotation immédiate (aucune période de double empreinte).** Mécanisme réel : `CLAIM_CODE_HMAC_KEY_VERSION` ; colonnes `media.claim_key_version`, `claim_code.key_version`, `media_claim.key_version` et signatures versionnées (migration `0097`) ; une empreinte d'une autre version compte comme absente ; démarrage de l'API refusé si la version est inférieure à `claim_key_version_max()` ; `reissue_claim_codes` et `reissuable_media` ; rôle `cashless_claimadmin` (`post-roles.sql` §14) ; commande `apps/api/src/cli/reissue-claim-codes.ts` ; procédure `docs/procedure-rotation-codes-rattachement.md`. **Test de levée :** `apps/api/test/integration/media/claim-rotation.spec.ts` (ancien code refusé comme inconnu, NFR-002), `apps/api/test/integration/cli/reissue-claim-codes.spec.ts` (« SC-003 »), `packages/ledger-sql/tests/tests_claim_key_version.sql`. **Test de borne inversé :** un ancien code ne se rattache plus après la rotation (l'ancienne condition exigeait qu'il se rattache pendant la période) ; ces mêmes tests échouent si une période de double empreinte réapparaît. **Mutations :** voir ADR-228 et `docs/passation-10a/preuves.md` (FR-007, FR-008). Limites : OP-N167 |
| OP-N81 | Les PSP et le coffre des secrets sont des faux (un par fournisseur, `apps/api/src/psp/`) : un faux PSP produit des notifications signées avec des secrets de test | Crédits de portefeuille fabriqués par quiconque connaît le faux ; secrets de test au lieu de secrets par détenteur des fonds | Chaque faux porte `isFake` ; `assertProcessIsSafe` refuse le démarrage en production (processus public et `psp-poller`), test `production-guard.spec.ts` | Mission « Adaptateurs PSP réels » | Adaptateurs essayés contre le bac à sable de chaque PSP, coffre AWS réel, faux retirés de la production (ADR-131) |
| OP-N83 | CORRIGÉ en cycle 2 de WP14 (migration `0042`) : `wallet.other_block` tenu par le déclencheur `wallet_block_cause_guard` ; le déblocage « contestation » refuse (CL029) dès qu'une autre cause est active, quel que soit l'ordre | Un chemin de blocage qui écrirait `ACTIVE` lui-même lève aussi la contestation (comportement voulu : une personne habilitée de l'autre cause) | `unblock_wallet` refuse si `other_block` ; `block_wallet_after_chargeback` ne marque pas si `other_block` ; `tests_psp_topups.sql` (perte puis contestation, contestation puis perte, cause tierce puis deux contestations) ; `wallet-unblock.spec.ts` | Mission 13 (revue) | Un futur chemin de blocage (perte, fraude) à relire : il doit écrire `BLOCKED` sans annoncer l'origine « contestation » |
| OP-N84 | LEVÉ le 29/10/2026 (WP14 cycle 2, décision du porteur) : `take_deposit(uuid,uuid)`, `refund_deposit(uuid,uuid)`, `refund_cash_due(...)` retirées de `post-roles.sql` (section 4) ; le moteur passe par `take_deposit_for_session`, `refund_deposit_for_session`, `refund_cash_due_for_session` et, sans compte désigné (mode `FROM_BALANCE`), par `take_deposit_from_balance` / `refund_deposit_from_balance` (0041) | Aucun : droit plus étroit que celui retiré | `tests_cash_psp_rights.sql` (`[A8-DETTE levée]` : EXECUTE refusé), `tests_execute_grants.sql`, `engine.spec.ts` (compte désigné refusé) | Levé | Aucune ; fonctions à faire relire par une personne |
| OP-N85 | Reprise de la caution due : faite à l'écriture d'un crédit suivant, jamais seule | Un bracelet crédité sans sa caution due prise tant qu'aucun autre crédit n'arrive | Le travailleur de reprise (WP12) rejoue l'événement ; la caution est idempotente | Mission 13 (recette V1) | Reprise des cautions `DUE` par le travailleur, avec un test qui tue le processus entre COMMIT et `afterCommit` |
| OP-N86 | `psp_poll_candidates` et `psp_events_to_retry` (toutes les recharges et notifications, tous prestataires) exécutables par `cashless_app` ; `psp-poller` sous `cashless_app` ; INSERT direct sur `anomaly` | Le processus public, si compromis, lit les recharges et notifications de tous les prestataires et écrit des anomalies arbitraires | `tests_cash_psp_rights.sql` (liste exacte des rôles qui exécutent les deux fonctions ; liste exacte des rôles ayant INSERT sur `anomaly`) | Mission 13 | Rôle dédié au `psp-poller` ; les deux fonctions et l'INSERT sur `anomaly` retirés à `cashless_app`, remplacés par une fonction de la base ; tests de borne inversés |
| OP-N87 | Garde « aucune espèce sans session » (`posting_cash_desk_guard`, 0036) : `IF NOT FOUND THEN RETURN NEW` si la lecture de `cash_desk` ne voit rien | Propriétaire de la fonction soumis à la RLS : la garde laisse passer une écriture en espèces sans session | `tests_cash_psp_rights.sql` (le propriétaire de la fonction est superutilisateur ou BYPASSRLS) | Mission 13 | Rôle propriétaire vérifié au déploiement, ou garde qui refuse quand la recherche est impossible ; fichier à faire relire par une personne |
| OP-N88 | Lecture des soldes avant `post_transaction` : `PURCHASE` sans verrou ; `CHARGEBACK` verrouillé par `wallet_topup_headroom` | Paiement par bracelet refusé à tort (« Solde interdit ») quand une dépense simultanée du même portefeuille passe entre la lecture et l'écriture ; interblocage possible, faible, pour la contestation (RETRY) | `chargeback-concurrency.spec.ts` (cas déterministe : contestation aboutie malgré une dépense validée entre lecture et écriture) ; aucun test pour `PURCHASE` | Mission 13 | Fonction SQL dédiée de verrouillage ordonné, test déterministe pour `PURCHASE` |
| OP-N89 | `SignPort` et `DataKeyPort` du processus des snapshots en faux (mission 7) | Snapshots signés par une clé dérivée d'une graine du code : faux snapshots acceptés par les terminaux | Faux refusé au démarrage en production (`createKms`, `assertProcessIsSafe`) ; `403 OFFLINE_NOT_ALLOWED` sans clé `ACTIVE` | Mission 12b | Adaptateur AWS KMS (`kms:Sign`, `GenerateDataKey`, `Decrypt`), rôle IAM par processus, garde levée pour ces ports seulement |
| OP-N90 | Numéro de lot laissé sans résultat final (`offline_batch_retry`) | Numéro jamais renvoyé : vente non écrite sans trou `SEQ_GAP` | Trace écrite par la base dans la transaction de l'opération ; clôture du lot refusée sans elle ; alerte à 24 h | Mission 13 (revue) | Aucune trace ouverte de plus de 24 h en recette ; test de borne inchangé |
| OP-N91 | Lecture inter-prestataires des imports en cours par `cashless_app` ; deux `EXECUTE` de plus pour le signataire | Fuite de l'existence d'un import d'un autre prestataire si l'API était compromise ; signataire qui jette un brouillon valide | Fonction qui ne rend que `(import_id, operator_id)` ; traitement ensuite sous RLS ; jeter n'efface rien de publié et le brouillon est reconstruit | Mission 13 (revue) | Listes d'`EXECUTE` figées inchangées ; colonnes rendues inchangées |
| OP-N100 | Clés de la passerelle (stockage matériel, autorité des passerelles) simulées par des faux jusqu'à la mission 12b ; la passerelle n'est pas utilisable en production avant | Faux de développement des ports `HARDWARE_KEYSTORE` et `EDGE_CA` : clé de signature et clé d'accord lisibles sur le disque ou en mémoire | Faux refusé au démarrage en production, un test par faux (`NestFactory` réel) | Mission 12b | Adaptateurs réels essayés ; faux retirés ; preuves NFR-009 refaites |
| OP-N101 | Jetons d'appareil de la passerelle signés par une clé propre, valables sur elle seule | Secret de signature de jetons sur un mini-PC de site, hors du KMS central | Jeton refusé au central (`kid`, `aud`) ; clé qui ne signe que l'audience de la passerelle | Mission 12b | Clé dans un module matériel non exportable ; rotation de `kid` éprouvée |
| OP-N102 | Renouvellement du jeton d'appareil sans rotation du jeton de rafraîchissement sur la passerelle | Pendant `EDGE`, un jeton de rafraîchissement volé n'est pas détecté ; empreintes de jetons de rafraîchissement stockées sur le site | Empreinte vérifiée avec le certificat et la preuve de possession ; aucun nouveau jeton de rafraîchissement ; rotation forcée au retour | À fixer par le porteur | Renouvellement avec rotation et canal d'inscription du nouveau jeton au central |
| OP-N103 | Jeton de personne expiré toléré au guichet de la passerelle, 12 h après la bascule, avec `exp >= activated_at` ajouté | Compte révoqué pendant la coupure qui agit jusqu'à 12 h ; horloge reculée pendant un arrêt | Un test par condition de la tolérance ; refus à 12 h + 1 s ; audit versé au central | À fixer par le porteur | Jeton de coupure délivré par le central à l'ouverture de session |
| OP-N104 | Ventes `EDGE_ONLINE` sans signature du terminal : perte maximale `min(soldes ; T × H × plafond horaire ; passages réels × plafond par vente)`, valeurs des plafonds à soumettre | Passerelle compromise qui rejoue de vraies lectures de bracelet sous les plafonds | Preuve du bracelet, plafonds, rognage au solde central, alerte ; scénario de passerelle hostile | Mission 13 (recette V1) | Signature du terminal relayée, ou plafonds validés et mesurés |
| OP-N105 | Inscription d'une passerelle par une seule personne, alerte et délai avant les mots de passe | Une personne inscrit une passerelle à sa clé d'accord et obtient les mots de passe de l'événement | Alerte immédiate ; délai ; rien pour une `STANDBY` non promue | Mission 12b ou 13 | Approbation à deux à l'inscription |
| OP-N106 | Purge des secrets du site : mini-PC volé avant la purge | Machine volée avant la clôture ou avant l'ordre de purge : secrets lisibles | Purge automatique à la clôture et manuelle à deux ; test de canari sous toutes ses représentations | Mission 12b | Données au repos chiffrées sous une clé matérielle détruite à la révocation |
| OP-N107 | Passerelle perdue : pas de rejeu automatique des activations et cautions, anomalie `EDGE_REPLAY_FAILED`, résolution à deux | Activations et cautions non reversées après reprise forcée, rétablissement manuel | Anomalie sur toute référence inconnue ; opérations rejouées reconnues par la clé du terminal | Mission 13 (recette V1) | Procédure de rétablissement éprouvée |
| OP-N108 | Recharge espèces au rejeu : dépassement temporaire d'un plafond réglementaire, à signaler au juriste | Solde local au-dessus d'un plafond réglementaire entre la recharge locale et son rejeu | Jamais de rejet pour un plafond : deux parts, anomalie `CASH_TOPUP_OVER_LIMIT` | Mission 13 (recette V1) | Avis écrit du juriste |
| OP-N109 | « Même moteur » (SPECIFICATION §9) devient « mêmes modules » : base locale à schéma réduit | Deux implémentations de calcul si le paquet partagé est contourné ; texte de la spécification en retard | Test d'architecture de `shared-rules` ; mêmes scénarios de référence | Mission 13 (recette V1) | Texte de §9 aligné |
| OP-N110 | `STALE` persisté seulement si l'époque est confirmée ou plausible (au plus +2) ; levée locale à deux | Une époque forgée à `epoch + 1` ou `+ 2` arrête les débits jusqu'à la levée locale (disponibilité) | En-tête forgé à 9999 sans arrêt ; levée à deux personnes distinctes auditée | Mission 13 (recette V1) | Époque signée par le central dans la requête, ou canal de contrôle toujours disponible |
| OP-N111 | Base locale de la passerelle : le rôle unique `edge_app` peut couper les déclencheurs ou supprimer les tables d'autorité, de file et d'audit | Un code compromis ou un accès au rôle sur le mini-PC efface l'audit ou fausse l'époque d'autorité sans trace locale | Déclencheur `BEFORE TRUNCATE` (TRUNCATE refusé, testé) ; test qui liste les droits DDL d'`edge_app` et échoue si un autre rôle les reçoit | Mission 13 (recette V1) | Propriétaire des migrations distinct du rôle d'exécution, sans droit DDL |
| OP-N112 | Ordres à deux personnes : une même personne détenant les deux clés de site n'est pas détectable | Levée locale de `STALE` ou purge faite par une seule personne | Outil d'enrôlement : deux titulaires nominatifs distincts exigés ; procédure d'exploitation | Porteur | Clés sur supports personnels avec identification forte, hors mission 8 |
| OP-N113 | Clé TLS client de la passerelle vers le central en fichier, jusqu'à la mission 12b | Une copie du disque du mini-PC permet d'usurper la passerelle auprès du central jusqu'à la révocation de son certificat | Démarrage refusé si le fichier ou son répertoire sont plus larges que 0600 ou si c'est un lien symbolique ; clé distincte de la clé `batch` ; jamais journalisée | Mission 12b | Poignée de main signée par le composant matériel (fournisseur OpenSSL/PKCS#11 ou proxy mTLS) ; fichier refusé |
| OP-N114 | Retour de l'autorité au central : une seconde demande `CENTRAL` à autre clé abandonne le rendu en cours | Un double clic ou un `OPERATOR_ADMIN` malveillant arrête le retour (disponibilité ; le grand livre reste `EDGE`, aucune double dépense) | Abandon audité ; réservé à `OPERATOR_ADMIN` ; test du comportement | Back-office (hors mission) | Confirmation explicite côté interface, ou champ dédié au contrat |
| OP-N115 | Travailleur des colis de mots de passe (WP15) : `edge_media_to_pack` rend au plus 200 bracelets par page, sans curseur ; les bracelets illisibles sont écartés et journalisés une fois, mais une page de 200 illisibles arrête le service de la passerelle | Bracelets lisibles au-delà de ces 200 jamais servis à la passerelle (disponibilité : ventes refusées sur ces bracelets en mode `EDGE`), sans alerte du colis manqué | Message de journal « page entièrement illisible » ; bracelet illisible = défaut de personnalisation, rare | Mission 12b | Curseur dans `edge_media_to_pack` (migration correctrice) et alerte au central ; test d'une page de 200 illisibles suivie de bracelets lisibles |
| OP-N116 | **LEVÉ le 19/11/2026 (mission 11a)** : Outil d'inscription des passerelles (WP15) : `register --ledger` n'est pas vérifié contre l'événement (aucune fonction de lecture pour `cashless_edgeadmin`) | Grand livre erroné écrit dans le fichier d'enrôlement : la passerelle ne se synchronise pas (disponibilité, aucune fuite) | Échec visible à la première synchronisation ; procédure de site | Mission 11a | Contrôle du grand livre par l'outil (lecture étroite) ou grand livre rendu par l'inscription |
| OP-N117 | LEVÉ le 11/11/2026 (WP25 partie A) : reprise forcée (WP14, R-23) : seule la borne basse de la période de reprise est contrôlée ; une `ONLINE_REF` inconnue postérieure à la fin de la reprise ouvre aussi une anomalie `EDGE_REPLAY_FAILED` | Bruit d'anomalies à résoudre à deux (aucune perte, aucune écriture comptable) | Borne haute `completed_at` + 120 s contrôlée (`forced-takeover.ts`) ; test `apps/api/test/integration/edge/journal/online-ref-unknown.spec.ts` | Levé | Aucune |
| OP-N118 | Purge des secrets de la passerelle (WP24) : (1) le WAL de PostgreSQL et les blocs libres du disque ne sont pas effacés ; (2) les tables d'ajout seul (audit local, ordres locaux) ne sont pas vidées ; (3) la purge n'est pas dans la même transaction que la file des décisions | Copie du disque après la purge : secrets ou données lisibles dans le WAL ou les blocs libres si le disque n'est pas chiffré ; données d'audit locales conservées ; arrêt entre la file et la purge : purge partielle à reprendre | Disque chiffré exigé par la procédure de site ; canari de purge sur les tables ; purge manuelle versée au central avant destruction (décision 48) | Mission 12b | Données au repos chiffrées sous une clé matérielle détruite à la révocation (même levée qu'OP-N106) ; purge reprise au démarrage si interrompue |
| OP-N119 | LEVÉ le 11/11/2026 (WP25 partie A) : purge manuelle (WP24, décision 48) : `/edge/sync-batches` exige au moins une opération et la purge exige une file vide ; l'ordre de purge ne peut pas partir seul, la passerelle purge après 30 s sans accusé avec la trace `CENTRAL_UNCONFIRMED` | Ordre de purge jamais vu du central si l'audit local est perdu avec le disque ; versé sinon avec le premier lot suivant | Lot sans opération portant des `local_orders` accepté sous `/edge/*` (`0069`, `edge-0009`) ; avec lien, purge seulement après l'accusé ; tests `sync-empty-batch.spec.ts`, `orders-only.spec.ts`, `purge-with-link.spec.ts` | Levé | Aucune ; trace `CENTRAL_UNCONFIRMED` gardée pour la purge sans lien |
| OP-N122 | Ventes relayées par la passerelle : le central croit `pack_verified` sans pouvoir le vérifier | Passerelle compromise qui affirme `pack_verified: true` sans avoir lu le bracelet ; perte bornée par les plafonds de rejeu | `pack_verified` repris seulement pour une opération de la voie `/edge/*` et seulement s'il vaut `true` ; plafonds d'ADR-159 ; test `sync-pack-verified-bound.spec.ts` | Mission 12b | Preuve signée du terminal relayée et vérifiée par le central (même levée qu'OP-N104) |
| OP-N124 | Code du titulaire consommé avant l'écriture de sa décision | Décision perdue (panne, `409`) : pas de nouvel essai avec ce code ; un `BLOCK` perdu laisse la demande passer `REQUESTED` à l'échéance (jamais payée sans deux administrateurs) | Circuit à deux ; test `journey-limits.spec.ts` (OP-N124) | Mission 9b (confirmé par le porteur le 16/11/2026) | Consommation et décision dans une même transaction, essais faux comptés à part |
| OP-N125 | Quota de codes (3 par 15 min) et blocage de 30 min communs à tous les usages ; alerte de `BLOCK` = une ligne d'audit | Un tiers épuise le quota d'un numéro : `429` à la création ou titulaire sans code (disponibilité) ; `BLOCK` sans alerte livrée | Limite par numéro ; test `journey-limits.spec.ts` (OP-N125) | Mission 12b (confirmé par le porteur le 16/11/2026) | Quotas séparés par usage ; alerte livrée à une personne du prestataire |
| OP-N126 | Une seule personne habilitée, étrangère au remboursement, recrédite un `FAILED` | Recrédit sans échec réel du paiement (double versement), visible seulement au rapprochement | `FAILED` refusé au proposant et à l'exécutant ; audit ; test `journey-limits.spec.ts` (OP-N126) | Mission 9b (à confirmer par le porteur) | Rapprochement avec les relevés Wave/Orange Money, ou second valideur au contrat |
| OP-N128 | Guichet enchaîné : `approved_by` nul sur `DEPOSIT_REFUNDED` seule ; cumul lu sous le verrou du bracelet | Trace de la seconde personne moins directe ; dépassement rare du seuil cumulé par un événement concurrent, borné par `refund_cash_due` | Jeton d'approbation dans l'audit ; test `journey.spec.ts` (OP-N128 (a)) | Mission 9b (confirmé par le porteur le 16/11/2026) | `approved_by` porté par l'écriture ; cumul relu sous verrou du portefeuille |
| OP-N130 | Ordre des états d'une demande de remboursement gardé par l'API seule (`UPDATE` des colonnes de transition accordé à `cashless_app`) | Un défaut de l'API ou un accès au rôle ramène une demande `PAID`/`FAILED` à `REQUESTED` ou change son montant après approbation : seconde approbation possible, bornée par le solde payé restant du grand livre (pas de découvert) | Droits par colonne (identité de la demande non modifiable), CHECK jumelés, une demande ouverte par portefeuille, contrôle à deux de chaque `WALLET_REFUND` ; test `tests_refund_requests.sql` (liste exacte des colonnes modifiables : échoue si elle s'élargit) | Mission 9b | Déclencheur de base qui refuse toute transition hors du graphe de `data-model.md` (et `estimated_amount`/`fee` figés après `REQUESTED`) |
| OP-N131 | Copie externe des scellements simulée (`FakeSealCopy`) | Une compromission de la base permet de réécrire un scellement et sa copie ensemble : la chaîne d'audit n'est pas défendue contre un administrateur de la base | Le faux refuse le démarrage en production ; la vérification quotidienne contrôle la chaîne locale | `unit/production-guard.spec.ts` (« faux de la copie externe des scellements »), `integration/maintenance/process-guard.spec.ts`, `invariants-cloture/consignation.spec.ts` | Mission 12b | Copie réelle vers un stockage à verrou d'objet sous un compte distinct |
| OP-N132 | Alertes d'exploitation sans envoi à une personne | Une alerte (somme non nulle, scellement, versement vieilli, transaction longue) n'atteint personne sans lecteur du journal ou de `ops_alert` | Une alerte = une ligne d'audit `OPS_ALERT`, `pg_notify`, journal `ALERT` écrit avant la base ; dédoublonnage 1 h | `integration/controls/controls-alerts.spec.ts` ; `invariants-cloture/consignation.spec.ts` (aucun envoi dans le code des alertes : échoue aussi à la levée, à mettre à jour) | Mission 12b | Notificateur réel branché sur `ops_alert` |
| OP-N133 | `ops_*` : le propriétaire des fonctions doit être superutilisateur ou `BYPASSRLS` ; sans `pg_read_all_stats`, `ops_long_transactions` rend la ligne `?config` | Propriétaire ordinaire : chaîne d'audit de la plateforme invisible, `ops_ledgers_to_seal` en échec ; sans le droit de lecture : alerte de configuration 11 | Test de droits par rôle ; alerte de configuration | `tests_9b_rights.sql` (liste des droits, ligne `?config`), `tests_ops_functions.sql` | Mission 12b (lecture prestataire par prestataire) | `GRANT pg_read_all_stats` au propriétaire dans la procédure de déploiement ; fonctions par prestataire |
| OP-N134 | `closing_balance` déclaré jamais recoupé avec la somme des lignes importées | Un solde faux avec des lignes justes rend un compte « rapproché » si le solde du grand livre concorde | L'écran montre lignes et solde ; rapproché = lignes toutes rapprochées ET solde = grand livre | `tests_statements.sql` | À proposer au porteur | Contrôle somme des lignes = variation de solde entre deux relevés |
| OP-N135 | Une transaction rapprochée par plusieurs lignes d'un même compte | Règlement PSP en plusieurs virements : la somme des lignes peut dépasser le montant de la transaction sans refus | Rapprochement automatique seulement si le net ou le brut égale la ligne ; manuel libre | `tests_statements.sql` §3b, §3c, `match-statement-line.spec.ts` | À proposer au porteur | Règle « somme des lignes rapprochées <= montant de la transaction sur ce compte » |
| OP-N136 | `explained_by_anomalies` absent du contrat ; deux lignes sur la même anomalie | Un écart peut paraître expliqué deux fois | `explained_by_anomalies` additionne les deux ; rapproché seulement si le solde concorde | `reconciliation-state.spec.ts` (OP-N82) | À proposer au porteur | Une ligne par anomalie, ou champ exposé au contrat |
| OP-N137 | **LEVÉ le 19/11/2026 (mission 11a)** : Mineurs de la relecture de WP08 (liste en détail) | Nuisance (demande `FAILED`), absence d'audit sur un rejeu identique | Aucune écriture dans ces cas | `payouts/payout-batch.spec.ts`, `payout-confirm.spec.ts` | Mission 11a | Voir détail |
| OP-N138 | Réclamation tardive en `CASH` inatteignable sur un grand livre `LOCKED` | Un remboursement tardif en espèces est refusé `422 REFUND_NOT_ALLOWED` quand aucune session de caisse n'est ouverte ; `LEGAL` non exprimable | Règle voulue : session de caisse ouverte par l'auteur exigée | `late-claims/money-account.spec.ts` (« CASH sans session de caisse ouverte par l'auteur ») | — (règle voulue, consignée) | Sans objet |
| OP-N139 | Remboursement tardif en mobile money vers un autre numéro, sans code de vérification | Un remboursement tardif part vers un numéro que le festivalier n'a pas vérifié | Réclamation à deux personnes, preuve (`proof`), bornes de `check_late_claim`, destination absente de l'audit | `late-claims/late-claim.spec.ts` (« deux personnes : l'auteur ne valide pas sa demande ») ; `consignation.spec.ts` | Mission 12b (code envoyé au nouveau numéro) | Code à usage unique au numéro de destination |
| OP-N140 | **LEVÉ le 19/11/2026 (mission 11a)** : IBAN non masqué par `redact.ts` ; IBAN en clair dans `refund_request.iban` | Un journal de corps de requête ou une lecture directe de la table exposerait l'IBAN | Aucun journal de corps aujourd'hui ; audit et `approval_request` exposé masquent l'IBAN (`maskPaymentData`) | `late-claims/late-claim.spec.ts` (FR-024), `payouts/payout-export.spec.ts` | Mission 11a | Masque dans `redact.ts` avant tout journal de corps ; chiffrement au repos |
| OP-N141 | **LEVÉ le 18/11/2026 (mission 11a)** : Écart explicite de la régularisation `OPERATOR_FEE` non plafonné | Une valeur interne fausse écrirait un écart trop grand ; l'écart est fixé par le seul calculateur | Étape à deux niveaux (aperçu = écriture), `requirePositive` | `closing/closing-variants.spec.ts`, tests des constructeurs | Mission 11a | Plafond = frais bruts |
| OP-N142 | Relevés et export comptable : pagination multi-grands livres, relevé et CSV non tracés, double compte possible de l'export | Une écriture validée tard manquée entre deux pages (théorique) ; lecture du relevé non tracée ; un consommateur qui additionne les deux comptes légaux d'une écriture compte deux fois | Pagination par numéro d'écriture ; chaque écriture porte ses deux comptes (`sens`) | `statements/accounting-export.spec.ts`, `party-statement.spec.ts` | À proposer au porteur | Pagination stable, traçage de la lecture, note aux équipes clientes sur le double compte |
| OP-N143 | `closing_balance` non servi dans le relevé JSON | Le champ facultatif du `PartyStatement` manque ; le CSV porte le solde courant | Somme O(n) évitée (p95 2,2 s sans index couvrant) ; NFR-004 tenu sans lui | `statements/party-statement.spec.ts`, `statement-latency.spec.ts` | Mission ultérieure, à proposer au porteur | Index `posting(account_id) INCLUDE (amount)` |
| OP-N144 | Recrédit d'un `FAILED` sans voie de contournement quand une ligne de relevé est rapprochée | Une ligne rapprochée à tort bloque le recrédit ; aucun second valideur ne peut le débloquer | `409`, aucune écriture, la demande reste confirmable `PAID` | `refunds/failed-recredit-bound.spec.ts` ; `invariants-cloture/concurrency.spec.ts` (décision 14) | À proposer au porteur | Défaire un rapprochement à deux personnes (pas en 9b) |
| OP-N145 | **LEVÉ le 19/11/2026 (mission 11a)** : `refund_request` : `INSERT` direct en `PAID` possible sous les CHECK ; anciennes signatures de `refund_deposit` conservées | Un défaut du rôle applicatif écrirait une demande déjà `PAID` sans passer par les deux personnes | `INSERT` réservé à `cashless_app` (droits de table et de colonne), aucun `DELETE`, `UPDATE` borné aux colonnes de transition | `invariants-cloture/limits-9b.spec.ts` (`has_column_privilege` par rôle `cashless_*` et par colonne ; mutation `GRANT INSERT (status)` : échoue) | Mission 11a | Garde d'insertion et retrait des anciennes signatures |
| OP-N146 | Renforcements de la mission 9b, faits puis consignés | Aucun : aucun n'affaiblit la sécurité | Liste dans la fiche (ADR-200 à ADR-203, ADR-205, ADR-206, ADR-209) | Voir la fiche | — (clos) | Sans objet |
| OP-N147 | LEVÉ le 17/11/2026 : numéro de paiement en clair dans le résultat d'une approbation `WALLET_REFUND` | Numéro de mobile money lisible dans `GET /approval-requests` et l'audit (FR-024) | `approvalRequestDto` masque `result` (`maskPaymentData`) | `invariants-cloture/payment-data-exposure.spec.ts` (ADR-211) | Levé | Sans objet |
| OP-N148 | Ligne de relevé importée après le recrédit d'un `FAILED` reste « non rapprochée » ; pas d'alerte dédiée | Un paiement réellement parti, vu à la banque après le recrédit, n'est signalé que par l'alerte générique `statement-unmatched` (double versement possible, non expliqué) | Le recrédit est refusé si la ligne est déjà rapprochée (verrou, ADR-203) ; alerte générique | `tests_statements.sql` (section 4b : ligne laissée non rapprochée) | Mission 12b (alertes) | Alerte dédiée « paiement vu à la banque après recrédit » |
| OP-N149 | Aucun balayage d'isolation entre organisateurs d'un même prestataire pour les 20 opérations de la 9b | Trou dans la preuve (pas un défaut constaté) : une mutation qui retire un contrôle applicatif reste verte | Isolation entre prestataires prouvée (RLS) | `invariants-cloture/isolation-9b.spec.ts` (prestataires seulement) | Mission 13 | Balayage des 20 opérations avec deux organisateurs du même prestataire, et mutation qui le fait échouer |

**Levés le 21/10/2026 par la mission 5a (identite-enrolement-terminaux).**
- **OP-N42** : `DeviceIdentityPort` vérifie ensemble le jeton d'appareil lié, le certificat client (mTLS) et la
  signature de chaque requête (ADR-107) ; le faux n'est plus câblé hors des tests (`DEVICE_IDENTITY_FAKE=1`, refusé en
  production). Tests : `apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts` (chaque route de terminal du
  contrat, refusée pour chaque preuve absente, fausse, expirée, d'un autre terminal, rejouée ou d'une autre autorité),
  `apps/api/test/unit/production-guard.spec.ts` (« terminal : identité réelle par défaut… »),
  `device-latency.spec.ts` (garde de production, un test par faux). L'autorité des terminaux et le signataire des
  jetons restent des faux, refusés en production : dette OP-N73 (mission 7).
- **OP-N44** : `post-roles.sql` retire `EXECUTE` à `PUBLIC` et l'accorde rôle par rôle ; la suite de référence
  (`gen_tests.py`) ne l'exige plus pour `PUBLIC`. Test : `packages/ledger-sql/tests/tests_execute_grants.sql` (listes
  figées par rôle, refus à l'appel). Limite résiduelle séparée : OP-N68 (ADR-111).

### OP-N48 — Fichier de commande des codes de rattachement perdu en route (13 octobre 2026)

Le fichier de commande d'un lot (`issueClaimCodeOrder`) n'est remis qu'une fois et n'est conservé nulle part : c'est
voulu (ADR-56, NFR-002). Conséquence : si la réponse se perd après la validation en base (coupure réseau, navigateur
fermé), les codes du lot existent sous forme d'empreintes mais plus personne ne les connaît, et aucune route ne permet
d'en tirer d'autres. Sortie actuelle : clore le lot (ses codes jamais associés sont invalidés) et en commander un
nouveau. Le porteur a laissé le choix à l'agent (13 octobre 2026) : **pas de route de nouvelle émission dans cette mission** ;
la sortie reste de clore le lot et d'en commander un autre. À revoir si le cas se présente en exploitation (une
nouvelle émission, permise tant qu'aucun code du lot n'est associé à une puce, ne conserverait toujours rien).
Limites posées dans le même lot, à confirmer : import du fichier de l'imprimeur par envois de 10 000 lignes et 1 Mo
au plus.

### OP-N49 — Caution en espèces et espèces dues : pas de caisse avant la mission des caisses (13 octobre 2026)

Une caution payée à part en espèces, et le rendu des espèces dues, s'écrivent sur le compte de caisse du terminal
(`A-CAISSE-<n° de série>`). Ces comptes et leurs sessions (ouverture, comptage, fermeture) sont livrés par la mission
« Recharges, caisses et PSP ». **Décision du porteur n° 10 (13 octobre 2026, option A)** : la mission des bracelets
ne crée aucun compte de caisse. Les routes sont livrées et testées (compte posé par les tests) ; en usage réel elles
répondent `409` « aucune caisse ouverte pour ce terminal » tant que la mission des caisses n'a pas ouvert le compte.
Aucun argent liquide n'entre donc sans session de caisse. À la charge de la mission des caisses : créer le compte à
l'ouverture d'une session, sous ce code, ou adapter la recherche du compte (`counter-access.ts`). Décision : ADR-89.

**Levé le 29/10/2026 par la mission 6 (lots WP02 et WP09).** Une session de caisse (migration `0036_cash_sessions.sql`)
crée `A-CAISSE-<série>` à la première ouverture et la base refuse toute écriture sur une caisse sans session ouverte ;
`takeDeposit`, `refundDeposit`, `refundCashDue`, `releaseMedia` et `createCashTopup` répondent `409` sans session et
servent `cash_session_id`. Preuves : `tests_cash_sessions.sql`, `deposit.spec.ts`, `cash-due.spec.ts`,
`release.spec.ts`, `cash-desk-guard.spec.ts`, cas `SC-002 : OP-N49 levé` (étape 2 de `topup-journey.spec.ts`).

### OP-N50 — Rattachement par code : trois décisions et une limite (14 octobre 2026)

Décisions du porteur prises pendant le lot 17 (rattachement par code imprimé), consignées dans l'ADR-90 :

- **n° 11 — Consultation anonyme réduite** : `lookupBalanceByClaimCode` ne rend que ce que rend
  `public_balance_lookup` (devise, solde disponible, statut, et pour chacun des 10 derniers mouvements : date, type,
  montant). Le contrat demandait aussi la répartition payé/offert et l'identifiant, la source et le libellé de chaque
  écriture ; il est réduit (`openapi.yaml`). Renforcement : moins de données sur une route sans authentification.
- **n° 12 — Lecture consommée par la demande confirmée** (migration 0016) : `consume_tap` exige une écriture
  comptable et un rattachement n'en fait aucune. `consume_tap_for_claim` lie la lecture à la demande : une lecture
  récente, du bracelet de la demande, jamais déjà consommée, ne confirme qu'une demande.
  **Limite** : `consume_tap` (schéma de référence, non modifiable) ignore ce lien ; une lecture qui a confirmé une
  demande peut encore servir à une écriture pendant la fenêtre de l'événement (120 s par défaut). Risque faible :
  une même présentation du bracelet sert à un rattachement puis à une opération du même bracelet. Test qui échoue si
  la limite s'élargit : `tests/tests_media_claim_tap.sql`. **Levée par la mission 5** (confirmé par le porteur le
  15/10/2026 ; ADR-101) : c'est elle qui sert le paiement par `register_tap`,
  `post_transaction` et `consume_tap` et touche donc ce chemin. **Condition de levée** : `consume_tap` refuse une
  lecture liée à une demande de rattachement (migration, ou évolution du schéma de référence par son générateur) ;
  test pgTAP : lecture qui a confirmé une demande refusée par `consume_tap`. Fichier SQL à faire relire par une
  personne.
- **n° 13 — Activation depuis l'app (`SELF_APP`)** : un code valide d'un bracelet jamais activé l'active sur un
  portefeuille du festivalier si l'événement autorise `SELF_APP`, que le lot sert un seul événement et qu'il n'a pas
  de caution payée à part ; sinon refus, essai compté.
- **Limite du n° 12 levée le 21/10/2026 par la mission 5a** (WP05, migrations 0024 et 0026) : `consume_tap` refuse une
  lecture liée à une demande de rattachement, en ligne comme hors ligne, et la lecture d'une demande ne s'écrit plus
  directement. Tests : `packages/ledger-sql/tests/tests_consume_tap_claim.sql` (sections 1 à 7, chaque refus avec son
  témoin) ; course entre une écriture et une demande sur la même lecture (verrou `media-tap-use:`) :
  `apps/api/test/integration/media/tap-claim-race.spec.ts`. ADR-90 et ADR-101 complétés.

### OP-N51 — Guichet de retour : enchaînement des étapes, rattaché à la mission 9 (14 octobre 2026, décidé le 15)

`openapi.yaml` (`releaseMedia` avec `settle_balance`, `refund_deposit_by`) décrit un enchaînement complet du guichet de
retour par le serveur ; le plan de la mission des bracelets le renvoie à la mission 9. Provisoire : la restitution est
servie sans enchaînement, ces champs sont refusés en `422` (règle `release.no_chaining`).
**Décision du porteur du 15/10/2026 (ADR-91, acceptée)** : la mission 9 sert l'enchaînement, le contrat reste
inchangé. Point encore ouvert, rattaché à la mission 9 ; il ne bloque pas la mission des bracelets.

**Levé le 16/11/2026 par la mission 9a (ADR-91 annotée).** `settle_balance` et `refund_deposit_by` sont servis en une transaction ; le refus `release.no_chaining` a disparu. Preuves : `apps/api/test/integration/media/release-chaining.spec.ts` (FR-015 à FR-017, SC-004, seuil sur le cumul), `apps/api/test/integration/refunds/journey.spec.ts` (SC-004 de bout en bout).

### OP-N52 à OP-N55 — Constats des relectures indépendantes de la mission des bracelets (14 octobre 2026)

Relevés par les relectures indépendantes des lots 16 à 19 ; corrigé dans la mission tout ce qui renforçait la sécurité
sans décision (voir le compte rendu du lot 20). OP-N52 et OP-N53 sont levés le 15/10/2026 (décision du porteur,
lot 20, cycle 3) ; OP-N54 et OP-N55 restent ouverts ; leur fiche est complétée le 15/10/2026 sous le tableau (ADR, mission, condition de levée).

| Point | Constat | Risque | En place | Proposition |
|---|---|---|---|---|
| OP-N52 (**levé** le 15/10/2026, avec une limite résiduelle : OP-N56 ; migration `0017_media_reinstate_approval.sql`, ADR-94 ; tests `tests/tests_media_reinstate.sql`, `blacklist.spec.ts`) | La base ne vérifiait pas le valideur d'une sortie de liste noire : `reinstate_media` croit le valideur qu'on lui passe, et `check_media_transition` compare deux réglages de session posés par l'appelant ; `cashless_app` a `UPDATE (status)` sur `media` | Avec la connexion de l'API (défaut d'une autre route, injection), une seule personne sort un bracelet de liste noire en inventant un valideur | L'API n'appelle `reinstate_media` que depuis l'action approuvée `REINSTATE_MEDIA` (lien à l'épisode de liste noire, une seule demande en attente) ; réglages de session remis à vide après l'appel | Migration : `reinstate_media` exige une `approval_request` `REINSTATE_MEDIA` approuvée pour ce bracelet (auteur et valideur concordants) et le déclencheur refuse `BLACKLISTED → ACTIVE` hors de ce chemin ; ou retirer `UPDATE (status)` au profit de fonctions dédiées. Fichiers à relire : `schema_grand_livre_cashless.sql` (`reinstate_media`, `check_media_transition`), `post-roles.sql` |
| OP-N53 (**levé** le 15/10/2026 : `TRUST_PROXY_HOPS`, obligatoire en production, ADR-95 ; tests `claims-address-limit.spec.ts`, `config.spec.ts`, `processes.spec.ts`) | La limite de la consultation anonyme par adresse (60 par heure) reposait sur `req.ip`, sans réglage `trust proxy` | Derrière un répartiteur : toutes les adresses se confondent (limite globale, déni de service facile) ; `trust proxy` sans borne : `X-Forwarded-For` falsifiable, limite contournée | Limite par code (20 par heure) ; empreinte d'adresse à clé | Fixer explicitement la source de l'adresse (`trust proxy` limité au nombre de sauts du déploiement), et un test « 61ᵉ consultation de la même adresse → 429 » |
| OP-N54 | Le registre d'idempotence garde l'empreinte `request_hash` (SHA-256 sans clé) de la requête, qui contient le code imprimé (50 bits) | Une fuite de la base permet de retrouver un code par essais hors ligne (calcul lourd mais faisable) | Le code lui-même n'est jamais conservé ; les codes de confirmation ne sont plus conservés (route `transient`) | Empreinte de requête à clé (HMAC) dans le registre (mission 1), ou exclusion du code de l'empreinte pour ces routes |
| OP-N55 | `replace_media` ne fait pas suivre au bracelet neuf les espèces dues (anomalies `CASH_TOPUP_OVER_LIMIT`) de l'ancien | Des espèces dues sur un bracelet remplacé ne peuvent plus être rendues au guichet (bracelet `REPLACED`, rendu refusé) | Aucune perte comptable : la dette reste au grand livre (`L-ESP-A-RENDRE`) | Faire suivre les anomalies au remplacement (migration), ou un rendu au back-office sur décision de deux personnes (mission 9) |

**OP-N54 — fiche complétée le 15/10/2026 (ADR-99).**
- **Mission qui le lève : mission 5** (terminaux et paiement en ligne), confirmé par le porteur le 15/10/2026. Raison : c'est la prochaine mission de paiement ; elle ajoute des routes au registre d'idempotence
  (`POST /payments`, etc.) et touche donc `api_idempotency` et l'intercepteur qui calcule `request_hash`.
- **Condition de levée.** `request_hash` est une empreinte à clé (HMAC, secret hors de la base, comme
  `CLAIM_CODE_HMAC_KEY`), ou les champs secrets (code imprimé, code de confirmation) sont exclus de l'empreinte des
  routes qui les portent ; test : l'empreinte d'une requête de rattachement ne se recalcule pas à partir du code seul.
- **Test qui échoue si la limite s'élargit** : `apps/api/test/integration/end-to-end/media-secrets.spec.ts` (aucun code
  imprimé ni code de confirmation, en clair, hexadécimal ou base64, dans aucune colonne de la base, `api_idempotency`
  compris). Il ne fige pas l'empreinte elle-même : l'empreinte sans clé est le manque, pas un droit qui pourrait
  s'élargir.

**OP-N54 — levé le 21/10/2026 par la mission 5a (WP13, WP18 ; ADR-99).** `request_hash` est un HMAC sous
`IDEMPOTENCY_HMAC_KEY` (secret hors de la base, obligatoire en production), sans préfixe ; l'empreinte de
personnalisation (`personalizationHash`) aussi. Tests : `apps/api/test/unit/idempotency/request-hash.spec.ts`
(« requestHash (OP-N54) »), `apps/api/test/unit/media/personalization-hash.spec.ts`,
`apps/api/test/integration/media/personalization.spec.ts` (« registre d'idempotence : empreinte à clé liée à la
personne, jamais un SHA-256 sans clé (OP-N54) »), `media-secrets.spec.ts`, `device-secrets.spec.ts`.
**Consigne de déploiement (décision du porteur du 21/10/2026, option a)** : les lignes `api_idempotency` écrites
avant la mise en service (empreinte sans clé, ou modèle de route : OP-N71) sont purgées par le propriétaire de la base
à T + `IDEMPOTENCY_TTL_HOURS` (720 h), T étant l'heure du déploiement :
`DELETE FROM api_idempotency WHERE created_at < T` ; vérifier ensuite que ce compte est nul. D'ici là, un rejeu en vol
d'une requête antérieure reçoit `409 IDEMPOTENCY_KEY_REUSED` au lieu de la réponse enregistrée.

**OP-N55 — fiche complétée le 15/10/2026 (ADR-100).**
- **Mission qui le lève : mission 9** (remboursements, versements et clôture), déjà retenue au checkout principal ;
  report fait aussi dans `PROMPTS-A-ENVOYER.md` et `PRD.md` de cette branche. Raison : elle sert les remboursements
  et le guichet de retour, dont le rendu des espèces dues.
- **Condition de levée.** Les espèces dues d'un bracelet remplacé se rendent : soit `replace_media` fait suivre les
  anomalies `CASH_TOPUP_OVER_LIMIT` au bracelet neuf (migration), soit un rendu au back-office sur décision de deux
  personnes ; test : espèces dues d'un bracelet `REPLACED` rendues une fois, et une seule.
- **Test.** Aucun test ne fige ce manque : ce n'est pas un droit qui peut s'élargir mais une opération absente ; la
  dette reste au grand livre (`L-ESP-A-RENDRE`), dont les soldes sont vérifiés par les suites pgTAP du kit.
- **Levé le 16/11/2026 par la mission 9a (ADR-100 annotée).** `replace_media` fait suivre les anomalies `CASH_TOPUP_OVER_LIMIT` ouvertes au bracelet neuf (migration `0082_replace_media_cash_due.sql`) ; espèces dues rendues une fois et une seule. Preuves : `packages/ledger-sql/tests/tests_replace_cash_due.sql`, `apps/api/test/integration/media/cash-due-after-replace.spec.ts`.

### OP-N56 — Décision d'une demande d'approbation : la personne qui décide n'est pas authentifiée par la base (15 octobre 2026)

Limite résiduelle d'ADR-94 (levée d'OP-N52), consignée à la relecture du lot 20, cycle 3 (règle 3 de `CLAUDE.md`).

- **Risque.** `decide_approval_request(id, decided_by, approve, ...)` croit l'identifiant de valideur qu'on lui passe :
  la base ne sait pas authentifier une personne. Une session de l'API compromise (défaut d'une autre route, injection)
  peut donc créer une demande `REINSTATE_MEDIA` au nom d'un superviseur réel, la faire décider au nom d'un second
  superviseur réel du même prestataire, puis appeler `reinstate_media` : un bracelet sort de liste noire sans que
  deux personnes l'aient voulu. Même limite pour toute autre action à deux décidée par `approval_request`.
- **En place.** L'API ne décide une demande que pour la personne authentifiée par le serveur d'identité (jeton court,
  rôle relu en base, valideur ≠ auteur). La base exige, depuis la migration 0017 : une demande `REINSTATE_MEDIA`
  APPROVED du même prestataire, pour ce bracelet et l'épisode de liste noire en cours ; auteur et valideur distincts,
  personnes ACTIVE du prestataire ; valideur `SUPERVISOR` non révoqué ; demande née `PENDING`. Un valideur inventé ou
  non habilité est refusé. Depuis le lot 20, cycle 4 : les règles de passage (`media_transition`) ne sont plus modifiables
  par `cashless_app` (aucun contournement par un autre état). Depuis le cycle 5 (migration 0018) : l'historique des
  statuts (`media_status_history`, `media_batch_status_history`) n'est écrit que par ses déclencheurs, SECURITY
  DEFINER ; `cashless_app` n'y a ni `INSERT`, ni `UPDATE`, ni `DELETE`. Une session de l'API ne peut donc ni masquer
  l'épisode en cours ni planter une fausse mise en liste noire pour figer « l'épisode en cours » : la demande d'un
  épisode passé ne redevient pas concordante. Même fermeture sur `media_assignment` (clés d'idempotence du
  préchargement et des cautions, portefeuille débité) et `device_config_served` (configuration servie en cours). Chaque décision est journalisée
  (`audit_log`, chaîné et scellé).
- **Mission qui le lève.** Mission 11 (back-office web), où se prennent les décisions, avec le serveur d'identité réel
  (produit à choisir, PRD §4) : la décision porte une preuve signée par le serveur d'identité (jeton d'approbation
  d'ADR-74 : `sub` = valideur, `act`, `act_hash`, `jti` à usage unique) ou une signature de la décision par le
  valideur, vérifiée hors de la session de l'API et conservée avec la décision.
- **Condition de levée.** Une décision de demande d'approbation n'est enregistrée qu'avec une preuve que la session de
  l'API ne peut pas fabriquer seule (signature du serveur d'identité ou du valideur, vérifiée par une clé publique que
  l'API ne détient pas en écriture), et un test montre qu'une décision sans preuve, ou avec la preuve d'une autre
  personne ou d'une autre demande, est refusée.
- **Tests qui bornent la limite aujourd'hui** (ils échouent si elle s'élargit) : `tests/tests_media_reinstate.sql`
  (valideur inventé, valideur caissier, auteur et valideur inversés, épisode passé, historique masqué, ligne plantée
  dans l'historique puis réutilisation au nouvel épisode, détour par un autre état : refusés ; droits de `cashless_app`
  sur les historiques et les règles de passage ; droits d'écriture de tous les rôles de l'application sur les
  historiques de statut, `media_assignment` et `device_config_served`), `blacklist.spec.ts`.
- **Attribution de l'historique** (remarque 2 de la relecture du cycle 5, préexistante). L'auteur, le valideur et le
  motif portés par `media_status_history` et `media_batch_status_history` (`actor_id`, `approved_by`, `reason`) sont
  lus dans des réglages de session (`app.user_id`, `app.approved_by`, `app.reason`) que l'appelant fixe : une session
  de l'API compromise peut donc attribuer un passage réel à un valideur inventé ou à une autre personne. Cela ne
  débloque aucune règle (la sortie de liste noire exige une demande approuvée concordante, migration 0017) ; la trace
  n'est pas une preuve d'identité, au même titre que la décision elle-même. Levée avec ce point (mission 11).

- **Même limite à l'enrôlement des terminaux (revue post-fusion de la mission 5a, SEC-2, 21/10/2026).**
  `enroll_device` (migration 0022) croit l'auteur (`p_actor`) et accepte tels que l'API les donne les clés publiques,
  l'empreinte du certificat et le type d'attestation : la base ne prouve ni l'attestation ni l'auteur. Une session de
  l'API compromise pourrait créer un terminal aux clés choisies ; il resterait inutilisable sans certificat de
  l'autorité des terminaux ni jeton du signataire, deux clés hors de la base (barrière réelle, OP-N73 pour leurs
  adaptateurs). Renforcement décidé le même jour : retirer à `cashless_app` la lecture de
  `device_enrollment_code.code_hash` (correctif post-fusion de la mission 5a). **Fait le 22/10/2026** (`814710c`,
  aussi pour `device_enrollment_attempt.code_hash` ; test `tests_device_rights.sql` §1 bis) : une session compromise
  ne lit plus d'empreinte de code. La confiance dans l'auteur et les preuves reste, avec ce point (mission 11).

### OP-N57 — `offline_snapshot` : version plantée, déni de service hors ligne (15 octobre 2026)

Faiblesse du kit, antérieure à la mission 4, relevée à la relecture du lot 20, cycle 5 (remarque 1) ; consignée au
cycle 6 sans changement de comportement (décision de l'orchestrateur : les tables appartiennent à la mission 7).

- **Risque.** `cashless_app` est l'écrivain légitime de `offline_snapshot` (`INSERT` donné par `roles.sql`) et choisit
  la version. `check_offline_snapshot` n'exige qu'une version strictement croissante par grand livre : une session de
  l'API compromise (défaut d'une autre route, injection) qui insère un snapshot d'une version très grande (jusqu'à la
  borne de `bigint`) bloque toute version suivante de ce grand livre. Les terminaux ne reçoivent plus de snapshot à
  jour : déni de service du paiement hors ligne pour l'événement, et snapshots périmés gardés plus longtemps.
- **En place.** Lignes immuables (`offline_snapshot_immutable` : ni `UPDATE` ni `DELETE`), `DELETE`/`TRUNCATE` retirés à
  tous les rôles de l'application ; le déclencheur exige aussi le prestataire du grand livre, une clé de signature
  `ACTIVE` du central, l'époque d'autorité courante et un en-tête signé égal aux colonnes ; RLS `tenant_isolation`. Seul
  `cashless_app` y écrit (`INSERT`, et `UPDATE` refusé par le déclencheur). Aucun code de l'API n'écrit encore cette
  table (mission 7).
- **Mission qui le lève.** Mission 7 (hors ligne, snapshots et lots).
- **Condition de levée.** Un snapshot ne s'inscrit que par une fonction (SECURITY DEFINER, ou rôle dédié) qui calcule
  elle-même la version (dernière version + 1) ; `INSERT` direct retiré à `cashless_app` (ou borné par une politique
  restrictive équivalente) ; un test montre qu'une version choisie par l'appelant (très grande ou non contiguë) est
  refusée et que le snapshot suivant reste possible.
- **Test qui borne la limite aujourd'hui** (il échoue si elle s'élargit) : `tests/tests_definer_trigger_writers.sql`
  (liste exacte des droits d'écriture des rôles `cashless_*` sur `offline_snapshot` : `INSERT` et `UPDATE` de
  `cashless_app` seulement ; aucune suppression ; déclencheurs de contrôle et d'immuabilité présents).

**Levé le 04/11/2026 par la mission 7 (lots WP03 et WP08 ; constaté par WP21).** Un snapshot ne
s'inscrit plus que par `publish_offline_snapshot` (migration `0044`, SECURITY DEFINER, exécutée par
`cashless_snapsign` seul) qui calcule elle-même la version (dernière + 1) ; `INSERT` direct retiré à
`cashless_app` (`post-roles.sql`). Version plantée : refusée (`CL048`) et le snapshot suivant reste
possible.

Preuves, rejouées sur `cashless_wp21c` (`pg_prove`, PASS) : `tests_offline_snapshots.sql` (145
assertions ; §5 « version plantée à 2^62 : la publication refuse »), `tests_offline_rights.sql` (197
; « OP-N57 : première publication = version 1 (max + 1) », « version déjà publiée (plantée en
avance) refusée (CL048) », `INSERT` direct refusé) et `tests_definer_trigger_writers.sql` §3 (aucun
rôle `cashless_*` n'écrit `offline_snapshot` : la suite échoue si un droit d'écriture réapparaît).

### OP-N58 — `offline_policy_history` : trace falsifiable (15 octobre 2026)

Même origine qu'OP-N57 (kit, antérieure à la mission 4 ; relecture du lot 20, cycle 5, remarque 1 ; consignée au
cycle 6 sans changement de comportement).

- **Risque.** `log_offline_policy` écrit l'historique des politiques hors ligne avec les droits de l'appelant : le rôle
  qui modifie `offline_policy` doit donc avoir `INSERT` sur `offline_policy_history`, et peut y écrire n'importe quelle
  ligne de son prestataire. Une session de l'API compromise peut y planter une fausse version d'une politique (plafonds,
  auteur, date de début) : la trace des plafonds hors ligne devient falsifiable, et une version plantée en avance
  (`UNIQUE (policy_id, version)`) fait échouer la modification légitime suivante de cette politique.
- **En place.** Lignes immuables (`offline_policy_history_immutable`) ; `DELETE`/`TRUNCATE` retirés à tous les rôles de
  l'application ; RLS `tenant_isolation`. Aucune règle de la base ne lit cette table : le contrôle « plafonds en
  vigueur » (`policy_in_force`) lit la configuration servie (`device_config_served`, écrite par `record_config_served`
  seule, fermée en écriture à `cashless_app` au lot 20, cycle 5). Aucun code de l'API n'écrit encore les politiques
  hors ligne (mission 7).
- **Mission qui le lève.** Mission 7 (hors ligne), qui sert les politiques hors ligne.
- **Condition de levée.** `log_offline_policy` passe en SECURITY DEFINER (`search_path` fixé, comme `log_media_status`
  en migration 0018) et `INSERT` sur `offline_policy_history` est retiré à `cashless_app` ; un test montre qu'une ligne
  insérée directement est refusée et qu'une modification de politique écrit toujours son historique.
- **Test qui borne la limite aujourd'hui** : `tests/tests_definer_trigger_writers.sql` (liste exacte des droits
  d'écriture des rôles `cashless_*` sur `offline_policy_history` : `INSERT` et `UPDATE` de `cashless_app` seulement ;
  aucune suppression ; `log_offline_policy` aux droits de l'appelant, comportement inchangé dans la mission 4).
- **Bloque la production : oui** (décision du porteur du 15/10/2026, relecture du lot 20, cycle 6, remarque 1). Comme
  OP-N57, une version plantée en avance est un déni de service (la modification légitime suivante de la politique
  échoue) ; il est levé avant la production, avec la mission 7.

**Levé le 04/11/2026 par la mission 7 (lots WP02 et WP08 ; constaté par WP21).**
`log_offline_policy` est SECURITY DEFINER (migration `0043`, `search_path` fixé), les politiques ne
s'écrivent que par `set_offline_policy` et `clear_offline_policy`, et `cashless_app` n'a plus aucun
droit d'écriture sur `offline_policy` ni sur `offline_policy_history`. Une modification de politique
écrit toujours son historique.

Preuves, rejouées sur `cashless_wp21c` (PASS) : `tests_offline_policy.sql` (82 assertions ;
versions, ligne `deleted`, une ligne d'historique par modification),
`tests_definer_trigger_writers.sql` (24 ; §3 inversé : « OP-N58 levée : log_offline_policy est
SECURITY DEFINER », aucun rôle n'écrit l'historique) et `tests_offline_rights.sql` (197). La suite
échoue si un droit d'écriture direct réapparaît.

### OP-N59 — Fonctions SECURITY DEFINER : tables masquées par une table temporaire de l'appelant (15 octobre 2026)

Relevé au lot 20, cycle 7, en passant `register_personalized_media` en SECURITY DEFINER. Antérieur à la mission 4 :
toutes les fonctions SECURITY DEFINER du schéma de référence et des migrations fixent `SET search_path = public`.
**Tranché par le porteur le 15/10/2026 (ADR-96) ; aucun changement de comportement hors du lot 20.**

- **Risque.** Quand `pg_temp` n'est pas nommé dans `search_path`, PostgreSQL cherche les tables **d'abord** dans le
  schéma temporaire de la session. Tous les rôles `cashless_*` ont le droit `TEMP` sur la base (accordé à `PUBLIC` par
  défaut). Une session compromise crée une table temporaire du même nom qu'une table lue ou écrite par une fonction
  SECURITY DEFINER, et la fonction lit ou écrit la table temporaire avec les droits du propriétaire. Démontré en base
  (`scratchpad/wp20c7/pgtemp2.sql`, transaction annulée) : `cashless_app` crée `pg_temp.media_status_history`, puis
  `UPDATE media SET status = 'BLACKLISTED'` ; la ligne d'historique part dans la table temporaire, l'historique réel
  n'a pas la mise en liste noire (avant la migration 0019). Même chose pour un contrôle qui lit une table (lot, clé,
  grand livre) : la fonction voit les lignes choisies par l'appelant.
- **Conséquence probable : contournement du cloisonnement entre prestataires** (relecture du cycle 7, constat 2).
  `tenant_of_ledger`, `tenant_of_media`, `tenant_of_wallet`, `tenant_of_batch`, `tenant_of_event`, `tenant_of_device`
  et `tenant_of_gateway` sont SECURITY DEFINER, sans `pg_temp`, et lisent une table pour trouver le prestataire d'un
  objet. Elles alimentent `assert_tenant` (SECURITY INVOKER) dans les fonctions qui déplacent de l'argent ou changent
  un bracelet, par exemple `post_transaction` (`assert_tenant(tenant_of_ledger(p_ledger))`). Une table temporaire
  `ledger` de l'appelant ferait rendre le prestataire de la session pour un grand livre d'un autre prestataire, et le
  contrôle passerait. **Non démontré de bout en bout** : risque probable, écrit comme tel.
- **En place.** Migration 0019 : `register_personalized_media`, `associate_claim_code`, `log_media_status` et
  `log_batch_status` ont `search_path = public, pg_temp` (test : `tests/tests_personalization_definer.sql`, tables
  temporaires `media_batch` et `tag_data_key` ignorées). Les **77** autres fonctions SECURITY DEFINER du schéma
  `public` (81 au total au 15/10/2026) ne l'ont pas, dont les `tenant_of_*` ci-dessus, `post_transaction`,
  `activate_media`, `retire_dedicated_key`, les fonctions d'identité et d'audit. `assert_tenant` n'en fait pas partie
  (SECURITY INVOKER).
- **Options.** (A) retirer `TEMPORARY` sur la base à `PUBLIC` et aux rôles `cashless_*` dans `post-roles.sql` (une
  ligne ; vérifier qu'aucun rôle applicatif n'utilise de table temporaire) ; (B) migration qui passe toutes les
  fonctions SECURITY DEFINER du schéma `public` à `search_path = public, pg_temp`, avec un test qui liste celles qui
  ne l'ont pas ; (C) les deux.
- **Décision du porteur (15/10/2026, ADR-96).** Défaut consigné, non corrigé dans la mission 4 ; **levé par la
  mission 5** (prochaine mission qui touche la base) ; **bloque la production : oui**.
- **Mission qui le lève.** Mission 5 (terminaux et paiement en ligne) : retirer `TEMPORARY` aux rôles applicatifs
  (option A) ou passer toutes ces fonctions à `search_path = public, pg_temp` (option B), ou les deux.
- **Condition de levée.** Option retenue appliquée, et un test pgTAP : table temporaire de l'appelant sans effet sur
  une fonction SECURITY DEFINER prise au hasard (un `tenant_of_*` au moins), ou création de table temporaire refusée à
  chaque rôle `cashless_*` ; avec l'option B, le compte du test ci-dessous tombe à 0 et devient une égalité.
- **Test qui borne la limite aujourd'hui** (il échoue si elle s'élargit) : `tests/tests_definer_trigger_writers.sql`,
  section 4 : au plus 77 fonctions SECURITY DEFINER du schéma `public` sans `pg_temp` dans leur `search_path`.
- **Levé le 21/10/2026 par la mission 5a (options A et B ; WP02, WP07).** Migration 0021 : toute fonction SECURITY
  DEFINER du schéma `public` finit son `search_path` par `pg_temp` ; `post-roles.sql` retire `TEMPORARY` à `PUBLIC` et
  aux rôles `cashless_*`. Tests : `tests/tests_definer_search_path.sql` (table temporaire de l'appelant sans effet sur
  chaque `tenant_of_*`, témoin aux réglages d'avant 0021), `tests/tests_device_rights.sql` §5 (tables temporaires
  refusées à chaque rôle `cashless_*`), `tests/tests_definer_trigger_writers.sql` §4 (borne passée de 77 à une égalité
  à 0).

### OP-N60 — `cashless_app` contourne par accès direct des contrôles de fonctions INVOKER (15 octobre 2026)

- **LEVÉ le 19/11/2026 (mission 11a)**, ADR-216. **Mécanisme.** Migration
  `0091_media_batch_functions.sql` : `create_media_batch` (12 arguments, lot né `ORDERED`, auteur
  obligatoire) et `update_media_batch` (liste blanche de champs, `CL056`) ;
  `set_media_batch_status`, `media_set_status` et `issue_claim_codes` passent `SECURITY DEFINER`
  (corps identique) ; `media_set_status` limité à `SUSPENDED` et `BLACKLISTED` (renforcement).
  `post-roles.sql` §13 retire à `cashless_app` `INSERT`/`UPDATE` de `media_batch` et `UPDATE
  (status)` de `media` ; l'API (`media/batches/batches.service.ts`) appelle les fonctions, verrou
  `pg_advisory_xact_lock`.
- **Test de levée.** `packages/ledger-sql/tests/tests_media_batch_functions.sql` (79 tests : lot
  `ACTIVE` ou `CLOSED` refusé, champ hors liste refusé, `RETIRED` refusé) ; `tests_11a_rights.sql`
  (69 tests, `has_*_privilege` par rôle) ; `apps/api/test/integration/media/blacklist.spec.ts` («
  OP-N60 levée : sous cashless_app, aucune écriture directe de lot ni de statut », 42501).
- **Test de borne inversé.** Les anciens tests qui comptaient l'écriture directe comme permise sont
  inversés : `tests_media_api.sql` test 1 (8 devient 6 droits), `tests_media_claims.sql` test 9 (5
  devient 4), `tests_media_reinstate.sql` (`→ORDERED` exige un acteur), `batches.spec.ts` (l'auteur
  du lot est tracé).
- **Mutations vérifiées** (notes de WP01, WP05, WP03). Limite `p_to` de `media_set_status` retirée :
  `RETIRED` passe, le test `CL020` échoue. `GRANT UPDATE (status) ON media` puis `GRANT INSERT ON
  media_batch` : le test « OP-N60 levée » échoue (42501 attendu, aucune erreur reçue). Verrou du lot
  neutralisé (`if (false && lock)`) : le test des deux `PATCH` échoue. Quatre mutations de droits de
  WP03 détectées.
- **Limite restante.** Le verrou consultatif est pris avant le contrôle RLS (OP-N161).

Relevé au lot 20, cycle 7 (recherche demandée par le porteur : « les autres fonctions qui contrôlent ce qu'un rôle de
processus pourrait aussi faire par un accès direct à la table »). Les rôles des processus des clés n'ont plus de cas
(voir ADR-94, complément du cycle 7) ; restent ceux du rôle de l'API. **Tranché par le porteur le 15/10/2026 (ADR-97) ; non corrigé ici**, la
correction change des routes de l'API hors du lot 20.

- **Risque.** `roles.sql` rend `INSERT` et `UPDATE` sur toutes les tables à `cashless_app` ; `post-roles.sql` ne les
  borne pas sur `media_batch` (toutes les colonnes). Une session de l'API compromise peut : insérer un lot directement
  au statut `ACTIVE` ou `CLOSED`, sans passer par `ORDERED → PERSONALIZED → DELIVERED` (vérifié par la relecture du
  cycle 7 : `INSERT 0 1` dans les deux cas) ; passer un lot à `CLOSED` directement (le passage est permis par
  `media_batch_transition`) sans `close_batch`, donc sans acquérir les cautions ni retirer les bracelets, alors que
  `set_media_batch_status` refuse `CLOSED` ; changer `quantity`, `key_index`, `organizer_id` ou `event_id` d'un lot ;
  et changer le statut d'un bracelet sans motif (`media_set_status` exige un motif ; l'historique garde un motif
  vide). Vérifié en base (`scratchpad/wp20c7/opn60.sql`, transaction annulée) : `UPDATE media_batch SET quantity =
  500` et `SET status = 'CLOSED'` passent depuis `cashless_app`, alors que `set_media_batch_status(…, 'CLOSED', …)` est
  refusé ; `UPDATE media SET status = 'BLACKLISTED'` passe et l'historique garde un motif nul. Une quantité relevée
  par l'API laisse aussi la personnalisation enregistrer au-delà de la commande (la fonction lit la quantité du lot).
  La RLS borne tout cela au prestataire de la session ; les passages de statut restent ceux des tables de passage.
- **En place.** RLS `tenant_isolation` ; déclencheurs de passage (`check_media_transition`, `check_batch_transition`,
  `check_media_batch_key`) ; historiques écrits par leurs seuls déclencheurs (0018). L'API crée un lot par `INSERT`
  direct (`apps/api/src/media/batches/batches.service.ts:68`) et change son statut par `set_media_batch_status` et
  `close_batch` : un droit `INSERT` ne peut donc pas être retiré sans changer la création.
- **Options.** Borner `UPDATE` de `media_batch` par colonne (`status` seul, ou aucun avec une fonction SECURITY
  DEFINER pour chaque passage) et refuser `CLOSED` hors de `close_batch` par une politique restrictive ou un
  déclencheur ; passer `media_set_status` en SECURITY DEFINER et retirer `UPDATE (status)` de `media` à l'API.
- **Décision du porteur (15/10/2026, ADR-97).** Défaut consigné, non corrigé dans la mission 4 ; **levé par la
  mission 11** (back-office) ; **bloque la production : oui**.
- **Condition de levée.** Option retenue appliquée (création d'un lot par une fonction qui impose le statut `ORDERED`,
  ou politique restrictive sur l'`INSERT`) ; test pgTAP depuis `cashless_app` : lot inséré directement en `ACTIVE` ou
  en `CLOSED` refusé, `UPDATE media_batch SET status = 'CLOSED'` et `SET quantity = …` refusés, statut de bracelet
  sans motif refusé.
- **Test qui borne la limite aujourd'hui** (il échoue si elle s'élargit) : `tests/tests_definer_trigger_writers.sql`,
  section 4 : droits de `cashless_app` sur `media_batch` figés colonne par colonne (`INSERT`, `SELECT`, `UPDATE` ;
  aucune suppression).

### OP-N61 — Traitements par tranches (NFR-008) : preuve sur 5 000 bracelets manquante (15 octobre 2026)

Relevé par la vérification d'acceptation de la mission 4 (`acceptance-matrix.json`, 45 critères sur 46 en `pass`,
NFR-008 en échec). **Écart consigné par décision du porteur du 15/10/2026 (ADR-98).**

- **Exigence.** NFR-008 : la clôture d'un lot, le rattrapage du préchargement et le rechiffrement traitent au plus 500
  bracelets par tranche, peuvent être relancés sans double effet, et vont au bout sur un lot de 5 000 bracelets.
- **Ce qui est prouvé.** Tranches de 500 (`FORFEIT_SLICE`, `PRELOAD_SLICE`, `batches.service.ts`) et relance sans
  double effet : clôture sur 600 cautions, deux relances (`apps/api/test/integration/media/batches.spec.ts`) ;
  rechiffrement de 1 200 bracelets en 3 tranches, avec reprise après interruption
  (`apps/api/test/integration/media/data-keys.spec.ts`).
- **Ce qui manque.** Aucun test sur un lot de 5 000 bracelets ; le rattrapage du préchargement n'est testé que sur 3
  bracelets, sans atteindre une tranche (`PRELOAD_SLICE` jamais atteint).
- **Risque.** Une clôture, un rattrapage ou un rechiffrement qui n'irait pas au bout sur un gros lot (durée,
  `transaction_timeout` de 60 s, verrous) en exploitation : lot bloqué à mi-chemin, cautions non acquises ou bracelets
  sous l'ancienne clé de données. Le découpage en tranches et la reprise limitent ce risque sans le mesurer.
- **Mission qui le lève : mission 13** (recette V1), décision du porteur. **Condition de levée** : test sur un lot de
  5 000 bracelets pour les trois traitements (clôture, rattrapage du préchargement au-delà d'une tranche,
  rechiffrement), chacun allant au bout, avec au moins une relance sans double effet ; durées consignées dans le
  rapport de recette.
- **Bloque la production : oui** (la preuve est attendue de la recette, qui précède la production).
- **Pas de test qui fige la limite.** La limite est un manque de preuve, pas un droit ni un contrôle retiré : rien ne
  peut « s'élargir » qu'un test puisse borner. Les tests existants (`batches.spec.ts`, `data-keys.spec.ts`) échouent
  déjà si le découpage ou la reprise régressent.

### OP-N62 — Retrait d'une clé dédiée par la personnalisation sans travail (16 octobre 2026)

Limite résiduelle de la correction de SEC-1 (revue post-fusion de la mission 4, correctif
post-fusion n° 1, ADR-102), consignée selon la règle 3 de `CLAUDE.md`.

- **Risque.** `retire_dedicated_key` (schéma de référence, SECURITY DEFINER) retire une clé dédiée
  dont tous les lots sont clos : clé et clés de données retirées, mots de passe effacés, bracelets
  en fin de vie. Elle ne vérifie pas qu'un travail `RETIRE_KEY` approuvé est en cours. Depuis la
  migration 0020, seul `cashless_perso` peut l'appeler (l'API et `PUBLIC` ne le peuvent plus) : un
  processus de personnalisation compromis retirerait une clé dédiée sans décision à deux. Le modèle
  de menace retenu par la mission (connexion de l'API compromise) n'est plus concerné.
- **En place.** `EXECUTE` retiré à `PUBLIC` et à `cashless_app` ; la personnalisation n'exécute
  `RETIRE_KEY` qu'après la revérification de la demande (`TagKeyJobGate`) ; la désactivation dans le
  KMS qui suit n'est acceptée que pour une clé `RETIRED` après un retrait approuvé.
- **Mission qui le lève : mission 5**, avec OP-N44 (droits d'exécution des fonctions du schéma
  accordés rôle par rôle) — **confirmé par le porteur le 16/10/2026**. Condition de levée
  : `retire_dedicated_key` n'est plus appelable que par une fonction qui exige un travail
  `RETIRE_KEY` `RUNNING` de la même clé, issu d'une demande exécutée (ou la vérification est ajoutée
  par migration à une fonction de remplacement) ; test : appel sans travail refusé.
- **Test qui échoue si la limite s'élargit** : `tests/tests_tag_key_job_approval.sql` (droit
  d'exécution de `retire_dedicated_key` : personnalisation seulement ; refusé à `PUBLIC`, à l'API, à
  la plateforme, aux clés de bracelet et à la commande d'administration).
- **Seconde limite, délai d'une demande approuvée (confirmée par le porteur le 16/10/2026,
  mission 5, ADR-102 complété).** `enqueue_tag_key_job` ne lit pas `expires_at` : une demande
  `APPROVED` jamais exécutée sert encore plus tard, une seule fois (index uniques). La mission 5
  la fait refuser une fois `expires_at` dépassé. Test qui documente le comportement actuel :
  `tests/tests_tag_key_job_approval.sql`, section 6 (à inverser à la levée).
- **Levé le 21/10/2026 par la mission 5a (WP06, migration 0025, puis droits de WP07 ; ADR-102).** Le retrait d'une
  clé dédiée exige le travail `RETIRE_KEY` `RUNNING` de la même clé, et une demande approuvée périmée est refusée
  (`CL023`). Test : `tests/tests_tag_key_retire_guard.sql` (sections 2 à 4 : demande périmée refusée, retrait par le
  travail en cours, refus sans travail).

### OP-N63 — Clé d'accord d'un terminal réécrite par l'API (16 octobre 2026)

Signalé par le correctif post-fusion n° 1 en cherchant les autres entrées qu'un processus des clés
consomme après qu'une autre connexion les a déposées (consigne 6). **Écart accepté, bloque la
production : oui, levé par la mission 5 (enrôlement réel des terminaux) ; confirmé par le porteur
le 16/10/2026 ; ADR-105.**

- **Constat.** `roles.sql` (kit) accorde à `cashless_app` `UPDATE (agreement_public_key)` sur
  `device`. Le processus des clés de bracelet (`POST /media/auth-keys`) chiffre le mot de passe d'un
  bracelet pour cette clé (ECDH-ES P-256).
- **Risque.** Une session de l'API compromise remplace la clé d'accord d'un terminal par la sienne ;
  la réponse suivante de `POST /media/auth-keys` pour ce terminal devient lisible par elle si elle
  intercepte cette réponse. Aujourd'hui l'identité du terminal est un faux qui croit des en-têtes
  (OP-N42, bloque la production) : le risque est couvert par ce point jusqu'à la mission 5.
- **Décision.** Avec l'enrôlement réel (mission 5) : clé d'accord écrite à l'enrôlement
  seulement, par une fonction qui vérifie le code d'enrôlement, et `UPDATE (agreement_public_key)`
  retiré à `cashless_app` ; test : réécriture directe refusée. Fichier concerné :
  `packages/ledger-sql/roles.sql` (kit), corrigé par `post-roles.sql`.
- **Test qui échoue si la limite s'élargit** : `tests/tests_tag_key_job_approval.sql`, section 7
  (liste exacte des colonnes de `device` que `cashless_app` peut mettre à jour, `INSERT`,
  `REFERENCES`, `DELETE`, `TRUNCATE`).
- **Levé le 21/10/2026 par la mission 5a (WP03, WP07 ; ADR-105).** La clé d'accord n'est écrite qu'à l'enrôlement,
  par la fonction qui consomme le code d'enrôlement ; `UPDATE (agreement_public_key)` et `INSERT` sur `device` sont
  retirés à `cashless_app`. Tests : `tests/tests_device_rights.sql` §1 (liste exacte des colonnes modifiables) et §2
  (réécriture directe de chaque colonne protégée refusée). Les colonnes encore modifiables relèvent d'OP-N69.

### OP-N64 — Terminal iOS : clé de signature non attestée (19 octobre 2026)

- **CÔTÉ SERVEUR PRÊT, NON LEVÉ (mission 11a, WP02 et WP13, ADR-222).** Le serveur garde la clé App
  Attest à l'enrôlement (migration `0095_device_app_attest_key.sql` : table `device_app_attest_key`,
  `enroll_device` à 15 arguments, `advance_app_attest_counter(uuid, bytea, bigint)`, `CL059`) et
  sait vérifier une assertion (`attestation/ios-app-attest-assertion.ts`,
  `IosAppAttestAssertionVerifier`, **aucun appelant en production**, voulu et gardé par
  `test/unit/attestation/assertion-architecture.spec.ts`).
- **La borne iOS reste en place** : `POST /media/auth-keys` refuse toujours un terminal iOS
  (`device-auth-matrix.spec.ts` et `media-port-swap.spec.ts` inchangés).
- **Reste pour la mission 12** : envoyer les assertions App Attest, brancher le vérificateur,
  **puis** retirer la borne iOS. **Limite en toutes lettres : un vecteur d'assertion réel d'Apple
  est exigé avant la mission 12.** Les vecteurs de test sont générés localement (R1) : une erreur de
  double hachage ECDSA y serait invisible. Relecture du 19/11/2026 : code conforme à la procédure
  Apple, lu contre la spécification, jamais exercé sur un appareil. Compteur et déni de service :
  OP-N152.
- **Test.** `tests_device_app_attest.sql`, `app-attest-enrollment.spec.ts`,
  `app-attest-assertion.spec.ts`, `ios-assertion.spec.ts` ; mutations de WP13 : `rpIdHash` retiré,
  compteur `>=`, clé non passée à `enroll_device`, hachage triple, retour d'`advance` ignoré :
  toutes détectées.
- **Fichier à faire relire par une personne.** `attestation/ios-app-attest-assertion.ts`
  (cryptographie) et `advance_app_attest_counter` (`0095`).

Signalé au plan de la mission 5a. **Écart accepté, bloque la production : non ; réexaminé par la mission 12 (app
terminal) ; décision du porteur du 19/10/2026 ; ADR-106.**

- **Constat.** App Attest atteste sa propre clé et l'intégrité de l'app, pas la clé de signature ECDSA P-256 du
  terminal (requêtes signées, CSR, certificat mTLS).
- **Risque.** Une app iOS dont la clé de signature serait extraite de l'appareil pourrait signer hors de lui. Borné :
  un iPhone encaisse en QR seulement et ne reçoit jamais le mot de passe d'un bracelet.
- **Ce qui est fait en attendant.** Le défi d'enrôlement couvre le code, le `serial` et les deux clés publiques ; le
  jeton, le certificat et la signature restent exigés ensemble ; révocation immédiate.
- **Condition de levée.** Requêtes iOS signées par assertion App Attest (ou preuve équivalente).
- **Test qui échoue si la limite s'élargit** : `POST /media/auth-keys` refuse un terminal `os = IOS`.
- **Vérifié le 21/10/2026 (WP18)** : bornes « borne iOS (OP-N64) » de
  `apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts` (seule `/media/auth-keys` refuse un terminal iOS)
  et de `media-port-swap.spec.ts`. Pour la mission 12 : le `keyId` App Attest (credentialId) devra être renvoyé par le
  port et stocké (assertions), et l'app passe `iosClientDataHash` tel quel à `attestKey`.

### OP-N65 — Rafraîchissement : grâce de 60 s pour le même terminal (19 octobre 2026)

Signalé par la relecture contradictoire du plan de la mission 5a. **Écart accepté, bloque la production : non ;
réexaminé par la mission 13 (recette V1) ; décision du porteur du 19/10/2026 ; ADR-108.**

- **Constat.** Une réponse de rafraîchissement perdue fait réessayer le terminal avec un jeton déjà consommé.
- **Risque.** Un jeton consommé volé, représenté dans les 60 s, donnerait une paire neuve, à condition d'avoir aussi la
  clé de signature et le certificat du terminal (mTLS et preuve de possession exigés).
- **Test qui échoue si la limite s'élargit** : seconde représentation, plus de 60 s ou autre certificat → famille
  révoquée, jeton d'appareil de la famille refusé.
- **Vérifié le 21/10/2026 (WP18)** : « borne d'OP-N65 » (trois tests) de
  `apps/api/test/integration/devices/refresh.spec.ts` et `packages/ledger-sql/tests/tests_device_tokens.sql` §2.

### OP-N67 — Attestation Android : identité de l'app lue dans la liste logicielle (19 octobre 2026)

Signalé par l'implémentation de WP10 (mission 5a). **Écart accepté, affaiblit le plan, bloque la production : non ;
réexaminé par la mission 13 (recette V1) ; décision du porteur du 19/10/2026 ; ADR-110.**

- **Constat.** `research.md` R-05 voulait lire `attestationApplicationId` (paquet et empreintes de signature de l'app)
  dans la liste matérielle de Key Attestation. Sur les vrais appareils, ce champ est écrit par le service Keystore du
  système, donc placé dans `softwareEnforced` : la lecture stricte refuserait tout terminal Android.
- **Risque.** Un système d'exploitation compromis peut mentir sur l'app qui a créé la clé. Borné : la clé reste
  générée dans le TEE ou StrongBox (`origin = GENERATED`, chaîne signée par le matériel) ; `verifiedBootState =
  Verified`, `deviceLocked` et les niveaux de correctif restent lus dans la liste matérielle, et chaque certificat de
  la chaîne est contrôlé contre la liste de révocation de Google ; un système modifié ne passe pas le démarrage vérifié
  sans casser le TEE.
- **Ce qui est fait.** Seul ce champ est lu dans `softwareEnforced` ; s'il est aussi dans la liste matérielle, cette
  valeur prime et les deux doivent concorder.
- **Condition de levée.** Lecture dans la liste matérielle si les appareils cibles l'y placent, ou preuve d'intégrité
  de l'app complémentaire (Play Integrity) décidée en recette.
- **Test qui échoue si la limite s'élargit** : analyse du source qui échoue si un autre champ que
  `attestationApplicationId` est lu dans `softwareEnforced`, et tests de comportement : un autre contrôle
  (`rootOfTrust`, `origin`…) présent seulement dans `softwareEnforced` → refus ; valeurs différentes entre les deux
  listes → refus (`apps/api/test/unit/attestation/android.spec.ts`).

### OP-N68 — Fonction créée hors de `migrate.ts` : exécutable par PUBLIC jusqu'au rejeu des droits (20 octobre 2026)

Signalé par l'implémentation de WP07 (mission 5a). **Écart au plan accepté (contrôle non tenu) ; levé par la
mission 7 ; décisions du porteur du 20/10/2026 (option « une seule transaction », puis mission 7) ; ADR-111.**

- **Constat.** Le plan de WP07 demandait `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM
  PUBLIC`. Cette forme est sans effet dans PostgreSQL : un défaut posé par schéma ne retire pas le défaut global. La
  forme globale retire aussi `EXECUTE` à pgTAP et aux fonctions `pg_temp` des suites, qui cassent toutes.
- **Ce qui est fait.** `post-roles.sql` retire `EXECUTE` à `PUBLIC` sur toutes les fonctions de `public`, et
  `migrate.ts` applique la série de migrations et le rejeu de `roles.sql` et `post-roles.sql` dans une seule
  transaction (avec un verrou consultatif) : une fonction livrée par une migration n'est jamais exécutable par
  `PUBLIC`, même un instant.
- **Risque.** Une fonction créée à la main par le propriétaire (correctif d'urgence en psql, script d'exploitation)
  reçoit `EXECUTE` pour `PUBLIC` : tout rôle connecté, dont `cashless_app` et les processus des clés, peut l'appeler
  jusqu'au prochain passage de `migrate.ts`. Si elle est `SECURITY DEFINER`, elle s'exécute avec les droits du
  propriétaire, qui ignore la RLS.
- **Garde.** Règle d'exploitation : aucune fonction créée hors d'une migration ; après un correctif manuel, relancer
  `migrate.ts`.
- **Condition de levée.** Droit par défaut global (`ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire> REVOKE EXECUTE ON
  FUNCTIONS FROM PUBLIC`) une fois que les suites pgTAP n'en dépendent plus (pgTAP installé avec des droits
  explicites, ou droit rendu dans la transaction de chaque suite) ; la première assertion de la §4 de
  `tests_execute_grants.sql` s'inverse alors.
- **Tests qui bornent la limite** : `packages/ledger-sql/tests/tests_execute_grants.sql` §4 (« LIMITE RESTANTE : fonction
  créée à la main hors de migrate.ts exécutable par PUBLIC jusqu'au rejeu », puis fermeture au rejeu) ;
  `apps/api/test/integration/transverse/migrate-rights.spec.ts` (série et droits dans une même transaction ; échoue si
  le rejeu sort de la transaction ou si `post-roles.sql` cesse de retirer `PUBLIC`).

**Levé le 04/11/2026 par la mission 7 (lot WP08 ; constaté par WP21).** `post-roles.sql` §8a pose le
droit par défaut global `ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire> REVOKE EXECUTE ON
FUNCTIONS FROM PUBLIC` ; `_grants_for_tests.sql` le rouvre seulement le temps d'installer pgTAP. Une
fonction créée à la main n'est plus exécutable ni par `PUBLIC` ni par un rôle.

Preuves, rejouées sur `cashless_wp21c` (PASS) : `tests_execute_grants.sql` (79 assertions ; §4
inversé : « OP-N68 levée : fonction créée à la main par le propriétaire, exécutable ni par PUBLIC ni
par un rôle » et « défaut global (sans IN SCHEMA) posé pour le propriétaire courant ») ;
`transverse/migrate-rights.spec.ts` (série et droits dans une même transaction).

### OP-N69 — Terminal : numérotation, présence et affectation écrites directement par l'API (20 octobre 2026)

Relevé par la relecture indépendante de WP07 (mission 5a). **Défaut antérieur à la mission, ni créé ni aggravé par
WP07 ; consigné, levé par la mission 7 ; décision du porteur du 20/10/2026 ; ADR-112.**

- **Constat.** Après WP07, `cashless_app` n'insère plus dans `device` et ne touche plus au statut ni aux clés, mais
  garde `UPDATE` sur neuf colonnes : `app_mode`, `nfc_enabled`, `event_id`, `pos_id`, `station_name`,
  `last_snapshot_version`, `last_seen_at`, `next_seq_floor`, `personal_phone` (`post-roles.sql`, section 5).
- **Réduit le 26/10/2026 (mission 5b, WP07 ; constaté à la revue post-fusion du 27/10/2026).** `post-roles.sql`
  (section 6) ne laisse plus à `cashless_app` que `UPDATE (station_name, last_snapshot_version, last_seen_at,
  next_seq_floor)`. `event_id`, `pos_id`, `app_mode`, `nfc_enabled` et `personal_phone` ne sont plus modifiables
  directement : le déplacement d'un terminal et le contournement de la règle du téléphone personnel décrits
  ci-dessous sont fermés (renforcement). Preuve : `tests_device_rights.sql` §1. Restent ouverts : le plancher de
  numérotation et la dernière présence (condition de levée inchangée, mission 7).
- **Risque.** Une session de l'API compromise peut déplacer un terminal vers un autre événement ou point de vente
  (`event_id`, `pos_id`), abaisser ou relever le plancher de ses numéros de séquence (`next_seq_floor` : rejeu ou refus
  de lots hors ligne), ou falsifier sa dernière présence. Elle peut aussi réécrire `personal_phone` et `app_mode`, et
  contourner ainsi la règle du téléphone personnel (mode `KEYPAD_TPE` seulement ; revue post-fusion de la mission 5a,
  SEC-3). Le statut, les clés, l'empreinte du certificat et le prestataire restent protégés ; chaque requête relit le
  statut et le prestataire en base.
- **Condition de levée.** Ces écritures passent par des fonctions de la base qui contrôlent la transition (affectation
  dans le périmètre de l'organisateur, plancher qui ne descend jamais, présence posée par l'heure de la base), et les
  `UPDATE` directs correspondants sont retirés à `cashless_app`.
- **Test qui échoue si la limite s'élargit** : `packages/ledger-sql/tests/tests_device_rights.sql` §1 (« cashless_app :
  colonnes de device modifiables, liste exacte »).

**Levé le 04/11/2026 par la mission 7 (lots WP07 et WP08 ; constaté par WP21).** `cashless_app` n'a
plus aucun `UPDATE` direct sur `device`, `station_name` compris : la présence, la version de
snapshot acquittée, le nom de station et le plancher de numérotation passent par des fonctions de la
base (`record_device_heartbeat`, `ack_offline_snapshot`, `set_device_station_name`, migrations
`0022` et `0048`).

Preuve, rejouée sur `cashless_wp21c` (PASS) : `tests_device_rights.sql` (89 assertions ; §1 «
colonnes de device modifiables, liste VIDE (OP-N69 levée) » et §2 « OP-N69 levée : station_name
n'est plus modifiable en direct »). La suite échoue si une colonne redevient modifiable.

### OP-N70 — Suites de la mission 4 encore sous le faux d'identité du terminal (20 octobre 2026)

Signalé par l'implémentation de WP12 (mission 5a). **Écart à la définition de fin de WP12, accepté ; levé par WP18 de
la même mission ; décision du porteur du 20/10/2026 ; ADR-113.**

- **Constat.** La définition de fin de WP12 voulait toute la suite de la mission 4 avec l'identité réelle. Ces suites
  sont servies en clair par supertest, donc sans certificat client : elles tournent sous `DEVICE_IDENTITY_FAKE=1`
  (posé par `apps/api/test/support/app.ts`). L'identité réelle est prouvée en HTTPS mTLS par `media-port-swap.spec.ts`
  (`POST /v1/taps`, `POST /v1/media/auth-keys`, matrice des preuves NFR-002, rejeu, révocation, suspension).
- **Risque.** Une route de terminal de la mission 4 dont le comportement dépendrait de l'identité réelle (par exemple
  un champ lu autrement que par le faux) ne serait pas couverte. Le faux est refusé en production
  (`production-guard.spec.ts`).
- **Condition de levée (WP18).** Au moins une route de chaque contrôleur de terminal de la mission 4 servie en HTTPS
  réel avec le terminal de test ; un test échoue si une route de terminal n'est couverte par aucun test en identité
  réelle.
- **Levé le 21/10/2026 par WP18.** `apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts` croise les
  routes de terminal du contrat (`security` avec `deviceSignature`) et celles que les processus servent sous
  `DeviceGuard` : une route sans cas fait échouer la suite ; chaque route est servie en HTTPS mTLS avec le terminal de
  test (acceptée avec les trois preuves, refusée pour chacune). Les autres suites de la mission 4 restent sous le faux,
  refusé en production.

### OP-N71 — Idempotence : rejeu sur une autre ressource et entre personnes (21 octobre 2026)

Signalé par la relecture de WP16 (mission 5a), défaut antérieur (mission 1, `contracts/idempotency.md` règle 3).
**Correction transverse décidée par le porteur le 21/10/2026 ; confiée à WP18 de la mission 5a ; ADR-116.**

- **Constat.** `requestHash` (`apps/api/src/idempotency/request-hash.ts`) prend le modèle de route, pas le chemin
  concret, et `api_idempotency` rangeait la clé sous (prestataire, portée, clé). `POST /v1/devices/A/revoke` puis
  `POST /v1/devices/B/revoke` avec la même `Idempotency-Key` et le même motif : le second rejoue le 200 du premier, B
  reste actif. Toutes les routes `/:id` idempotentes sont concernées (prestataire, personnes, événements, approbations,
  médias, terminaux).
- **Risque.** Action de sécurité (révocation, suspension) crue faite et non faite ; réponse d'une ressource rendue à
  une personne du même prestataire qui n'y a pas droit, si elle connaît la clé.
- **Condition de levée (WP18).** Empreinte sur le chemin concret et clé liée à l'appelant (ADR-116), règle 3 du contrat
  mise à jour ; tests : même clé sur deux `:id` → `409 IDEMPOTENCY_KEY_REUSED` (statut de `openapi.yaml` et du code ;
  « 422 » corrigé, décision du porteur du 21/10/2026), même clé par deux personnes → aucune réponse de l'autre, rejeu
  légitime inchangé ; consigne de déploiement pour les lignes antérieures.
- **Levé le 21/10/2026 par WP18 (ADR-116).** Empreinte sur le chemin concret (sans la chaîne de requête) et liée à
  l'appelant (personne, terminal ou festivalier, posés par les gardes) ; règle 3 de `kitty-specs/fondations-grand-livre-01M4AY8M/contracts/
  idempotency.md` mise à jour. Tests : `apps/api/test/integration/devices/admin.spec.ts` (« ADR-116 : même clé sur deux
  `:id` → 409… ; B traité par sa clé », « ADR-116 : même clé par une autre personne du prestataire → aucune réponse de
  l'autre »), `integration/transverse/idempotency.spec.ts` (chaîne de requête hors de l'empreinte : rejeu),
  `unit/idempotency/request-hash.spec.ts`, `integration/media/personalization.spec.ts` (autre personne : 409).
  Consigne de déploiement : celle d'OP-N54 ci-dessus. Effet : sur une route de guichet, une autre personne qui reprend
  la même clé reçoit `409`.

### OP-N72 — Enrôlement : limite en amont absente, chaîne d'audit de la plateforme sollicitée (21 octobre 2026)

Limite résiduelle de la correction d'ADR-117 (relecture de WP14, cycle 2 ; mise en œuvre par WP18, migration 0030).
**Proposé par l'agent le 21/10/2026, confirmé par le porteur le même jour ; bloque la production : non ; levé par la
mission 13 (recette V1).**

- **Constat.** `POST /v1/device-enrollments` est une route sans compte. La migration 0030 rend les limites atomiques
  (verrous de l'adresse puis du code pris avant le contrôle, dans la même transaction), agrège l'adresse par /64 en
  IPv6 (IPv4 encapsulée ramenée à IPv4) et nomme la limite franchie (`limit: code|address`). Restent : chaque refus d'un
  code inconnu écrit dans la chaîne d'audit de la plateforme et en prend le verrou ; un attaquant qui dispose de
  nombreuses adresses (/64 différents) n'est borné que par adresse.
- **Risque.** Déni de service : une rafale de refus depuis de nombreuses adresses sérialise les écritures de la chaîne
  d'audit de la plateforme et ralentit les autres refus d'enrôlement. Pas de fuite ni d'enrôlement indu (60 bits
  d'entropie par code, 10 essais par code et par heure).
- **En place.** Limites par code et par adresse, atomiques ; au-delà, une seule trace `RATE_LIMITED` par fenêtre, les
  `429` suivants n'écrivent rien.
- **Condition de levée.** Limite de débit en amont (répartiteur ou passerelle) sur `POST /v1/device-enrollments`,
  décrite et vérifiée sur l'environnement de recette.
- **Test qui échoue si la limite s'élargit** : `packages/ledger-sql/tests/tests_enrollment_limits.sql` §3 (limite par
  /64) et §5 (rafale qui a passé le contrôle préalable : écritures bornées) ;
  `apps/api/test/integration/devices/enrollment-limits.spec.ts` (requêtes simultanées, IPv6).

### OP-N73 — Autorité des terminaux et signataire des jetons d'appareil : faux seulement (21 octobre 2026)

Signalé par la relecture de WP18 (mission 5a, constat M1) ; prévu par la contrainte C-004 de la mission (« pas
d'adaptateur AWS »), jamais nommé en dette. **Bloque la production : oui ; levé par la mission
12b, avec OP-N41 (déplacé de la mission 7 le 29/10/2026, ADR-138) ; décision du porteur du
21/10/2026 ; ADR-119.**

- **Constat.** `DeviceCaPort` et `TokenSignerPort` n'ont que des faux (`apps/api/src/device-ca/fake-device-ca.ts`,
  `apps/api/src/device-tokens/fake-token-signer.ts`) ; l'adaptateur réel (KMS ou HSM) attend la région (OP-N11).
- **Risque.** Aucun en production tant que la garde tient : le démarrage est refusé ; la dette bloque la mise en
  service. Un faux câblé en production rendrait les certificats et les jetons d'appareil forgeables par qui lit le
  code.
- **En place.** Les deux faux refusent de se construire en production et la garde de démarrage refuse un processus qui
  en porte un.
- **Condition de levée.** Adaptateurs réels des deux ports (clé de l'autorité et clé de signature des jetons hors du
  code et de l'environnement, SPEC §13.2), garde levée pour ces deux ports seulement.
- **Test qui échoue si la limite s'élargit** : `apps/api/test/integration/end-to-end/device-latency.spec.ts` (« faux de
  … seul : démarrage refusé », pour l'autorité et pour le signataire), `apps/api/test/unit/production-guard.spec.ts`.

### OP-N74 — Enrôlement sur un événement clos ou un point de vente supprimé (21 octobre 2026)

Relevé par la revue post-fusion de la mission 5a (DRIFT-1). **Écart à la spécification, consigné ; bloque la production :
non ; décision du porteur du 21/10/2026 ; ADR-120. LEVÉ le 26/10/2026 par la mission 5b (WP06, vérifié par WP14).**

- **Levée.** Migration `0035_enrollment_event_state.sql` (décision du porteur `DM-01M5HKDXSTFR5JS88GZ4B2EA5J`) :
  `create_device_enrollment_code` relit l'événement sous `FOR SHARE` et refuse (`CL031`) `CLOSED` pour tout mode et,
  dès `CLOSING`, les modes `CATALOG_POS` et `KEYPAD_TPE` (`TOPUP_DESK` permis jusqu'avant `CLOSED`) ; `enroll_device`
  refuse de même d'après l'événement du code et contrôle que le point de vente existe, appartient au prestataire et à
  l'événement du code (« supprimé » = absent, aucune suppression n'existe en base). Aucun terminal, code, jeton ni
  historique écrit sur un refus ; l'essai `EVENT_CLOSED` et l'audit sont écrits hors de la transaction annulée (ADR-117).
  Preuves : `packages/ledger-sql/tests/tests_enrollment_event_state.sql` (matrice états × modes : « émission : aucun
  code écrit pour les 16 refus », « émission : les 12 codes permis sont écrits », « enrôlement : aucun code refusé
  consommé, aucun terminal créé », « point de vente rattaché à un autre événement que celui du code : CL031 »,
  verrou `FOR SHARE` prouvé par `pgrowlocks`).
- **Historique du constat (21/10/2026).** Ce qui suit décrit l'écart tel qu'il était avant la levée.

- **Constat.** La spécification de la mission 5a (cas limites) exige le refus d'un enrôlement dont le code vise un
  événement clos ou annulé, ou un point de vente supprimé entre l'émission et l'enrôlement.
  `create_device_enrollment_code`, `check_device_enrollment_code` et `enroll_device` (migration 0022) ne lisent ni
  l'état de l'événement ni celui du point de vente. L'état « annulé » n'existe pas dans `event_status` (le plus proche
  est `CLOSED`).
- **Risque.** Un code encore valide (24 h par défaut, 7 jours au plus) enrôle un terminal affecté à un événement clos.
  Faible en 5a : le terminal n'encaisse rien tant que la mission 5b n'a pas livré le paiement ; il grandit avec elle.
- **En place.** Le code est à usage unique, borné dans le temps, révocable avec le terminal ; l'enrôlement est audité.
- **Condition de levée.** `create_device_enrollment_code` et `enroll_device` refusent un événement `CLOSED` (et les
  états de clôture que la mission 5b jugera bloquants) et un point de vente supprimé ; test pgTAP par refus, aucune
  ligne écrite.
- **Test.** Aucun test ne fige ce manque : c'est un contrôle absent, pas un droit qui peut s'élargir (même cas
  qu'OP-N55).

### OP-N75 — Purges des nonces et des essais d'enrôlement exécutées par l'API publique (21 octobre 2026)

Fiche de la limite acceptée par ADR-114 (décision du porteur du 20/10/2026), complétée après la revue post-fusion de
la mission 5a (SEC-1). **Bloque la production : non ; levée par la mission 7 ; décision du porteur du 21/10/2026.**

- **Constat.** `post-roles.sql` (section 4a) accorde à `cashless_app` `EXECUTE` sur `purge_device_request_nonces` et
  `purge_device_enrollment_attempts` (SECURITY DEFINER), appelées par le travailleur `device-purge` de l'API publique.
- **Risque.** Droit plus large que le plan : une session de l'API compromise peut lancer les purges à volonté. Chaque
  purge ne retire que des lignes hors de leur fenêtre, à l'heure de la base.
- **Condition de levée.** Rôle et connexion de maintenance dédiés (mission 7, qui revoit déjà les droits de la base :
  OP-N68, OP-N69), `EXECUTE` retiré à `cashless_app`.
- **Test qui échoue si la limite s'élargit** : `packages/ledger-sql/tests/tests_device_purge_window.sql` (aucune purge
  ne retire un nonce encore dans sa fenêtre ni un essai de moins de 24 h) et les listes figées de
  `tests_execute_grants.sql`.

**Levé le 04/11/2026 par la mission 7 (lots WP08 et WP10 ; constaté par WP21).** Le rôle
`cashless_maint` et le processus `maintenance` (`DATABASE_URL_MAINT`) exécutent seuls
`purge_device_request_nonces` et `purge_device_enrollment_attempts` (`post-roles.sql` §8g) ;
`EXECUTE` retiré à `cashless_app` et refusé à `cashless_tagkeys`.

Preuves, rejouées sur `cashless_wp21c` (PASS) : `tests_device_purge_window.sql` (9 assertions,
appelée sous `cashless_maint` : « cashless_app n'exécute plus purge_device_request_nonces (OP-N75)
», aucune purge ne retire une ligne encore dans sa fenêtre) et `tests_execute_grants.sql` (liste
figée des fonctions de `cashless_maint`). Le refus d'un `DATABASE_URL_MAINT` propriétaire ou superutilisateur en production est
levé (OP-N95 point 3, 04/11/2026).

### OP-N77 — Secrets de l'API exigés par tous les processus (23 octobre 2026)

Constaté par la relecture de WP08 de la mission 5b (constat 2) ; défaut antérieur à la mission. ADR-125.
**Bloque la production : non ; levée : mission 13 (recette V1).**

- **Constat.** `loadConfig` est commun à tous les processus ; en production, les trois secrets HMAC de l'API sont
  obligatoires dans l'environnement des processus des clés, d'administration des clés et de personnalisation.
- **Risque.** Un processus compromis qui n'a pas besoin de ces secrets les obtient quand même (empreintes des PIN,
  codes d'enrôlement, registre d'idempotence) : surface d'exposition plus large que nécessaire.
- **Condition de levée.** Chaque processus n'exige et ne reçoit que ses propres secrets ; test qui le prouve par
  processus.
- **Test qui échoue si la limite s'élargit** : `apps/api/test/unit/config.spec.ts` (liste fermée des secrets
  obligatoires en production).

### OP-N78 — Registre des essais de PIN sans purge (26 octobre 2026)

Constaté par la relecture de WP07 de la mission 5b. ADR-127. **Bloque la production : non ; levée : mission 13
(recette V1), décision du porteur du 26/10/2026.**

- **Constat.** `vendor_pin_check` (migration `0031_vendors.sql`) garde chaque essai de PIN ; aucune fonction ni aucun
  travailleur ne retire les lignes hors de leur fenêtre (contrairement aux nonces et aux essais d'enrôlement,
  OP-N75).
- **Risque.** Croissance sans limite de la table (volume, durée des sauvegardes, coût des requêtes de comptage des
  essais) ; aucune donnée secrète n'y est stockée (pas de PIN), donc pas de risque de confidentialité.
- **Condition de levée.** Fonction de purge bornée à la fenêtre de comptage des essais (aucun essai encore compté ne
  disparaît), exécutée par un rôle dédié (même décision qu'OP-N75) ; test pgTAP qui le prouve.

### OP-N79 — Session de vendeur : `vendor_id` hors de la clé composite (26 octobre 2026)

- **LEVÉ le 18/11/2026 (mission 11a)**, ADR-216. **Mécanisme.** Migration
  `0090_sale_attribution_vendor_key.sql` : clé `(id, vendor_id)` sur `vendor_session` et clé
  étrangère `sale_attribution_session_vendor_fk`, qui refuse une attribution dont le vendeur n'est
  pas celui de la session.
- **Test de levée.** `packages/ledger-sql/tests/tests_vendor_session_key.sql` (11 tests :
  attribution (session A, vendeur B) refusée en `23503`). **Test de borne inversé.** La seconde
  barrière ne manque plus ; `tests_payment_rights.sql` et `tests_11a_rights.sql` figent les droits
  qui laissaient seule la première barrière.
- **Mutation vérifiée** (WP01, rejouée en relecture). `DROP CONSTRAINT
  sale_attribution_session_vendor_fk` : le cas (session A, vendeur B) passe, le test `23503` échoue.

Proposé par la relecture de WP07 de la mission 5b. ADR-127. **Bloque la production : non ; durcissement reporté par le
porteur le 26/10/2026 ; levée proposée : mission 11, avec OP-N76.**

- **Constat.** La référence de `sale_attribution` vers `vendor_session` ne porte pas `vendor_id` : le schéma n'impose
  pas que le vendeur d'une vente soit celui de la session désignée. Seule la fonction d'écriture le garantit.
- **Risque.** Une écriture directe dans `sale_attribution` pourrait attribuer une vente à un autre vendeur que celui
  de la session. Ce chemin est fermé depuis WP07 (`REVOKE INSERT, UPDATE ON sale_attribution FROM cashless_app`) ;
  il reste une seule barrière au lieu de deux.
- **Condition de levée.** Clé composite `(vendor_session_id, vendor_id)` référencée par `sale_attribution` (retouche de
  `0033_payments.sql` ou nouvelle migration), avec test pgTAP d'une attribution incohérente refusée.
- **Test qui échoue si la limite s'élargit** : `packages/ledger-sql/tests/tests_payment_rights.sql` (WP07 :
  `cashless_app` n'a ni `INSERT` ni `UPDATE` sur `sale_attribution`).

### OP-N80 — Pool du verrou d'essai de PIN : dimensionnement non mesuré (26 octobre 2026)

Report de la relecture WP09 cycle 3 (mission 5b), traité par WP14 : **consigné, non mesuré en charge** ; report à la
mission 13 accepté par le porteur le 26/10/2026 (ADR-130). **Bloque la production : non** (disponibilité, aucun droit élargi).

- **Constat.** `SessionLock` tient une connexion de son pool dédié pendant toute la requête d'ouverture de session
  (vérification argon2 comprise, ~60 ms). Si plus de `poolSize` ouvertures arrivent ensemble, `pool.connect` attend
  10 s puis la requête échoue en `500` (pas de `429`).
- **Risque.** Un pic d'ouvertures de session (ouverture de l'événement : tous les terminaux ensemble) dégrade
  l'ouverture ; aucune écriture partielle (rien n'est consommé avant le verrou).
- **Condition de levée.** Mesure en charge à la recette V1 (mission 13), puis taille du pool ajustée ou refus `429`
  immédiat à la saturation ; test qui échoue si la saturation rend un `500`.
- **Test.** Aucun à ce jour : le comportement n'a pas été mesuré par la mission 5b (preuve de la concurrence des
  essais : `vendor-sessions.spec.ts`, « essais simultanés depuis 5 terminaux »).


### OP-N81 — Adaptateurs PSP réels et coffre des secrets reportés (27 octobre 2026)

Décision du porteur au cadrage de la mission 6 (`recharges-caisses-psp-01M5YEBA`, DM `01M5YF39MKBNF9VHJ7JM49B0SE` et
`01M5YF3D9YZZPHP1FGEWH3E4ME`) : faux gardés plus longtemps que prévu (règle 1 de `CLAUDE.md`) ; ADR-131.
**Bloque la production : oui** pour les recharges en ligne.

- **Constat.** Aucun accès de test PSP n'existe (action 11). La mission 6 livre le port `PspAdapter` (initier,
  vérifier une notification, interroger un statut, lire un relevé), un faux par fournisseur et le port
  `PspSecretStore` avec un faux coffre ; pas d'adaptateur Wave, Orange Money, PayDunya ni Stripe, ni d'adaptateur AWS
  Secrets Manager.
- **Risque.** Aucun en production tant que la garde tient : les faux refusent le démarrage ; les recharges en ligne
  ne sont simplement pas servies. Risque résiduel : un adaptateur réel écrit plus tard sans vecteurs du PSP
  (vérification de signature non éprouvée).
- **Condition de levée.** Accès de test obtenus ; adaptateurs écrits et essayés contre le bac à sable de chaque PSP
  (vecteurs de signature réels) ; adaptateur AWS Secrets Manager (dépendance vérifiée et épinglée, région OP-N11) ;
  faux retirés des processus de production.
- **Test.** `apps/api/test/unit/production-guard.spec.ts` : chaque faux PSP et le faux coffre refusés en production.

### OP-N82 — Remboursement au payeur d'un paiement non crédité (27 octobre 2026)

Plan de la mission 6 (R-11, R-17). **Bloque la production : non.**

- **Constat.** Un paiement réussi chez le PSP mais non créditable (plafond réglementaire, 3-D Secure non attesté,
  plafond de carte du jour, grand livre au-delà de `CLOSING`) n'écrit rien au grand livre (un succès notifié après une
  annulation confirmée est crédité s'il est recevable : R-20, décision du porteur du 29/10/2026) ;
  une anomalie (`PSP_TOPUP_OVER_LIMIT` ou `PSP_TOPUP_NOT_CREDITED`) porte le montant à rendre. La plateforme n'a aucun
  canal de remboursement PSP (« pas de remboursement par carte en V1 »).
- **Risque.** Argent du payeur détenu sans écriture jusqu'au remboursement manuel ; suivi par l'anomalie et, au
  rapprochement (mission 9), par l'écart entre relevé et grand livre.
- **Condition de levée.** Remboursement par l'adaptateur (mission des adaptateurs réels), écriture et clôture de
  l'anomalie dans la même transaction.
- **Test.** Tests de la mission 6 : aucune écriture et une anomalie avec montant pour chaque cas non créditable.
- **Complété le 29/10/2026 (WP14).** Écart ATTENDU au contrôle « grand livre = relevé du PSP » (mission 9) : un paiement
  non crédité est dans le relevé du PSP et pas au grand livre ; les anomalies `PSP_TOPUP_OVER_LIMIT` et
  `PSP_TOPUP_NOT_CREDITED` (et `PSP_MISMATCH` d'une notification ou d'une contestation introuvable après 24 h) sont à
  exclure du rapprochement ou à représenter (constat A16, report mission 9). Preuves : `psp-process.spec.ts`,
  `psp-card.spec.ts`, `topup-journey.spec.ts` (étape 5).

### OP-N83 — Cause d'un blocage de portefeuille (29 octobre 2026) — CORRIGÉ en cycle 2 de WP14

Défaut de la migration `0038`, corrigé en deux temps : `0039` (cause autre PUIS contestation) puis `0042`
(WP14 cycle 2, décision du porteur du 29/10/2026 : toutes causes, quel que soit l'ordre). **Bloque la production : non.**

- **Constat.** `block_wallet_after_chargeback` posait le marqueur sur un portefeuille déjà `BLOCKED` pour une autre
  cause (0039 l'évite). Dans l'ordre inverse (contestation PUIS perte), l'autre cause ne laissait aucune trace et le
  déblocage « contestation » remettait `ACTIVE` un portefeuille encore bloqué. `0039` n'avait pas couvert ce cas ; la
  limite n'avait pas été validée par le porteur (ADR-134 corrigé).
- **Correction (`0042`).** `wallet.other_block` ; le déclencheur `wallet_block_cause_guard` le pose à toute écriture de
  `BLOCKED` qui n'annonce pas l'origine « contestation » (même sur un portefeuille déjà `BLOCKED`), l'efface au retour
  à `ACTIVE` ; `unblock_wallet` refuse (CL029) si `other_block` ; la demande API refuse d'emblée (409). `cashless_app`
  n'écrit pas la colonne (`post-roles.sql`, 7b-bis). Tests : `tests_psp_topups.sql` (perte puis contestation,
  contestation puis perte, cause tierce puis deux contestations), `wallet-unblock.spec.ts`.
- **Limite restante.** Un chemin qui écrit lui-même `ACTIVE` lève aussi l'état de contestation (c'est la personne
  habilitée de l'autre cause qui débloque). Un futur chemin de blocage doit écrire `BLOCKED` sans annoncer l'origine
  « contestation » : seul `block_wallet_after_chargeback` le fait. **Fonctions à faire relire par une personne** :
  `block_wallet_after_chargeback`, `unblock_wallet`, `wallet_block_cause_guard`.

### OP-N84 — Octroi provisoire des anciennes signatures de caisse à `cashless_app` (29 octobre 2026) — LEVÉ

`[A8-DETTE]` de WP05, levé le 29/10/2026 en cycle 2 de WP14 (décision du porteur ; ADR-135). **Bloque la production : non.**

- **Fait.** `take_deposit`, `refund_deposit`, `refund_cash_due` retirées de `post-roles.sql` (section 4). Le moteur
  passe par `take_deposit_for_session`, `refund_deposit_for_session`, `refund_cash_due_for_session` (0036) et, pour la
  caution prélevée sur le solde ou une caution due (aucun compte désigné), par `take_deposit_from_balance` et
  `refund_deposit_from_balance` (0041, plus étroites que le droit retiré). Test `[A8-DETTE]` inversé.
- **Conséquence fonctionnelle (signalée au porteur).** Le moteur refuse une commande de caution qui désigne un compte
  d'argent (`moneyAccount`, ex. banque) : aucun appelant de production n'en avait (le guichet exige espèces ET session).
  Une caution payée à part sur un compte autre qu'une caisse exigerait une fonction à compte libre : non créée.

### OP-N85 — Reprise de la caution due après un arrêt entre COMMIT et `afterCommit` (29 octobre 2026)

Relevé par la relecture de WP12 (affaiblit légèrement A33, fenêtre étroite). **Bloque la production : non.**

- **Constat.** La caution due est prise après le COMMIT du crédit (transaction distincte). Si le processus s'arrête
  entre les deux, elle n'est reprise qu'au rejeu d'une autre notification ou d'un autre crédit du même bracelet.
- **Risque.** Bracelet crédité dont la caution due n'est pas prise ; l'argent n'est pas perdu (suivi par le
  portefeuille), la caution reste `DUE`.
- **Condition de levée.** Reprise des cautions `DUE` par le travailleur, test qui tue le processus entre COMMIT et
  `afterCommit`.

### OP-N86 — Droits de `cashless_app` plus larges que nécessaire (29 octobre 2026)

Constat 1 de la revue post-fusion de la mission 6 ; consigné sur décision du porteur du 29/10/2026 (ADR-136).
**Bloque la production : non.**

- **Constat.** (1) `psp_poll_candidates(int)` et `psp_events_to_retry(int)` (0038, `post-roles.sql`) voient les
  recharges et notifications de tous les prestataires ; `cashless_app`, donc le processus public, peut les appeler.
  (2) Le `psp-poller` tourne sous `cashless_app` (`apps/api/src/db/psp-poller-db.module.ts`), sans rôle dédié.
  (3) `cashless_app` garde un INSERT direct sur `anomaly` (droit antérieur à la mission), utilisé par 5 sites de la
  mission 6 (`psp-payment-processor.ts`, `event-dispatcher.ts`, `chargeback.service.ts`).
- **Raison.** Le retrait exige un rôle de base dédié et une fonction d'ouverture d'anomalie : hors du périmètre de la
  mission 6, reporté à la recette.
- **Risque.** Une connexion `cashless_app` compromise lit des données de tous les prestataires (identifiants de
  recharge, notifications) et écrit des anomalies arbitraires.
- **Mission qui lève.** Mission 13.
- **Condition de levée.** Rôle dédié au `psp-poller` ; les deux fonctions et l'INSERT sur `anomaly` retirés à
  `cashless_app` au profit d'une fonction de la base ; tests de borne inversés.
- **Test qui échoue si la limite s'élargit.** `tests_cash_psp_rights.sql` : liste exacte des rôles `cashless_*` qui
  exécutent les deux fonctions, liste exacte de ceux qui ont INSERT sur `anomaly`.

**Complément du 04/11/2026 (mission 7, WP08 ; ADR-141).** Le plan de la mission 7 retirait
l'`INSERT` direct sur `anomaly` à `cashless_app` ; décision du porteur du 30/10/2026 : il est GARDÉ
(sept appelants de l'API dont `psp-payment-processor.ts` ×2, `event-dispatcher.ts` ×2,
`chargeback.service.ts`, `reversal.service.ts`), statu quo d'OP-N86, levé en mission 13. La mission
7 ajoute `open_offline_anomaly` (écriture des anomalies hors ligne par fonction) sans rien retirer.
Test de borne inchangé : `tests_cash_psp_rights.sql` (liste exacte des rôles `cashless_*` qui ont
`INSERT` sur `anomaly`).

### OP-N87 — Garde « aucune espèce sans session » : dépend du propriétaire de la fonction (29 octobre 2026)

Constat 2 (majeur) de la revue post-fusion de la mission 6 ; consigné sur décision du porteur du 29/10/2026
(ADR-136). **Bloque la production : non, sous réserve du rôle propriétaire.**

- **Constat.** `posting_cash_desk_guard` (0036, `SECURITY DEFINER`) fait `PERFORM 1 FROM cash_desk ...` puis
  `IF NOT FOUND THEN RETURN NEW`. La RLS de `cash_desk` est forcée : si le propriétaire de la fonction ne la contourne
  pas (ni superutilisateur ni BYPASSRLS), la recherche ne trouve rien et la garde laisse passer sans bruit.
- **Raison.** Sûr avec le propriétaire des migrations actuel ; changer la garde modifie une migration fusionnée.
- **Risque.** Écriture en espèces sans session de caisse si le déploiement change de rôle propriétaire.
- **Mission qui lève.** Mission 13 (déploiement).
- **Condition de levée.** Rôle propriétaire vérifié au déploiement, ou garde qui refuse si la recherche est
  impossible.
- **Test qui échoue si la limite s'élargit.** `tests_cash_psp_rights.sql` : le propriétaire de
  `posting_cash_desk_guard()` est `rolsuper` ou `rolbypassrls`.

### OP-N88 — Soldes lus sans verrou avant l'écriture (29 octobre 2026)

Défaut trouvé par la CI de la PR #8 (mission 6) ; décision du porteur du 29/10/2026 : garder le correctif et reporter.
**Bloque la production : non** (aucune garantie affaiblie : la base refuse tout découvert).

- **Constat.** Le moteur répartit certaines écritures d'après des soldes lus avant que `post_transaction` ne verrouille
  les comptes. Pour `CHARGEBACK`, une dépense concurrente faisait refuser l'écriture (RETRY) : corrigé par
  `lockWalletPaidBalance` (`apps/api/src/ledger/db/ledger-queries.ts`), qui appelle `wallet_topup_headroom` pour son
  verrou `FOR UPDATE` sur le solde payé (`959b4cdd`). `PURCHASE` (mission 5b, `enrich` de
  `ledger-engine.service.ts`) lit toujours les soldes promo et payé sans verrou.
- **Raison.** Correctif minimal sans migration ni droit nouveau pour fusionner la PR #8.
- **Risque.** Paiement par bracelet refusé à tort sous concurrence sur un même portefeuille ; interblocage possible,
  faible, entre une contestation et une écriture qui tient d'abord un compte d'identifiant plus petit (RETRY).
- **Mission qui lève.** Mission 13.
- **Condition de levée.** Fonction SQL dédiée (`SECURITY DEFINER`) qui verrouille tous les comptes de l'écriture dans
  l'ordre des identifiants avant la lecture des soldes, utilisée par `CHARGEBACK` et `PURCHASE` ; test déterministe
  pour `PURCHASE`.
- **Test.** `chargeback-concurrency.spec.ts` (cas déterministe, mutation vérifiée) ; `PURCHASE` : aucun à ce jour.

### OP-N89 — Snapshots hors ligne signés par un faux KMS (30 octobre 2026)

Plan de la mission 7 ; décision du porteur du 29/10/2026 (services externes simulés jusqu'à la mission 12b) ; ADR-138.
**Bloque la production : oui** (démarrage refusé, donc aucun hors ligne en production avant 12b).

- **Constat.** Les processus `snapshot-content` (`DecryptPort`, `DataKeyPort`) et `snapshot-signer` (`SignPort`)
  n'ont que le faux KMS (`apps/api/src/kms/fake-kms.ts`), dont les clés se dérivent d'une graine du code.
- **Raison.** Aucun accès AWS avant la mission 12b (feuille de route révisée du 29/10/2026).
- **Risque.** En production, de faux snapshots (bracelet bloqué présenté comme actif) seraient signés et acceptés.
- **Mission qui lève.** Mission 12b (avec OP-N41 et OP-N73).
- **Condition de levée.** Adaptateur AWS des trois ports, un rôle IAM par processus, garde de production levée pour ces
  ports seulement, vérification d'Ed25519 (OP-N13).
- **Test qui échoue si la limite s'élargit.** `test/unit/production-guard.spec.ts` : chacun des deux processus refuse
  de démarrer en production avec le faux ; `GET /offline-snapshots/current` répond `403 OFFLINE_NOT_ALLOWED`
  (`SNAPSHOTS_UNAVAILABLE`) sans clé `ACTIVE`.

### OP-N90 — Rejet réessayable : numéro sans résultat final admis à la clôture (30 octobre 2026)

Plan de la mission 7 (passe contradictoire A24) ; décision du porteur du 30/10/2026 (DM `01M664S4Y4FW6W6TMP76BQGWV7`) ;
ADR-139. **Bloque la production : non.**

- **Constat.** `sync_protocol.md` §7.1-9 : au quatrième `CL007`, rien n'est écrit au registre pour que le terminal
  renvoie l'opération ; `complete_offline_batch` (schéma) refusait de clore un lot dont un numéro n'a pas de ligne.
- **Décision.** `record_offline_retry` écrit `offline_batch_retry` dans la transaction de l'opération ;
  `complete_offline_batch` (remplacée) n'admet un numéro sans ligne que sur cette trace ; trace close au résultat final.
- **Risque.** Un numéro jamais renvoyé reste sans résultat final ni anomalie `SEQ_GAP` (le trou n'apparaît qu'au lot
  suivant).
- **Garde.** Alerte du travailleur `seq-gap-age` si une trace reste ouverte plus de 24 h.
- **Test qui échoue si la limite s'élargit.** `tests_offline_batches.sql` : clôture refusée pour un numéro sans ligne
  ni trace ; trace écrite par la seule fonction (`cashless_app` sans `INSERT`).

### OP-N91 — Droits ajoutés au contrat de la mission 7 (30 octobre 2026)

Tâches de la mission 7 (contradictions relevées par les rédacteurs des lots) ; décisions du porteur du 30/10/2026
(DM `01M667XBV66NBKA5DEFFXY15HM`, `01M667Y1J4DT3HY96ZBCXXMXBT`) ; ADR-140. **Bloque la production : non.**

- **Constat.** `contracts/database-rights.md` ne donnait au signataire ni le rejet d'un brouillon altéré ni la marque
  d'alerte des numéros `RETRY`, et retirait à `cashless_app` toute lecture de `device_journal_import`, dont le
  travailleur d'import a besoin pour trouver les imports en cours.
- **Décision.** `cashless_snapsign` : `EXECUTE` de `discard_offline_snapshot_draft` et `mark_offline_retry_alerted`
  (nouvelle). `cashless_snapcontent` : `append_…_entries`, `seal_…`, `discard_…` de ses brouillons. `cashless_app` :
  `device_journal_imports_processing()` (DEFINER, identifiants seuls). L'audit `SNAPSHOT_PUBLISHED` est écrit par
  `publish_offline_snapshot`, sans droit d'audit pour le signataire.
- **Risque.** API compromise : elle apprend qu'un autre prestataire a un import en cours (identifiants seuls).
  Signataire compromis : il jette des brouillons (déni de publication, rien de publié n'est touché).
- **Test qui échoue si la limite s'élargit.** `tests_execute_grants.sql` (listes figées par rôle) ;
  `tests_offline_batches.sql` : colonnes rendues par `device_journal_imports_processing` figées.

### OP-N92 — Clés de signature des snapshots : lectures et rotation (4 novembre 2026)

Décisions du porteur des 30/10 et 02/11/2026 (WP09, WP13) ; consignées par WP21 ; ADR-142 et
ADR-143. **Bloque la production : non.**

- **Constat.** (1) `cashless_keyadmin` lit cinq colonnes de `snapshot_signing_key` (`key_id`,
  `kms_key_ref`, `operator_id`, `owner`, `status`), jamais `public_key`. (2) `cashless_snapsign`
  exécute `snapshot_public_keys(uuid)` (décision du porteur du 02/11) : le signataire vérifie sa
  signature contre la clé publique du `key_id` de l'en-tête et refuse de publier sinon. (3)
  `KeyAdminPort` gagne `publicKey(ref)`, en lecture seule ; `key-admin` ne reçoit toujours pas
  `sign` (30/10). (4) La rotation est un passage explicite `--once` avec
  `SNAPSHOT_KEY_ROTATE_ACTOR=<uuid>`, sans approbation à deux personnes ; l'acteur est un uuid
  valide non vérifié comme personne existante (aucune table de personnes) ; un arrêt entre la
  création de la clé dans le KMS et la ligne d'audit laisse une clé orpheline (une seule est adoptée
  à la reprise).
- **Raison.** Vérifier avant de publier (défense en profondeur) ; reprendre une rotation sans table
  de travaux ; pas de back-office d'approbation avant la mission 11.
- **Risque.** `cashless_keyadmin` compromis : connaît les références KMS des clés de signature, sans
  clé privée ni écriture. `cashless_snapsign` compromis : lit des clés publiques, sans droit de
  table. Qui lance la rotation peut le faire sous un acteur arbitraire (audit trompeur) et retirer
  la plus ancienne clé. Clé KMS orpheline : coût, aucune exposition.
- **En place.** Les actions `SNAPSHOT_SIGNING_KEY_*` ne s'écrivent que sous `cashless_keyadmin`
  (politique RESTRICTIVE de `0049`, renforcement) ; deux clés valides au plus (`CL054`) ; clé
  publique validée P-256 SPKI par l'API ; aucune écriture directe sur la table.
- **Mission qui le lève.** Mission 13 (recette V1) pour la rotation à deux personnes et l'acteur
  vérifié (avec OP-N56) ; les deux lectures sont une limite acceptée.
- **Condition de levée.** Rotation soumise à une demande approuvée à deux (modèle d'ADR-102), acteur
  contrôlé comme membre, nettoyage des clés KMS orphelines.
- **Tests qui bornent la limite** (ils échouent si elle s'élargit) : `tests_offline_rights.sql` («
  cashless_keyadmin : colonnes lisibles de snapshot_signing_key », liste exacte ; aucune écriture
  directe ; `cashless_snapsign` sans droit de table et `snapshot_public_keys` exécutable) ;
  `snapshot-keys/rotation.spec.ts` (« une troisième clé valide insérée hors rotation : CL054 », «
  audite l'acteur réel, sans clé privée », clé qui n'est pas P-256 SPKI refusée).

### OP-N93 — Snapshots hors ligne : limites du contenu et de la signature (4 novembre 2026)

Relevées aux relectures de WP04, WP11, WP12 et WP13 ; consignées par WP21 ; ADR-144. **Bloque la
production : non.**

- **Constat.** (a) `snapshot_public_keys` rend les clés du prestataire s'il a sa propre clé
  `CENTRAL` `ACTIVE`, sinon celles de la plateforme : les snapshots déjà signés par la plateforme ne
  sont plus vérifiables ensuite. (b) Une entrée est publiée SANS mot de passe quand son
  `pwd_pack_enc` ne s'ouvre pas (`PWD_DEK_RETIRED`, `PWD_DEK_MISSING`, `PWD_OPEN_FAILED`,
  `PWD_INCOMPLETE_ROW`) ; elle n'est pas rejouée par un `DELTA` (le `FULL` suivant, dans l'heure, la
  corrige) ; seul un journal `ERROR` le signale. (c) `content_key_wrapped` ne porte pas la référence
  de la clé d'emballage (sa rotation rend les anciennes versions inouvrables) ; une clé d'accord
  invalide en tête de `offline_snapshot_keys_to_wrap`, au-delà de 500, affame les suivantes ;
  `DekCache` garde les clés de données jusqu'à `tagDekCacheSeconds`. (d) Verrou consultatif de
  session par grand livre (`apps/api/src/db/advisory-session.ts`) et délai d'orphelin
  `SNAPSHOT_ORPHAN_DISCARD_SECONDS` = 600 s (la configuration refuse 300 s ou moins) ; au démarrage,
  le balayage jette un brouillon `READY` tout juste scellé par l'instance précédente (le signataire
  l'écarte par `DRAFT_NOT_READY`, le producteur le régénère). (e) Une `SNAPSHOT_SIGNING_KEY_REF`
  erronée fait jeter chaque brouillon `READY` (alarme 3) ; `publish_offline_snapshot` ne recompare
  que les comptes, l'immuabilité d'un brouillon `READY` repose sur `0044` et les droits de WP08.
- **Raison.** (b) Échec fermé : le terminal refuse un bracelet dont le mot de passe est absent
  (`sync_protocol.md` §6, contrôle 3), alors qu'échouer toute la version retarderait les blocages
  (§4.2-1). Les autres : choix de simplicité des lots, sans droit de base ajouté.
- **Risque.** Disponibilité du hors ligne (bracelet refusé jusqu'à une heure, snapshots retardés) ou
  vérification impossible d'un ancien snapshot ; jamais un droit élargi ni un faux snapshot accepté.
- **Mission qui le lève.** Mission 13 (recette V1) pour (b) à (e), avec alarme chiffrée sur les
  entrées sautées ; (a) : mission des clés de signature par prestataire, 12b (confirmé par le
  porteur le 04/11/2026).
- **Condition de levée.** (a) Servir la clé plateforme tant qu'un snapshot qu'elle a signé est
  servable ; (b) alarme et seuil sur les entrées sautées ; (c) référence de la clé d'emballage dans
  l'enveloppe et pagination par terminal ; (d) reprise du brouillon scellé au démarrage ; (e)
  comparaison du contenu à la publication.
- **Tests qui bornent la limite.** `unit/snapshots-content/orphan-config.spec.ts` (600 s par défaut,
  301 s accepté) ; `unit/snapshots-content/crypto-encryptor.spec.ts` (« clé de données RETIRED :
  entrée sans mot de passe, erreur nommée, aucun clair ») ;
  `integration/snapshots-signer/key-missing.spec.ts` et `draft-tamper.spec.ts` ;
  `integration/snapshots-content/cadence.spec.ts`. Ajoutés par WP21 (part E), dans
  `apps/api/test/integration/end-to-end/offline-bounds.spec.ts` : (a) « OP-N93(a) : clés publiques servies, celles du prestataire OU celles de la
  plateforme » (cas « prestataire avec clé CENTRAL ACTIVE propre : aucune clé de la plateforme n'est
  rendue ») ; famine de (c) « OP-N93(c) : famine au-delà de 500 enveloppes » (cas « 500 terminaux à
  clé d'accord invalide en tête de file : le terminal valide suivant n'est pas servi »).

### OP-N94 — Lots et import de journal : choix consignés (4 novembre 2026)

Écarts relevés aux relectures de WP05, WP08, WP19 et WP20, classés par le porteur les 03/11/2026 ;
consignés par WP21 ; ADR-145 et ADR-146. **Bloque la production : non.**

- **Constat.** (1) Une vente hors catalogue (`CL034`) est écrite sans lignes (`lines_status =
  CATALOG_MISMATCH`). (2) Un `config_id` inconnu donne `OFFLINE_NOT_ALLOWED` avec
  `POLICY_LIMIT_EXCEEDED` en détail (`sync_protocol.md` §7.2 à mettre en accord). (3) L'annulation
  faite depuis le back-office (`sale-reversal-action.ts`) n'appelle pas `reduce_offline_shortfall` :
  la perte hors ligne reste surestimée. (4) Une annulation hors ligne se fait sans tap re-présenté,
  en devise du grand livre, sur une vente du même terminal (exemple de `openapi.yaml`, décision du
  porteur du 03/11). (5) Migration `0050` hors du plan (`0043` à `0049`) :
  `cancel_device_journal_import` (DEFINER, `EXECUTE` à `cashless_app`) passe un import `PENDING` à
  `REJECTED` (et non `FAILED` : garde de `0046` et contrainte `device_journal_import_approved`),
  refuse tant que la demande est valable (`CL001`) ou si l'import n'est pas `PENDING` (`CL053`). (6)
  La base ne vérifie pas que `p_actor` et `p_approver` sont membres du prestataire : l'API le fait
  (même classe qu'OP-N56 et OP-N76). (7) `lock_device(uuid, text)` (DEFINER, `0049`) est appelée par
  cinq services et n'est pas dans `interfaces.md`.
- **Risque.** (1) à (3) : comptabilité des ventes hors ligne et perte mal estimée, jamais
  sous-estimée. (5) API compromise : annule un import `PENDING` de son prestataire (déni, bornée par
  `assert_tenant` et par la demande valable). (6) API compromise : désigne un approbateur d'un autre
  prestataire.
- **Mission qui le lève.** Mission 13 (recette V1) pour (3) et (6) ; (1), (2), (4), (5) et (7) sont
  des choix permanents revus en mission 13.
- **Condition de levée.** (3) `reduce_offline_shortfall` appelée par l'annulation du back-office ;
  (6) contrôle d'appartenance en base ; (7) et (5) reportés au contrat.
- **Tests qui bornent la limite.** `tests_device_journal_import_cancel.sql` (pgTAP) et
  `tests_execute_grants.sql` (5) ; `integration/offline/journal-import-cycle2.spec.ts` (rejet
  `REJECTED`, demande échue, `assertApprover`, SUPERVISOR d'un autre événement : 403) (5, 6) ;
  `integration/offline/processing.spec.ts` (« configuration inconnue : refusée », 2). Ajoutés
  par WP21 (part E), dans `apps/api/test/integration/end-to-end/offline-bounds.spec.ts` : (1) « OP-N94(1) : vente hors catalogue écrite sans lignes »
  (cas « lignes hors catalogue : vente ACCEPTED, metadata.lines_status CATALOG_MISMATCH, aucune
  ligne ») ; (3) « OP-N94(3) : annulation du back-office sans reduce_offline_shortfall » (cas « vente
  hors ligne avec manque, annulée au back-office : soldes rendus, anomalie inchangée (3000, OPEN) »).
  Sans test de borne : (7).

### OP-N95 — Limites de corps et de démarrage des processus de la mission 7 (4 novembre 2026)

Relevées aux relectures de WP10, WP18 et WP20 ; consignées par WP21 ; ADR-147. **Bloque la
production : non** (le point 3, qui pouvait la bloquer, est levé le 04/11/2026).

- **Constat.** (1) Hors `POST /offline-batches` et import de journal, un corps de plus de 100 ko
  donne `500 INTERNAL_ERROR` au lieu de `413` (défaut antérieur à la mission). (2) Le corps de
  l'import est lu jusqu'à 21 037 056 octets (20 lots de 1 Mio plus 64 Kio) puis `413`, seulement
  avec un en-tête `Authorization` et après le jeton et le rôle (`body-gate.ts`). (3) LEVÉ le
  04/11/2026 (décision du porteur) : en production, `assertMaintenanceRole`
  (`apps/api/src/db/maintenance-role-guard.ts`, appelé par `maintenance-db.module.ts`) refuse de
  démarrer si la connexion de `DATABASE_URL_MAINT` est superutilisateur, `BYPASSRLS`, propriétaire de
  la base ou non membre de `cashless_maint`. (4) `gatedBody` lit sans filtre si
  l'identité n'a pas de `preAuthenticate`.
- **Risque.** (1) et (2) : consommation de mémoire par un porteur de jeton valide, `500` trompeur.
  (3) Mauvaise configuration de déploiement qui élargit un droit sans alarme.
- **Mission qui le lève.** Mission 13 (recette V1).
- **Condition de levée.** (1) `413` sur la limite globale ; (4) filtre exigé (refus de démarrer sans
  `preAuthenticate`).
- **Tests qui bornent la limite.** (2) `integration/offline/journal-import-cycle2.spec.ts` (« corps
  de 150 Kio avec jeton invalide 401, avec jeton de CASHIER 403 », « le corps n'est pas lu ») et
  `batches-intake.spec.ts` (`413 BATCH_TOO_LARGE`). Ajoutés par
  WP21 (part E), dans `apps/api/test/integration/end-to-end/offline-bounds.spec.ts` : (1) « OP-N95(1) : corps de plus de 100 ko hors lots et import »
  (cas « refusé, jamais traité, aucune écriture ; le statut est 500 et non 413 (limite connue) ») ;
  (3) « OP-N95(3) : DATABASE_URL_MAINT refusé en production s'il n'est pas cashless_maint » (cas
  « production + propriétaire… : refus nommé », « production + cashless_maint : démarre »,
  « MaintenanceDbModule : production + propriétaire ne compile pas… ») ; (4) « OP-N95(4) :
  gatedBody sans preAuthenticate » (cas « sans filtre, le corps est lu sans contrôle d'identité
  (limite figée) », « configuration réelle : le filtre des terminaux et celui des personnes sont
  présents »).

### OP-N96 — Remontée des terminaux d'un événement : enveloppe de lecture ouverte à l'API (4 novembre 2026)

Décision du porteur du 04/11/2026 (option (a)) ; consignée par WP21 (partie D) ; ADR-148. **Bloque la production : non.**

- **Constat.** `GET /events/{event_id}/device-sync-status` exigeait `event_device_sync_status` et `event_sync_deadline`,
  fermées à `cashless_app` (R-30.12). Migration `0051` hors du plan (`0043` à `0049`) :
  `event_device_sync_status_api(uuid)` (DEFINER, STABLE, lecture seule, bornée au prestataire de session,
  mêmes colonnes que la réponse du contrat), `EXECUTE` à `cashless_app` sur elle seule.
- **Risque.** Lecture, par une API compromise, de l'état de remontée des terminaux de son propre prestataire (déjà
  lisible par RLS) ; aucune écriture ; aucun autre prestataire. Une faute dans la fonction DEFINER élargirait la
  lecture.
- **Mission qui le relit.** Mission 13 (recette V1). Droit permanent, pas de levée prévue.
- **Condition de levée.** Sans objet ; à revoir si une seconde route a besoin de la même lecture ou si le contrat
  change la réponse.
- **Test de borne.** `tests_offline_rights.sql` (6 quater) et `tests_execute_grants.sql` (liste exacte) : échouent si le
  droit ou les colonnes s'élargissent. `offline-sync-status.spec.ts` côté API.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` : mission 13, relecture des droits ajoutés (`0050`, `0051`).

### OP-N97 — Garde des noms secrets de l'API publique : exemption de `pwd_pack_enc` (4 novembre 2026)

Décision du porteur du 04/11/2026 ; consignée par WP21 (partie E) ; ADR-150. **Bloque la production : non.**

- **Constat.** `architecture.spec.ts` interdit aux fichiers de l'API publique de nommer des colonnes secrètes.
  `offline/snapshots/offline-snapshots.service.ts` nomme `pwd_pack_enc` pour mettre en forme l'enveloppe servie au
  terminal. Exemption : ce nom, dans ce fichier, rien d'autre ; liste constante figée par un test.
- **Risque.** Un usage abusif de `pwd_pack_enc` dans ce fichier ne serait plus détecté par la garde. Le blob est
  chiffré sous K_v (l'API ne la détient pas) ; `pwd_pack_dek_id`, `encrypted_dek`, `offline_snapshot_rows` et
  `SELECT * FROM media` restent interdits partout.
- **Mission qui le relit.** Mission 13 (recette V1).
- **Condition de levée.** Mettre en forme l'entrée sans nommer la colonne dans le service, puis retirer l'exemption.
- **Test de borne.** `architecture.spec.ts` : « exemption des noms secrets : liste figée » et « (contrôle) » :
  échouent si la liste grandit ou si le nom est toléré ailleurs.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` : mission 13, à côté d'OP-N96.

### OP-N98 — NFR-005 : un changement ordinaire est visible en un peu plus de 60 s (4 novembre 2026)

Décision du porteur du 04/11/2026 ; consignée par WP21 (partie G) ; ADR-151. **Bloque la production : non.**

- **Constat.** NFR-005 demande qu'un changement non bloquant (nouveau bracelet actif…) soit visible dans une version
  publiée en 60 s au plus. La cadence R-30.5 attend `DELTA_AFTER_MS` = 60 s après la dernière version avant de produire
  un DELTA ordinaire (`snapshot-cadence.ts`), puis il faut la boucle du travailleur (1 s), le chiffrement, l'écriture, la
  signature et la publication. Mesuré par WP21 (partie A) : 60,9 à 62,2 s. Le porteur garde 60 s pour le délai.
- **Risque.** Un changement non bloquant arrive au terminal environ 1 à 2 s plus tard que la cible. Aucun effet sur la
  sécurité : les changements bloquants (blocage, retrait, lot non actif, portefeuille bloqué) partent sans attendre et
  tiennent 5 s (corrigé par la partie G, tranches rendant la main à la boucle).
- **Mission qui le lève.** Mission 13 (recette V1).
- **Condition de levée.** Ramener `DELTA_AFTER_MS` à 55 s au plus (marge pour la production et la signature), ou faire
  reformuler NFR-005 par le porteur (« 60 s après le délai de cadence »), puis retirer l'écart connu du test.
- **Test de borne.** `test/unit/snapshots-content/cadence-bounds.spec.ts` : `DELTA_AFTER_MS` ne dépasse pas 60 000 ms.
  `snapshot-latency.spec.ts` : le cas « autre changement … 60 s » échoue au-delà de 62,5 s (60 s plus la marge
  documentée de 2,5 s) ; le cas strict « ≤ 60 s » est marqué `it.failing` (écart connu OP-N98) et fait échouer la suite
  dès que la mesure passe sous 60 s, pour que l'écart soit retiré avec la dette.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` : mission 13, à côté d'OP-N96 et OP-N97.

### OP-N99 — FR-024 : câblage de deux refus de période non prouvé en intégration (5 novembre 2026)

Relevé par la relecture de WP21 (cycle 1) et la revue post-fusion de la mission 7. **Bloque la production : non.**

- **Constat.** FR-024 refuse une opération hors ligne quand le grand livre est verrouillé (`LEDGER_LOCKED`) ou que la
  date limite de synchronisation est passée (`SYNC_DEADLINE_PASSED`). La règle est prouvée par
  `test/unit/offline/period.spec.ts` (fonction pure) ; en intégration, `processing.spec.ts` ne couvre que
  `PERIOD_CLOSED`. Le passage de ces deux cas depuis `compliance-input.reader.ts` jusqu'au résultat de l'opération
  n'est donc pas prouvé de bout en bout.
- **Risque.** Faible : un défaut de câblage laisserait passer jusqu'à l'écriture une opération sur un grand livre
  verrouillé, que la base refuse alors (`CL003`, l'opération est rejetée sans écriture). Pour une date limite passée,
  la base ne vérifie pas la date à l'écriture (`event_sync_deadline` ne sert qu'aux transitions de cycle de vie,
  `0008`, vérifié le 05/11) : l'opération serait écrite au lieu d'être refusée.
- **Mission qui le lève.** Mission 13 (recette V1), ou plus tôt à la première retouche du traitement des lots.
- **Condition de levée.** Deux cas d'intégration dans `test/integration/offline/processing*.spec.ts` (grand livre
  verrouillé ; date limite passée), chacun refusé avec son code et sans écriture.
- **Test de borne.** `period.spec.ts` (la règle) ; la matrice d'acceptation porte la réserve (FR-024).
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` : mission 13, à côté d'OP-N98.

### OP-N100 — Clés de la passerelle simulées jusqu'à la mission 12b (5 novembre 2026)

Mission 8 (passerelle locale), Décision du porteur (contrainte C-007) ; ADR-155. **Bloque la production : oui.**

- **Constat.** Le port `HARDWARE_KEYSTORE` (signature, accord ECDH, clé publique, jamais d'export) et le port `EDGE_CA` ont chacun un faux de développement.
- **Risque.** Clé de signature des lots et des snapshots, clé de jetons et clé d'accord lisibles par quiconque accède au disque ou à la mémoire du faux. La passerelle n'est pas utilisable en production.
- **Mission qui le lève.** Mission 12b.
- **Condition de levée.** Adaptateurs réels essayés contre le matériel, faux retirés des processus de production, preuves NFR-009 refaites.
- **Test de borne.** Démarrage réel refusé en production avec chaque faux (`apps/gateway/test/...` par réglage).
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N101 — Jetons d'appareil de la passerelle : clé propre (5 novembre 2026)

Mission 8 (passerelle locale), Décision 2 du porteur ; ADR-156. **Bloque la production : oui.**

- **Constat.** La passerelle signe des jetons d'accès (ES256, `aud` de la passerelle) avec une clé propre ; ils ne valent que sur elle et sont refusés au central.
- **Risque.** Secret de signature de jetons sur un mini-PC de site, hors du KMS central.
- **Mission qui le lève.** Mission 12b.
- **Condition de levée.** Clé dans un module matériel non exportable, rotation de `kid` éprouvée.
- **Test de borne.** Jeton de la passerelle refusé par le vérificateur central (`kid`, audience) ; la clé ne signe que l'audience de la passerelle.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N102 — Jeton d'appareil renouvelé sans rotation sur la passerelle (5 novembre 2026)

Mission 8 (passerelle locale), Décision 11 du porteur (passe contradictoire A01) ; ADR-157. **Bloque la production : oui.**

- **Constat.** La passerelle reçoit l'empreinte du jeton de rafraîchissement courant et le certificat de chaque terminal, vérifie la preuve de possession, émet un jeton court et ne fait pas tourner le jeton de rafraîchissement ; rotation forcée au retour.
- **Risque.** Pendant `EDGE`, plus de détection de réutilisation d'un jeton de rafraîchissement volé ; empreintes de jetons de rafraîchissement stockées sur le site.
- **Mission qui le lève.** À fixer par le porteur (changement de contrat pour la rotation).
- **Condition de levée.** Renouvellement avec rotation et canal d'inscription du nouveau jeton au central.
- **Test de borne.** Empreinte différente refusée ; aucun nouveau jeton de rafraîchissement ; empreinte servie à la `PRIMARY` seule ; réutilisation après le retour : famille révoquée.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N103 — Jeton de personne expiré toléré au guichet (5 novembre 2026)

Mission 8 (passerelle locale), Décision 3 du porteur, renforcée (A15), audit versé (décision 18) ; ADR-158. **Bloque la production : oui.**

- **Constat.** Tolérance d'un jeton expiré sur la passerelle seulement, même personne, même terminal, session ouverte, `exp >= activated_at`, 12 h au plus après la bascule, chaque usage audité et versé au central.
- **Risque.** Un compte révoqué pendant la coupure agit jusqu'à 12 h ; une horloge reculée pendant un arrêt fait perdre la durée de l'arrêt.
- **Mission qui le lève.** À fixer par le porteur (proposition : exploitation de la 12b).
- **Condition de levée.** Jeton de coupure délivré par le central à l'ouverture de session.
- **Test de borne.** Un test par condition ; refus à 12 h + 1 s ; redémarrage à horloge reculée de 2 h et de 13 h.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N104 — Ventes `EDGE_ONLINE` : perte maximale chiffrée (5 novembre 2026)

Mission 8 (passerelle locale), Décision 13 du porteur (passe contradictoire A07) ; ADR-159. **Bloque la production : oui.**

- **Constat.** Au rejeu : preuve du bracelet, plafond par vente et par terminal et par heure, rognage au solde central sous verrou, alerte. Aucun changement de contrat.
- **Risque.** Perte maximale par cycle `EDGE` : `min(somme des soldes ; T × H × plafond horaire ; passages réels × plafond par vente)`. Valeurs des plafonds : À SOUMETTRE AU PORTEUR.
- **Mission qui le lève.** Mission 13 (recette V1), ou plus tôt si la signature du terminal est relayée.
- **Condition de levée.** Signature relayée et vérifiée, ou plafonds validés et mesurés.
- **Test de borne.** Vente sans preuve valide ou au-delà du plafond refusée ou rognée avec alerte ; passerelle hostile (2 000 ventes fictives) sous la formule.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N105 — Inscription d'une passerelle par une seule personne (5 novembre 2026)

Mission 8 (passerelle locale), Décision 16 du porteur (contre la recommandation de A16) ; ADR-160. **Bloque la production : oui.**

- **Constat.** Alerte immédiate, délai avant l'envoi des mots de passe (durée À SOUMETTRE AU PORTEUR), rien pour une `STANDBY` non promue.
- **Risque.** Une personne inscrit une passerelle à sa clé d'accord et obtient les mots de passe si l'alerte n'est pas traitée.
  L'option `--by` de l'outil d'inscription (`tools/edge-admin/src/commands.ts`, en tête) n'authentifie pas la personne : c'est
  une étiquette déclarative, non une identité vérifiée (revue post-fusion de la mission 8).
- **Mission qui le lève.** Mission 12b ou 13.
- **Condition de levée.** Approbation à deux à l'inscription.
- **Test de borne.** Alerte levée, aucun colis avant le délai, aucun colis à une `STANDBY`.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N106 — Purge des secrets : mini-PC volé avant la purge (5 novembre 2026)

Mission 8 (passerelle locale), Décision 17 du porteur (passe contradictoire A21) ; ADR-161. **Bloque la production : oui.**

- **Constat.** Purge automatique à la clôture de l'événement et manuelle à deux personnes : clés détruites, colis, empreintes et tables répliquées supprimés.
- **Risque.** Une machine volée avant la purge garde ses secrets ; la révocation à distance ne joint pas une machine débranchée.
- **Mission qui le lève.** Mission 12b (chiffrement au repos sous clé matérielle).
- **Condition de levée.** Données au repos chiffrées sous une clé matérielle détruite à la révocation.
- **Test de borne.** Après la purge, aucun canari sous aucune représentation, aucune clé utilisable ; purge manuelle refusée si la file n'est pas acquittée.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N107 — Passerelle perdue sans rejeu automatique (5 novembre 2026)

Mission 8 (passerelle locale), Décision 4 du porteur ; ADR-162. **Bloque la production : non.**

- **Constat.** Une `ONLINE_REF` inconnue ouvre `EDGE_REPLAY_FAILED` ; un `TOPUP_CASH` suit le refus existant avec une anomalie portant le montant ; résolution à deux.
- **Risque.** Activations et cautions non reversées après reprise forcée, rétablissement manuel ; aucune perte silencieuse.
- **Mission qui le lève.** Mission 13 (recette V1).
- **Condition de levée.** Procédure de rétablissement éprouvée.
- **Test de borne.** Reprise forcée avec journal : anomalies pour les seules opérations non rejouées.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N108 — Dépassement temporaire d'un plafond réglementaire au rejeu d'une recharge espèces (5 novembre 2026)

Mission 8 (passerelle locale), Décision 14 du porteur (passe contradictoire A09) ; à signaler au juriste ; ADR-163. **Bloque la production : oui.**

- **Constat.** Une recharge espèces n'est jamais rejetée pour un plafond au rejeu : deux parts, anomalie `CASH_TOPUP_OVER_LIMIT` résolue à deux.
- **Risque.** Entre la recharge locale et son rejeu, le solde sur la passerelle peut dépasser un plafond réglementaire ; le solde local peut dépasser le solde central de la somme des recharges non rejouées.
- **Mission qui le lève.** Mission 13 (recette V1).
- **Condition de levée.** Avis écrit du juriste.
- **Test de borne.** Recharge dépassant la marge au rejeu : jamais `REJECTED`, deux parts, anomalie avec `media_id` et montant.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N109 — « Même moteur » devient « mêmes modules » (5 novembre 2026)

Mission 8 (passerelle locale), Décision 1 du porteur ; ADR-164. **Bloque la production : non.**

- **Constat.** Base PostgreSQL locale au schéma réduit, règles pures partagées en TypeScript (`@cashless/shared-rules`), mêmes scénarios de référence, le central seul tient la comptabilité.
- **Risque.** Deux implémentations de calcul si le paquet partagé est contourné ; §9 de `SPECIFICATION.md` en retard.
- **Mission qui le lève.** Mission 13 (recette V1).
- **Condition de levée.** Texte de §9 aligné.
- **Test de borne.** Test d'architecture de `packages/shared-rules` ; scénarios de référence lus par les tests de la passerelle.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N110 — `STALE` persisté seulement si confirmé ou plausible (5 novembre 2026)

Mission 8 (passerelle locale), Décision 15 du porteur (passe contradictoire A12) ; ADR-165. **Bloque la production : non.**

- **Constat.** Une époque supérieure vue dans une requête de terminal ne persiste `STALE` que si elle est confirmée par le central ou au plus égale à l'époque détenue + 2 ; levée locale à deux personnes.
- **Risque.** Une époque forgée à `epoch + 1` ou `+ 2` arrête les débits jusqu'à la levée locale (disponibilité, pas argent).
- **Mission qui le lève.** Mission 13 (recette V1).
- **Condition de levée.** Époque signée par le central dans la requête, ou canal de contrôle toujours disponible.
- **Test de borne.** En-tête forgé à 9999 sans arrêt ; à `epoch + 1` arrêt puis levée à deux personnes distinctes.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N111 — Base locale de la passerelle : rôle unique propriétaire des tables (9 novembre 2026)

Mission 8 (passerelle locale), Décision 19 du porteur (relectures de WP16 et WP17) ; ADR-166. **Bloque la production : oui.**

- **Constat.** `edge_app` possède toutes les tables locales (plan : rôle unique). Il peut `DISABLE TRIGGER` ou `DROP` sur `edge_op`, `edge_audit`, `edge_authority`. `TRUNCATE` est refusé par un déclencheur (correction de la décision 19, WP20).
- **Risque.** Un code compromis ou un accès au rôle sur le mini-PC efface l'audit local ou remet l'époque d'autorité à zéro sans trace locale ; les transitions `STALE` → `GRANTED_PENDING` → `ACTIVE` restent des `UPDATE` directs (la base ne prouve pas l'accusé).
- **Mission qui le lève.** Mission 13 (recette V1), ou WP25 si le temps le permet.
- **Condition de levée.** Propriétaire des migrations distinct du rôle d'exécution, sans droit DDL ni `TRIGGER`.
- **Test de borne.** `TRUNCATE` refusé sur les trois tables ; test qui liste les rôles disposant de droits DDL et échoue si un autre rôle qu'`edge_app` les reçoit.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N112 — Ordres à deux personnes : détention des deux clés par une seule personne (9 novembre 2026)

Mission 8 (passerelle locale), Décision 27 du porteur (relecture de WP17) ; ADR-167. **Bloque la production : non.**

- **Constat.** Les deux clés de site sont enregistrées au nom de deux titulaires distincts (exigé par l'outil d'enrôlement) ; rien ne détecte qu'une même personne les détient.
- **Risque.** Levée locale de `STALE` ou purge manuelle décidée par une seule personne.
- **Mission qui le lève.** Hors mission 8 (porteur).
- **Condition de levée.** Clés sur supports personnels avec identification forte, ou procédure d'exploitation vérifiée en recette.
- **Test de borne.** Outil d'enrôlement : deux titulaires identiques ou deux clés identiques refusés.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N113 — Clé TLS client de la passerelle en fichier jusqu'à la mission 12b (9 novembre 2026)

Mission 8 (passerelle locale), Décision 32 du porteur (WP20) ; ADR-168. **Bloque la production : oui (avec OP-N100).**

- **Constat.** Node ne permet pas de signer la poignée de main TLS par une clé non exportable sans module natif ; la connexion mTLS vers le central utilise une clé privée en fichier (`GATEWAY_CENTRAL_CLIENT_KEY_FILE`).
- **Risque.** Une copie du disque du mini-PC permet d'usurper la passerelle auprès du central jusqu'à la révocation de son certificat ; les lots restent signés par la clé `batch` du port, donc une usurpation ne suffit pas à faire accepter des ventes.
- **Mission qui le lève.** Mission 12b (adaptateurs matériels réels).
- **Condition de levée.** Poignée de main signée par le composant matériel (fournisseur OpenSSL/PKCS#11 ou proxy mTLS local) ; fichier refusé au démarrage en production.
- **Test de borne.** Démarrage refusé si le fichier ou son répertoire sont plus larges que 0600, si c'est un lien symbolique, ou si la clé égale la clé `batch` ; canari de clé absent des journaux.
- **Report.** `PROMPTS-A-ENVOYER.md` (mission 12b) et `PRD.md` §2.6.

### OP-N114 — Abandon du retour de l'autorité par une seconde demande (9 novembre 2026)

Mission 8 (passerelle locale), Décision 34 du porteur (relecture de WP11) ; ADR-170. **Bloque la production : non.**

- **Constat.** Une seconde demande `CENTRAL` envoyée avec une autre clé d'idempotence abandonne le rendu en cours (`fail_edge_release`), y compris en `RELEASING`.
- **Risque.** Un double clic ou un acte malveillant d'un `OPERATOR_ADMIN` arrête le retour au central ; le grand livre reste `EDGE`, aucune double dépense ; l'abandon est audité.
- **Mission qui le lève.** Back-office (hors mission 8).
- **Condition de levée.** Confirmation explicite avant l'abandon côté interface, ou champ dédié au contrat.
- **Test de borne.** Seconde demande à autre clé : rendu abandonné, audit `EDGE_AUTHORITY_ABANDONED`, autorité inchangée.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N118 — Purge des secrets de la passerelle : effacement incomplet (11 novembre 2026)

Mission 8 (passerelle locale), WP24, décision 49 du porteur ; ADR-186. **Bloque la production : oui** (avec OP-N106).

- **Constat.** La purge détruit les clés et vide les tables répliquées, mais (1) le WAL de PostgreSQL et les blocs
  libres du disque ne sont pas effacés ; (2) les tables d'ajout seul (audit local, ordres locaux) ne sont pas vidées ;
  (3) la purge ne s'exécute pas dans la même transaction que la file des décisions.
- **Risque.** Une copie du disque faite après la purge peut contenir des secrets ou des données dans le WAL ou les
  blocs libres si le disque n'est pas chiffré ; l'audit local reste lisible ; un arrêt entre la file et la purge
  laisse une purge partielle.
- **Mission qui le lève.** Mission 12b (chiffrement au repos sous clé matérielle, levée commune avec OP-N106).
- **Condition de levée.** Données au repos chiffrées sous une clé matérielle détruite à la révocation ; purge
  interrompue reprise au démarrage.
- **Test de borne.** Canari de purge (`apps/gateway/test/purge/purge-canary.spec.ts`) ; test qui liste les tables
  non vidées par la purge et échoue si la liste s'allonge (à ajouter en WP24 ou WP25).
- **Report.** `PROMPTS-A-ENVOYER.md` (mission 12b) et `PRD.md` §2.6.


### OP-N119 — Purge manuelle forcée sans accusé du central (11 novembre 2026)

Mission 8 (passerelle locale), WP24, décision 50 du porteur ; ADR-187. **LEVÉ le 11/11/2026** par WP25 (partie A) ;
ne bloque plus la production.

- **Constat.** `POST /edge/sync-batches` exige au moins une opération ; la purge manuelle exige une file vide.
  L'ordre de purge ne peut donc pas partir seul : la passerelle attend 30 s puis purge avec la trace
  `CENTRAL_UNCONFIRMED`.
- **Risque.** Si l'audit local est perdu avec le disque, le central ne voit jamais l'ordre de purge.
- **Mission qui le lève.** WP25 de la mission 8.
- **Condition de levée.** Lot sans opération accepté s'il porte des `local_orders` (ajout rétrocompatible sous
  `/edge/*`) ; avec lien, purge seulement après l'accusé.
- **Test de borne.** `apps/gateway/test/purge/purge-manual.spec.ts` (rien n'est détruit avant l'accusé ; purge
  forcée tracée sans lien).
- **Levée.** `0069_edge_spend_order_empty_batch.sql` et `edge-0009_orders_only_batch.sql` : lot sans opération
  accepté s'il porte des `local_orders` (`EMPTY_BATCH_WITHOUT_LOCAL_ORDERS` sinon), `edge_seq` et chaîne inchangés ;
  preuves `apps/api/test/integration/edge/sync/sync-empty-batch.spec.ts`, `apps/gateway/test/queue/orders-only.spec.ts`,
  `apps/gateway/test/purge/purge-with-link.spec.ts`, `apps/gateway/test/e2e/purge-end-to-end.spec.ts`. Reste : sans
  lien, la purge forcée tracée `CENTRAL_UNCONFIRMED` (ordre versé avec le premier lot suivant).
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.
### OP-N122 — Ventes relayées : `pack_verified` cru sans vérification possible (12 novembre 2026)

Mission 8 (passerelle locale), revue post-fusion (constat C1), décision du porteur du 12/11/2026 (« consigner en dette ») ; ADR-188.
**Bloque la production : oui.**

- **Constat.** Pour une vente relayée par la passerelle, le central reprend `tap.pack_verified` (« la passerelle a lu le colis de
  mots de passe du bracelet ») sans pouvoir le vérifier : seule la passerelle détient la clé des colis, par conception.
  Code : `apps/api/src/edge/sync/edge-sync.writer.ts` (`pack_verified: t.pack_verified === true`) ; gardes SQL
  `0070_edge_origin_key_padding.sql` (`TAP_PACK_NOT_VERIFIED`), `0061`, `0064`. Signalé en WP13, jamais consigné avant ce jour.
- **Risque.** Une passerelle compromise affirme `pack_verified: true` sans avoir lu le bracelet. Perte bornée par les plafonds de
  rejeu (ADR-159, OP-N104) : même enveloppe qu'OP-N104, pas de perte supplémentaire.
- **Mission qui le lève.** Mission 12b (preuve signée du terminal relayée et vérifiée par le central, même levée qu'OP-N104).
- **Condition de levée.** Preuve signée du terminal relayée avec la vente et vérifiée par le central.
- **Test de borne.** `apps/api/test/integration/edge/sync/sync-pack-verified-bound.spec.ts` : seul le booléen `true` d'une
  opération reçue d'une passerelle authentifiée est repris ; une vente ainsi crue reste sous les plafonds d'ADR-159 ; tout
  élargissement de la confiance rend le test rouge.
- **Report.** `PROMPTS-A-ENVOYER.md` et `PRD.md` §2.6.

### OP-N123 — Demande de remboursement créée par le back-office (virement bancaire), reportée (13 novembre 2026)

Mission 9a (remboursements), specify ; décision du porteur du 13/11/2026 (« reporter, consigné »).
**Bloque le code : non. Bloque la production : non** (le canal virement reste inutilisable d'ici là).

- **Constat.** SPECIFICATION §8.5 réserve le virement bancaire aux demandes créées par le back-office ; le contrat
  `openapi.yaml` (description de `createMyRefundRequest`) déclare cette opération « à ajouter, non décrite ici ». La 9a
  sert le contrat tel quel : demandes de l'app (Wave, Orange Money), approbation, confirmation, refus, guichet de retour.
- **Conséquence.** D'ici la 9b, un gros montant se rembourse par Wave ou Orange Money (circuit à deux, vérification
  d'identité au-delà de `refund_new_number_max` pour un autre numéro) ou en espèces au guichet de retour.
- **Mission qui le lève.** Mission 9b : ajout rétrocompatible au contrat (création par le back-office, `BANK_TRANSFER`
  avec IBAN), annoncé à l'équipe back-office, même circuit à deux.
- **Condition de levée.** Opération au contrat, servie et testée (demande `BANK_TRANSFER` créée par le back-office,
  approuvée à deux, confirmée).
- **Ce que la 9a sert (confirmé le 16/11/2026).** `BANK_TRANSFER` à la création répond `422 REFUND_NOT_ALLOWED` (`create-refund-request.spec.ts`, « BANK_TRANSFER et autre numéro sans code »). Texte vérifié, inchangé ; test de levée inchangé.
- **Report.** `PROMPTS-A-ENVOYER.md` (mission 9b) et `PRD.md`.
### OP-N120 — Code à usage unique rendu en en-tête de réponse par le faux envoyeur (10 novembre 2026)

Décision du porteur du 10/11/2026 (authentification des festivaliers servie en avance sur la mission 10a, hors Spec Kitty) ;
ADR-180. **Bloque la production : oui (le faux envoyeur refuse le démarrage en production).**

- **Constat.** Le vrai envoi du code (SMS, WhatsApp, repli) arrive avec la mission 12b. D'ici là, l'envoyeur est un faux
  (`apps/api/src/customer-auth/otp-sender.ts`) : il n'envoie rien, n'écrit jamais le code dans les journaux, et la route
  `POST /customer-auth/otp` rend le code dans l'en-tête de réponse `X-Test-Otp-Code` tant que l'envoyeur est un faux.
- **Renforcement fait (10/11/2026, revue).** Essais faux cumulés par numéro sur 30 min glissantes, tous défis confondus :
  le 5ᵉ faux cumulé bloque le numéro 30 min (ADR-180). Limite restante, inhérente : un tiers peut bloquer un numéro
  qu'il connaît en échouant volontairement.
- **Risque.** Quiconque connaît l'URL d'une API de développement ou d'intégration, et le `operator_code` du prestataire,
  se connecte sur n'importe quel numéro (la vérification du numéro est inopérante) : lecture des soldes et de
  l'historique, déclaration de perte de bracelet. Sans effet en production, où le démarrage est refusé.
- **Garde en place.** `createOtpSender` lève `FakeInProductionError` en production et la garde de démarrage nomme
  « l'envoi des codes à usage unique » (libellé d'origine ; depuis la 10a, trois libellés : voir la mise à jour du 20/11/2026 ci-dessous) ; l'en-tête n'est posé que si `isFake` (jamais avec un envoyeur réel). Les limites
  (3 envois par numéro sur 15 min, 10 par adresse et par heure, 5 essais puis blocage 30 min) s'appliquent aussi au faux.
- **Mission qui le lève.** Mission 12b (vrai fournisseur d'envoi, avec le service de clés réel).
- **Condition de levée.** `OtpSender` réel branché ; `FakeOtpSender` et l'en-tête `X-Test-Otp-Code` retirés du code de
  production (le faux ne reste que dans les tests).
- **Test de borne.** `test/unit/production-guard.spec.ts` (envoyeur refusé en production, garde de démarrage) et
  `test/integration/customer-auth/otp.spec.ts` (aucun en-tête avec un envoyeur qui n'est pas un faux) : échouent si
  l'en-tête peut sortir en production.
- **Report.** `PROMPTS-A-ENVOYER.md` (missions 10a et 12b) et `PRD.md`. Fichiers à faire relire par une personne :
  `0080_customer_auth.sql`, section 10 de `post-roles.sql`, `customer-auth.service.ts` (empreintes, blocage, rotation).
- **Mise à jour du 20/11/2026 (mission 10a, ADR-229).** L'envoyeur unique devient une chaîne : `ChainedOtpSender`
  (`customer-auth/otp-chain.ts`) devant trois fournisseurs (`OtpProvider`, `customer-auth/otp-providers.ts`), tous des
  faux jusqu'à la 12b : `FakeWhatsAppProvider`, `FakeSmsPrimaryProvider`, `FakeSmsFallbackProvider`. **Les trois
  refusent le démarrage en production**, chacun avec son libellé dans `processes/bootstrap.ts` : « l'envoi des codes
  par WhatsApp », « l'envoi des codes par SMS (principal) », « l'envoi des codes par SMS (repli) » (au lieu d'un seul
  « l'envoi des codes à usage unique »). Tests de borne : `apps/api/test/unit/customer-auth/otp-chain.spec.ts`
  (section 11 : les trois faux refusent), `apps/gateway/test/e2e/production-refusals.spec.ts` (trois entrées,
  35/35 à la relecture de WP10), `test/unit/production-guard.spec.ts`. L'en-tête `X-Test-Otp-Code` reste tant qu'un
  fournisseur est un faux (`integration/customer-auth/otp-chain.spec.ts` : « un fournisseur non factice : aucun
  en-tête »). **Condition de levée complétée :** les trois fournisseurs réels branchés derrière `OtpProvider` (accusés de
  livraison par `deliveryRef`, lien du titulaire), `X-Test-Otp-Code` retiré, les trois libellés de `bootstrap.ts` et
  `COVERAGE` retirés avec les faux. Limites propres à la chaîne : OP-N166.

### OP-N121 — Secrets PSP de démo et route de simulation du paiement, hors production (10 novembre 2026)

Décision du porteur du 10/11/2026 (recharge PSP testable de bout en bout sur l'API de développement, hors Spec Kitty) ;
ADR-181. **Bloque la production : non (module absent en production, aucun faux n'y est construit).**

- **Constat.** Sans configuration PSP pour l'événement de démo, `POST /topups/psp` répondait `409 PSP_NOT_CONFIGURED`, et
  le faux coffre était vide dans un processus réel. Deux ajouts, hors production seulement : (1) le faux coffre
  (`FakePspSecretStore`) sert, pour les seules références `psp/<titulaire>/demo-wave|demo-om|demo-card`, des secrets
  dérivés (HMAC-SHA256) d'un secret de test PUBLIC du dépôt ; le contrôle titulaire / référence reste en place, toute
  autre référence reste `NOT_FOUND` ; (2) la route `POST /v1/__dev/psp-topups/{topup_id}/outcome`
  (`{ "outcome": "SUCCEEDED" | "FAILED" }`, hors contrat) fabrique la notification du PSP, signée, et la remet au vrai
  chemin de réception (`WebhookIntake`). Pour `FAILED`, la notification est sans effet (R-20) : la route appelle ensuite
  `settleUnpaid`, la finalisation de l'interrogation planifiée. Aucune écriture directe au grand livre.
- **Risque.** Quiconque connaît l'URL d'une API de développement et possède un compte de démo (ou en crée un par
  OP-N120) crédite SON portefeuille de démo sans payer, dans les plafonds de la juridiction. Les secrets de démo sont
  publics : une notification signée avec eux est acceptée pour une configuration `demo-*`. Sans effet en production.
- **Garde en place.** `devPspSimulationImports` ne charge le module que pour `NODE_ENV` = `development` ou `test` ;
  `createDevNotificationFabricator` lève `FakeInProductionError` en production ; le faux coffre reste refusé par la garde
  de démarrage. Seul le festivalier titulaire (`@CustomerAuth()`) peut simuler sa recharge (404 identique sinon),
  recharge `PENDING` seulement, idempotent (identifiant d'événement déterministe).
- **Mission qui le lève.** Mission 12b (adaptateurs PSP réels et vrai coffre, ex-6b).
- **Condition de levée.** Adaptateurs réels branchés ; `DevPspSimulationModule`, les secrets `demo-*` du faux coffre et
  les configurations `demo-*` du script de démo retirés du code livré.
- **Test de borne.** `test/unit/psp-dev-simulation.spec.ts` (coffre : `demo-*` seulement, titulaire contrôlé ; fabricant
  refusé en production ; module absent d'`AppModule` en production ; route 404) et
  `test/integration/topups/dev-simulation.spec.ts` (parcours, titulaire, idempotence, plafond).
- **Report.** `PROMPTS-A-ENVOYER.md` (missions 10a et 12b) et `PRD.md`. Fichiers à faire relire par une personne :
  `fake-psp-secret-store.ts` (dérivation), `psp-simulation.service.ts` et `psp-simulation.module.ts` (gardes).

### OP-N76 — PIN des vendeurs : la base croit l'API pour la vérification (22 octobre 2026)

- **LEVÉ le 19/11/2026 (mission 11a)**, ADR-217. **Mécanisme.** Rôle `cashless_pin`
  (`post-roles.sql` §13a) et processus `vendor-pin` (`main.vendor-pin.ts`, `vendor-pin/`, écoute
  127.0.0.1:3003) : seul lecteur de l'empreinte (`begin_vendor_pin_check`) et seul ouvreur de
  session (`open_vendor_session`) ; `cashless_app` n'a plus `EXECUTE` sur ces deux fonctions (§13b).
  Appel interne de l'API signé HMAC (`vendor-pin-call-signature.ts`, `x-pin-ts` en millisecondes,
  fenêtre de 30 s, **sans repli**) ; `VENDOR_PIN_SECRET` n'est lu que par le processus (`config.ts`
  : `vendorPinSettings`) ; le dérivé d'idempotence reste dans l'API. Décision du porteur du
  19/11/2026 : cache de signatures vues (rejeu refusé en 401, 20 000 entrées, plein = 401), corps
  sans `rawBody` refusé.
- **Test de levée.** `tests_11a_rights.sql` (`cashless_app` sans `EXECUTE`) ;
  `integration/vendor-pin/vendor-pin-process.spec.ts` (« seul EXECUTE de begin_vendor_pin_check et
  open_vendor_session », refus uniforme 401, parcours PIN, compteur) ;
  `integration/vendors/vendor-sessions.spec.ts` (aucun repli : 5 cas) ;
  `vendor-pin-call-replay.spec.ts` ; `test/unit/architecture.spec.ts` (« le secret des PIN n'est lu
  que par le processus vendor-pin ») ; `config.spec.ts` (production refusée sans
  `VENDOR_PIN_CALL_KEY`).
- **Test de borne inversé.** Les tests qui ouvraient une session par `POST /vendor-sessions` sans
  processus (`payments-*`, `payment-journey`, `payment-isolation`, `offline-secrets`,
  `device-auth-matrix`) démarrent maintenant un vrai processus (`test/support/app.ts`,
  `startVendorPinServer`) ; l'exemption nommée de `config.ts` dans le test d'architecture est levée.
- **Mutations vérifiées.** Repli (`catch` qui ouvre la session) : 5 cas FR-006 échouent (7 en
  relecture) ; garde HMAC et fenêtre : 2 et 1 échecs ; `VENDOR_PIN_SECRET` lu dans
  `errors/problem.ts` : 2 échecs d'architecture ; sans cache anti-rejeu : 2 échecs ; sans refus de
  `rawBody` : 1 échec. Latence NFR-001 : p50 163 ms, p95 211 ms, p99 249 ms sur 200 ouvertures
  (seuils 300 et 600 ms).
- **Limites restantes nommées.** PIN en transit (OP-N151) ; secret du PIN réutilisable ailleurs
  (OP-N154) ; atomicité et mineurs (OP-N158, OP-N159).
- **Fichiers à faire relire par une personne.** `main.vendor-pin.ts`,
  `vendor-pin/vendor-pin-call-signature.ts`, `vendor-pin/vendor-pin-call.guard.ts`,
  `vendor-pin/vendor-pin.digester.ts`, `vendors/vendor-pin.client.ts`.

Limite acceptée par le porteur au plan de la mission 5b (`DM-01M5HRNFEFWDG47YEGE5N3C3GN`, passe contradictoire A15) ;
ADR-121. **Bloque la production : non ; levée avec OP-N56 (mission 11).** Code livré par la mission 5b (WP07, migration
`0031_vendors.sql`) ; borne vérifiée par WP14.

- **Constat.** argon2id se calcule dans l'API : `begin_vendor_pin_check` rend l'empreinte du PIN à `cashless_app`, et
  `open_vendor_session` ouvre la session sur la foi de la transaction de l'API (la base ne refait pas la vérification).
- **Risque.** Une connexion `cashless_app` compromise lit les empreintes (inutiles sans `VENDOR_PIN_SECRET`, gardé hors
  base) et ouvre une session pour n'importe quel vendeur sans PIN (en consommant un essai, audité). Même classe
  qu'OP-N56 : une telle connexion peut déjà écrire des ventes au nom d'un terminal du prestataire.
- **Condition de levée.** Vérification du PIN par un processus séparé, seul détenteur de `VENDOR_PIN_SECRET` et d'un
  rôle de base propre, qui seul exécute ces deux fonctions (sur le modèle des processus de clés de la mission 4) ; ou
  preuve que l'API ne peut fabriquer, comme prévu pour OP-N56.
- **Test qui échoue si la limite s'élargit** : liste figée de `tests_execute_grants.sql` (aucun autre rôle que
  `cashless_app` n'exécute `begin_vendor_pin_check` ni `open_vendor_session`) ; `tests_vendors.sql` (aucune session sans
  essai compté, non expiré, non utilisé) ; audit de chaque ouverture (`VENDOR_SESSION_OPENED`).

### OP-N66 — Import du fichier de l'imprimeur lent quand la table des bracelets est volumineuse (19 octobre 2026)

Constaté pendant la mission 5a (vérification de WP09), défaut antérieur à cette mission (mission 4). **Hors
mission 5a, bloque la production : à évaluer ; décision du porteur du 19/10/2026 : point ouvert, pas de correctif dans
la mission 5a.**

- **Constat.** Le test « associe les lignes justes, refuse les autres… » de
  `apps/api/test/integration/media/claim-code-order.spec.ts` (import `POST …/claim-code-associations`) dépasse son
  délai Jest de 5 s dès que `test/integration/end-to-end/media-latency.spec.ts` a créé ~100 000 bracelets dans un lot.
  Reproduit sur `feat/identite-enrolement-terminaux` sans le code de la mission 5a ; vert seul après `reset-db`. Il est
  apparu quand l'ajout de suites a changé l'ordre d'exécution de Jest.
- **Risque.** Probable recherche sans index adapté dans le chemin d'import (ou dans `associate_claim_code`), dont le
  coût croît avec la table `media` : un import réel sur un prestataire à fort volume serait lent ; et la CI peut
  devenir instable selon l'ordre des suites.
- **Pistes.** `EXPLAIN ANALYZE` des requêtes de l'import sur une base peuplée ; index manquant ; ou isoler la suite de
  latence (lot dédié nettoyé, ou exécution en fin de batterie).
- **Condition de levée.** L'import de 7 lignes reste sous 1 s avec 100 000 bracelets en base, prouvé par un test.

## 3. Relectures d'experts

| Expert | Objet | Points | Documents à fournir |
|---|---|---|---|
| Juriste (BCEAO, CDP) | Statut réglementaire, plafonds, casse, stockage des pièces KYC, conservation, localisation des données | Condition d'ADR-48 (ex-OP-N2), OP-N3 (casse), ADR-38 (stockage KYC), OP-N11, OP-N12 | SPECIFICATION §4.4, §6.3, §6.5, §13.5 ; DECISIONS_ADR |
| Expert-comptable SYSCOHADA | Plan de comptes, taxes, casse, caution, correspondance légale | OP-N3, écart de taxe par période (ADR-09) | SPECIFICATION §5.2, §5.3, §12.3 ; classeur ; scénario de référence |
| Auditeur sécurité | Cloisonnement, clés, bracelets, API, hors ligne, passerelle | ADR-44 (revue de conception, puis test d'intrusion avant le pilote) | Documents du kit : SPECIFICATION, DECISIONS_ADR, `sync_protocol.md`, `openapi.yaml`, schéma de référence et tests |

### Questions au juriste (condition d'ADR-48, ADR-38, OP-N12)

À poser par écrit, avec SPECIFICATION §4.4, §6.3, §6.5, §13.5 et ADR-11, ADR-38, ADR-48 :

1. L'instruction BCEAO n° 001-01-2024 (ou un autre texte en vigueur) exclut-elle de son champ les instruments utilisables seulement dans un réseau limité (un organisateur, ses événements et ses commerçants) ? Si oui, à quelles conditions exactes (nombre ou type de commerçants, montants, durée, fournisseur unique) ?
2. Le modèle décrit en §6.5 (pas de transfert, pas de retrait sauf remboursement du solde, pas de rémunération, validité limitée) remplit-il ces conditions ? Y a-t-il une déclaration ou une notification à faire à la BCEAO ?
3. Qui porte le risque réglementaire : l'organisateur émetteur, le prestataire, ou la plateforme ? Le choix du détenteur des fonds (ADR-11) change-t-il la réponse ?
4. Des plafonds s'appliquent-ils dans ce régime (solde, recharges mensuelles, avec ou sans identification) ? Lesquels ? Les montants de l'instruction 008-05-2015 sont-ils encore applicables ?
5. Un portefeuille durable, utilisable sur plusieurs événements du même organisateur (`wallet_scope = ORGANIZER`), reste-t-il dans l'exclusion ?
6. Le paiement par carte et par mobile money pour recharger, et le remboursement vers mobile money, posent-ils une contrainte particulière ?
7. Si l'exclusion ne s'applique pas : quels types d'établissements agréés peuvent servir d'adossement, et quelles obligations restent au projet ?
8. Stockage des pièces d'identité (ADR-38) : le minimum enregistré au guichet (type de pièce, pays, 4 derniers caractères du numéro, date d'expiration, sans photo) suffit-il aux obligations d'identification ? Faut-il conserver une copie ou le numéro complet, et pendant combien de temps ?
9. Durées de conservation (OP-N12) : combien de temps garder les écritures comptables et les historiques des festivaliers identifiés, pays par pays (CDP au Sénégal) ? L'anonymisation des données personnelles 13 mois après la dernière activité est-elle acceptable ?

### Questions à l'expert-comptable (OP-N3)

À poser par écrit, avec SPECIFICATION §5.2, §5.3, §5.5, §12.3, ADR-09, ADR-12, le classeur et le scénario de référence :

1. Casse : les soldes non réclamés peuvent-ils être acquis, après quel délai, et au profit de qui (organisateur, prestataire, compte légal) ? Quel traitement comptable pour chacun ?
2. Taxes sur les frais et commissions : quel taux, et quel fait générateur (vente, encaissement, clôture de l'événement) ?
3. Écart de taxe par période (ADR-09) : la taxe est extraite par transaction et par bénéficiaire ; son total peut différer de quelques unités d'une taxe calculée sur le total de la période. Cet écart est-il acceptable, et faut-il une écriture de régularisation ?
4. Caution acquise (bracelet non rendu) : est-elle taxable, à quel taux et à quelle date ?
5. Correspondance SYSCOHADA indicative (SPECIFICATION §12.3, table `account_mapping`) : est-elle juste pour un organisateur émetteur et détenteur des fonds ? Quels comptes changent si le prestataire est émetteur ou détenteur ?

## 4. Ordre de décision conseillé

1. **Condition d'ADR-48** : choisir le juriste et lui envoyer ses questions (§3, questions 1 à 9 ; action 8). La réponse écrite est exigée avant le premier événement réel.
2. **Campagne NFC** : validation de la puce, campagne de mesure et mesure de latence (actions 1 à 3), avant le code de l'app terminal ; elle conditionne la liste des téléphones et OP-N11.
3. **Questions de la revue de cohérence n° 1** (OP-N21 à OP-N38, §8) : toutes traitées le 1er octobre 2026 ; restent les points reportés (§6).
4. **Questions de la revue de cohérence n° 2** : toutes tranchées le 2 octobre 2026 (§9).
5. **OP-N3** : envoyer les questions à l'expert-comptable (action 9), en parallèle du développement.
6. **OP-B1 et OP-B2** sont tranchés (ADR-70, ADR-66) : plus aucun point ne bloque le code.
7. Les autres points peuvent attendre le premier pilote.

## 5. Points tranchés

| Point | Décision | Date | Fiche |
|---|---|---|---|
| OP-N42 Identité du terminal | Levé par la mission 5a : jeton lié, mTLS et signature de chaque requête exigés ensemble ; faux refusé en production (`device-auth-matrix.spec.ts`, `production-guard.spec.ts`) | 21 octobre 2026 | ADR-88, ADR-107 |
| OP-N44 `EXECUTE` hérité de `PUBLIC` | Levé par la mission 5a : droits d'exécution rôle par rôle (`tests_execute_grants.sql`) | 21 octobre 2026 | ADR-84, ADR-101 |
| OP-N50 Lecture d'une demande et `consume_tap` | Levé par la mission 5a : migrations 0024 et 0026 (`tests_consume_tap_claim.sql`, `tap-claim-race.spec.ts`) | 21 octobre 2026 | ADR-90, ADR-101 |
| OP-N54 Empreinte sans clé au registre d'idempotence | Levé par la mission 5a : HMAC sous `IDEMPOTENCY_HMAC_KEY` (`request-hash.spec.ts`, `personalization.spec.ts`) ; purge des lignes antérieures à T + 720 h | 21 octobre 2026 | ADR-99 |
| OP-N59 SECURITY DEFINER sans `pg_temp` | Levé par la mission 5a : migration 0021 et `TEMPORARY` retiré (`tests_definer_search_path.sql`, `tests_device_rights.sql` §5) | 21 octobre 2026 | ADR-96 |
| OP-N62 Retrait d'une clé dédiée sans travail | Levé par la mission 5a : migration 0025 (`tests_tag_key_retire_guard.sql`) | 21 octobre 2026 | ADR-102 |
| OP-N63 Clé d'accord réécrite par l'API | Levé par la mission 5a : écrite à l'enrôlement seulement (`tests_device_rights.sql` §1, §2) | 21 octobre 2026 | ADR-105 |
| OP-N70 Suites de la mission 4 sous le faux | Levé par WP18 de la mission 5a : chaque route de terminal en HTTPS réel, test de couverture (`device-auth-matrix.spec.ts`) | 21 octobre 2026 | ADR-113 |
| OP-N71 Idempotence par chemin concret et appelant | Levé par WP18 de la mission 5a (`admin.spec.ts`, `idempotency.spec.ts`, `request-hash.spec.ts`) | 21 octobre 2026 | ADR-116 |
| OP-N57 `offline_snapshot` : version plantée | Levé par la mission 7 : version calculée par `publish_offline_snapshot`, `INSERT` direct retiré (`tests_offline_snapshots.sql`, `tests_offline_rights.sql`, `tests_definer_trigger_writers.sql` §3) | 4 novembre 2026 | ADR-137 |
| OP-N58 `offline_policy_history` falsifiable | Levé par la mission 7 : `log_offline_policy` en DEFINER, écritures par fonctions (`tests_offline_policy.sql`, `tests_definer_trigger_writers.sql` §3) | 4 novembre 2026 | ADR-137 |
| OP-N68 Fonction créée à la main exécutable par `PUBLIC` | Levé par la mission 7 : droit par défaut global (`tests_execute_grants.sql` §4 inversé) | 4 novembre 2026 | ADR-111 |
| OP-N69 Colonnes de `device` écrites par l'API | Levé par la mission 7 : liste vide, écritures par fonctions (`tests_device_rights.sql` §1) | 4 novembre 2026 | ADR-112 |
| OP-N75 Purges exécutées par `cashless_app` | Levé par la mission 7 : rôle `cashless_maint` (`tests_device_purge_window.sql`, `tests_execute_grants.sql`) | 4 novembre 2026 | ADR-114 |
| OP-N40 Conservation des clés d'idempotence | 30 jours par défaut (720 h, `IDEMPOTENCY_TTL_HOURS`), conforme au contrat ; terminaux : pour toujours (clé du grand livre) | 9 octobre 2026 | ADR-79 |
| OP-N39 Pile logicielle | L'existant prime : PostgreSQL 17, RFC 9457, curseur, idempotence en base, sans ORM, Express, jose 6 ; le reste du document du porteur devient la cible (`08-pile-logicielle.md`) | 9 octobre 2026 | ADR-78 |
| OP-N1 Catalogue | Option B : prix TTC fixe, catégories, un taux de taxe par article ; ni variantes, ni remises, ni stock en V1 | 30 septembre 2026 | ADR-35 |
| OP-B1 Paiements | Comptes marchands au détenteur des fonds (A) ; Wave et Orange Money en direct (M3) ; carte configurée par organisateur : agrégateur local (PayDunya) ou PSP international (Stripe) | 2 octobre 2026 | ADR-70 |
| OP-B2 Codes à usage unique | WhatsApp d'abord, SMS en repli avec deux fournisseurs SMS (options C et D combinées) ; fournisseurs à choisir sur devis | 2 octobre 2026 | ADR-66 |
| OP-N3 (casse) | Casse réversible : enregistrée à la date limite, remboursement possible pendant 5 ans par annulation de casse en back-office (C) | 2 octobre 2026 | ADR-67 |
| OP-N6 Assiette des frais du prestataire | Au choix dans chaque contrat, brut par défaut (C) | 2 octobre 2026 | ADR-68 |
| OP-N7 Gestion des terminaux | Pas de MDM ; un téléphone personnel n'a jamais le hors ligne | 2 octobre 2026 | ADR-69 |
| OP-N2 Statut réglementaire | Option B : instrument à usage limité (réseau limité), règles de périmètre dans SPEC §6.5 ; plafonds paramétrables, valeurs de 2015 provisoires. **Sous condition** d'un avis écrit du juriste avant le premier événement réel ; sinon adossement à un établissement agréé | 30 septembre 2026 | ADR-48 |
| OP-N4 Code imprimé | Option B : QR code imprimé + code de 10 caractères en clair dessous | 30 septembre 2026 | ADR-36 |
| OP-N5 Capture différée | Option A : capture automatique seulement en V1 ; si un client hôtelier le demande, réservation dans le grand livre (option C) | 30 septembre 2026 | ADR-37 |
| OP-N8 Identification | Option D : vérification au guichet en V1, vérification en ligne plus tard sur le même modèle de données. Stockage minimal de la pièce à confirmer par le juriste | 30 septembre 2026 | ADR-38 |
| OP-N10 Validation terrain NFC | Téléphones : ceux déjà disponibles (option C). Critères : deux niveaux, « recommandé » (300 ms, 2 %) et « toléré » (500 ms, 5 %). Calendrier : dès maintenant, par le porteur du projet, avant le code de l'app terminal | 30 septembre 2026 | ADR-39 |
| OP-N14 Droit de place supérieur aux ventes | Option D : mode choisi par l'organisateur pour chaque commerçant (déduction avec reste dû, paiement d'avance, déduction plafonnée), défaut « déduction avec reste dû » | 30 septembre 2026 | ADR-40 |
| OP-N15 Import des billets | Sans objet : les bracelets-billets et le contrôle d'accès sont abandonnés ; les bracelets servent exclusivement au cashless | 30 septembre 2026 | ADR-41 |
| OP-N16 App festivalier | Compte par téléphone vérifié seulement (A) ; perte : suspension immédiate et paiement par QR en attendant (B) ; sans compte : consultation du solde en lecture seule par le code imprimé (B) | 30 septembre 2026 | ADR-42 |
| OP-N17 Premier partenaire de caisse tierce | Option C : caisses tierces reportées après la V1 (intentions de paiement, TPE associé, webhooks sortants, SDK) ; contrat conservé, marqué V2 | 30 septembre 2026 | ADR-43 |
| OP-N18 Audit de sécurité | Revue de conception et test d'intrusion (B) ; revue de conception dès maintenant sur les documents, test d'intrusion avant le pilote (A) ; pas d'outils de sécurité imposés dans la CI pour l'instant (B) | 30 septembre 2026 | ADR-44 |
| OP-N19 Charge et chaînage | Charge cible B (200 terminaux, 50 ventes/s sur le site, 20/s sur un stand), démontrée à deux fois ; scellement périodique du journal toutes les 5 minutes, copié hors de la base (C) | 30 septembre 2026 | ADR-45, ADR-46 |
| OP-N20 Compléments de schéma | Option C : les éléments critiques (S6 à S10, S12, S13, S25 et les colonnes associées de S4) sont écrits dans le schéma de référence avec leurs tests ; l'agent conçoit les éléments courants, et le porteur du projet relit sa première migration | 30 septembre 2026 | ADR-47 |
| OP-N21 Fin d'événement | Synchronisations tardives : écrites jusqu'à la fin de `RECONCILING`, ensuite rejet `SYNC_DEADLINE_PASSED`, anomalie et écriture par le back-office, commerçant garanti (C) ; `PROMO_EXPIRY` et `CHARGEBACK` acceptés pendant toute la clôture (A) ; clôture possible avec soldes restants listés si la casse est `NONE` ou `LEGAL_ACCOUNT`, grand livre verrouillé quand ils sont nuls (A) | 1er octobre 2026 | ADR-49 |
| OP-N22 Remboursements | Wave, Orange Money, virement bancaire au back-office, espèces au guichet ; pas de carte en V1 (B) ; espèces : une personne jusqu'à 50 000 XOF (réglable par événement), deux au-delà (B) ; bracelets anonymes remboursables en espèces sur présentation du bracelet (A) | 1er octobre 2026 | ADR-53 |
| OP-N23 Niveau d'identification | Porté par le client et calculé à chaque usage (identification non révoquée, pièce non expirée) ; table `kyc_verification` écrite dans le schéma de référence (A) | 1er octobre 2026 | ADR-54 |
| OP-N24 Renvoi d'une lecture | Le serveur reconnaît le renvoi (même terminal, bracelet, compteur, UID) dans un délai réglable par événement, 120 s par défaut, de 0 à 600 s (B) ; une opération de lot qui cite la lecture enregistrée en ligne la réutilise, quel que soit le délai (A) | 1er octobre 2026 | ADR-50 |
| OP-N25 Durée des transactions | PostgreSQL 17, `transaction_timeout = 60s` sur le rôle applicatif, plus une tâche de surveillance en filet (A + B) | 1er octobre 2026 | ADR-55 |
| OP-N26 Statut événement et grand livre | Fonction SQL unique `set_event_status` : passage contrôlé, conditions de clôture calculables vérifiées par la base, statut des grands livres, scellement final, historique (A) | 1er octobre 2026 | ADR-51 |
| OP-N27 Passerelle pendant une coupure | Passerelle intermédiaire : ventes, annulations, recharges espèces, activation sans frais sur solde, caution en espèces ; refus des autres prélèvements sur solde, des remboursements et des restitutions (B) | 1er octobre 2026 | ADR-52 |
| OP-N28 Code imprimé | Tous les lots `PUBLIC`, pas les lots `STAFF` ni `VIP` (A) ; code généré à la commande, associé à la puce à la personnalisation par scan du QR ou fichier du fournisseur (A) | 1er octobre 2026 | ADR-56 |
| OP-N29 Perte d'un terminal non conforme | Selon qui a fourni le terminal : plateforme ou prestataire → prestataire ; organisateur → organisateur ; commerçant → commerçant, sauf défaut du logiciel établi (B) | 1er octobre 2026 | ADR-58 |
| OP-N30 Chemin NFC de paiement | `READ_SIG` à chaque paiement, vérifiée par le terminal et comparée par le serveur à la signature de la personnalisation ; pas de `GET_VERSION` (B) | 1er octobre 2026 | ADR-59 |
| OP-N31 Latence | Bout en bout p95 ≤ 1,2 s, p99 ≤ 2 s ; NFC p95 ≤ 300 ms ; réseau + serveur p95 ≤ 800 ms, p99 ≤ 1,5 s ; serveur seul p95 ≤ 200 ms, p99 ≤ 500 ms (A) | 1er octobre 2026 | ADR-60 |
| OP-N32 Réglages des terminaux | Réglables par événement dans des bornes fixées par la base, par le prestataire (fenêtre d'annulation : organisateur), envoyés dans `DeviceConfig` (A) | 1er octobre 2026 | ADR-61 |
| OP-N33 Compte commerçant chaud | Tout compte commerçant est chaud par défaut (A) | 1er octobre 2026 | ADR-62 |
| OP-N34 Espèces encaissées au-delà d'un plafond | Recharge écrite en deux parts : marge au portefeuille, reste en `L-ESP-A-RENDRE`, rendu au guichet sur présentation du bracelet (B) | 1er octobre 2026 | ADR-63 |
| OP-N35 Paiement par QR | Deux sens toujours autorisés, sans réglage (C) ; pas de jeton préchargé, réseau obligatoire sur le téléphone ; sinon paiement par bracelet (A) | 1er octobre 2026 | ADR-64 |
| OP-N38 Rattachement d'un bracelet approvisionné | Libre si le solde est nul ; sinon demande en attente confirmée au guichet (lecture du bracelet et code de confirmation) ; consultation anonyme par un tiers acceptée (A) | 1er octobre 2026 | ADR-57 |
| OP-N150 Clé de l'IBAN | Clé de chiffrement de l'IBAN lue en configuration de l'API, aux trois emplacements (limite : clé dans le processus public, levée avec le vrai KMS en 12b) | 18 novembre 2026 | ADR-218, ADR-223 |
| OP-N153 `refund_deposit(uuid, uuid)` | Gardée interne, exécutable par personne (écart à FR-012, neutre) | 18 novembre 2026 | ADR-219, ADR-223 |
| OP-N152 Compteur App Attest | Un seul `EXECUTE` nouveau pour `cashless_app` hors OP-N60 : `advance_app_attest_counter` | 18 novembre 2026 | ADR-222, ADR-223 |
| OP-N76 Rejeu de l'appel vendor-pin | Cache de signatures vues, rejeu refusé en 401 ; test d'ouverture de l'enveloppe à l'exécution des versements | 19 novembre 2026 | ADR-217, ADR-220 |
| OP-N79, N141 | Levés par la mission 11a | 18 novembre 2026 | ADR-216, ADR-220 |
| OP-N60, N76, N116, N137, N140, N145 | Levés par la mission 11a ; OP-N64 « côté serveur prêt », non levé | 19 novembre 2026 | ADR-216 à ADR-222 |
| OP-N156 Masque en texte libre | Levé par renforcement : `msisdn` et IBAN libres (tirets, espaces insécables, collés) masqués, sur décision du porteur | 19 novembre 2026 | ADR-218, ADR-223 |
| Relance de Colima | Colima et le conteneur de test `cashless-platform-pg17` relancés ; `cashless-api-db-1` (5434, API partagée) laissé arrêté, à relancer par le porteur | 19 novembre 2026 | ADR-223 |
| Tests de borne avant la fusion | Les tests de borne des écarts acceptés sont écrits avant la fusion (règle 3), dans la lane n | 19 novembre 2026 | ADR-223, ADR-224 |
| Périmètre de la 10a | KYC au guichet, OP-N47, `printed_number` et `pending_offline_notice`, chaîne d'envoi des codes | 20 novembre 2026 | ADR-231 |
| OP-N163 Agent titulaire | Détecté par l'égalité du numéro vérifié du compte et de `app_user.phone` de l'agent ; limite : agent sans numéro ou à autre numéro non détecté | 20 novembre 2026 | ADR-227, ADR-231 |
| OP-N47 Rotation du secret des codes | Rotation **immédiate**, sans double empreinte ; version du secret sur chaque empreinte ; réémission par commande d'exploitation sous le rôle `cashless_claimadmin` (jamais `cashless_app`) | 20 novembre 2026 | ADR-228, ADR-231 |
| Code OTP en mémoire | Code gardé en mémoire du processus seulement pendant la chaîne, 35 s au plus, jamais en base ni dans un journal | 20 novembre 2026 | ADR-229, ADR-231 |
| `printed_number` | Troisième colonne facultative du fichier de l'imprimeur ; description du corps `text/csv` et deux motifs de ligne ajoutés au contrat | 20 novembre 2026 | ADR-225 |
| Fichier de réémission | Cinq colonnes `rank,code,url,uid,printed_number` : chaque ligne nomme son bracelet ; plus d'import après réémission (`reissuable_media` rend `nfc_uid` et `printed_number`) | 20 novembre 2026 (soir) | ADR-228, ADR-231 |
| Réponse `422` de `revokeKycVerification` | Déclarée au contrat (motif absent ou de moins de 10 caractères, `VALIDATION_FAILED`), ajout rétrocompatible inscrit dans `contract-baseline.json` | 20 novembre 2026 (soir) | ADR-225 |
| Contradiction §6.3 point 5 | Le contrat (révocation par deux personnes) prime (20/11/2026) ; **spécification amendée le 23/11/2026, décision du porteur : OP-N164 levé** | 20 et 23 novembre 2026 | ADR-227 |
| Réponse `422` de `revokeKycVerification` dans ADR-225 | Validé par le porteur : la décision reste dans ADR-225 | 23 novembre 2026 | ADR-225 |

## 6. Points reportés

| Point | Statut | En attendant |
|---|---|---|
| OP-N3 : casse, taxes, caution acquise, SYSCOHADA | Regroupé dans les questions à l'expert-comptable (§3), et, pour la casse, dans les questions au juriste (§3) ; envoi : action 9 | Hypothèses actuelles paramétrables ; `account_mapping` indicatif |
| OP-N9 : contestations de paiement par carte | **Tranché le 2 octobre 2026** (ADR-77) : payeur selon le contrat (`chargeback_bearer`, organisateur par défaut), 3-D Secure, plafond par carte et par jour, alerte multi-cartes ; contestation tardive écrite dans le grand livre verrouillé | ADR-77 |
| OP-N11 : région AWS | Provisoire le 1er octobre 2026 : Paris (`eu-west-3`), ADR-65. À confirmer après la mesure de latence (action 3, §7) et l'avis du juriste | Développement, tests et pilote préparés en `eu-west-3` ; région paramétrable |
| OP-N12 : durées de conservation | Regroupé dans les questions au juriste (§3, question 9) | 5 ans pour les écritures ; données personnelles anonymisées 13 mois après la dernière activité |
| OP-N13 : algorithme de signature des snapshots | Vérification technique confiée à l'agent | ECDSA P-256 |
| OP-N37 : outils de sécurité en CI (dépendances vulnérables, analyse statique, détection de secrets) | Reporté le 30 septembre 2026 (ADR-44 : « reste à décider » ; question B17 de la revue de cohérence) | Aucun outil imposé en CI ; le test de cloisonnement sur toutes les routes reste un critère d'acceptation |
| OP-N36 : capture différée dans la cible V2 | Reporté le 1er octobre 2026 au cadrage de la V2, avec le premier partenaire de caisse (option A) | `capturePaymentIntent` reste marquée V2, sans engagement |

## 7. Actions à mener

| # | Action | Responsable | Échéance | Débloque |
|---|---|---|---|---|
| 1 | Validation de la puce sur de vrais bracelets (demi-journée, §5.0 du protocole) : `GET_VERSION`, `READ` sur page protégée, reprise après NAK, compteur 2, protection de `INCR_CNT` | Porteur du projet | Avant le code de l'app terminal | Code de lecture NFC |
| 2 | Campagne de mesure complète sur les téléphones disponibles, classés par profil ; rapport selon le gabarit du protocole | Porteur du projet | Avant le code de l'app terminal | Liste des téléphones recommandés et tolérés |
| 3 | Mesure de latence réseau depuis Dakar (Orange, Free, Expresso) vers les régions candidates | Porteur du projet, pendant la campagne | Avant le code de l'app terminal | OP-N11 (région) |
| 4 | Demander au fournisseur de bracelets le surcoût d'un QR différent par bracelet | Porteur du projet | Avant la première commande | ADR-36 |
| 5 | Préciser la taille du plus grand événement visé la première année (festivaliers, points de vente), pour confirmer la cible de charge | Porteur du projet | Avant le test de charge | ADR-45 |
| 6 | Choisir un auditeur de sécurité et lui confier la revue de conception (documents du kit) | Porteur du projet | Maintenant | ADR-44 |
| 7 | Test d'intrusion du système complet | Auditeur | Avant le premier événement pilote | Mise en production |
| 8 | Choisir un juriste (droit bancaire UEMOA) et lui envoyer ses questions (§3 : condition d'ADR-48, stockage des pièces KYC, durées de conservation) | Porteur du projet | Maintenant ; réponse écrite avant le premier événement réel | Mise en production (régime et plafonds) ; ADR-38 (stockage KYC) ; OP-N12 |
| 9 | Envoyer les questions à l'expert-comptable SYSCOHADA (§3) avec le classeur et le scénario de référence | Porteur du projet | Maintenant ; réponse avant la production | OP-N3 (casse, taxes, caution acquise, correspondance comptable) |
| 10 | Codes à usage unique (ADR-66) : demander les devis (SMS principal local couvrant Orange, Free et Expresso ; SMS de repli international ; fournisseur WhatsApp agréé Meta) et lancer la validation du nom d'expéditeur SMS (RCCM, 5 à 10 jours) et du modèle WhatsApp | Porteur du projet | Avant le pilote | Envoi réel des codes |
| 11 | Paiements (ADR-70) : ouvrir un compte Wave Business et un compte marchand Orange Money (accès de test et documentation des API) ; obtenir les accès de test PayDunya et Stripe ; vérifier pour Stripe l'ouverture de compte et le versement en XOF pour un marchand établi au Sénégal | Porteur du projet | Maintenant (validation Orange Money : plusieurs semaines) | Adaptateurs PSP réels |

## 8. Questions issues de la revue de cohérence n° 1 (30 septembre 2026)

Questions de la partie B de `REVUE_COHERENCE.md` (archivée). Toutes ont été traitées le 1er octobre 2026 : tranchées, ou reportées (§6). Le tableau est gardé pour la correspondance des numéros.

| Point | Revue | Question | Recommandation |
|---|---|---|---|
| ~~OP-N21~~ | B1 | Tranché le 1er octobre 2026 : voir §5 et ADR-49 | — |
| ~~OP-N22~~ | B2 | Tranché le 1er octobre 2026 : voir §5 et ADR-53 | — |
| ~~OP-N23~~ | B3 | Tranché le 1er octobre 2026 : voir §5 et ADR-54 | — |
| ~~OP-N24~~ | B4 | Tranché le 1er octobre 2026 : voir §5 et ADR-50 | — |
| ~~OP-N25~~ | B5 | Tranché le 1er octobre 2026 : voir §5 et ADR-55 | — |
| ~~OP-N26~~ | B6 | Tranché le 1er octobre 2026 : voir §5 et ADR-51 | — |
| ~~OP-N27~~ | B7 | Tranché le 1er octobre 2026 : voir §5 et ADR-52 | — |
| ~~OP-N28~~ | B8 | Tranché le 1er octobre 2026 : voir §5 et ADR-56 | — |
| ~~OP-N38~~ | — | Tranché le 1er octobre 2026 : voir §5 et ADR-57 | — |
| ~~OP-N29~~ | B9 | Tranché le 1er octobre 2026 : voir §5 et ADR-58 | — |
| ~~OP-N30~~ | B10 | Tranché le 1er octobre 2026 : voir §5 et ADR-59 | — |
| ~~OP-N31~~ | B11 | Tranché le 1er octobre 2026 : voir §5 et ADR-60 | — |
| ~~OP-N32~~ | B12 | Tranché le 1er octobre 2026 : voir §5 et ADR-61 | — |
| ~~OP-N33~~ | B13 | Tranché le 1er octobre 2026 : voir §5 et ADR-62 | — |
| ~~OP-N34~~ | B14 | Tranché le 1er octobre 2026 : voir §5 et ADR-63 | — |
| ~~OP-N35~~ | B15 | Tranché le 1er octobre 2026 : voir §5 et ADR-64 | — |
| ~~OP-N36~~ | B16 | Reporté le 1er octobre 2026 au cadrage V2 : voir §6 | — |
| OP-N37 | B17 | Outils de sécurité en CI : ADR-44 dit « reste à décider », sans point de suivi | Reporté (§6) |

## 9. Questions de la revue de cohérence n° 2 (2 octobre 2026)

Questions de la partie B de `REVUE_COHERENCE_2.md`. Statut : **à trancher**. Elles seront posées une par une. En attendant, l'agent ne choisit pas : il code ce qui n'en dépend pas et signale le reste. La SPEC écrit « en attente de Qx (revue 2) » aux endroits concernés.

| Point | Question | Recommandation de la revue | Statut | En attendant (texte actuel) |
|---|---|---|---|---|
| Q1 | La configuration PSP (S26) est rattachée à l'organisateur, alors que le détenteur des fonds est choisi par événement. Faut-il rattacher S26 à l'événement ? | Configuration par organisateur, avec choix par événement parmi ses configurations | **Tranché le 2 octobre 2026 : option C** (ADR-72) | S26 + S26b (SPEC §11.1, §14.2) |
| Q2 | Date limite de synchronisation : non définie, citée sur deux transitions (`CLOSING` → `RECONCILING` et `RECONCILING` → `SETTLING`) | `event.sync_deadline` = fin de l'événement + 72 h, contrôlée au passage à `SETTLING` | **Tranché le 2 octobre 2026 : option B, 72 h** (ADR-73) | `event.sync_deadline_hours`, contrôle dans `set_event_status` (SPEC §12.1) |
| Q3 | Comment fonctionne la double validation par l'API ? Aujourd'hui `approved_by` est envoyé dans le corps de la requête : une seule personne peut se valider elle-même (API-B1) | Demande, puis approbation par une seconde personne connectée, avec expiration après 24 h | **Tranché le 2 octobre 2026 : option C** (ADR-74) | Guichet : jeton d'approbation sur place (`X-Approval-Token`, 5 min) ; back-office : demande puis approbation (`approval_request`, `/approval-requests`, 24 h) ; `approved_by` du corps ignoré (SPEC §3.2) |
| Q4 | Faut-il une limite au montant et au périmètre des réclamations tardives (comptes, montant, `ADJUSTMENT` libre, `BREAKAGE_REVERSAL` accepté sur un grand livre `OPEN`) ? (DB-I6) | Limite = casse initiale du support ; double validation ; seulement par le back-office | **Tranché le 2 octobre 2026 : option A** (ADR-75) | `check_late_claim` dans `post_transaction`, `CL024` (SPEC §5.3, §12.1) |
| Q5 | Le numéro pour un remboursement mobile peut-il être différent du numéro vérifié ? | Oui, mais seulement après un code à usage unique envoyé au nouveau numéro | **Tranché le 2 octobre 2026 : option C, 50 000 et 48 h** (ADR-76) | SPEC §8.5 ; `event.refund_new_number_max`, `event.refund_new_number_hold_hours` |
| Q6 (= OP-N9) | Qui paie les contestations carte, et comment traiter une contestation reçue après `CLOSED` (flux `LATE_CHARGEBACK`) ? | Toujours ouvert ; à reposer avec le flux `LATE_CHARGEBACK` | **Tranché le 2 octobre 2026 : partie 1 option C, partie 2 option B** (ADR-77) | `contract.chargeback_bearer` ; contestation tardive par demande d'approbation (SPEC §5.3, §12.1) |

### OP-N124 — Remboursement : code du titulaire consommé avant l'écriture de sa décision (16 novembre 2026)

Mission 9a, relecture de WP03 ; décision du porteur n° 12a du 16/11/2026 ; ADR-192. **Bloque la production : non.**

- **Constat.** `decideRefundRequestAsHolder` vérifie et consomme le code dans une transaction propre (pour que les essais faux restent comptés), puis écrit la décision. Si l'écriture échoue (panne, `409` d'une demande échue), le code est perdu.
- **Risque.** Pas de nouvel essai avec ce code ; un `BLOCK` perdu laisse la demande passer `REQUESTED` à l'échéance (approuvable). Aucun paiement sans deux administrateurs.
- **Mission qui le lève.** Mission 9b (confirmé par le porteur le 16/11/2026). **Condition de levée.** Code consommé seulement si la décision est écrite, code faux toujours compté.
- **Test de borne.** `apps/api/test/integration/refunds/journey-limits.spec.ts` (OP-N124). Une levée le fait aussi échouer : à mettre à jour avec la consignation.
- **Report.** `PROMPTS-A-ENVOYER.md` (9a, 9b) et `PRD.md`.

### OP-N125 — Remboursement : quota de codes commun à tous les usages, alerte de `BLOCK` en ligne d'audit (16 novembre 2026)

Mission 9a, relecture de WP03 ; décision du porteur n° 12b du 16/11/2026 ; ADR-193. **Bloque la production : non.**

- **Constat.** Le quota (3 envois par numéro sur 15 min) et le blocage de 30 min sont par numéro, tous usages confondus (R-05). L'alerte du `BLOCK` du titulaire est réduite à une ligne d'audit (`REFUND_HOLDER_DECIDED`, sans code ni numéro), sans envoi au prestataire.
- **Risque.** Un tiers qui connaît un numéro et un code public épuise le quota par des demandes de connexion : `429` à `createMyRefundRequest` (autre numéro) ou titulaire sans code pour `BLOCK`. Disponibilité et alerte, aucune perte de fonds.
- **Mission qui le lève.** Mission 12b (vrai envoi, quotas par usage), confirmé par le porteur le 16/11/2026. **Condition de levée.** Quotas séparés ; alerte de `BLOCK` livrée.
- **Test de borne.** `journey-limits.spec.ts` (OP-N125).
- **Report.** `PROMPTS-A-ENVOYER.md` (9a, 9b) et `PRD.md`.

### OP-N126 — Remboursement : une seule personne habilitée recrédite un `FAILED` (16 novembre 2026)

Mission 9a, relecture de WP05 ; décision du porteur n° 13 du 16/11/2026 ; ADR-191. **Bloque la production : non.**

- **Constat.** `FAILED` est refusé (`403`) au proposant et à l'exécutant (renforcement) ; une seule autre personne habilitée suffit à recréditer, le valideur du `REVERSAL` restant nominal. **Il faut un troisième administrateur sur l'événement** : avec deux, personne ne peut confirmer `FAILED`.
- **Risque.** Recrédit sans échec réel du paiement hors système, détectable au rapprochement seulement.
- **Mission qui le lève.** Mission 9b (rapprochements Wave/Orange Money), proposition à confirmer par le porteur. **Condition de levée.** `FAILED` sans paiement correspondant signalé au rapprochement, ou second valideur au contrat.
- **Test de borne.** `journey-limits.spec.ts` (OP-N126), `confirm-refund.spec.ts` (décision 13).
- **Report.** `PROMPTS-A-ENVOYER.md` (9b) et `PRD.md`.

### OP-N127 — Contradiction C-001 : FR-012 « sans titulaire vérifié → REQUESTED » (16 novembre 2026) — CLOS

Mission 9a, relecture de WP04 ; **décision du porteur n° 15 du 16/11/2026, ADR-194 (acceptée).**

- **Constat.** Par `/me`, toute identité est créée avec le numéro : la branche « sans titulaire vérifié → `REQUESTED` » de FR-012 et du scénario 5 était inatteignable.
- **Décision.** `spec.md` amendée (branche retirée), comportement strict gardé : un compte sans identité vérifiée reçoit `422 REFUND_NOT_ALLOWED`. Plus aucune limite à borner.
- **Test.** `journey-limits.spec.ts` (comportement strict).

### OP-N128 — Guichet enchaîné : limites relevées en relecture de WP06 (16 novembre 2026)

Mission 9a ; ADR-195 (acceptée, confirmé par le porteur le 16/11/2026) ; ADR-190 pour le seuil sur le cumul. **Bloque la production : non.**

- **(a)** Caution seule au-dessus du seuil avec jeton : `DEPOSIT_REFUNDED` sans `approved_by` ; approbateur dans l'audit du jeton seulement. Test : `journey.spec.ts` (OP-N128 (a)).
- **(b)** Cumul lu sous le verrou du bracelet, non du portefeuille : des espèces dues apparues avant l'étape 5 ne sont contrôlées que par le seuil propre de `refund_cash_due`. Non testé (fenêtre de course).
- **Mission qui le lève.** Mission 9b (confirmé par le porteur le 16/11/2026).

### OP-N129 — Décision du titulaire : lien du contrat (16 novembre 2026) — LEVÉ

Constat de WP07 ; **décision du porteur n° 14 du 16/11/2026 : corrigé en 9a** (WP03 rouvert).

- **Constat initial.** `holder-decision` exige `otp_request_id` et `code`, mais l'identifiant n'était rendu par aucune route.
- **Levée.** Pour l'usage « titulaire », l'envoyeur de codes (`OtpSender.send(phone, code, channel, link?)`) reçoit aussi `refund_request_id` et `otp_request_id` pour construire le lien. Aucune route ni champ ajouté à `openapi.yaml` ; faux envoyeur interdit en production.
- **Preuves.** `apps/api/test/integration/refunds/holder-link.spec.ts` (envoyeur reçoit les deux identifiants, décision par le lien) ; `journey.spec.ts` (décision par le lien reçu, sans lecture en base ; la réponse de création ne contient pas le code du titulaire).

### OP-N130 — Ordre des états d'une demande de remboursement gardé par l'API seule (16 novembre 2026)

Revue post-fusion de la mission 9a ; ADR-196 ; **décision du porteur du 16/11/2026 : consigner, lever en 9b.** **Bloque la production : non.**

- **Constat.** `0081_refund_requests.sql` garde la cohérence de chaque ligne (CHECK jumelés) mais pas le passage d'un état à l'autre ; `post-roles.sql` § 11 accorde à `cashless_app` l'`UPDATE` des colonnes de transition (`status`, `approved_by`, `transaction_id`, `estimated_amount`, `fee`…). Limite prévue au prompt de WP01 (« à signaler, pas à corriger ici »), restée sans entrée jusqu'à la revue.
- **Risque.** Un défaut de l'API ou un accès au rôle ramène une demande `PAID` ou `FAILED` à `REQUESTED` : elle peut être approuvée une seconde fois. Le grand livre borne le débit au solde payé restant (pas de création de monnaie).
- **Garde en place.** Identité de la demande non modifiable (droits par colonne), aucun `DELETE`, une demande ouverte par portefeuille, contrôle à deux de chaque `WALLET_REFUND`, parcours et concurrence testés (`journey.spec.ts`, `concurrency.spec.ts`).
- **Test de la limite.** `packages/ledger-sql/tests/tests_refund_requests.sql` : liste exacte des colonnes modifiables par `cashless_app` (échoue si elle s'élargit) et refus de l'`UPDATE` des colonnes d'identité.
- **Mission qui le lève.** Mission 9b. **Condition de levée.** Déclencheur qui refuse toute transition hors du graphe de `data-model.md`, et `estimated_amount`/`fee` figés après `REQUESTED` ; test pgTAP de chaque transition interdite.


## 10. Mission 9b (versements, rapprochements, clôture) : consignation du 17 novembre 2026

Écrit par WP14 à partir des notes de lane de WP01 à WP13 et des décisions 1 à 17 du porteur
(`docs/passation-9b/contexte-9b.md`). Chaque entrée cite sa source et son test. « Bloque la production » : voir la ligne du
tableau de la section 2.

### OP-N131 — Copie externe des scellements simulée jusqu'à la 12b (17 novembre 2026)

Source : note de lane de WP12 ; décision du porteur n° 3 du 17/11/2026 ; ADR-197. **Bloque le code : non. Bloque la production : oui, mais le faux refuse déjà le démarrage.**

- **Constat.** `createSealCopy` rend un `FakeSealCopy` hors production ; en production, la construction et le démarrage du processus `maintenance` sont refusés (« la copie externe des scellements est un faux »).
- **Risque.** Tant que la copie réelle manque, un scellement et sa copie vivent dans la même base : un administrateur de la base peut réécrire les deux. La vérification quotidienne (`ops_verify_audit_chain`) ne protège que contre une erreur, pas contre ce cas.
- **Test de la limite.** `apps/api/test/unit/production-guard.spec.ts` (« faux de la copie externe des scellements : construction refusée en production » ; « la garde de démarrage nomme le faux ») et `integration/maintenance/process-guard.spec.ts` (« refuse de démarrer en production : la copie externe des scellements est un faux »). Ces tests échouent si le faux est admis en production.
- **Mission qui le lève.** Mission 12b. **Condition de levée.** Adaptateur de copie réel (stockage à verrou d'objet, compte distinct) essayé contre le service ; le faux reste refusé en production.
- **Report.** `PROMPTS-A-ENVOYER.md` (12b) et `PRD.md`.

### OP-N132 — Alertes d'exploitation sans envoi à une personne (17 novembre 2026)

Source : note de lane de WP12 ; C-010 ; décision du porteur n° 3 ; ADR-198. **Bloque la production : oui (à lever avant l'exploitation réelle).**

- **Constat.** Une alerte (codes 7 à 11 : scellement, intégrité, contrôles du grand livre, contrôles d'exploitation, transaction longue) est une ligne d'audit `OPS_ALERT`, un `pg_notify('ops_alert', …)` et un journal `ALERT`, dédoublonnés à 1 h. Rien n'est envoyé à une personne. Choix d'exploitation de WP12 : seuil `statement-unmatched` à 24 h (non spécifié), `open-anomalies` re-signale après redémarrage (mémoire du processus), l'ordre d'enregistrement des travailleurs n'est pas garanti par Nest.
- **Risque.** Une alerte n'est vue que si quelqu'un lit le journal ou écoute `ops_alert` : un écart (somme non nulle, versement vieilli de 48 h) peut rester sans réponse.
- **Test de la limite.** `integration/controls/controls-alerts.spec.ts` (une alerte par contrôle, jamais le silence) et `invariants-cloture/consignation.spec.ts` (le code des alertes n'importe aucun envoyeur ; il échoue aussi quand la 12b ajoute l'envoi : à mettre à jour avec la levée).
- **Mission qui le lève.** Mission 12b. **Condition de levée.** Notificateur réel branché sur `ops_alert`, essayé, avec accusé de réception.
- **Report.** `PROMPTS-A-ENVOYER.md` (12b) et `PRD.md`.

### OP-N133 — Propriétaire des `ops_*` et `pg_read_all_stats` (17 novembre 2026)

Source : notes de lane de WP05 (hypothèse de 0022) et WP06 (réglage de déploiement) ; R-13 ; ADR-199. **Bloque la production : oui (réglage de déploiement à faire).**

- **Constat.** Les 14 fonctions `ops_*` (0087) lisent des tables à sécurité par ligne forcée : elles ne voient la chaîne d'audit de la plateforme que si leur propriétaire est superutilisateur ou `BYPASSRLS` (hypothèse héritée de 0022, `audit_log_chain`). `ops_long_transactions` rend la ligne `?config` (pid nul) si le propriétaire n'est pas membre de `pg_read_all_stats` ; ce `GRANT` n'est pas dans `post-roles.sql`.
- **Risque.** Un propriétaire ordinaire rend la chaîne d'audit de la plateforme invisible et fait échouer `ops_ledgers_to_seal` ; sans `pg_read_all_stats`, la surveillance des transactions longues est aveugle (alerte de configuration 11).
- **Test de la limite.** `packages/ledger-sql/tests/tests_9b_rights.sql` (droits exacts de `cashless_maint`, ligne `?config`, appels réels) et `tests_ops_functions.sql` (63 tests, propriétaire non superutilisateur).
- **Mission qui le lève.** Mission 12b (lecture prestataire par prestataire, sans propriétaire privilégié). **Condition de levée.** Fonctions qui lisent par prestataire ; `pg_read_all_stats` inscrit à la procédure de déploiement et vérifié au démarrage.
- **Fichier à faire relire par une personne.** `post-roles.sql` section 12.

### OP-N134 — `closing_balance` déclaré jamais recoupé avec la somme des lignes (17 novembre 2026)

Source : relecture de WP02 (cycle 3) ; ADR-200. **Bloque la production : non.**

- **Constat.** Le solde de clôture est déclaré par l'importeur. « Rapproché » vaut : toutes les lignes rapprochées ET solde du relevé = solde du grand livre à la date (+ anomalies).
- **Risque.** Un solde déclaré faux avec des lignes justes passe si le solde du grand livre concorde.
- **Test de la limite.** `tests_statements.sql` (famille « rapproché »).
- **Mission qui le lève.** À proposer au porteur. **Condition de levée.** Contrôle : somme des lignes = variation du solde entre deux relevés du compte.

### OP-N135 — Une transaction rapprochée par plusieurs lignes (17 novembre 2026)

Source : relecture de WP02 (cycles 3 et 5) ; décision du porteur n° 7 (rapprochement automatique par signe et montant). **Bloque la production : non.**

- **Constat.** Un règlement PSP unique (`PSP_SETTLEMENT`) versé en deux virements ou plus donne deux lignes pour une écriture ; le modèle ne les représente pas. Le rapprochement manuel d'une seconde ligne à la même transaction est permis ; l'automatique exige que le montant égale le net ou le brut de la transaction sur le compte.
- **Risque.** La somme des lignes rapprochées à une transaction peut dépasser son montant sans refus.
- **Règle proposée.** « Somme des lignes rapprochées <= montant de la transaction sur ce compte ». **Mission qui le lève.** À proposer au porteur.
- **Test de la limite.** `tests_statements.sql` §3b et §3c, `reconciliation/match-statement-line.spec.ts`.

### OP-N136 — `explained_by_anomalies` non exposé ; deux lignes pour une anomalie (17 novembre 2026)

Source : notes de lane de WP09 et relecture. **Bloque la production : non.**

- **Constat.** La base calcule `explained_by_anomalies` (utilisé dans « rapproché ») mais `AccountReconciliation` du contrat figé ne le porte pas. Deux lignes de relevé peuvent être rapprochées à la même anomalie : l'écart expliqué additionne les deux.
- **Risque.** L'écran du back-office ne montre pas pourquoi un compte est rapproché ; un écart peut être « expliqué » deux fois.
- **Mission qui le lève.** À proposer au porteur (exposer le champ par ajout rétrocompatible, ou une ligne par anomalie).
- **Test.** `reconciliation/reconciliation-state.spec.ts` (« FR-015, OP-N82 : un paiement non crédité rapproché à son anomalie explique l'écart »).

### OP-N137 — Mineurs de la relecture de WP08 (17 novembre 2026)

- **LEVÉ le 19/11/2026 (mission 11a)**, ADR-220. **Mécanisme.** `payouts/payout-action.ts` : crochet
  `guardDecision(ctx, decision)` appelé avant `decide` pour `APPROVE` et `REJECT` (a : approbateur
  du mauvais rôle, `403`, demande `PENDING`, rien d'écrit ; b : le refus exige aussi la classe de
  bénéficiaire, renforcement de FR-014) ; c : un `confirm` rejoué laisse une ligne d'audit
  `PAYOUT_CONFIRM_REPLAYED` sans destination, sans écriture comptable ; d : l'auto-approbation rend
  exactement `409 APPROVAL_INVALID` (amendement de FR-016 : la spec disait `403`, la réponse réelle
  est `409`).
- **Test de levée.** `payouts/payout-guard-decision.spec.ts` (FR-013, FR-014, attribution révoquée)
  ; `payout-confirm.spec.ts` (« OP-N137 (c) ») ; `payout-batch.spec.ts` (auto-approbation,
  `APPROVAL_INVALID`).
- **Test de borne inversé.** L'ancien test d'auto-approbation qui acceptait `[403, 409]` n'accepte
  plus que `409 APPROVAL_INVALID` ; le test qui laissait passer le mauvais rôle en `FAILED` attend
  `403` et `PENDING`.
- **Mutations vérifiées.** Crochet `guardDecision` retiré : 4 échecs ; audit du rejeu retiré : 1
  échec ; repli sur l'IBAN brut à l'export : 1 échec ; `checkSealed` retiré de `execute` : 1 échec
  (commit `414e35f2`).
- **Limites restantes.** OP-N160.

Source : relecture de WP08 (cycle 1). **Bloque la production : non.**

- **(a)** Un approbateur du mauvais rôle fait passer la demande en `FAILED` (aucune écriture) : nuisance possible.
- **(b)** Refus sans rôle par classe de bénéficiaire (même `403` pour tous).
- **(c)** `confirm` rejoué avec le même résultat : `200` sans écriture ni audit (`settle_payout` idempotent).
- **(d)** Le test d'auto-approbation accepte `403` ou `409`.
- **Tests.** `payouts/payout-batch.spec.ts`, `payout-confirm.spec.ts`. **Mission qui le lève.** 11a.

### OP-N138 — Réclamation tardive en `CASH` inatteignable sur un grand livre `LOCKED` (17 novembre 2026)

Source : note de lane de WP10 ; ADR-206. **Bloque la production : non.**

- **Constat.** Un remboursement tardif en espèces exige une session de caisse ouverte par l'auteur ; sur un grand livre `LOCKED`, aucune session n'est ouverte : `422 REFUND_NOT_ALLOWED`. Règle voulue, consignée. `LEGAL` est refusé (non exprimable).
- **Test.** `late-claims/money-account.spec.ts` (« CASH sans session de caisse ouverte par l'auteur »).

### OP-N139 — Remboursement tardif en mobile money vers un autre numéro (17 novembre 2026)

Source : décision du porteur n° 13 du 17/11/2026 ; note de lane de WP10 ; ADR-207. **Bloque la production : non.**

- **Constat.** Une réclamation tardive de `WALLET_REFUND` peut payer en Wave ou Orange Money vers un numéro autre que celui du festivalier, sans code envoyé à ce numéro (contrairement à l'ADR-76 en ligne). Accepté par le porteur : contrôle par une seconde personne, preuve (`proof`) et bornes de `check_late_claim`.
- **Risque.** Un administrateur et son valideur complices peuvent faire partir un remboursement tardif vers un numéro qui n'est pas celui du titulaire ; la destination n'est pas dans l'audit (masquée).
- **Test de la limite.** `late-claims/late-claim.spec.ts` (« deux personnes : l'auteur ne valide pas sa demande », destination Wave autre numéro) : il échoue si une seule personne suffit ; la base refuse aussi `created_by = approved_by`.
- **Mission qui le lève.** Mission 12b. **Condition de levée.** Code à usage unique envoyé au numéro de destination avant paiement.
- **Report.** `PROMPTS-A-ENVOYER.md` (12b) et `PRD.md`.

### OP-N140 — IBAN non masqué par `redact.ts`, IBAN en clair au repos (17 novembre 2026)

- **LEVÉ le 19/11/2026 (mission 11a)**, ADR-218 (masque et chiffrement au repos). **Mécanisme.**
  `errors/redact.ts` masque l'IBAN par champ (`iban`, `iban=`) et par forme (texte libre) ;
  `common/iban-vault.ts` (`IbanVault`, AES-256-GCM, IV aléatoire, AAD liée au prestataire, enveloppe
  `enc:v1:<kid>:…`) ; anneau `IBAN_KEYRING` et `IBAN_ACTIVE_KID` lus en configuration de l'API,
  démarrage refusé en production sans eux ou avec une clé de test ; migration `0093_iban_sealed.sql`
  (`CHECK … NOT VALID` sur `refund_request.iban` et `payout.iban`) ; champ `iban_mask` (`maskIban`,
  `common/iban.ts`) à côté de l'enveloppe ; l'enveloppe est écrite aux trois emplacements
  (`refund_request.iban`, `payout.iban`, `approval_request.payload`) ; l'IBAN n'est ouvert que dans
  `exportBatch` (et vérifié par `checkSealed` à l'exécution) ; `maskPaymentData` rend `iban_mask`,
  jamais l'enveloppe.
- **Test de levée.** `unit/errors/redact.spec.ts` ; `unit/common/iban-vault.spec.ts` ;
  `tests_iban_sealed.sql` (clair refusé en `23514` sur les deux tables) ;
  `refunds/create-backoffice.spec.ts` (NFR-005, 7 cas) ; `late-claims/late-claim.spec.ts` ;
  `payouts/payout-export.spec.ts` (500 lignes en 90 ms, NFR-002) ; `payout-batch.spec.ts` (enveloppe
  altérée ou d'un autre prestataire forgée en base : `FAILED`, rien au grand livre, commit
  `414e35f2`) ; `unit/config.spec.ts` (production sans anneau ou avec clé de test refusée).
- **Test de borne inversé.** `invariants-cloture/limits-9b.spec.ts` figeait le comportement de
  `redact.ts` (IBAN non masqué) : il exige maintenant le masque (« OP-N140 levé »), et l'IBAN en
  clair sous `cashless_app` est refusé (23514).
- **Mutations vérifiées.** Sans `setAAD` : 2 échecs ; sans `setAuthTag` : 2 ; sans passe par valeur
  : 6 ; sans garde de production de l'anneau : 2 ; clé de test, `https`, 32 octets exacts, `kid`
  actif : 5 mutations tuées (WP04) ; sans `seal` : 7 cas échouent ; mapper qui rend l'enveloppe :
  échecs de `payout-roles` et `late-claim` ; `checkSealed` retiré : échec.
- **Écart accepté par le porteur (18/11/2026) : la clé de l'anneau est dans le processus public**
  (OP-N150, ADR-218). Texte libre et `msisdn` : OP-N156.
- **Fichiers à faire relire par une personne.** `errors/redact.ts`, `common/iban-vault.ts`,
  `config/config.ts` (anneau), `0093_iban_sealed.sql`.

Source : note de lane de WP11 ; ADR-203. **Bloque la production : oui si un journal de corps de requête est ajouté.**

- **Constat.** `errors/redact.ts` ne masque pas l'IBAN (aucun journal de corps aujourd'hui). `refund_request.iban` est stocké en clair (nécessaire au paiement manuel). L'audit et `GET /approval-requests` masquent l'IBAN et le numéro (`maskPaymentData`, WP08) ; la ligne de la base garde la valeur complète pour l'export.
- **Test.** `late-claims/late-claim.spec.ts` (« FR-024 : ni IBAN ni numéro dans l'audit ni dans GET /approval-requests », réactivé par la consolidation) et `payouts/payout-export.spec.ts`.
- **Mission qui le lève.** 11a. **Condition de levée.** Masque d'IBAN dans `redact.ts`, couvert avant tout journal de corps ; chiffrement au repos à décider.
- **Fichier à faire relire par une personne.** `errors/redact.ts`.

### OP-N141 — Écart explicite de la régularisation `OPERATOR_FEE` (17 novembre 2026)

- **LEVÉ le 18/11/2026 (mission 11a)**, ADR-220. **Mécanisme.** `ledger/builders/closing/fees.ts`
  exporte `operatorFeeTotal(config, bases)` ; `closing/calculators/operator-fee.ts` y délègue
  (`feeTotal`) ; l'écart `amount` de la régularisation `OPERATOR_FEE` ne peut dépasser les frais
  bruts (`VALIDATION_FAILED`). Retouche hors carte de WP11.
- **Test de levée.** `integration/closing/closing-variants.spec.ts` (5 tests) ;
  `unit/builders/closing/closing-builders.spec.ts` et les tests unitaires de clôture (70 verts :
  brut +1 sur trois assiettes, énorme, bases vides). **Test de borne inversé.** L'ancien test qui
  acceptait tout écart positif exige maintenant le refus de tout écart au-dessus des frais bruts.
- **Mutations vérifiées.** Contrôle retiré : 8 échecs ; `>` remplacé par `>=` : 3 échecs ; plafond
  +1 : 7 échecs (relecture).

Source : relecture de WP07 (cycle 2) ; décision n° 10 ; ADR-205. **Bloque la production : non.**

- **Constat.** Pour `NET_OF_REFUNDS`, `OperatorFeePayload.amount` (frais bruts − frais nets) n'est borné que par `requirePositive`, sans plafond aux frais bruts ; la valeur est fixée par le seul calculateur interne.
- **Mission qui le lève.** 11a. **Condition de levée.** Plafond = frais bruts, avec test.
- **Test.** `closing/closing-variants.spec.ts`.

### OP-N142 — Relevés et export comptable : limites relevées en relecture de WP13 (17 novembre 2026)

Source : relecture de WP13 (cycle 1) ; ADR-209. **Bloque la production : non.**

- **(a)** Pagination par numéro d'écriture sur plusieurs grands livres : une écriture validée plus tard peut être manquée entre deux pages (théorique).
- **(b)** Le relevé et le CSV du festivalier ne sont pas tracés dans l'audit (hors FR-024).
- **(c)** Export comptable : chaque écriture porte ses deux comptes légaux (`sens`) ; si les deux côtés d'une transaction sont mappés, un consommateur qui additionne tout compte deux fois. À documenter (note aux équipes clientes).
- **Mission qui les lève.** À proposer au porteur. **Tests.** `statements/accounting-export.spec.ts`, `party-statement.spec.ts`.

### OP-N143 — `closing_balance` non servi dans le relevé JSON (17 novembre 2026)

Source : décision du porteur n° 16 du 17/11/2026 ; note de lane de WP13 ; ADR-209. **Bloque la production : non.**

- **Constat.** Le champ facultatif `closing_balance` du `PartyStatement` n'est pas servi (somme O(n) sur comptes chauds : p95 de 2,2 s sans index couvrant). Le CSV porte le solde courant. NFR-004 : p95 270 ms organisateur, 148 ms prestataire, 94 ms plateforme, 104 ms commerçant (100 000 transactions, 20 simultanés).
- **Mission qui le lève.** Mission ultérieure, à proposer au porteur : index `posting(account_id) INCLUDE (amount)`.
- **Test.** `statements/party-statement.spec.ts`, `statement-latency.spec.ts`.

### OP-N144 — Recrédit d'un `FAILED` sans voie de contournement (17 novembre 2026)

Source : note de lane de WP11 (question au porteur) ; décisions n° 13 (16/11) et n° 14 (17/11) ; ADR-203. **Bloque la production : non.**

- **Constat.** Si une ligne de relevé est rapprochée à la sortie d'argent d'une demande `PROCESSING`, `confirm FAILED` répond `409` : le paiement est visible à la banque. Aucun second valideur ne peut passer outre (défaut sûr). La demande reste confirmable `PAID`.
- **Risque.** Un rapprochement posé à tort bloque le recrédit ; un rapprochement ne se défait pas en 9b (data-model, invariant 4).
- **Mission qui le lève.** À proposer au porteur. **Condition de levée.** Défaire un rapprochement à deux personnes, ou second valideur au contrat.
- **Test.** `refunds/failed-recredit-bound.spec.ts`.

### OP-N145 — `refund_request` : `INSERT` direct et anciennes signatures (17 novembre 2026)

- **LEVÉ le 19/11/2026 (mission 11a)**, ADR-219. **Mécanisme.** Migration
  `0092_refund_request_insert_guard.sql` : déclencheur `refund_request_insert_guard` (`CL057`, `409
  CONFLICT_STATE`, `sqlstate-map.ts`) qui refuse tout `INSERT` hors état initial (`AWAITING_HOLDER`,
  `REQUESTED`) ; `INSERT` de `cashless_app` limité par colonne (`post-roles.sql` §13) ;
  `refund_deposit_for_session(uuid, uuid)` retirée (`DROP FUNCTION`, migration `0092`) ;
  `refund_deposit(uuid, uuid)` **gardée** interne, exécutable par aucun rôle (écart à FR-012,
  OP-N153).
- **Test de levée.** `tests_refund_insert_guard.sql` ; `tests_11a_rights.sql`
  (`refund_deposit(uuid,uuid)` et `refund_request_insert_guard()` sans `EXECUTE`, appel refusé en
  `42501`) ; `tests_refund_transitions.sql`.
- **Test de borne inversé.** `invariants-cloture/limits-9b.spec.ts`, bloc « OP-N145 : insertion sous
  cashless_app » : `PAID`, `CANCELLED`, `PROCESSING`, `REJECTED` insérés directement sont refusés
  (avant : « seul `cashless_app` a `INSERT` » comme limite acceptée) ; `PAID` avec une colonne non
  accordée : 42501.
- **Mutations vérifiées.** Déclencheur désactivé : `CANCELLED` passe (WP02) ; `DISABLE TRIGGER` : 4
  cas échouent (WP09) ; `GRANT INSERT (status, external_reference)` : 3 échecs de `limits-9b`
  (WP09).
- **Limites restantes.** Superutilisateurs exclus de la garde, `CHECK` `NOT VALID` : OP-N155.
- **Fichiers à faire relire par une personne.** `refund_request_insert_guard()` (`0092`).

Source : en-tête de `0086_refund_debts.sql` (WP04). **Bloque la production : non.**

- **Constat.** `refund_request_transition_guard` est `BEFORE UPDATE` : un `INSERT` direct en `PAID` reste possible sous les CHECK (aucune garde d'insertion ajoutée ; `cashless_app` n'a pas `INSERT` direct sur les colonnes de transition au-delà des droits de `post-roles.sql`). Les signatures `refund_deposit(uuid, uuid)` et `refund_deposit_for_session(uuid, uuid)` sont conservées et délèguent avec `NULL, NULL` ; l'appel TypeScript passe aux signatures à quatre arguments (WP11).
- **Mission qui le lève.** 11a (proposition, à confirmer par le porteur) : garde d'insertion et retrait des anciennes signatures.
- **Test.** `invariants-cloture/limits-9b.spec.ts` : seul `cashless_app` a `INSERT` sur `refund_request` (droits de table et de colonne, `has_column_privilege` pour chaque rôle `cashless_*` et chaque colonne), aucun `DELETE`, colonnes d'`UPDATE` bornées ; mutation `GRANT INSERT (status) ... TO cashless_platform` : le test échoue.
- **Fichiers à faire relire par une personne.** `0086_refund_debts.sql` (`refund_request_transition_guard`, `refund_deposit` à quatre arguments).

### OP-N147 — Numéro de paiement en clair dans le résultat d'une approbation `WALLET_REFUND` (17 novembre 2026) — LEVÉ

Relevé par WP14 en rejouant la preuve FR-024 de WP10 après consolidation ; ADR-204. **Levé le 17/11/2026 par la mission 9b (WP14), sur décision de l'orchestrateur (renforcement, règle 1) : `approvalRequestDto` applique `maskPaymentData` à `result` comme à `payload` ; test `invariants-cloture/payment-data-exposure.spec.ts` (mutation : sans le masque, il échoue), ADR-211.** Constat d'origine ci-dessous.

- **Constat.** `approvalRequestDto` (`approval/approval.mapper.ts`, WP08) masque `payload` par `maskPaymentData` mais recopie `result` tel quel. Le `result` d'une demande `WALLET_REFUND` exécutée est la demande de remboursement : `destination: { method, msisdn }`. Le numéro est donc en clair dans `GET /approval-requests` et dans les lignes d'audit `APPROVAL_EXECUTED` (9a, `wallet-refund-action.ts`). Aucun IBAN n'y figure (le DTO ne porte pas `iban`). Conséquence de test : `late-claims/late-claim.spec.ts` (« FR-024 », balayage de tout `audit_log`) échoue sur une base où la suite des remboursements a tourné avant, avec le numéro `+221770000099` ; il passe sur une base neuve.
- **Risque.** Donnée personnelle (numéro de mobile money) lisible par les rôles qui lisent les demandes et par quiconque lit l'audit ; contraire à FR-024.
- **Options pour le porteur.** (1) Appliquer `maskPaymentData` à `result` dans `approvalRequestDto` (correction d'une ligne, lot WP08, renforcement) ; (2) ne pas inclure la destination dans le `result` d'une approbation.
- **Test.** `invariants-cloture/payment-data-exposure.spec.ts` ; le balayage de `late-claim.spec.ts` est filtré sur ses propres objets.
- **Fichier à faire relire par une personne.** `approval/approval.mapper.ts`.

### OP-N146 — Renforcements de la mission 9b (17 novembre 2026) — CLOS

Faits puis consignés (règle 1 de `CLAUDE.md`) ; aucun n'affaiblit la sécurité.

- Garde de `closing_step` limitée au grand livre de l'événement (WP02, ADR-201) ; conditions de passage ajoutées (`NO_OPEN_CASH_SESSION`, `PSP_RECONCILED` calculée, `CLOSING_STEPS_DONE`, `REFUND_DEADLINE_REACHED`, R-05, ADR-201).
- `create_payout_batch` limité à une demande `APPROVED` d'action `PAYOUT`, auteur ≠ demandeur, valideur ≠ décideur ; `payout` exige `initiated_tx_id` (et `settled_tx_id` au règlement) ; borne du droit net en base `CL055` (WP03, décision 6, R-07, ADR-201).
- Unicité globale `(source, external_ref)` retirée au profit de l'unicité par compte (WP02, ADR-200).
- Rapprochement automatique par signe et montant (net ou brut) (WP02, décision 7, ADR-202).
- Verrou de `refund_request` au rapprochement (décision 14, ADR-203) ; arbitrages de la route 15 (virement `REQUESTED`, numéro étranger en `AWAITING_HOLDER`, `extra_check`).
- `ops_verify_audit_chain` ajoutée pour la chaîne d'audit (WP05, FR-020, ADR-201).
- Charge du versement et de la réclamation tardive revalidées à l'exécution ; grand livre à portée organisateur refusé sur les sept étapes (WP10, WP07, ADR-205, ADR-206).
- Bornes de période de l'export comptable en UTC (décision 17, ADR-209, `invariants-cloture/utc-bounds.spec.ts`).
- Enums Dart générés renommés par l'ajout de valeurs au contrat (décision 6) : `Event.status` passe de `Status4` à `Status5`, `TokenFamily.status` de `Status5` à `Status6` ; casse la compilation des clients qui nomment ces enums, signalé dans `docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md` (ADR-213).
- `apps/api/test/fixtures/edge-vectors/vectors.json` reformaté par Prettier par WP07, hors carte (aucune valeur changée).
- Tests de borne ajoutés après la mission : `invariants-cloture/limits-9b.spec.ts` (OP-N140 : comportement actuel de `redact.ts` figé ; OP-N145 : seul `cashless_app` a `INSERT` sur `refund_request`, aucun `DELETE`, colonnes d'`UPDATE` bornées).

### OP-N148 — Reste d'OP-N126 : ligne de relevé importée après le recrédit d'un `FAILED` (17 novembre 2026)

Source : relectures de WP11 et de la mission ; décision n° 14 ; ADR-212. **Bloque la production : non.**

- **Constat.** La base ferme la fenêtre de course entre un rapprochement validé et le `REVERSAL` (ADR-203, verrou de `refund_request`). Reste le cas inverse : une ligne de relevé importée **après** le recrédit d'une demande `FAILED` n'est pas rapprochée (le rapprochement automatique la laisse « non rapprochée », le manuel est refusé). Elle ne lève que l'alerte générique `statement-unmatched` ; aucune alerte dédiée « paiement vu à la banque après recrédit ». Le recrédit reste possible tant que la ligne n'est pas importée : structurel, la banque n'est pas encore connue.
- **Risque.** Un paiement réellement parti puis recrédité (double versement possible) n'est signalé que par une alerte générique, sans lien avec la demande.
- **Test de la limite.** `tests_statements.sql` (section 4b : demande `FAILED`, ligne laissée non rapprochée) ; `invariants-cloture/consignation.spec.ts` (fiche, ADR, reports).
- **Mission qui le lève.** Mission 12b (alertes). **Condition de levée.** Alerte dédiée, avec envoi à une personne (OP-N132), à l'import d'une ligne dont la référence est celle d'une demande recréditée.
- **Report.** `PROMPTS-A-ENVOYER.md` (12b) et `PRD.md`.

### OP-N149 — Pas de balayage d'isolation entre organisateurs d'un même prestataire (17 novembre 2026)

Source : relecture de WP14 ; **pas un écart accepté** (aucun ADR) : un trou dans la preuve, aucun défaut constaté. **Bloque la production : non.**

- **Constat.** `invariants-cloture/isolation-9b.spec.ts` ne prouve que l'isolation entre prestataires, qui repose aussi sur la RLS : une mutation qui retire un contrôle applicatif reste verte. Aucun balayage entre organisateurs d'un même prestataire n'existe pour les 20 opérations ajoutées au contrat.
- **Mission qui le lève.** Mission 13 (recette V1). **Condition de levée.** Balayage des 20 opérations avec deux organisateurs du même prestataire, et mutation d'un contrôle applicatif qui le fait échouer.
- **Report.** `PROMPTS-A-ENVOYER.md` (13) et `PRD.md`.

### Levées de la mission 9b (17 novembre 2026)

OP-N123, OP-N124, OP-N126, OP-N128, OP-N130 et la partie « rapprochement » d'OP-N82 passent à « levé le 17/11/2026 par la mission 9b » (ADR-210). Pour chacun : test de levée dans la ligne du tableau de la section 1. OP-N3 reste ouvert (aucun jeu de correspondance SYSCOHADA livré, `account_mapping` vide).

## 11. Mission 11a (durcissements serveur hérités) : consignation du 19/11/2026

Écrit par WP14 le 19/11/2026 à partir des notes de lane de WP01 à WP13 (journal d'états de la
mission), des relectures et des décisions du porteur du 18/11/2026 et du 19/11/2026. Mission Spec
Kitty `durcissements-serveur-01M7QAJD`. Chaque entrée cite sa source, son test et l'ADR qui la porte
(ADR-216 à ADR-224). « Bloque la production » : voir la ligne du tableau de la section 2. **Preuves
par FR, NFR et SC** : `acceptance-matrix.json` de la mission (tenue par l'orchestrateur, source des
commandes et résultats) ; chaque FR de `spec.md` apparaît ci-dessous (FR-001 à FR-004 : OP-N60 ;
FR-005 à FR-007 : OP-N76 ; FR-008 : OP-N79 ; FR-009 et FR-010 : OP-N140 ; FR-011 et FR-012 : OP-N145
; FR-013 à FR-016 : OP-N137 ; FR-017 : OP-N141 ; FR-018 et FR-019 : OP-N64 ; FR-020 : OP-N116 ;
FR-021 : cette section).

### Lots de la mission

| Lot | Contenu | Migrations et tests principaux |
|---|---|---|
| WP01 | Lots de bracelets et clé vendeur-session | `0090`, `0091` ; `tests_vendor_session_key.sql` (11), `tests_media_batch_functions.sql` (79) |
| WP02 | Garde d'insertion, IBAN scellé, inscription, App Attest | `0092` à `0095` ; `tests_refund_insert_guard.sql`, `tests_iban_sealed.sql`, `tests_edge_gateway.sql`, `tests_device_app_attest.sql` |
| WP03 | Droits de la base (`post-roles.sql` §13, `cashless_pin`) | `tests_11a_rights.sql` (69) ; 83 suites pgTAP vertes sur la base du lot |
| WP04 | Configuration (anneau d'IBAN, clé d'appel de `vendor-pin`) | `unit/config.spec.ts` |
| WP05 | Lots de bracelets, côté API | `integration/media/batches.spec.ts`, `blacklist.spec.ts` |
| WP06 | Processus `vendor-pin` | `integration/vendor-pin/vendor-pin-process.spec.ts` (13) |
| WP07 | Session de vendeur par le processus (client, anti-rejeu) | `integration/vendors/*`, `vendor-pin-call-replay.spec.ts` |
| WP08 | Coffre d'IBAN et masque | `unit/common/iban-vault.spec.ts`, `unit/errors/redact.spec.ts` |
| WP09 | Remboursements et IBAN scellé | `refunds/create-backoffice.spec.ts`, `invariants-cloture/limits-9b.spec.ts` |
| WP10 | Versements, décisions, export | `payouts/payout-guard-decision.spec.ts`, `payout-batch.spec.ts`, `payout-confirm.spec.ts` |
| WP11 | Plafond de la régularisation | `closing/closing-variants.spec.ts` |
| WP12 | Inscription des passerelles | `tools/edge-admin/test/register.spec.ts`, `commands-other.spec.ts` |
| WP13 | App Attest côté serveur | `unit/attestation/*`, `integration/attestation/*` |

### Retouches hors carte relevées

`test/support/tls.ts` (WP04, `VENDOR_PIN_CALL_KEY`, `IBAN_KEYRING`) ; `apps/api/src/app.module.ts`
(WP08, une ligne d'import et `IbanVaultModule`) ; `closing/calculators/operator-fee.ts` (WP11) ;
`processes/bootstrap.ts` (option `host`, écoute loopback) et les cas
`device-auth-cases/{payments,vendors}.cases.ts`, `payments-fixtures.ts` (WP06) ;
`errors/sqlstate-map.ts` (WP05 `CL056`, WP09 `CL057`, test `sqlstate-map.spec.ts`) ;
`config/config.ts`, `vendor-pin/vendor-pin-call.guard.ts`, `test/support/app.ts`,
`architecture.spec.ts`, `config.spec.ts` (WP07, la garde autorisée par le porteur le 19/11/2026) ;
`commands-other.spec.ts`, 5 lignes au lieu de 3 (WP12) ; tests pgTAP figés ajustés (WP02, WP03) ;
`env.test.example`, `SERVICES-EXTERNES.md`, `migrate.ts` (`CASHLESS_PIN_PASSWORD`),
`ledger-tests.yml`, `test/support/db.ts` (WP03). `tests_refund_insert_guard.sql` (`GRANT INSERT`
limité à la transaction de test, annulée) est à valider par le relecteur humain. Aucune retouche à
`openapi.yaml` ni à `SPECIFICATION.md`.

### Instabilités et états intermédiaires rencontrés

- **Casse de compilation WP06 vers WP07.** Après WP06, `tsc` échoue dans `src/vendors/` tant que
  WP07 n'est pas fusionné (l'API n'a plus `hash`/`verify`) ; `config.ts` lit encore
  `VENDOR_PIN_SECRET` jusqu'à WP07. **WP06 et WP07 se fusionnent ensemble.** État voulu, levé par
  WP07.
- **`closing-journey.spec.ts` (5 sur 8 en échec) dans toute lane qui a WP02 sans WP10** : `0093`
  refuse l'IBAN en clair que l'API écrit avant WP10 (`23514` dans `create_payout_batch`). 8 sur 8
  dans la lane de WP10 : pas une régression. `device-auth-matrix` et les tests qui ouvrent une
  session par `POST /vendor-sessions` (`payments-*`, `payment-journey`, `payment-isolation`,
  `offline-secrets`) : `403` depuis WP03 (voulu), levé par WP07 ; ces fichiers ne sont dans aucun
  `owned_files` : à relancer en série après la fusion.
- **Défaut de rapport** (amélioration possible, non bloquante) : `23514` est classé
  `VALIDATION_FAILED` sans motif (`payout-action.ts`, `SQL_FAILURES`).
- Instabilités déjà connues : `tests_event_ledger.sql` 63-66, `claim-code-order.spec.ts`,
  `transverse/migrate-lock.spec.ts`, latences sous Docker. Les tests `commands-other` de WP12 sur
  vraie base ont été rejoués par le relecteur de WP12 sur `cashless_wp12`.
- **Déploiement (WP04).** En production, tout processus qui appelle `loadConfig` exige
  `VENDOR_PIN_CALL_KEY`, `IBAN_KEYRING` et `IBAN_ACTIVE_KID` ; le processus `vendor-pin` exige en
  plus `VENDOR_PIN_SECRET` et son URL de base (`VENDOR_PIN_URL`). Le rôle `cashless_pin` n'a pas de
  mot de passe en production (OP-N157).

### Renforcements faits puis consignés (règle 1 de `CLAUDE.md`)

Aucun n'affaiblit la sécurité (ADR-216 à ADR-224). `redact.ts` masque `msisdn` et les IBAN libres
(OP-N156, 19/11/2026, `3c112821`). `media_set_status` limité à `SUSPENDED` et
`BLACKLISTED` ; `create_media_batch` exige un acteur et l'historique `→ORDERED` porte l'auteur et le
motif « Création du lot » (avant : NULL) ; `UPDATE` de `media` réduit à deux colonnes ; refus d'un
lot de versements : la classe de bénéficiaire est exigée (FR-014) ; réclamation tardive : masque
falsifié et enveloppe illisible refusés à l'exécution (`APPROVAL_INVALID`) ; lot de versements :
masque d'IBAN recoupé avec l'enveloppe ouverte à l'exécution, masque falsifié → `FAILED`
(`VALIDATION_FAILED`) (revue post-fusion du 20/11/2026, constat B-1, commit `ae432316`, test
« masque falsifié » de `payout-batch.spec.ts` ; avant ce correctif, le valideur pouvait voir le
masque d'un autre IBAN que celui payé) ; `23505` de la clé App Attest converti en `422
ATTESTATION_FAILED` (au lieu de `500`) ; cache anti-rejeu et refus d'un corps sans `rawBody` (garde
de `vendor-pin`, décision du porteur du 19/11/2026) ; test d'ouverture de l'enveloppe à l'exécution
d'un versement (décision du porteur du 19/11/2026, commit `414e35f2`).

### Décisions du porteur consignées

- **18/11/2026, au plan** : (1) clé d'IBAN en configuration de l'API (OP-N150) ; (2)
  `refund_deposit(uuid, uuid)` gardée interne (OP-N153) ; (3) un seul `EXECUTE` nouveau pour
  `cashless_app` hors OP-N60 : `advance_app_attest_counter` (OP-N152). ADR-223.
- **19/11/2026** : cache de signatures vues et refus d'un corps sans `rawBody` dans la garde de
  `vendor-pin` (fait par WP07) ; test d'ouverture de l'enveloppe à l'exécution des versements (fait
  par WP10, `414e35f2`).
- **19/11/2026 (consignées par WP14, ADR-223)** : (a) Colima et Docker trouvés arrêtés : relance
  autorisée par le porteur, pour le conteneur de test `cashless-platform-pg17` seulement ;
  `cashless-api-db-1` (base de l'API partagée, port 5434) reste arrêté, à relancer par le porteur.
  (b) Les tests de borne manquants sont écrits **avant** la fusion (règle 3), dans la lane n :
  `bde1d13b`, `3c112821`, `d7d1d139`. (c) `msisdn` et les IBAN libres (tirets, espaces insécables,
  collés) sont masqués par `redact.ts` : **OP-N156 passe de question ouverte à LEVÉ le 19/11/2026,
  par renforcement** (commit `3c112821`) ; limites résiduelles dans la fiche d'OP-N156.

### Contradiction CL058, tranchée par le porteur le 19/11/2026

`interfaces.md` (l. 44) attribue à WP12 le mappage HTTP de `CL058` dans `sqlstate-map.ts`. Or
`CL058` n'est levé que par `register_edge_gateway`, appelée par l'outil `edge-admin` (traduit par le
`main.ts` de l'outil), jamais par l'API : le mappage ne serait jamais atteint. Option proposée :
corriger `interfaces.md` (pas de ligne inutile dans l'API). **Tranchée par le porteur le
19/11/2026 : `interfaces.md` corrigé (CL058 traduit par edge-admin, absent de l'API).**
`sqlstate-map.ts` n'a pas de ligne `CL058` ; `sqlstate-map.spec.ts` a une ligne `CL057`.

### Fichiers à faire relire par une personne (règle 4 de `CLAUDE.md`)

L'agent qui a écrit le code ne vaut pas relecture indépendante. Clés, droits de la base,
cryptographie :

- `apps/api/src/errors/redact.ts` ; `apps/api/src/common/iban-vault.ts` et la configuration de
  l'anneau (`config/config.ts` : `ibanKeyring`, `ibanActiveKid`, `vendorPinSettings`) ;
- migrations `0090` à `0095` (en particulier `0091` fonctions `DEFINER` de lot, `0092`
  `refund_request_insert_guard()`, `0095` `advance_app_attest_counter`) ;
- `packages/ledger-sql/post-roles.sql` section 13 et `roles.sql` (rôle `cashless_pin`, retraits à
  `cashless_app`) ;
- `apps/api/src/main.vendor-pin.ts`, `vendor-pin/vendor-pin-call-signature.ts` (signature HMAC de
  l'appel interne), `vendor-pin/vendor-pin-call.guard.ts` (cache anti-rejeu),
  `vendor-pin/vendor-pin.digester.ts`, `vendors/vendor-pin.client.ts` ;
- `apps/api/src/attestation/ios-app-attest-assertion.ts` (cryptographie : la relecture humaine est
  la seule garantie avant un vecteur d'Apple) ;
- `payouts/payout-action.ts` (`checkSealed`, ouverture de l'enveloppe) et
  `late-claims/late-claim-action.ts` (masque falsifié refusé) : ajoutés par WP14 d'après les notes
  de WP09 et WP10 ;
- `packages/ledger-sql/tests/tests_refund_insert_guard.sql` (octroi de test limité à une transaction
  annulée).

### Tests de borne écrits avant la fusion (19/11/2026) et ce qui reste non figé

Décision du porteur du 19/11/2026 : les tests de borne sont écrits avant la fusion, dans la lane n.
Chacun a été vérifié par mutation (la mutation fait échouer le test) sauf mention contraire.

- `packages/ledger-sql/tests/tests_11a_bounds.sql` (`bde1d13b`, 46 assertions) : OP-N155(b),
OP-N157,
  OP-N8 (`cashless_pin` sans pouvoir d'administration) et OP-N152 ; 12 mutations détectées.
- `3c112821` : OP-N156 (`unit/errors/redact.spec.ts`), OP-N160
  (`integration/payouts/payout-export.spec.ts`, `payout-mixed-visibility.spec.ts`), OP-N161
  (`integration/media/batches-op-n161.spec.ts`), `CL057` dans `unit/errors/sqlstate-map.spec.ts`.
  Mutations détectées, sauf OP-N160 (a) : non faite.
- `d7d1d139` : OP-N151 et OP-N159 (c) (`unit/architecture.spec.ts`), OP-N151, OP-N158 et OP-N159
  (`integration/vendors/vendor-pin-bounds.spec.ts`,
  `integration/vendor-pin/vendor-pin-process.spec.ts`),
  anti-rejeu (`vendor-pin-call-replay.spec.ts` : fenêtre 30 s, garde 70 s, cache 20 000).

**Reste non figé, consigné comme limite** (points 23 à 25 de la relecture) : (a) la garde de
`refund_request_insert_guard` ne vise que les membres de `cashless_app` ; `cashless_platform` et
`cashless_pin` ne sont arrêtés que par l'absence de droit `INSERT`, elle figée ; (b) le second
contrôle `REVOKED` dans l'`UPDATE` d'`advance_app_attest_counter` est une défense en double, non
figée séparément ; (c) le mot de passe de `cashless_pin` n'est pas testable en base de test ; (d)
les attributs de rôle survivent à `reset-db` (rôles du cluster) : une mutation sur un rôle se défait
à la main ; (e) le retard du `PATCH` de B sur un lot de A (OP-N161) n'est pas figé ; (f) CL058
absent
de `sqlstate-map.ts` (contradiction tranchée le 19/11/2026, ci-dessus). **Non testable :
OP-N154** (la réutilisation d'un
secret entre processus est invisible d'un processus seul) : c'est un **contrôle de déploiement**.
`tests_11a_bounds.sql` est à faire relire par une personne : ses listes attendues sont la source
des bornes.

### OP-N150 — Clé de l'IBAN dans le processus public (18 novembre 2026)

Source : décision du porteur n° 1 du 18/11/2026 (plan) ; notes de WP04, WP08 ; ADR-218. **Bloque la
production : non (écart accepté) ; le faux n'existe pas : le démarrage est refusé sans anneau.**

- **Constat.** L'anneau de clés d'IBAN (`IBAN_KEYRING`, `IBAN_ACTIVE_KID`) est lu par l'API, donc
  par le processus qui exporte le CSV (`x-process: public`). Le processus public n'a aucun port du
  service de clés (`architecture.spec.ts` l'interdit) et seul un faux existe.
- **Risque.** Une API compromise lit la clé et ouvre les IBAN qu'elle peut lire. Gain conservé :
  base, sauvegardes, réplicas, autres rôles de base et injection SQL en lecture ne voient que des
  enveloppes.
- **Test de la limite.** `unit/config.spec.ts` (production sans anneau, avec clé de test ou sans
  `kid` actif : refusée) ; `tests_iban_sealed.sql` (clair refusé) ; `unit/architecture.spec.ts`
  (aucun port de clés dans l'API publique).
- **Mission qui le lève.** Mission 12b. **Condition de levée.** Vrai KMS (OP-N41) : retirer
  `IBAN_KEYRING` de la configuration de l'API, rouvrir par un port du service de clés, ce qui impose
  de lever la règle d'architecture du processus public ou de déplacer l'export (décision du
  porteur).
- **Report.** `PROMPTS-A-ENVOYER.md` (12b) et `PRD.md`. **Fichier à faire relire.**
  `common/iban-vault.ts`.

### OP-N151 — PIN en transit vers le processus vendor-pin (18 novembre 2026)

Source : plan, tableau des écarts ; ADR-217 ; reste d'OP-N76. **Bloque la production : non (limite
acceptée).**

- **Constat.** L'API voit le PIN en clair avant de le passer au processus `vendor-pin` ; création et
  changement de PIN restent appelés par l'API. Le corps de l'appel signé porte le PIN.
- **Risque.** Une API compromise peut tester des PIN, au rythme du décompte d'essais existant (même
  limite qu'avant, désormais nommée). Sécurité de l'appel : secret partagé (HMAC), écoute loopback,
  TLS 1.3 hors loopback. **Portée précisée le 20/11/2026 (revue post-fusion, N-3)** : un processus
  d'API **entièrement** compromis (clé d'appel et connexion `cashless_app`) n'est pas borné par le
  décompte. Il peut faire calculer l'empreinte d'un PIN de son choix (`POST hash` du processus
  `vendor-pin`), l'écrire par `set_vendor_pin` (`vendors.service.ts`, qui remet le compteur à 0 et
  lève le blocage, `0031_vendors.sql`), puis ouvrir une session de ce vendeur avec ce PIN. Le
  changement de PIN est audité (`VENDOR_PIN_CHANGED`) et ferme les sessions ouvertes. Une connexion SQL
  seule ne le peut pas : sans le secret du processus, elle ne fabrique pas d'empreinte valide.
- **Test de la limite.** `vendor-pin-process.spec.ts` (le décompte d'essais borne les essais,
  `LOCKED` au 5e) ; `architecture.spec.ts` (l'API ne lit pas le secret des PIN). **Test de borne
  (`d7d1d139`) :**
  `unit/architecture.spec.ts` « OP-N151 » (hors de `vendor-pin/`, aucun fichier ne persiste ni ne
  journalise le champ `pin`, avec son contrôle) et `integration/vendors/vendor-pin-bounds.spec.ts`
  (ouverture réussie, refusée, plantée, création et changement de PIN : le PIN n'est ni en base ni
  dans un journal).
- **Mission qui le lève.** Mission 12 avec OP-N56 (12b). **Condition de levée.** Preuve du PIN que
  l'API ne peut pas voir (calculée par l'app).
- **Report.** `PROMPTS-A-ENVOYER.md` (12 et 12b) et `PRD.md`.

### OP-N152 — Compteur App Attest : déni de service par `cashless_app` (18 novembre 2026)

Source : décision du porteur n° 3 du 18/11/2026 ; note et relecture de WP13 ; ADR-222. **Bloque la
production : non.**

- **Constat.** `cashless_app` exécute `advance_app_attest_counter(uuid, bytea, bigint)` (`SECURITY
  DEFINER`, `search_path = public, pg_temp`, mise à jour conditionnelle atomique). C'est le seul
  `EXECUTE` nouveau de la mission hors OP-N60.
- **Risque.** Une API compromise peut faire avancer le compteur d'un appareil et bloquer ses
  assertions (déni de service), sans gagner d'accès.
- **Test de la limite.** `tests_11a_bounds.sql` (`bde1d13b`, section OP-N152 : `EXECUTE` de la
  fonction, compteur strictement croissant, terminal `REVOKED` refusé, autre prestataire refusé) ;
  `tests_execute_grants.sql` et `tests_11a_rights.sql` : la liste figée des
  `EXECUTE` de `cashless_app` contient cette fonction et rien d'autre de nouveau ;
  `integration/attestation/app-attest-assertion.spec.ts` (compteur strictement croissant, avance
  atomique).
- **Mission qui le lève.** Aucune demandée (risque accepté) ou signature de l'avance (mission 12).
  **Condition.** Si la mission 12 signe l'avance, retirer l'`EXECUTE` ; sinon aucune.
- **Report.** `PROMPTS-A-ENVOYER.md` (12) et `PRD.md`. **Fichier à faire relire.** `0095`
  (`advance_app_attest_counter`).

### OP-N153 — `refund_deposit(uuid, uuid)` gardée (18 novembre 2026)

Source : décision du porteur n° 2 du 18/11/2026 ; note de WP02 ; ADR-219. **Bloque la production :
non.**

- **Constat.** Écart à FR-012 : `refund_deposit(uuid, uuid)` n'est pas retirée ; elle est appelée
  par `refund_deposit_from_balance` (0041), par le générateur `gen_tests.py` et définie dans le
  schéma de référence, que la mission ne modifie pas (C-004).
- **Risque.** Neutre : exécutable par aucun rôle applicatif ni `PUBLIC`.
- **Test de la limite.** `tests_11a_rights.sql` (« exécutables par aucun rôle `cashless_*` ni
  `PUBLIC` », appel refusé en `42501`) ; `tests_refund_transitions.sql`.
- **Mission qui le lève.** Prochain remaniement du générateur et du schéma de référence. **Condition
  de levée.** Fonction retirée avec ses appelants.
- **Mission héritière.** Mission 13 (confirmée par le porteur le 19/11/2026 : le générateur
  `gen_tests.py` et le schéma de référence ne se modifient pas avant). **Report.**
  `PROMPTS-A-ENVOYER.md` (13) et `PRD.md`.

### OP-N154 — Secret du PIN réutilisé dans un autre processus, non détecté (19 novembre 2026)

Source : note et relecture de WP04 (18/11/2026) ; ADR-224. **Bloque la production : non.**

- **Constat.** `vendorPinSettings` ne compare le secret des PIN qu'avec son propre environnement.
  Une fois l'API sans `VENDOR_PIN_SECRET`, un secret du PIN réutilisé comme autre secret dans un
  autre processus ou sur une autre machine n'est détecté nulle part. Inhérent à la séparation voulue
  (OP-N76).
- **Risque.** Une erreur de déploiement annule la séparation sans alerte.
- **Test de la limite.** Aucun n'est possible dans un processus seul. `architecture.spec.ts` prouve
  seulement que l'API ne lit pas le secret. **Non testable ; contrôle de déploiement** (procédure
  ou outil) à la charge de la mission 12b.
- **Mission qui le lève.** Mission 12b (coffre des secrets, un secret par rôle). **Condition de
  levée.** Secrets distincts émis par le coffre.
- **Report.** `PROMPTS-A-ENVOYER.md` (12b) et `PRD.md`.

### OP-N155 — IBAN `NOT VALID` et superutilisateurs hors de la garde (19 novembre 2026)

Source : notes de WP02 ; ADR-224 ; décision du porteur du 19/11/2026. **Bloque la production :
oui.**

- **Constat.** (a) Une ligne ancienne de `refund_request` ou `payout` avec un IBAN en clair ne peut
  plus changer d'état : le `CHECK` est réévalué à l'`UPDATE`. Sans effet en pré-production (aucune
  donnée réelle, bases de développement recréées). (b) Le déclencheur `refund_request_insert_guard`
  exclut les superutilisateurs (fixtures du propriétaire) ; un superutilisateur pouvait déjà
  désactiver le déclencheur. Neutre.
- **Risque.** (a) Nul ici ; en production avec données anciennes, il faut chiffrer ou purger avant
  `VALIDATE` : d'où la condition bloquante. (b) Aucun aujourd'hui ; réexaminé avec (a).
- **Test de la limite.** (a) `tests_iban_sealed.sql` (la ligne ancienne ne change pas d'état ; les
  deux `CHECK` sont `NOT VALID`). (b) `tests_11a_bounds.sql` (`bde1d13b`, section OP-N155(b) : la
  garde n'exclut que les superutilisateurs, une seule exclusion, texte de la garde). Limite non
  figée : la garde ne vise que les membres de `cashless_app` ; `cashless_platform` et `cashless_pin`
  ne sont arrêtés que par l'absence de droit `INSERT`, elle figée.
- **Mission qui le lève.** Mission 12b (décision du porteur du 19/11/2026) : **condition bloquante
  de passage en production**. La 12b purge ou chiffre les lignes anciennes en clair de
  `refund_request` et de `payout`, puis fait `ALTER TABLE … VALIDATE CONSTRAINT` sur les deux
  `CHECK`, avant la première donnée réelle ; le statut des superutilisateurs exclus de la garde est
  réexaminé au même moment. **Condition de levée.** Aucune ligne en clair, `CHECK` validés.
- **Report.** `PROMPTS-A-ENVOYER.md` (12b) et `PRD.md` (11a, 12b).

### OP-N156 — Masque d'IBAN en texte libre et `msisdn` : LEVÉ le 19/11/2026 par renforcement

Source : relecture et note de WP08 ; décision du porteur du 19/11/2026 ; ADR-218, ADR-223.
**Bloque la production : non.**

- **LEVÉ le 19/11/2026 par renforcement** (commit `3c112821`, mission 11a). Avant : IBAN à tirets,
  espaces insécables, deux IBAN collés et `msisdn` non masqués en texte libre ; question posée au
  porteur le 18/11/2026. Le porteur a décidé le 19/11/2026 de masquer. `errors/redact.ts` masque
  désormais : les IBAN à tirets, à espaces insécables et collés ; `msisdn`, `phone`, `mobile` par
  nom de champ (préfixes, `_number`) ; tout numéro E.164 (`+` suivi de 7 à 15 chiffres) en texte
  libre ; les UUID sont exclus.
- **Test de levée.** `unit/errors/redact.spec.ts` (« IBAN en texte libre, formes limites »,
  « msisdn », « conserve le reste du message », montants, décalages horaires et UUID intacts) ;
  mutations détectées.
- **Limites résiduelles (consignées).** (1) Faux positif accepté : un nombre signé de 7 chiffres ou
  plus (`+1250000`) est masqué. (2) Un numéro national sans `+` n'est masqué que par nom de champ,
  pas en texte libre. (3) Un numéro dans un chemin d'URL (`/p/221771234567`) n'est pas masqué ;
  ni un numéro national sans `+` hors d'un champ nommé. (4) Aucun journal de corps n'existe
  aujourd'hui ; le masque reste la dernière barrière.
- **Mission qui le lève.** Sans objet (levé). **Fichier à faire relire.** `errors/redact.ts`.
  **Report.** `PRD.md` (11a) et `PROMPTS-A-ENVOYER.md` (11a).

### OP-N157 — Audit de `cashless_pin` et mot de passe du rôle (19 novembre 2026)

Source : relecture de WP03 ; note de WP03 ; ADR-224. **Bloque la production : non.**

- **Constat.** (a) `INSERT` sur `audit_log` borné au prestataire par la RLS, mais non restreint aux
  actions `VENDOR_*` par une politique dédiée (comme `cashless_tagkeys`). (b) `cashless_pin` n'a pas
  de mot de passe en production : rôle sans mot de passe, comme les autres rôles de processus (seuls
  les rôles de la passerelle refusent) ; comportement existant.
- **Risque.** (a) Un processus compromis pourrait écrire d'autres actions d'audit pour son
  prestataire ; surface à réduire. (b) Dépend de `pg_hba` et du réseau.
- **Test de la limite.** `tests_11a_rights.sql` (`INSERT` de `VENDOR_PIN_FAILED` accepté, autre
  prestataire refusé, `UPDATE` refusé) ; **test de borne** `tests_11a_bounds.sql` (`bde1d13b`,
  sections OP-N157 et OP-N8) : droits de table et de colonne, `EXECUTE`, RLS d'`audit_log` et
  politiques nommées une à une, `cashless_pin` sans pouvoir d'administration ; la limite « aucune
  politique `VENDOR_*` » y est figée et échouera le jour où la politique est ajoutée (voulu : mettre
  à jour ce test). Le mot de passe du rôle n'est pas testable en base de test.
- **Mission qui le lève.** Mission 12b (durcissement de déploiement). **Condition.** Politique
  `VENDOR_*` ; secret du rôle émis par le coffre.
- **Report.** `PROMPTS-A-ENVOYER.md` (12b) et `PRD.md`. **Fichiers à faire relire.**
  `post-roles.sql` §13, `tests_11a_bounds.sql`.

### OP-N158 — Session de vendeur ouverte hors de la transaction de l'API (19 novembre 2026)

Source : note et relecture de WP07 ; ADR-217. **Bloque la production : non.**

- **Constat.** La session est ouverte par le processus `vendor-pin` hors de la transaction de l'API
  : si l'API tombe avant de répondre, le renvoi de la clé d'idempotence reçoit `409` et le nouvel
  essai est compté. `writes: false` est incompatible avec `transient` : la route appelle le
  processus hors transaction puis ouvre une `tx.run` vide pour le refus de rejeu. `x-pin-ts` est en
  millisecondes (code de WP06) alors que le prompt de WP07 disait secondes. Cache anti-rejeu : 20
  000 entrées, plein = 401 (échec sûr). Deux instances d'API qui signent le même corps à la même
  milliseconde : le second appel est refusé (`INTERNAL_ERROR`), échec sûr, négligeable. Le corps de
  l'appel porte le PIN en clair (OP-N151).
- **Risque.** Un essai de PIN compté en trop après une panne ; aucun accès gagné.
- **Test de la limite.** `vendor-pin-call-replay.spec.ts` (cache plein, rejeu refusé) ;
  `vendor-sessions.spec.ts`. **Test de borne (`d7d1d139`) :** `vendors/vendor-pin-bounds.spec.ts`
  « OP-N158 » : la session est ouverte par le processus ; le renvoi de la clé rend `409` sans
  rouvrir
  de session, le processus n'est pas rappelé et un nouvel essai est compté.
- **Limite non figée.** Si l'API tombe **avant** la validation de la clé d'idempotence (entre
  l'appel au processus et la validation), la clé est relâchée : le renvoi ouvre une **nouvelle
  session comptée qui remplace l'ancienne**. Seul le cas « API tombée après la validation » est
  figé.
- **Mission qui le lève.** Mission 13 (recette). **Condition.** Décision du porteur.
- **Report.** `PROMPTS-A-ENVOYER.md` (13) et `PRD.md`.

### OP-N159 — Tests faibles de WP06 et WP07, mineurs de relecture (19 novembre 2026)

Source : relectures de WP06 et WP07 ; ADR-217. **Bloque la production : non.**

- **(a)** Cas concurrent `23505` vers `409 CONCURRENT` de `vendor-pin` non testé. **(b)** « Route
  non marquée refusée » accepte `401` ou `404`. **(c)** `vendors/vendors.dto.ts` importe
  `PIN_PATTERN` de `vendor-pin/vendor-pin.hasher` : le module argon2 est chargé dans l'API sans être
  utilisé (le secret n'est pas lu) ; correction proposée : constante dans un module neutre et
  contrôle d'architecture. **(d)** Le corps brut absent signait un corps vide (fail-open latent, non
  exploitable : `rawBody: true` partout) : **levé** par le refus 401 de WP07.
  **Corrigé le 19/11/2026 (`d7d1d139`) :** la constante est dans `common/pin-pattern.ts` et plus
  rien dans `vendors/` n'importe le hacheur. **L'affirmation « argon2 chargé sans être utilisé »
  était inexacte** : argon2 reste chargé par l'API via `idempotency/idempotency.interceptor.ts`
  (dérivé d'idempotence, ADR-126), usage légitime, exemption nommée.
- **Risque, raison.** Nul en production : tests et constante seulement ; l'ancien import ne
  changeait aucun droit. Raison : mineurs de relecture, corrigés ou figés sans attendre.
- **Tests de borne (`d7d1d139`).** (a) `vendors/vendor-pin-bounds.spec.ts` (`23505` sur
  `vendor_session_open_per_device` : `409 CONCURRENT` côté processus, `429 RATE_LIMITED` avec
  `Retry-After: 1` côté API ; un `23505` d'un autre index n'est jamais pris pour un cas concurrent)
  ;
  (b) route non marquée : `404 NOT_FOUND` exact (`vendor-pin-process.spec.ts`) ; (c)
  `unit/architecture.spec.ts` (aucun import du hacheur, du digester ni d'argon2 hors de
  `vendor-pin/`) ; anti-rejeu figé (fenêtre 30 s, garde 70 s, cache 20 000 :
  `vendor-pin-call-replay.spec.ts`). **Mission qui le lève.** Mission 13. **Report.**
  `PROMPTS-A-ENVOYER.md` (13) et `PRD.md`.

### OP-N160 — Versements : limites résiduelles de WP10 (19 novembre 2026)

Source : notes et relecture de WP10 ; ADR-220. **Bloque la production : non.**

- **Constat.** (a) Export illisible (enveloppe altérée, autre prestataire, clair ancien) : `500`
  sans CSV ni valeur (échec fermé). (b) `canSee` montre encore un lot mixte à un détenteur d'une
  seule classe (lecture seule). (c) Contradiction prompt et `interfaces.md` sur la signature de
  `guardDecision` : `interfaces.md` suivi (`ctx = {client, request, payload, actor}`). (d)
  `validatePayload` garde un argument ; l'ouverture de l'enveloppe se fait dans `execute`. (e)
  Renforcement : le refus exige aussi la classe de bénéficiaire (FR-014).
- **Risque, raison.** (a) Un lot dont une enveloppe est altérée ne peut pas être exporté : le
  versement est retardé, aucune valeur n'est exposée (échec fermé voulu). (b) Un détenteur d'une
  seule classe voit un lot mixte en lecture seule : fuite de lecture limitée au lot, sans écriture.
  Raison : `canSee` relève de l'écran de la mission 11.
- **Test de la limite.** `payout-batch.spec.ts` (enveloppe altérée à l'exécution : `FAILED`) ;
  **tests de borne (`3c112821`)** : (a) `payout-export.spec.ts` « OP-N160 (a) » (une ligne illisible
  sur plusieurs : `500`, aucun CSV partiel ; mutation de (a) non faite) ; (b)
  `payouts/payout-mixed-visibility.spec.ts` (lot mixte vu par un détenteur d'une seule classe :
  lecture seule, ni décision, ni destination, ni export).
- **Mission qui le lève.** Mission 11 (écrans de versement) pour (b) ; aucune pour (a) (échec
  fermé voulu). **Condition.** Le back-office n'affiche pas un lot mixte à une seule classe.
  **Report.** `PROMPTS-A-ENVOYER.md` (11) et `PRD.md` (11).

### OP-N161 — Verrou consultatif des lots de bracelets avant la RLS (19 novembre 2026)

Source : relecture de WP05 (cycle 2) ; ADR-216. **Bloque la production : non.**

- **Constat.** Le verrou (`hashtextextended('media-batch:' || id)`) est pris avant le contrôle RLS :
  un prestataire qui connaît l'UUID d'un lot d'un autre peut retarder son `PATCH` le temps de sa
  propre transaction. Aucun accès aux données. Renforcement d'audit non noté dans une note de lane :
  l'historique `→ORDERED` porte le motif « Création du lot » (au lieu de NULL).
- **Risque, raison.** Retard d'un `PATCH` d'un lot par un autre prestataire (disponibilité), sans
  accès aux données ni écriture. Raison : le verrou doit précéder la lecture pour sérialiser.
- **Test de la limite.** `media/batches.spec.ts` (le propriétaire tient le verrou, un `PATCH` s'y
  bloque). **Tests de borne (`3c112821`) :** `media/batches-op-n161.spec.ts` (`PATCH` de B sur le
  lot de A : `404`, aucune donnée, aucune écriture, aucun audit ; clé de verrou préfixée
  `media-batch:` et propre au lot ; RLS de `media_batch` active). **Non figé :** le retard lui-même.
- **Mission qui le lève.** Mission 13. **Condition.** Verrou pris après la lecture sous RLS.
  **Report.** `PROMPTS-A-ENVOYER.md` (13) et `PRD.md`.

### OP-N162 — Inscription des passerelles : `--ledger` refusé (19 novembre 2026)

Source : relecture de WP12 ; ADR-221. **Bloque la production : non.**

- **Risque, raison.** Un script de site qui passe encore `--ledger` casse : disponibilité de
  l'inscription, aucune fuite ni droit élargi. Raison : le grand livre doit venir de la base, pas
  d'un argument manuel (OP-N116).
- **Constat.** Le grand livre est rendu par la base (`register_edge_gateway`, `(gateway_id,
  ledger_id)`, `CL058`). `edge-admin register` refuse `--ledger`, même vide ou identique : un script
  de site qui la passe encore casse volontairement (procédure §2 à jour). `CL058` prouvé côté SQL
  par `tests_edge_gateway.sql` ; côté outil sur le faux (`register.spec.ts`). Écart de périmètre
  accepté : 5 lignes de `commands-other.spec.ts` au lieu de 3 (signature de `registerReal`), plus
  l'assertion « grand livre écrit = `identify_edge_gateway` » (T047 §5).
- **Mission qui le lève.** Sans objet (comportement voulu). **Condition de levée.** Aucune : le
  refus de `--ledger` reste. **Test de borne.** `tools/edge-admin/test/register.spec.ts` (refus de
  `--ledger`, même vide ou identique). **Report.** `PRD.md` (11a) et `PROMPTS-A-ENVOYER.md` (11a).

### Levées de la mission 11a (18 et 19 novembre 2026)

OP-N79 et OP-N141 passent à « levé le 18/11/2026 par la mission 11a » ; OP-N60, OP-N76, OP-N116,
OP-N137 (a à d), OP-N140 et OP-N145 à « levé le 19/11/2026 » (ADR-216 à ADR-221) ; OP-N156 à « levé
le 19/11/2026 par renforcement » (ADR-218). OP-N64 passe à « côté serveur prêt, non levé »
(ADR-222). OP-N116 : `register_edge_gateway` rend `(gateway_id, ledger_id)` (`0094`), `edge-admin
register` refuse `--ledger` (`tools/edge-admin/test/register.spec.ts`, `tests_edge_gateway.sql` :
`CL058` sans grand livre ou avec deux devises ; mutation : retrait du refus de `--ledger`, 3 tests
de `register.spec.ts` échouent).

## 12. Mission 10a (serveur de l'app festivalier) : consignation du 23/11/2026

Écrit par WP11 à partir des notes de lane de WP01 à WP10 (journal d'états de la mission), des comptes
rendus de relecture (`review-cycle-*` et `review-feedback-*` de chaque lot) et des décisions du porteur du
20/11/2026. Mission Spec Kitty `serveur-app-festivalier-01M7WB69`. Chaque entrée cite sa source, son test
et l'ADR qui la porte (ADR-225 à ADR-231). « Bloque la production » : voir la ligne du tableau de la
section 2. **Preuves par FR, NFR, SC et contrainte** : `docs/passation-10a/preuves.md` (commande,
résultat, mutation, chaque preuve absente d'une note étant écrite « non établie ») et
`acceptance-matrix.json` de la mission (tenue par l'orchestrateur, que ce lot ne modifie pas). Couverture :
FR-001 à FR-004 et FR-006 : identification (OP-N163, OP-N164, OP-N165) ; FR-005 : révocation (OP-N164) ;
FR-007 et FR-008 : OP-N47 levé (OP-N167) ; FR-009 et FR-010 : `/me` (OP-N168) ; FR-011 à FR-013 : chaîne
d'envoi (OP-N120 mis à jour, OP-N166) ; C-001 : ADR-225 ; C-005 : OP-N163 ; C-002 : OP-N164.

### Lots de la mission

| Lot | Contenu | Migrations et tests principaux |
|---|---|---|
| WP01 | Fonctions d'identification et de révocation (`DEFINER`, `CL060` à `CL063`) | `0096` ; `tests_kyc_functions.sql` (63 à la relecture) |
| WP02 | Version du secret des codes, signatures versionnées, `reissue_claim_codes`, `reissuable_media`, `claim_key_version_max`, `media.printed_number` (`CL064`, `CL065`) | `0097` ; `tests_claim_key_version.sql` (125 à la fusion de WP08) |
| WP03 | Avis de solde provisoire et table des canaux d'envoi | `0098`, `0099` ; `tests_pending_offline_notice.sql`, `tests_otp_channel_attempt.sql` |
| WP04 | Droits de la base (`post-roles.sql` §14, rôle `cashless_claimadmin`), environnements | `tests_10a_rights.sql` (78) |
| WP05 | `createKycVerification` (`POST /kyc-verifications`), `KYC_VERIFIED`, masque d'`id_last4` | `integration/kyc/create.spec.ts`, `limits.spec.ts` |
| WP06 | Révocation à deux (`KYC_REVOCATION`, `revokeKycVerification`) | `integration/kyc/revoke.spec.ts` (12/12) |
| WP07 | Configuration (version du secret, délais), appels versionnés, import à trois colonnes | `integration/media/claim-rotation.spec.ts` |
| WP08 | Commande `reissue-claim-codes`, procédure de rotation, fichier de cinq colonnes | `integration/cli/reissue-claim-codes.spec.ts` (12/12) |
| WP09 | `/me` complet (`printed_number`, `pending_offline_notice`), trois ajouts au contrat | `integration/customer-app/me-10a.spec.ts` ; `check.mjs` 0 refus |
| WP10 | Chaîne d'envoi (WhatsApp, SMS principal, SMS de repli), trois faux refusés en production | `unit/customer-auth/otp-chain.spec.ts` (19/19), `integration/customer-auth/otp-chain.spec.ts` (5/5) |
| WP11 | Preuves, consignation, documentation | aucun code |

### Retouches hors carte relevées

WP02 : `post-roles.sql` (signatures seules, aucun droit ajouté ou retiré), `tests_media_claims.sql`,
`tests_personalization_definer.sql`, `tests_media_roles.sql`, `tests_media_batch_functions.sql` (appels
passés aux signatures versionnées) ; ajout non prévu : `claim_media_reissuable` (prédicat partagé, exécutable
par aucun rôle). WP03 : `UNIQUE (id, operator_id)` ajouté à `otp_challenge` (table de `0080`) dans `0099`,
pour la clé composite. WP04 : `tools/dev-db/env.test.example`, `docs/SERVICES-EXTERNES.md`,
`tests_offline_rights.sql`, `packages/ledger-sql/src/migrate.ts`, `tools/dev-db/env.sh`, le workflow de CI,
`apps/gateway/test/support/disposable-databases.ts`, `apps/api/test/support/db.ts` ; listes figées de droits
mises à jour ; test 122 de `tests_claim_key_version.sql` aligné sur `interfaces.md`. WP05 :
`apps/api/src/app.module.ts` (un import, une ligne), `audit/audit.service.ts` (`KYC_VERIFIED`, `KYC_REVOKED`),
`unit/errors/sqlstate-map.spec.ts`, `errors/redact.ts` (`id_last4`) avec `redact.spec.ts` et `limits-9b.spec.ts`.
WP06 : `kyc/kyc.module.ts`. WP07 : `media/claims/claims.dto.ts`, `claim-code-order.spec.ts` (quatre colonnes),
`apps/api/jest.config.cjs`, `.github/workflows/ledger-tests.yml` (étape en série), `claim-rotation.spec.ts`.
WP08 : `jest.config.cjs`, `ledger-tests.yml` ; puis, par décision du porteur du 20/11/2026 (soir),
`0097` (`reissuable_media` rend `nfc_uid` et `printed_number`) et `tests_claim_key_version.sql`. WP09 :
`customer-app/lost-media.service.ts`, `packages/contracts/generated/openapi.ts`, types Dart régénérés
(`reason3.dart`, `rejected.g.dart`), `tools/contract-stability/check.test.mjs` (71 à 75). WP10 :
`unit/production-guard.spec.ts`, `integration/end-to-end/device-latency.spec.ts`, ajout non prévu
`integration/devices/enrollment.spec.ts` (trois jetons neutres : ses fabriques auraient refusé en
production). WP11 : `docs/procedure-rotation-codes-rattachement.md`, étape 4 (fichier à cinq colonnes, comme
l'étape 5 et le contrat), retouche autorisée par l'orchestrateur. Aucun fichier `.sql` généré ni migration
existante modifié ; `SPECIFICATION.md` non touché.

### Instabilités et états intermédiaires rencontrés

- **WP10 : un échec isolé sur 50** en intégration (`customer-auth/otp-chain`), vert à la relance ; cause non
  établie ; consigné comme instabilité (OP-N166).
- **WP08 : `integration/cli/reissue-claim-codes.spec.ts` est ignoré** quand `SKIP_LATENCY` est posé
  (`apps/api/jest.config.cjs`, passe parallèle) ; il tourne dans l'étape en série de
  `.github/workflows/ledger-tests.yml`. Même cas pour `media/claim-rotation.spec.ts` (WP07 : la version du
  secret est globale à la base). Un lancement avec `SKIP_LATENCY` seul ne les exerce donc pas (OP-N167).
- **WP10, cycle 1 : base Docker arrêtée** (Colima) ; les tests d'intégration n'avaient pas pu être relancés par le
  relecteur, rejoués au cycle 2 (50/50).
- **WP04 :** tant que WP04 n'est pas fusionné, les suites de droits figées échouent sur les nouveaux objets (état
  voulu) ; levé par WP04.
- Instabilités déjà connues : `tests_event_ledger.sql` 63-66, `claim-code-order.spec.ts`,
  `transverse/migrate-lock.spec.ts`, `tests_offline_snapshot_source_no_stats.sql`.
- **Lignes de plus de 100 caractères** non reformatées dans `otp-chain.ts`, `otp-providers.ts`,
  `otp-sender.ts`, `reissue-claim-codes.ts` et leurs tests : reformatage à la fusion (décision du 14/10/2026).

### Renforcements faits puis consignés (règle 1 de `CLAUDE.md`)

Aucun écart de la mission n'affaiblit la sécurité ; chacun des suivants la renforce (ADR-226 à ADR-229).
Réémission réservée au rôle `cashless_claimadmin` (`cashless_app` ne peut exécuter ni `reissue_claim_codes`,
ni `reissuable_media`, ni `claim_media_reissuable`) ; **`packages/ledger-sql/src/migrate.ts` refuse de
démarrer en production sans mot de passe de `cashless_claimadmin`** (`CASHLESS_CLAIMADMIN_PASSWORD`, WP04) ;
identification et révocation par fonctions `DEFINER` seules ; pièce déjà expirée refusée à la saisie
(`CL062`) ; agent restreint à `operator_id` de la session ou NULL (plateforme), sinon `no_data_found` ; client
d'un autre prestataire jamais atteint par la comparaison de numéro ; `id_last4` ajouté à `REDACTED_FIELDS`
(jamais dans les journaux applicatifs) ; `associate_claim_code` n'accepte qu'un code d'une version plus
ancienne jamais utilisé, un code déjà utilisé reste refusé ; `failed_reason` borné par un `CHECK` plus
strict que le prompt (commence par une lettre), clé composite `(challenge_id, operator_id)` vers
`otp_challenge` ; fichier de réémission créé en mode `0600` avec `wx` (jamais écrasé), supprimé quand la
base refuse, version inférieure à la base refusée sans rien écrire ; démarrage de l'API refusé quand la
version configurée est inférieure à `claim_key_version_max()` ; délai par envoi de la chaîne borné au délai
de l'étape, essais notés dans l'ordre des étapes ; bornes OTP à 15 000 et 20 000 ms (le prompt de WP07 en
citait 60 000 par erreur, `interfaces.md` fait foi).

### Décisions du porteur consignées

- **20/11/2026, au specify et au plan (ADR-231)** : périmètre ; agent titulaire par égalité du numéro vérifié et
  de `app_user.phone` (limite OP-N163) ; rotation **immédiate** sans double empreinte, version du secret sur
  chaque empreinte (OP-N47 levé) ; réémission par commande d'exploitation sous `cashless_claimadmin` ;
  code OTP en mémoire du processus seulement (35 s au plus) ; `printed_number` en troisième colonne facultative
  du fichier de l'imprimeur.
- **20/11/2026 (soir), ADR-225 et ADR-228** : (a) motifs `BAD_PRINTED_NUMBER` et `PRINTED_NUMBER_TAKEN` ajoutés à
  `ClaimCodeAssociationResult.reason` ; (b) réponse `'422'` (`VALIDATION_FAILED`) déclarée sur
  `revokeKycVerification` ; (c) le fichier de réémission nomme son bracelet (`rank,code,url,uid,printed_number`),
  plus d'import après réémission, `reissuable_media` rend `nfc_uid` et `printed_number` (WP08 avait signalé que
  le fichier `rank,code,url` ne disait pas quel bracelet portait quel rang). Les trois sont inscrites dans
  `contract-baseline.json` (« Décision du porteur : 20/11/2026 ADR-225 ») pour (a) et (b).
- **23/11/2026 (revue de WP11), ADR-227 et ADR-225 :** (a) la décision « `422` de `revokeKycVerification` » reste dans
  ADR-225 (validé) ; (b) `SPECIFICATION.md` §6.3 point 5 est amendé pour s'aligner sur le contrat (révocation par deux
  personnes) : amendement minimal et daté, **OP-N164 levé**.

### Fiches des points nés de la mission

### OP-N163 — Agent titulaire non détecté (20 novembre 2026)

Décision du porteur du 20/11/2026 ; ADR-227. **Bloque la production : non** (limite acceptée par décision du
porteur ; l'identification reste tracée avec son auteur à l'audit, `KYC_VERIFIED`).

- **Constat.** `create_kyc_verification` refuse (`CL061`, `403`) l'identification d'un compte dont
  `customer_identity.phone` est égal à `app_user.phone` de l'agent. Un agent sans téléphone enregistré, ou
  qui identifie un compte à un autre numéro que le sien, n'est pas détecté.
- **Risque.** Un agent peut ouvrir des plafonds à un compte qu'il contrôle sous un autre numéro.
- **Raison.** Le lien agent ↔ compte festivalier n'existe pas ; il a été écarté au specify.
- **Mission qui le lève.** À décider par le porteur. **Condition de levée.** Un lien agent ↔ compte festivalier
  (ou un second contrôle) qui détecte aussi ces deux cas ; le test de borne est alors inversé.
- **Test de borne.** `packages/ledger-sql/tests/tests_kyc_functions.sql` (section 9 « Limite consignée C-005 » :
  agent sans numéro accepté, agent à autre numéro accepté, agent au numéro du client refusé, agent au numéro d'un
  client d'un autre prestataire accepté) et `integration/kyc/create.spec.ts` (« limite C-005 : agent sans numéro,
  201 ») : échouent si la règle s'élargit ou se resserre en silence.
- **Report.** `PROMPTS-A-ENVOYER.md` (missions 10a, 11) et `PRD.md`. Fichier à faire relire : `0096`.

### OP-N164 — Contradiction SPECIFICATION §6.3 point 5 et contrat (20 novembre 2026) — LEVÉ le 23/11/2026

ADR-227. **Bloque la production : non.** **LEVÉ le 23/11/2026 : décision du porteur, `SPECIFICATION.md` §6.3 point 5 amendé
(révocation par deux personnes), amendement daté renvoyant à ADR-227.** Texte d'origine conservé ci-dessous.

- **Constat.** §6.3 point 5 dit qu'un administrateur peut révoquer une identification ; `openapi.yaml`
  (`revokeKycVerification`) exige une demande `KYC_REVOCATION` approuvée par une autre personne (`OPERATOR_ADMIN`
  ou `ORGANIZER_ADMIN`). Le contrat prime (§0.3) : l'implémentation suit le contrat.
- **Risque.** Une lecture de la seule spécification attendrait une révocation par une personne.
- **Mission qui le lève.** Levé par la mission 10a le 23/11/2026. **Condition de levée (remplie).** Le porteur confirme le
  contrat et la spécification est amendée.
- **Test de borne.** `integration/kyc/revoke.spec.ts` (« l'auteur ne valide pas sa demande », « approbation par une
  autre personne », rôles bornés) : échoue si la révocation redevient l'acte d'une personne ; la spécification et le
  contrat disent désormais la même chose.
- **Report.** `PROMPTS-A-ENVOYER.md` (mission 11) et `PRD.md`.

### OP-N165 — Identification et révocation : limites résiduelles (20 novembre 2026)

ADR-226. **Bloque la production : non.**

- **Constats (notes de WP05 et WP06, relectures).** (1) `p_by` de `revoke_kyc_verification` n'est pas contrôlé par
  la base : l'auteur est le `requested_by` de la demande, fixé par l'API (même classe qu'OP-N56) ; (2) une
  identification posée par `customer_id` seul (`wallet_id` NULL) se révoque à la portée `OPERATOR`, donc par
  `OPERATOR_ADMIN` seulement ; (3) avec `customer_id`, un client sans portefeuille d'événement est refusé en
  `403` et non en `422` ; (4) le plafond de recharge n'est pas rejoué sur un second portefeuille après révocation
  (niveau `NONE` prouvé par `wallet_kyc_level`) ; (5) le contrôle `scope_type = 'EVENT'` de `0098` est redondant
  avec la jointure de l'événement (test ajouté au cycle 2 de WP03, mutation : échec du test 16) ; (6) **`guardDecision`
  ne teste pas l'état `REVOKED`** (R-03 de WP06, qui a suivi le contrat) : une demande sur une identification déjà
  révoquée n'est pas refusée par la garde de décision, elle échoue à l'exécution (`CL063`, `409 CONFLICT_STATE`). Contrôle
  reporté vers la base, qui refuse ; test : `integration/kyc/revoke.spec.ts` (« déjà révoquée : 409 à la demande sans
  demande créée ; révoquée entre-temps : approbation FAILED CONFLICT_STATE ») ; mutation WP06 (a) : contrôle `REVOKED`
  retiré, test 6 échoue.
- **Mission qui les lève.** OP-N56 (mission 12b) pour (1) ; mission 11 (messages d'écran) pour (3) ; mission 13
  pour (4). **Conditions.** Preuve signée de la personne qui décide ; écran qui explique le `403` ; test de
  recharge sur deux portefeuilles.
- **Tests de borne.** `integration/kyc/revoke.spec.ts` (« identification posée par client : portée OPERATOR »,
  « demande falsifiée par le propriétaire »), `integration/kyc/create.spec.ts` (« 403 : client dont les
  portefeuilles sont seulement sur un autre événement »).
- **Report.** `PROMPTS-A-ENVOYER.md` (11, 12b, 13) et `PRD.md`. Fichiers à faire relire : `0096`,
  `kyc/kyc.service.ts`, `kyc/kyc-revocation-action.ts`.

### OP-N166 — Chaîne d'envoi des codes : limites (20 novembre 2026)

Décision du porteur du 20/11/2026 (code en mémoire) ; ADR-229. **Bloque la production : non** (les trois
fournisseurs sont des faux, refusés en production : c'est OP-N120 qui bloque).

- **Constats.** (1) Le code en attente de bascule n'existe qu'en mémoire du processus : un redémarrage perd la
  bascule, le festivalier redemande un code (décision du porteur). (2) Quand le plafond dur de 35 s tombe avant
  l'étape suivante (délais réglés au maximum, fournisseur lent), la chaîne s'arrête sans envoi de repli et sans
  essai noté en base : conforme à « 35 s au plus », signalé en relecture de WP10 (constat 2). (3) La mémoire est
  bornée à 1 000 entrées : la 1 001ᵉ efface la plus ancienne, qui ne se déclenche plus. (4) Un échec isolé sur 50
  en intégration (voir instabilités), vert à la relance.
- **Risque.** Un code non délivré dans ces cas ; le festivalier redemande (les bascules ne comptent pas dans les
  limites d'envoi).
- **Mission qui le lève.** Mission 12b (fournisseurs réels, mesure des délais réels de 10 s et 20 s).
  **Condition.** Délais mesurés avec les vrais fournisseurs, décision du porteur sur un essai noté au plafond.
- **Tests de borne.** `unit/customer-auth/otp-chain.spec.ts` (« plafond dur seul » : repli jamais appelé, code
  effacé à 35 000 ms ; « borne de 1 000 » ; mutation : retrait de `arm(entry, OTP_CODE_HARD_CAP_MS, …)`, 1 échec
  sur 19), `integration/customer-auth/otp-chain.spec.ts` (« arrêt pendant une chaîne »).
- **Report.** `PROMPTS-A-ENVOYER.md` (12b, 13) et `PRD.md`. Fichiers à faire relire : `otp-chain.ts`,
  `otp-providers.ts`, `bootstrap.ts`.

### OP-N167 — Commande `reissue-claim-codes` : limites (20 novembre 2026)

ADR-228. **Bloque la production : non** (commande d'exploitation sous accord écrit du porteur).

- **Constats.** (1) Le fichier contient des codes en clair : mode `0600`, jamais écrasé, jamais sur la sortie
  standard ; il doit être détruit après remise (procédure). (2) La commande écrit le fichier avant la base :
  tuée entre les deux, elle laisse un fichier sans valeur ; si l'issue du `COMMIT` est incertaine, le fichier est
  conservé et la relance est interdite sans vérification. (3) **Aucun test pour disque plein (`ENOSPC`) ni pour un
  `COMMIT` d'issue incertaine** : le code les traite, rien ne les exerce (relecture de WP08). (4) Le spec
  d'intégration est ignoré quand `SKIP_LATENCY` est posé (`jest.config.cjs`) : il ne tourne que dans l'étape en
  série de la CI (la course `CL065` est dans OP-N169).
- **Mission qui le lève.** Mission 13 (recette : procédure jouée sur un lot réel). **Condition.** Les deux cas
  (3) figés par test ; procédure exécutée de bout en bout sur un lot réel.
- **Tests de borne.** `integration/cli/reissue-claim-codes.spec.ts` (« fichier existant : jamais écrasé »,
  « base refusée : aucun fichier ne reste », « aucun code ailleurs que dans le fichier », « droits : cashless_app
  ne peut pas réémettre ») ; mutations : écriture du fichier après la base, retrait de `wx`, mode `0644`, codes sur
  la sortie standard, UID permutés (tous détectés).
- **Report.** `PROMPTS-A-ENVOYER.md` (mission 13) et `PRD.md`. Fichiers à faire relire :
  `apps/api/src/cli/reissue-claim-codes.ts`, `0097`, `post-roles.sql` §14.

### OP-N168 — Avis de solde provisoire : approximation assumée (20 novembre 2026)

ADR-230. **Bloque la production : non.**

- **Constat.** `wallet_pending_offline_notice` est vrai si l'événement n'est pas `CLOSED` et si au moins un
  terminal non révoqué a un accusé de snapshot sur ce grand livre plus récent que son dernier lot (ou sans lot).
  Approximations : tous les statuts de lot comptent (`REJECTED` inclus) ; le dernier lot est celui du terminal sur
  le grand livre du portefeuille ; les grands livres `ORGANIZER` et `OPERATOR_BILLING` rendent toujours faux.
- **Risque.** Un avis absent ou superflu ; jamais un solde modifié. Le faux `false` d'un lot d'un autre grand livre a
  été corrigé au cycle 2 de WP03.
- **Mission qui le lève.** Mission 13 (recette). **Condition.** Le porteur confirme l'approximation ou demande de
  l'affiner.
- **Tests de borne.** `tests_pending_offline_notice.sql` (mutations : retrait de `status <> REVOKED`, `>=`,
  `coalesce`, `status <> CLOSED`, filtre de grand livre, `scope_type`) et `integration/customer-app/me-10a.spec.ts`
  (« terminal révoqué ou événement CLOSED : l'avis reste faux »). Le comportement « tous statuts de lot comptent »
  n'a pas de test dédié cité par les notes : non établi.
- **Report.** `PROMPTS-A-ENVOYER.md` (10b, 13) et `PRD.md`.

### OP-N169 — Mineurs de la 10a (20 novembre 2026)

ADR-231. **Bloque la production : non.**

- **Constats.** Course `CL065` non testée (WP02) ; la personnalisation ne teste pas le cas d'un ancien code
  (WP07) ; `seed-demo` ne pose pas la version des codes (défaut 1 : refusé après une rotation) ; la version du secret
  est globale à la base, d'où l'étape en série de la CI (`claim-rotation`) ; les compteurs de consultation
  anonyme par adresse repartent à zéro à la rotation (la référence d'adresse dépend du secret, accepté au plan) ;
  lignes de plus de 100 caractères (reformatage à la fusion) ; import `reflect-metadata` inutile dans la commande
  (WP08) ; **`personalization.service.ts` n'a pas le contrôle applicatif de `claim_code_used_at`** (WP07) : un code déjà
  utilisé est refusé par la base seule (`CL020`, `MEDIA_ALREADY_HAS_CODE`), contrôle reporté vers la base ; test qui le
  fige : `packages/ledger-sql/tests/tests_claim_key_version.sql` (l. 298-299 : `claim_code_used_at` posé, puis
  `throws_ok` `CL020`) ; la personnalisation elle-même n'a pas de test du cas d'ancien code.
- **Mission qui les lève.** Mission 13. **Condition.** Tests figés et nettoyage au passage de la recette.
- **Report.** `PROMPTS-A-ENVOYER.md` (mission 13) et `PRD.md`.

### Fichiers à faire relire par une personne (règle 4 de `CLAUDE.md`)

L'agent qui a écrit le code ne vaut pas relecture indépendante. Clés, droits de la base, cryptographie,
codes en clair :

- `packages/ledger-sql/migrations/0096_kyc_functions.sql` (fonctions `DEFINER` d'identification et de révocation,
  règle de l'agent titulaire, ordre des contrôles) ;
- `packages/ledger-sql/migrations/0097_claim_code_key_version.sql` (version du secret, signatures versionnées,
  `reissue_claim_codes`, `reissuable_media`, `claim_media_reissuable`, `claim_key_version_max`, `associate_claim_code`
  qui libère l'ancienne ligne, numéro imprimé) ;
- `packages/ledger-sql/migrations/0098_pending_offline_notice.sql` et `0099_otp_channel_attempt.sql` (RLS forcée,
  clé composite, `UNIQUE (id, operator_id)` ajouté à `otp_challenge`, aucune colonne de code) ;
- `packages/ledger-sql/post-roles.sql` section 14 (rôle `cashless_claimadmin`, `EXECUTE` de `cashless_app`, droits
  de `otp_channel_attempt`) ; `roles.sql` n'a pas changé ; `packages/ledger-sql/src/migrate.ts` (mot de passe du
  rôle, refus en production) ;
- `apps/api/src/cli/reissue-claim-codes.ts` (codes en clair, fichier de sortie, rôle de la connexion) ;
- `apps/api/src/db/claim-admin-connection.ts` (connexion du rôle `cashless_claimadmin` et refus en production d'un rôle
  trop large, déplacés de la commande par le correctif d'intégration `f5299969` du 23/11/2026) ;
- `apps/api/src/kms/claim-hash.ts`, `config/config.ts` (`claimAdminSettings`, version du secret) et
  `media/claims/claims.service.ts` (refus de démarrage sur version) ;
- `apps/api/src/customer-auth/otp-chain.ts` (code en mémoire, plafond, effacement), `otp-providers.ts`,
  `otp-sender.ts` et `apps/api/src/processes/bootstrap.ts` (libellés de refus des trois faux) ;
- `apps/api/src/kyc/kyc.service.ts` et `kyc-revocation-action.ts` (portée, auteur de la révocation),
  `errors/redact.ts` (`id_last4`) ;
- `.github/workflows/ledger-tests.yml`, `tools/dev-db/env.sh`, `tools/dev-db/env.test.example` et
  `apps/gateway/test/support/disposable-databases.ts` (mot de passe et URL du rôle `cashless_claimadmin`, WP04) ;
- `apps/api/src/kyc/kyc.controller.ts` et `kyc/kyc-revocation.controller.ts` (contrôle de rôle et de portée des
  routes d'identification et de révocation) ;
- `apps/api/src/media/batches/claim-codes.service.ts` et `media/personalization/personalization.service.ts`
  (appels versionnés, remplacement d'un ancien code, `MEDIA_ALREADY_HAS_CODE`, empreintes) ;
- `apps/api/src/customer-auth/customer-auth.service.ts` et `customer-auth.module.ts` (câblage de la chaîne, lien du
  titulaire), `audit/audit.service.ts` (`KYC_VERIFIED`, `KYC_REVOKED`), `errors/sqlstate-map.ts` (`CL060` à `CL063`) ;
- `tools/contract-stability/contract-baseline.json` et les trois ajouts d'`openapi.yaml` (décision du porteur).

Exhaustivité revérifiée le 23/11/2026 par `git diff --name-only` de la base commune avec `main` : les autres fichiers
modifiés hors tests sont des fichiers de documentation, de lecture (`customer-app/me.service.ts`, `lost-media.service.ts`),
de câblage sans droit ni secret (`app.module.ts`, `kyc.module.ts`, `claims.dto.ts`) ou générés (`openapi.ts`, Dart).

### Tests de borne écrits avec la mission et ce qui reste non figé

Chaque test de borne ci-dessus est écrit dans le lot qui porte la limite ; mutations rejouées par les
relecteurs (voir `docs/passation-10a/preuves.md`). **Non figé, consigné comme limite :** (a) disque plein et
`COMMIT` d'issue incertaine de `reissue-claim-codes` (OP-N167) ; (b) « tous statuts de lot comptent » dans
`wallet_pending_offline_notice` (OP-N168) ; (c) course `CL065` (OP-N169) ; (d) `scope_type = 'EVENT'` de `0098`
prouvé seulement depuis le cycle 2 de WP03 ; (e) délais réels de 10 s et 20 s (faux seulement, minuteries
simulées) : mission 12b ; (f) auteur de la révocation non contrôlé par la base (OP-N165).

---

## 13. Mission 9c (rendu partiel en espèces au guichet) : consignation du 23/11/2026

Écrit par WP06 à partir des notes de lane de WP01 à WP05 (journal d'états de la mission), des comptes rendus de
relecture et des décisions du porteur du 23/11/2026. Mission Spec Kitty `remboursement-partiel-especes-01M84932`.
Décision : ADR-233 ; limites : ADR-234 (OP-N173 à OP-N184). OP-N170 et OP-N171 restent réservés au dossier du
back-office. **Preuves par FR, NFR, SC et contrainte** : `docs/passation-9c/preuves.md`. Aucun écart n'affaiblit la
sécurité : le cumul par portefeuille et le refus d'une `refund_policy` sans `channels` la renforcent. Aucun droit
nouveau pour `cashless_app`.

### Lots de la mission

| Lot | Contenu | Migrations et tests principaux |
|---|---|---|
| WP01 | Colonne `event.cash_partial_refund_enabled`, index partiel du cumul | `0100` ; `tests_cash_partial_refund.sql` |
| WP02 | Contrat : `refundPartialCash`, deux schémas, propriété d'`Event` et d'`EventUpdate`, baseline | `contract-additions-9b.spec.ts` ; `check.mjs` |
| WP03 | Réglages : catalogue, règle croisée `operator.cash_partial_refund_allowed` | `integration/configuration/partial-refund-settings.spec.ts` |
| WP04 | Cumul du jour du portefeuille et seconde personne | `integration/media/partial-refund-threshold.spec.ts` |
| WP05 | Opération `refundPartialCash` (contrôleur, service, audit) | `integration/media/partial-cash-refund.spec.ts`, `partial-cash-refund-concurrency.spec.ts` |
| WP06 | Spécification, ADR, points ouverts, preuves | aucun code |

### Décisions du porteur du 23/11/2026 (ADR-233)

Cumul par portefeuille (renforcement du choix initial par bracelet) ; bracelets anonymes acceptés, frais à chaque
rendu ; le prestataire autorise, l'organisateur active ; montant saisi débité, espèces remises nettes des frais ;
ajouts au contrat acceptés. `SPECIFICATION.md` §8.5 et §17 amendés sans changer le numéro de version.

### Limites et écarts (ADR-234)

Chaque entrée : **Bloque la production : non.** Mission qui la lève et condition dans le tableau de la section 2.

- **OP-N173.** WP04 : un `REVERSAL` d'un rendu partiel n'est pas déduit du cumul (choix prudent, seuil atteint plus
  vite). Test de borne : `partial-refund-threshold.spec.ts` (somme exacte du brut des rendus). **Condition de levée :**
  décision du porteur de déduire les annulations, avec test.
- **OP-N174.** Limite L2 : les espèces dues ne sont pas rendues par ce chemin. **Absence de test assumée** (absence de
  fonction) ; `refundCashDue` reste la seule voie (C-002).
- **OP-N175.** WP03 (relecture) : pas de message localisé propre pour `operator.cash_partial_refund_allowed`.
  Test de borne : `partial-refund-settings.spec.ts` (« sans autorisation du prestataire : 422 »).
- **OP-N176.** WP05 : `422 WALLET_BLOCKED` absent de la description de `refundPartialCash` (`interfaces.md` le
  donne). Test : `partial-cash-refund.spec.ts` (« portefeuille bloqué : 422 WALLET_BLOCKED »). Le contrat est gelé :
  tout ajout est rétrocompatible et signalé au porteur avant.
- **OP-N177.** WP05 : `refund_policy` sans `channels` refusée (renforcement). Test :
  `partial-cash-refund.spec.ts` (« politique fermée ou sans canal CASH : même refus »).
- **OP-N178.** WP05 : pas de contrôle explicite du mode `TOPUP_DESK` (comme le guichet de retour) ; la session
  ouverte exigée n'existe que pour ce mode, ce qui évite un `DEVICE_MODE_NOT_ALLOWED` hors contrat. Test :
  `partial-cash-refund.spec.ts` (« terminal sans session de caisse ouverte : 409 »).
- **OP-N179.** WP05 : phases d'événement tenues par la matrice du moteur (`status-matrix.ts`), non par le code de
  l'opération ; aucun contrôle ajouté, donc aucune mutation possible dans le code du lot. Test :
  `partial-cash-refund.spec.ts` (« phase de l'événement refusée : 422 ; phase permise (clôture) »). **Condition de
  levée :** décision du porteur d'un contrôle de phase propre à l'opération.
- **OP-N180.** WP05 (relecture) : tests absents « paiement suivant accepté » (US1, le bracelet ACTIVE et le solde
  sont relus seulement) et `VENDOR` explicite. **Absence assumée.**
- **OP-N181.** WP05 (relecture) : mutation du verrou `lockWalletPaidBalance` détectée 4 fois sur 5 seulement. Test :
  `partial-cash-refund-concurrency.spec.ts` (20 envois, exactement 10 rendus ; 20 envois sur deux bracelets,
  maximum 5 000, exactement 5). Le verrou du bracelet suffit à une file unique par bracelet ; seul le cas de deux
  bracelets du même portefeuille exerce le verrou du portefeuille.
- **OP-N182.** WP01 et WP04 : le plan retenu par le planificateur n'est mesuré que sur 73 lignes (index
  `journal_transaction_ledger_id_occurred_at_idx`) ; l'index partiel n'est pris qu'en forçant les réglages.
  Test de borne : `tests_cash_partial_refund.sql` (existence de l'index), qui ne prouve pas son choix à volume
  réel.
- **OP-N183.** WP04 : filtre `p.amount > 0` défensif, sa mutation ne fait échouer aucun test ; juste puisque les
  débits du portefeuille payé sont positifs. **Absence assumée.**
- **OP-N184.** Lignes de plus de 100 caractères dans plusieurs fichiers du lot (reformatage à la fusion).
- **Faits consignés sans OP.** (a) WP03 : la création d'événement ignore `cash_partial_refund_enabled`
  (`EventCreate` inchangé, défaut `false` conservé ; test `partial-refund-settings.spec.ts`, « la création ne peut pas
  activer le réglage »). (b) WP04 : écart à `interfaces.md`, paramètre `ledgerId` ajouté aux signatures de
  `partialRefundDayTotal` et de `requireApprovalOverDailyCumul` (index partiel en tête `ledger_id`), accepté par
  l'orchestrateur ; WP05 passe le grand livre du terminal ; test : `partial-refund-threshold.spec.ts` (« le grand livre
  filtre »).
- **Mission qui les lève.** 11, 12 et 13 selon le tableau de la section 2. **Report.** `PROMPTS-A-ENVOYER.md` (11,
  12, 13) et `PRD.md`.

### Fichiers à faire relire par une personne (règle 4 de `CLAUDE.md`)

L'agent qui a écrit le code ne vaut pas relecture indépendante. Droits de la base, argent, contrat :

- `apps/api/src/media/lifecycle/partial-refund.service.ts` (ordre des verrous, cumul, droits, frais, écriture de la
  caisse) ;
- `apps/api/src/media/lifecycle/partial-refund-threshold.ts` (cumul du jour du portefeuille, seconde personne, lu sous
  le verrou du solde payé) ;
- `packages/ledger-sql/migrations/0100_event_cash_partial_refund.sql` (colonne, index partiel, aucun `GRANT`) ;
- `apps/api/src/configuration/bounds-validator.ts` (règle croisée `operator.cash_partial_refund_allowed`) ;
- `apps/api/src/configuration/settings-catalog.ts` (matrice des droits de réglage : `setBy` `OPERATOR_ADMIN` pour
  `cash_partial_refund_allowed`, `ORGANIZER_ADMIN` pour `cash_partial_refund_enabled`) ;
- `packages/contracts/openapi.yaml`, `tools/contract-stability/contract-baseline.json` et le test de gel
  `apps/api/test/unit/contracts/contract-additions-9b.spec.ts` (décision du porteur).

Exhaustivité revérifiée le 23/11/2026 par `git diff --name-only $(git merge-base main HEAD)..HEAD` : les autres
fichiers modifiés hors tests et documentation sont de câblage sans droit ni secret
(`partial-refund.controller.ts`, `return.module.ts`, `audit.service.ts` : une valeur d'union,
`MEDIA_PARTIAL_CASH_REFUNDED`), de configuration d'essai (`jest.config.cjs`, `.github/workflows/ledger-tests.yml` :
étape seule de la concurrence) ou générés (`packages/contracts/generated/openapi.ts`, fichiers Dart de
`packages/contracts/dart/`).

### Tests de borne écrits avec la mission et ce qui reste non figé

Mutations rejouées par les relecteurs (voir `docs/passation-9c/preuves.md`). **Non figé, consigné comme limite :**
(a) OP-N180 ; (b) OP-N181 ; (c) OP-N182 ; (d) OP-N183 ; (e) OP-N174.
