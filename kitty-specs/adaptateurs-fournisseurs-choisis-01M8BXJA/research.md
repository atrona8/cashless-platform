# Research — mission 12b-1 (adaptateurs des fournisseurs choisis)

Sources lues le 26/11/2026. Les points marqués **[à confirmer à l'essai]** ne sont pas établis par une page lue et
sont vérifiés par la commande d'essai du service (IC-08) ; l'adaptateur les isole dans une constante commentée.

## Sources

| Fournisseur | Source | Lisible ? |
|---|---|---|
| Wave | https://docs.wave.com/checkout, /webhook, /business, /balance-api | oui |
| PayDunya | https://developers.paydunya.com (toutes pages) | **non (403)** |
| PayDunya | SDK officiels `github.com/paydunyadev/paydunya-node-master` (`lib/index.js`, `lib/checkout-invoice.js`), `paydunyadev/paydunya-woocommerce-gateway` (`WC_Paydunya.php`) | oui |
| Stripe | https://docs.stripe.com/webhooks, /api/checkout/sessions/create, /expire, /api/charges/object, /api/payment_intents/object, /api/balance_transactions/list, /api/events/types, /api/idempotent_requests, /currencies | oui (liste des pays : 404) |
| Orange Money | https://developer.orange.com/apis/om-webpay (aperçu seul) ; https://developer.orange-sonatel.com (documentation technique derrière un compte) | sans contenu technique → hors périmètre (D1) |
| AWS | Documentation des API KMS, Secrets Manager, S3 (Object Lock, écritures conditionnelles) | connues ; noms d'opérations et de paramètres du SDK v3 |

## R-01 — Dépendances (C-004, directive chaîne d'approvisionnement)

- **Décision** : `axios` **1.21.1** (publiée le 09/11/2026, mainteneur `jasonsaayman`, registre npm officiel) ;
  `@aws-sdk/client-kms`, `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-s3` **3.1172.0** (publiées le
  18/11/2026, `amzn-oss`). Versions exactes, intégrité dans `package-lock.json`, aucune des quatre n'a de script
  `preinstall`/`install`/`postinstall`. Installation avec `--ignore-scripts` puis vérification du lockfile.
- **Raison** : `axios` 1 est déjà la cible du HTTP sortant des PSP (`docs/08-pile-logicielle.md` §1) ; le SDK AWS v3
  modulaire limite le code chargé à trois clients. Versions d'au moins une semaine (les plus récentes, 3.1178.0 du
  25/11, écartées pour fraîcheur).
- **Alternatives** : `fetch` natif de Node 22 (aucune dépendance) écarté pour respecter la pile arrêtée (ADR-78) ;
  bibliothèques officielles Stripe / PayDunya écartées (surface large, le port n'utilise que quelques appels).
- **Revue contradictoire** : faite par l'orchestrateur sur les quatre paquets (registre, mainteneur, scripts, date) ;
  constat contesté : « le SDK AWS tire ~60 paquets transitifs `@smithy/*` » → **accepted** : maintenus par AWS, sans
  script d'installation ; listés dans le lockfile, relus à la revue.

## R-02 — Port PSP à deux verdicts (FR-001)

- **Décision** : `verifyNotification` rend soit une **notification** horodatée (Wave, Stripe), soit un **signal**
  (PayDunya) : identifiant de notification + référence du paiement, sans montant ni horodatage. Une notification peut
  être marquée **à relire** (`confirmationRequired`) quand elle ne porte pas tout ce que le crédit exige (Stripe : la
  carte). Le crédit d'un signal ou d'une notification à relire ne vient que de `getStatus`.
- **Raison** : PayDunya ne signe pas son contenu (D2) ; la notification Stripe `checkout.session.completed` ne contient
  ni résultat 3-D Secure ni empreinte (ils sont sur la `Charge`).
- **Alternatives** : faire l'appel `getStatus` pendant la réception (écarté : réponse < 2 s au contrat, Wave exige 2xx
  sous 5 s, et le répartiteur est « sans appel réseau ») ; tout relire pour tous les PSP (écarté pour Wave, dont la
  notification signée porte la session complète).

## R-03 — Signature HMAC paramétrée

- **Wave** : en-tête `Wave-Signature: t=<s>,v1=<hex>[,v1=…]` ; HMAC-SHA256 hex de `t + corps_brut` **sans
  séparateur** ; plusieurs `v1` pendant une rotation ; refuser au-delà de 5 min (la documentation ne fixe pas l'avance :
  ±300 s symétrique retenu). Clé : secret de notification `wave_sn_WHS_…`, distinct de la clé d'API.
- **Stripe** : `Stripe-Signature: t=…,v1=…[,v1=…][,v0=…][,autres]` ; HMAC-SHA256 de `t + '.' + corps_brut` ; `v0` et
  entrées inconnues **ignorées** (la documentation impose de les tolérer) ; ±300 s.
- **Décision** : `verifyHmacSignature({ separator, allowUnknownEntries, toleranceSeconds, … })` ; les deux secrets
  (courant, précédent avant échéance) restent évalués sans sortie anticipée ; le faux garde son schéma actuel.

## R-04 — Wave

- Base `https://api.wave.com`, `Authorization: Bearer <clé d'API>` (une clé par portefeuille Business).
- Création : `POST /v1/checkout/sessions` `{ amount: "<entier>", currency: "XOF", client_reference: <psp_topup_id>,
  success_url, error_url, restrict_payer_mobile? }` → `id` (`cos-…`), `wave_launch_url`, `when_expires`.
  `success_url` et `error_url` obligatoires en https : `returnUrl` de la demande, sinon les adresses de la configuration
  (`WAVE_DEFAULT_SUCCESS_URL`, `WAVE_DEFAULT_ERROR_URL`) ; sans adresse, refus avant appel.
- Aucune clé d'idempotence documentée → une création n'est **jamais** rejouée telle quelle : sur délai ou erreur
  réseau, `GET /v1/checkout/sessions/search?client_reference=` d'abord.
- Signature des requêtes (optionnelle, irréversible côté Wave) : prise en charge si `request_signing_secret` est posé
  (`Wave-Signature` sur `t + corps`, corps vide pour un GET).
- Statut : `checkout_status` `open|complete|expired`, `payment_status` `processing|cancelled|succeeded` →
  `complete+succeeded` PAID ; `expired` EXPIRED ; `cancelled` FAILED ; sinon PENDING.
- Annulation : `POST /v1/checkout/sessions/:id/expire` ; 200 → annulée ; 409 → `cancelled: false`.
- Relevé : `GET /v1/transactions?date=AAAA-MM-JJ` par jour de la période, curseur `after`, `page_info.has_next_page` ;
  lignes avec `amount`, `fee`, `client_reference`, `is_reversal`.
- Événements : `checkout.session.completed` → PAYMENT_SUCCEEDED si `payment_status=succeeded` ;
  `checkout.session.payment_failed` → PAYMENT_FAILED ; autres → UNKNOWN (conservé, sans effet). `notificationId` = `id`
  de l'événement.

## R-05 — PayDunya

- Base `https://app.paydunya.com/sandbox-api/v1` (bac à sable) ou `https://app.paydunya.com/api/v1`, en-têtes
  `PAYDUNYA-MASTER-KEY`, `PAYDUNYA-PRIVATE-KEY`, `PAYDUNYA-TOKEN`, `Content-Type: application/json` (SDK node).
- Création : `POST checkout-invoice/create` `{ invoice: { total_amount, description }, store: { name },
  actions: { callback_url, return_url, cancel_url }, custom_data: { psp_topup_id } }` → `response_code "00"`,
  `response_text` (adresse de paiement), `token`.
- Confirmation : `GET checkout-invoice/confirm/{token}` → `status` (`completed`, `pending`, `cancelled`, `failed`
  **[à confirmer à l'essai]** pour les deux derniers), `invoice.total_amount`, `custom_data`, `receipt_url`.
- IPN : POST `application/x-www-form-urlencoded`, champs `data[hash]`, `data[status]`, `data[invoice][token]`,
  `data[custom_data][…]` ; preuve d'origine `data[hash] === sha512_hex(MASTER-KEY)` (module WooCommerce officiel).
  Comparaison à temps constant ; **signal** (D2) ; `notificationId = paydunya:<token>:<status>`.
- Pas d'annulation, de relevé ni de remboursement documentés : `cancel` → `{ cancelled: false }` ; `readStatement` →
  liste vide, et le rapprochement PayDunya reste manuel (OP nouveau). Carte : aucune preuve 3-D Secure ni empreinte
  dans la confirmation → `threeDs: 'NOT_PERFORMED'`, `fingerprint: null` → recharge reçue non créditée (D7, règle
  ADR-77 gardée), réexamen après l'essai.
- **Écart de sécurité (D2)** : la preuve d'origine est une valeur fixe ; qui la connaît forge une notification. Effet
  borné : un signal forgé ne déclenche qu'une relecture authentifiée (au pire une charge d'appels) ; débit des signaux
  limité par configuration (au plus 1 relecture par recharge et par minute). OP et ADR à créer (IC-10).

## R-06 — Stripe

- Base `https://api.stripe.com`, `Authorization: Bearer <sk_…>`, corps `application/x-www-form-urlencoded`,
  `Idempotency-Key: <psp_topup_id>` sur chaque POST.
- Création : `POST /v1/checkout/sessions` `mode=payment`, `line_items[0][price_data][currency]=xof`,
  `…[unit_amount]=<montant>`, `…[product_data][name]=Recharge`, `line_items[0][quantity]=1`,
  `payment_method_types[0]=card`, `payment_method_options[card][request_three_d_secure]=any`,
  `client_reference_id`, `metadata[psp_topup_id]`, `success_url`, `cancel_url`, `expires_at` (+30 min, minimum Stripe)
  → `id` (`cs_…`), `url`. XOF devise **sans décimale** **[à confirmer à l'essai]** : montant entier en francs.
- Statut : session (`status`, `payment_status`) puis `GET /v1/payment_intents/:id?expand[]=latest_charge` →
  `latest_charge.payment_method_details.card.three_d_secure.result` (`authenticated`, `attempt_acknowledged` →
  SUCCEEDED ; `failed`, `processing_error` → FAILED ; absent, `not_supported`, `exempted`, `data_share_only` →
  NOT_PERFORMED) et `….card.fingerprint`.
- Annulation : `POST /v1/checkout/sessions/:id/expire` (session `open` seulement).
- Relevé : `GET /v1/balance_transactions?created[gte]=…&created[lte]=…&limit=100&starting_after=…`.
- Événements : `checkout.session.completed` (payé) et `checkout.session.async_payment_succeeded` → PAYMENT_SUCCEEDED
  **à relire** ; `…async_payment_failed` → PAYMENT_FAILED ; `…expired` → PAYMENT_CANCELLED ; `charge.dispute.created`
  → DISPUTE ; autres → UNKNOWN.
- Éligibilité d'un marchand établi au Sénégal : non vérifiée (liste des pays en 404) ; à la charge du porteur (D4).

## R-07 — Relecture des signaux sans migration (révisé au découpage, 26/11/2026)

- **Constat** : `psp_poll_candidates` (migration `0038`) ne rend que les recharges `PENDING` de plus de 2 minutes, en
  dur ; la priorité aux recharges signalées demanderait une migration.
- **Décision** : la logique « relire une recharge chez le PSP puis appliquer » est extraite du travailleur dans un
  service commun `PspStatusConfirmer` (`topups/psp/psp-status-confirmer.ts`). La réception, après avoir conservé un
  signal ou une notification à relire et **après avoir répondu**, demande au confirmateur une relecture asynchrone de
  la recharge désignée (`setImmediate`, hors de la requête, au plus une par recharge et par minute dans le processus).
  Le travailleur d'interrogation (2 min) reste le filet : une relecture perdue (redémarrage, panne) est reprise.
- **Raison** : aucune migration, crédit par le chemin unique du processeur (verrou, clé de paiement : NFR-005 hérité),
  réponse au PSP inchangée.
- **Alternative** : migration `0103` remplaçant `psp_poll_candidates` (écartée : plus lourde, même effet à 2 min près).

## R-08 — Secrets Manager

- Un secret par configuration, nom `psp/<holder_party_id>/<nom>` (forme actuelle de `secret_ref`), valeur JSON :
  `{ "credentials": { … par fournisseur … }, "notification": "<secret>" }` ; rotation : version `AWSPREVIOUS` lue pour
  le secret de notification précédent, échéance dans l'étiquette `previous_valid_until` du JSON courant.
- `GetSecretValue` ; erreurs `ResourceNotFoundException` → `NOT_FOUND`, autres → `UNAVAILABLE` ; jamais de valeur,
  de référence ni de détenteur attendu dans un message ; cache 60 s.

## R-09 — KMS

- `GenerateMac {KeyId, Message, MacAlgorithm: HMAC_SHA_256}` → `Mac` (32 octets) ; `GenerateDataKey {KeyId,
  KeySpec: AES_256}` → `Plaintext`, `CiphertextBlob` ; `Decrypt {KeyId, CiphertextBlob}` ; `Sign {KeyId, Message,
  MessageType: RAW, SigningAlgorithm: ECDSA_SHA_256}` → DER ; `GetPublicKey` → SPKI DER ; `CreateKey {KeySpec,
  KeyUsage}` (HMAC_256/GENERATE_VERIFY_MAC, SYMMETRIC_DEFAULT/ENCRYPT_DECRYPT, ECC_NIST_P256/SIGN_VERIFY) ;
  `DisableKey`.
- Messages > 4 096 octets refusés par KMS en RAW : refus explicite avant appel (les messages actuels sont des en-têtes
  JCS et des UID, bien en deçà ; un test borne la taille).
- Identifiants AWS : chaîne par défaut du SDK (rôle du processus), jamais de clé d'accès en configuration.

## R-10 — S3 Object Lock

- `PutObject {Bucket, Key: <kind>/<id>/<seal_no>, Body: empreinte, ObjectLockMode: COMPLIANCE,
  ObjectLockRetainUntilDate: now + SEAL_COPY_RETENTION_DAYS (3 650), ChecksumAlgorithm: SHA256, IfNoneMatch: '*'}` ;
  412 (déjà écrit) → relire et comparer : identique → référence rendue, différent → erreur d'intégrité.
- Compartiment créé avec Object Lock (procédure du porteur, compte distinct) ; le rôle d'écriture n'a ni
  `s3:BypassGovernanceRetention` ni `s3:DeleteObject`.

## R-11 — Garde de production et sélection

- Liste `PRODUCTION_ENABLED_SERVICES` vide (D6). Services nommés : `psp.wave`, `psp.paydunya`, `psp.stripe`,
  `psp.secrets`, `kms`, `seal-copy`.
- Production : réglage `fake` refusé ; `real` hors liste refusé (« <service> n'a pas été essayé ») ; un PSP non
  autorisé reste indisponible (503 aux recharges, 404 aux notifications), comme aujourd'hui.

## R-12 — Commandes d'essai

- `src/external-services/trial/<service>.ts`, lancées par `npm run essai -w @cashless/api -- <service>` ; refusées en
  production ; parcours : Wave (création d'une session de 100 XOF, relecture, expiration, relevé du jour) ; PayDunya
  (facture, confirmation) ; Stripe (session, relecture, expiration, relevé) ; Secrets Manager (lecture d'un secret de
  test) ; KMS (création de clés de test, MAC, clé de données aller-retour, signature vérifiée, désactivation) ; S3
  (écriture verrouillée d'un objet de test, relecture, refus d'écrasement). Compte rendu : étapes, statuts, durées.

## R-13 — Tests sans réseau

- Serveurs HTTP locaux (`node:http`) par fournisseur, rejouant les corps d'exemple des documentations ; clients AWS
  construits avec `endpoint` local et identifiants factices ; garde de test qui fait échouer toute résolution d'un
  hôte externe (NFR-001).

## R-14 — Attestations

Comparaison point par point à faire au lot (IC-09) ; sans écart, aucun changement de code.
