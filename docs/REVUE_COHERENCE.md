# Revue de cohérence du kit — 30 septembre 2026

> **Archivée — remplacée par `REVUE_COHERENCE_2.md`** (2 octobre 2026). Ce document est gardé pour l'historique. Ses comptages (assertions, opérations, codes) et ses numéros de ligne ne sont plus à jour ; les questions encore ouvertes sont dans `POINTS_OUVERTS.md` §9.

> **État.** La partie A a été appliquée le 30 septembre 2026 (schéma, tests, SPEC, ADR, points ouverts, protocole, contrat d'API, banc NFC). La suite du schéma compte désormais 262 assertions, et le contrat 62 opérations (ajout de `confirmRefundRequest`). Les questions de la partie B sont suivies dans `POINTS_OUVERTS.md` sous les numéros OP-N21 à OP-N37.
> **Mise à jour du 1er octobre 2026.** Toutes les questions de la partie B ont été traitées : B1 à B15 tranchées (ADR-49 à ADR-64, plus ADR-57 pour la question OP-N38 née de B8), B16 et B17 reportées (POINTS_OUVERTS §6).

Cette revue couvre `SPECIFICATION.md`, `DECISIONS_ADR.md`, `POINTS_OUVERTS.md`, `sync_protocol.md`, `openapi.yaml`, `schema_grand_livre_cashless.sql`, les générateurs de tests et le banc NFC (`PROTOCOLE_TERRAIN.md`, `analyse_mesures.py`). Chaque constat a été vérifié dans le texte ; les numéros de ligne sont ceux du 30 septembre.

**Ce qui est cohérent partout :**

- les 25 types de transaction, les sources, et les statuts des supports, des lots, des cautions, des portefeuilles, des événements et des grands livres ;
- les codes CL001 à CL017 ;
- les comptages : 61 opérations, 8 en V2, 4 webhooks ; 245 et 55 assertions ; 19 cas du moteur ; 48 transactions du scénario ;
- les valeurs par défaut du hors ligne (2 s / 3 s, 120 s, 15 min, 500 opérations / 1 Mio, 30 s, 60 s, 7 jours) ;
- l'abandon des billets ;
- les renvois ADR → SPEC (sauf ceux listés ci-dessous) ;
- la couverture de §14.1 par la section 18 du schéma.

**Bilan :**

- **Partie A** : 42 corrections qui ne demandent pas de décision. Ce sont des erreurs, des oublis, ou l'application d'une décision déjà prise.
- **Partie B** : 17 questions non tranchées et non suivies jusqu'ici.
- **Partie C** : rappel des points déjà suivis.

---

## A. Corrections sans décision

### A1. Graves (erreurs de logique)

| # | Constat | Où | Correction |
|---|---|---|---|
| A1.1 | La reprise forcée peut être validée par son propre auteur : quand un retour est déjà demandé, la contrainte compare le valideur au demandeur initial, pas à l'auteur de la reprise | schéma `force_central_authority` | Refuser `p_approver` NULL ou égal à `p_actor` en tête de fonction ; ajouter un test |
| A1.2 | `config_id` est classé parmi les champs chaînés (immuables), alors que l'entrée est créée avant l'éventuel passage hors ligne. L'empreinte change, et une vente déjà écrite en ligne serait rejetée (`IDEMPOTENCY_KEY_REUSED`) au lieu d'être reconnue comme doublon | sync §3.3 ; openapi `OfflineOperation` | Passer `config_id` en champ d'état, comme `snapshot_version` |
| A1.3 | Des opérations confirmées en ligne (central ou passerelle) et renvoyées après une reprise forcée n'ont ni `config_id` ni `snapshot_version` : elles seraient toujours rejetées, alors que §9.7 garantit le commerçant | sync §7.1 étape 4, §7.2, §9.7 | Exempter des contrôles §7.2 les opérations `online_status = CONFIRMED` |
| A1.4 | `lpad(seq, 4, "0")` tronque au-delà de 9 999 (collision de clés) | sync §7.1 étape 1 | « complété à gauche jusqu'à 4 chiffres au moins, jamais tronqué » |
| A1.5 | La SPEC dit que la bascule se fait « par `set_debit_authority` », alors que l'application ne doit pas l'appeler. De plus, aucune fonction interne n'est retirée à `PUBLIC` | SPEC §9.7 ; SPEC §13.1 ; schéma | Renvoyer aux fonctions de bascule ; `REVOKE EXECUTE … FROM PUBLIC` sur les fonctions internes ; ajouter un test |
| A1.6 | `replace_media` passe une écriture de préchargement pour le nouveau bracelet et échoue si l'événement n'autorise pas `DESK`, alors que la SPEC dit « sans écriture comptable » | schéma `replace_media` ; SPEC §6.1, §7.8, §8.5 | Chemin interne sans préchargement ni contrôle du mode d'activation ; ajouter un test |

### A2. Application de décisions déjà prises

| # | Constat | Correction |
|---|---|---|
| A2.1 | `PAIRED_TPE` (V2, ADR-43) est encore accepté par le schéma et par l'énumération openapi ; la SPEC range le « TPE associé » et `packages/nfc-sdk` dans l'arborescence V1 | Retirer du `CHECK` ; marquer V2 dans openapi avec refus `DEVICE_MODE_NOT_ALLOWED` ; marquer V2 dans l'arborescence |
| A2.2 | S15 (tables V2) figure dans le tableau « L'agent DOIT ajouter » | Déplacer S15 dans une liste V2 |
| A2.3 | `createPayment` (V1) accepte `payment_intent_id` ; sync parle d'« intention POS tiers » sans mention V2 | Marquer V2 |
| A2.4 | `approveRefundRequest` écrit un type `REFUND` (inexistant), déclenche un virement automatique et n'a pas de seconde personne. La SPEC (§8.5) dit : remboursement manuel en V1, approbation à deux, paiement hors système, confirmation | Type `WALLET_REFUND` ; flux manuel à deux ; opération de confirmation |
| A2.5 | `releaseMedia` (openapi) ne passe pas par `PROMO_EXPIRY`, alors que la SPEC §7.9 l'impose avant la restitution | Aligner la description |
| A2.6 | Le banc NFC ne connaît qu'un niveau (p95 300 ms, 2 %), sans p99 ni niveau « toléré » ; PROTOCOLE §8 garde un 3ᵉ niveau « avec réserve » et deux règles de conditions contradictoires ; il parle de « 3 à 4 téléphones représentatifs » ; l'Irlande manque à la mesure de latence ; il n'y a pas d'essai de protection d'`INCR_CNT` | Aligner sur ADR-39 (deux niveaux, p99, téléphones disponibles) ; ajouter l'Irlande et l'essai `INCR_CNT` ; corriger le calcul « ≈ 15 gestes » (7,5) et « une fois sur deux (≈ 61 %) » |
| A2.7 | Le snapshot : l'en-tête décrit dans la SPEC (§9.4) et dans sync (§4) omet `format`, `kind`, `entries` et `removed`, exigés par la base et par openapi. Le contenu omet `wallet_status`. Une remarque obsolète dit que la signature ne porte que sur (version, empreinte). La clé de la passerelle n'est pas dans le KMS : l'exception n'est pas dite. La taille est sous-estimée (plus de 5 Mo pour 50 000 bracelets) | Compléter les listes ; supprimer la remarque ; écrire l'exception de la passerelle ; corriger la taille |
| A2.8 | L'exemple de lot hors ligne dans openapi n'a pas de `config_id` ; la passerelle relaie une `device_signature` par opération, qui n'existe pas (le terminal signe l'en-tête du lot) | Ajouter `config_id` ; relayer l'en-tête et la signature du lot d'origine |
| A2.9 | Remboursement : SPEC §6.5 n'autorise la sortie d'argent que « vers un numéro vérifié », alors que §8.5 prévoit aussi les espèces au guichet | Ajouter l'exception des espèces au guichet (voir aussi B2) |
| A2.10 | Consultation anonyme : « n'utilise pas le code de rattachement », alors que c'est ce même code imprimé | « ne consomme pas le code » |
| A2.11 | POOL : « rattachements suivants… par lecture NFC », ambigu avec ADR-42 (l'app ne lit jamais la puce) | « par un terminal au guichet » |
| A2.12 | ADR-37 (capture automatique en V1) s'applique à une fonction devenue V2 (ADR-43) ; la fiche ADR-30 dit encore « Acceptée » et garde TPE associé et SDK | ADR-37 et ADR-30 : statut « Modifiée par ADR-43 » ; ajouter « Modifiée » et « Acceptée sous condition » aux statuts possibles |

### A3. Codes d'erreur et contrat d'API

| # | Constat | Correction |
|---|---|---|
| A3.1 | Des codes normatifs ne sont cités sur aucune réponse d'openapi : `CHAIN_BROKEN`, `BATCH_SIGNATURE_INVALID`, `HANDOVER_INVALID_STATE`, `SEQ_GAP_NOT_FOUND`, `DEVICE_MODE_NOT_ALLOWED`, `DEBIT_AUTHORITY_MOVING` | Les citer sur les opérations concernées ; `DEBIT_AUTHORITY_MOVING` n'est pas un refus définitif (sync §5.1) |
| A3.2 | Il y a deux noms pour le même refus : `OFFLINE_NOT_ALLOWED` / `OFFLINE_DISABLED`, et `MEDIA_UNKNOWN` / `MEDIA_NOT_IN_SNAPSHOT` | Un seul nom par refus |
| A3.3 | `SEQ_OUT_OF_ORDER` sert aussi pour un lot de terminal non continu (400), alors que §5.7 le réserve à `edge_seq` | Élargir la ligne §5.7 |
| A3.4 | Le terminal révoqué lève `42501` (absent de §5.7) ; CL001 couvre beaucoup plus de cas que son libellé ; `check_balanced` n'a pas de SQLSTATE | Compléter §5.7 ; `CL001` dans `check_balanced` |
| A3.5 | CL003, CL004, CL005, CL008 et CL009 sont testés par le texte du message, pas par le SQLSTATE (CL003 pas du tout) | Tests `throws_code` |
| A3.6 | Trois écritures n'ont pas d'`Idempotency-Key` (`reportMyMediaLost`, `cancelPaymentRequest`, `rejectRefundRequest`) ; le préfixe `refund:` contredit `bo:` ; la clé d'un lot est le `batch_id` (exception non dite) | Aligner |
| A3.7 | Petits écarts de valeurs : heartbeat « 30 à 60 s » au lieu de 60 s ; lots de la passerelle `maxItems: 1000` au lieu de 500 ; `max_snapshot_age` sans défaut et nommé autrement ; limites d'essais du code imprimé ; « prochain snapshot » au lieu de « ≤ 5 s » après une perte ; `PspTopup.status CANCELLED` absent de S14 ; `Accept-Language` absent ; exemple de clé en Ed25519 alors que le défaut est ECDSA | Aligner sur la SPEC |
| A3.8 | Des ProblemCodes sont décrits nulle part (23, dont `TAP_EXPIRED`, `REFUND_ALREADY_OPEN`, `OTP_INVALID`) | Une phrase par code dans l'opération concernée |

### A4. Schéma (mineur)

| # | Constat | Correction |
|---|---|---|
| A4.1 | `anomaly.kind` est libre ; `RETIRED_IDENTITY`, `CLOCK_SKEW`, `VOID_CONFLICT`, `ONLINE_CONFIRMED_MISSING` et l'anomalie de terminal non conforme ne sont listés nulle part | `CHECK` à liste fermée, reprise dans la SPEC |
| A4.2 | Écriture `BACKOFFICE` avec `created_by` NULL acceptée ; `ANOMALY_RESOLUTION` non forcée en `BACKOFFICE` | Renforcer les `CHECK` |
| A4.3 | `device.serial` unique pour toujours, alors que le ré-enrôlement réutilise le `serial` (sync §3.1) | Unicité parmi les terminaux non révoqués |
| A4.4 | `payout` n'a ni date d'initiation ni valideur (alerte 48 h, double validation) ; `payout.method` dit `OM` au lieu de `ORANGE_MONEY` | Ajouter les colonnes ; aligner le nom |
| A4.5 | Commentaires périmés : préchargement « une transaction pour tout le lot », `register_tap` (5 résultats au lieu de 11), `ledger_jurisdiction`, « PostgreSQL 14+ » ; deux sections 17 ; `assert_tenant` appelé après la lecture dans quatre fonctions | Nettoyer |
| A4.6 | `funds_holder` à la fois colonne d'événement et réglage de configuration | Dire que la colonne fait foi |
| A4.7 | `preload_batch` compte aussi les bracelets déjà préchargés ; `activate_media` ne contrôle pas le mode si le lot n'a pas d'événement et qu'aucun n'est donné | Corriger ; exiger l'événement |

### A5. Renvois et tenue des documents

| # | Constat | Correction |
|---|---|---|
| A5.1 | Renvois faux : sync « §8.1 » (→ §7.4), I6 « §4 » (→ §5.2, §8), openapi « §5.4 » (→ §5.1) et « §5.1 » (→ §6.1), ADR-23 « §7.11 » (→ §7.10), SPEC §7.6 « OP-N10 » (→ ADR-39, avant le code de l'app terminal) | Corriger |
| A5.2 | Mentions de billets dans ADR-24 et ADR-26 ; ADR-18 dit « registre à ajouter » (fait, ADR-47) | Notes de renvoi datées (la règle interdit de réécrire une fiche) |
| A5.3 | POINTS_OUVERTS : OP-N7 absent des points reportés ; fiches OP-N6 et OP-N9 différentes de leur ligne « reporté » ; ordre de décision périmé (OP-N10) ; ligne « Auditeur sécurité » tronquée ; « ci-dessous » faux ; « action 3 » sans numérotation ; OP-N2 mal trié | Corriger |
| A5.4 | SPEC §17 : pas de ligne pour OP-B1 ni OP-B2 ; OP-N3 sans `account_mapping` ; ligne « validation de la puce » pour un point tranché | Compléter |
| A5.5 | En-têtes datés du 28 septembre (SPEC version 1.0, POINTS_OUVERTS) ; S23 absent sans explication | Version 1.1 du 30 septembre ; « S23 : retiré » |
| A5.6 | Niveaux d'exigence : « DEVRAIENT être effacés » contre « DOIVENT » ; snapshot en ≤ 5 s après un blocage en « DEVRAIT » dans sync, « DOIT » dans la SPEC | Harmoniser en DOIT |
| A5.7 | Liste des webhooks (6 événements dans SPEC §8.4 contre 4 livrés) ; diagramme des modes du terminal incomplet (`OFFLINE → DEGRADED`) ; « perte maximale : aucune » avec passerelle, alors que sync accepte un risque résiduel ; `PERIOD_CLOSED` et `LEDGER_LOCKED` rangés en « terminal fautif » ; ordre de lecture NFC différent entre SPEC §7.6 et sync | Aligner (ordre de SPEC §7.6, normatif) |
| A5.8 | Rôles : l'identification par `CASHIER` est absente de §3.2 ; le service qui sert `/media/auth-keys` n'a pas le droit de déchiffrer ; le contrôle quotidien appelle `GenerateMac`, réservé à la personnalisation | Nommer les services et leurs droits |
| A5.9 | sync §7.1 : rien ne dit ce qui se passe au 4ᵉ CL007 | `REJECTED`, `retryable = true` |

---

## B. Questions non tranchées et non suivies

Classées de la plus urgente à la moins urgente. Chacune recevra un numéro OP et sera posée une par une.

| # | Question | Pourquoi c'est un problème | Recommandation |
|---|---|---|---|
| B1 | **Fin d'événement.** Que devient une vente hors ligne synchronisée après le passage en `CLOSING` ? Faut-il autoriser `PROMO_EXPIRY` (restitution au guichet) et `CHARGEBACK` pendant les phases de clôture ? Comment clore un événement si la casse est `NONE` ou `LEGAL_ACCOUNT` (soldes jamais nuls, pas de compte de versement légal) ? | Contradiction avec I4 (commerçant garanti) ; restitution impossible en clôture ; clôture impossible dans deux cas | Accepter la synchro hors ligne jusqu'à `LOCKED` ; autoriser `PROMO_EXPIRY` et `CHARGEBACK` jusqu'à `LOCKED` ; condition de clôture propre à chaque destination de casse |
| B2 | **Remboursements.** Canaux (Wave, Orange Money, espèces ; virement bancaire ou carte ?) ; le remboursement en espèces au guichet exige-t-il une seconde personne ? Est-il ouvert aux bracelets anonymes ? | openapi, SPEC et scénario de référence divergent (le scénario rembourse par virement) | Wave, Orange Money, espèces ; espèces au guichet sans seconde personne sous un plafond, anonymes compris ; virement réservé au back-office |
| B3 | **Identification (KYC).** Le niveau est-il porté par le client (calculé, suit l'expiration de la pièce) ou stocké par portefeuille ? | La SPEC dit les deux | Porté par le client, calculé ; la colonne du portefeuille devient une vue |
| B4 | **Rejeu de `POST /taps`.** Un rejeu réseau présente le même compteur et met un bracelet honnête en liste noire (« copie suspectée ») | Faux blocages en situation de réseau faible | Rendre `/taps` idempotent sur (terminal, bracelet, compteur, UID) |
| B5 | **Durée maximale d'une transaction (60 s).** PostgreSQL 16 ne sait pas la borner (`transaction_timeout` arrive en version 17) | Le scellement repose sur cette borne | Passer à PostgreSQL 17 ; à défaut, borne applicative et surveillance |
| B6 | **Statut de l'événement → statut du grand livre.** Qui fait la synchronisation : un déclencheur ou l'application ? | Sans elle, CL003 et CL004 ne se déclenchent jamais | Fonction SQL unique `set_event_status` qui met à jour les deux |
| B7 | **Passerelle.** L'activation et la caution sont-elles servies par la passerelle (`x-edge-available`) ou indisponibles pendant `EDGE` (sync §9.6) ? | Contradiction directe | Activation sans frais et caution en espèces servies ; prélèvements sur solde refusés |
| B8 | **Code imprimé.** Sur tous les lots publics, ou seulement si `SELF_APP` est autorisé ? À quel moment est-il généré (commande ou personnalisation) ? | La consultation anonyme du solde (ADR-42) en dépend ; le défaut `{DESK}` supprime le code | Tous les lots `PUBLIC`, généré à la commande ; dépend du devis QR (action en cours) |
| B9 | **Perte due à un terminal non conforme.** Qui la porte ? §9.6 dit « le prestataire », §8.2 dit « l'organisateur est responsable des terminaux » | Contradiction | Le prestataire (responsable du logiciel), sauf terminal fourni par l'organisateur ou le commerçant |
| B10 | **Chemin NFC de paiement.** `GET_VERSION` et `READ_SIG` font-ils partie de chaque paiement ? Le banc les mesure, SPEC §7.6 non | Les seuils d'ADR-39 ne mesurent pas le vrai chemin | Paiement sans `GET_VERSION` ni `READ_SIG` ; le banc mesure les deux séquences |
| B11 | **Latence de bout en bout.** openapi vise p99 < 800 ms, la SPEC 95 % < 1 s côté serveur ; le protocole dit « par exemple p95 ≤ 800 ms » ; OP-N11 (région) en dépend | Pas d'objectif unique | Terminal → réponse : p95 ≤ 800 ms, p99 ≤ 1,5 s ; serveur : p95 ≤ 200 ms |
| B12 | **Paramètres du terminal.** Délais, battement de cœur, synchronisation et fenêtre d'annulation sont dits « réglables », mais `DeviceConfig` n'en porte aucun | Réglage impossible | Les ajouter à `DeviceConfig`, réglables par événement |
| B13 | **Compte commerçant « chaud ».** « Selon volume », sans critère, alors qu'un stand vise 20 ventes par seconde | Risque de contention | Chaud par défaut pour tout commerçant |
| B14 | **Excédent de caisse dû au client** (recharge espèces refusée pour plafond) : procédure non décrite, `CASH_DIFF` non défini | Pas d'écriture prévue | Remboursement espèces immédiat, écriture `ADJUSTMENT` à deux si la caisse est fermée |
| B15 | **QR client hors réseau.** Nombre de jetons préchargés et durée de vie (60 s les rend inutiles) ; paramètre du sens des QR autorisés | Valeurs absentes | 5 jetons, 24 h, usage unique ; paramètre `qr_directions` |
| B16 | **Capture différée en V2** : fait-elle partie de la cible V2 ? | openapi garde `capturePaymentIntent` | À trancher lors du cadrage V2 (reportable) |
| B17 | **Outils de sécurité en CI** : ADR-44 dit « reste à décider », mais aucun point ne le suit | Oubli de suivi | L'ajouter aux points reportés |

Autres mentions « plus tard », déjà assumées : puces anti-clonage, vérification d'identité en ligne. Elles relèvent de la feuille de route, pas d'une décision.

---

## C. Points déjà suivis (rappel)

OP-B1 (titulaire des comptes marchands ; PSP carte), OP-B2 (codes à usage unique), OP-N3 (casse, taxes, caution acquise, SYSCOHADA ; à scinder en questions pour l'expert-comptable), OP-N6, OP-N7, OP-N9 (le contrat doit porter la partie qui supporte les contestations), OP-N11, OP-N12, OP-N13, la condition d'ADR-48 (avis du juriste), et les actions de POINTS_OUVERTS §7. Les questions pour l'expert-comptable (OP-N3, écart de taxe par période) et pour le juriste (OP-N12, stockage KYC d'ADR-38) restent à rédiger.
