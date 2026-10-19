# Référence API, vue produit

> Statut de complétude : voir `06-docs-status.md`. Ce document ne remplace
> jamais le contrat OpenAPI (le contrat technique exact, schéma par schéma) : il
> l'accompagne et ne duplique aucun schéma de requête ou de réponse.
> Dernière mise à jour : 15/10/2026 (routes de la mission « Bracelets NFC », approuvée, acceptation et fusion en
> attente). Ce document décrit le contrat ; le tableau « Détail par mission » dit ce qui est réellement servi.

## Lien vers la spécification technique

- Spécification OpenAPI : [`packages/contracts/openapi.yaml`](../packages/contracts/openapi.yaml) (OpenAPI 3.1 ; normative, SPECIFICATION §0.2). 131 chemins et 159 opérations dans `main`
  (mission « Bracelets NFC » comprise, PR #3 du 16/10/2026).
- Généré par : non généré, écrit à la main ; c'est la **source** des types TypeScript et Dart, qui seront générés depuis lui (§2.2).
- Opérations V2 (`x-release: V2`) : présentes dans le contrat, à ne pas implémenter en V1.
- Manque au contrat (à ajouter par les missions) : endpoints du back-office (catalogues, politiques hors ligne, clôture, versements, relevés, exports), en-tête `Accept-Language` commun (§10.1, §10.4).

## Vue d'ensemble par domaine

### Terminaux
- À quoi ça sert : enrôler un terminal par code à usage unique, renouveler son jeton, lui servir sa configuration et suivre ses numéros de séquence.
- Endpoints principaux : `POST /device-enrollment-codes`, `POST /device-enrollments`, `POST /device-tokens/refresh`, `GET /device/config`, `POST /device/heartbeat`, `GET /device/seq-status`.
- Section du contrat : chemins `/device*`, `/devices/{device_id}/…`.
- Authentification (mission 5a, plan du 19/10/2026) : certificat client (mTLS), jeton d'appareil lié à la clé et signature de chaque requête (RFC 9421 restreint), exigés ensemble ; back-office des terminaux ajouté (`listDevices`, `getDevice`, `suspendDevice`, `reactivateDevice`, `revokeDevice`, `listDeviceEnrollmentCodes`).

### Bracelets
- À quoi ça sert : obtenir le mot de passe d'un bracelet, enregistrer une lecture, activer, consulter, gérer caution, restitution, remplacement, remise en stock et rendu des espèces dues ; au back-office, gérer les clés de bracelet (à deux), les lots et leurs codes imprimés, les bracelets (liste noire, perte) ; au poste d'atelier, personnaliser.
- Endpoints principaux : terrain `POST /media/auth-keys`, `POST /taps`, `POST /media/activations`, `POST /media/{media_id}/release`, `POST /media/{media_id}/replace`, `POST /media/{media_id}/reassignment`, `POST /media/{media_id}/cash-due-refunds`, `POST /media/claims/confirmations` ; back-office `/operators/{operator_id}/tag-keys…`, `/tag-key-jobs…`, `/tag-key-check-runs`, `/media-batches…`, `/media…` ; poste `/operators/{operator_id}/media-personalizations…`.
- Processus : chaque opération porte `x-process` (`public`, `tag-keys`, `personalization`) ; seule `POST /media/auth-keys` est servie par le processus des clés, et les deux routes du poste par la personnalisation. L'aiguillage par chemin reste à déployer (OP-N45).
- Section du contrat : chemins `/media*`, `/taps`, `/operators/{operator_id}/tag-key*`, `/operators/{operator_id}/media*`.

### Paiements et QR commerçant
- À quoi ça sert : encaisser par bracelet ou QR client, consulter, annuler ; créer et payer un QR commerçant.
- Endpoints principaux : `POST /payments`, `POST /payments/{transaction_id}/reversal`, `POST /payment-requests`, `POST /payment-requests/{payment_request_id}/pay`.
- Section du contrat : chemins `/payments*`, `/payment-requests*`.

### Recharges, caisses et identification
- À quoi ça sert : recharge en espèces, demande de recharge PSP et suivi, sessions de caisse, identification au guichet.
- Endpoints principaux : `POST /topups/cash`, `POST /topups/psp`, `POST /cash-sessions`, `POST /cash-sessions/{cash_session_id}/close`, `POST /kyc-verifications`.
- Section du contrat : chemins `/topups*`, `/cash-sessions*`, `/kyc-verifications*`.

### Webhooks PSP
- À quoi ça sert : recevoir les notifications signées de chaque PSP, par configuration.
- Endpoints principaux : `POST /webhooks/{provider}/{psp_config_id}`.

### Hors ligne
- À quoi ça sert : servir le snapshot (complet ou delta), recevoir son accusé, recevoir les lots d'opérations et en rendre le résultat, lever un trou de séquence, importer le journal d'un terminal révoqué.
- Endpoints principaux : `GET /offline-snapshots/current`, `POST /offline-snapshots/ack`, `POST /offline-batches`, `GET /offline-batches/{batch_id}`, `POST /devices/{device_id}/seq-gaps/{seq}/waive`.
- Détail normatif : `docs/sync_protocol.md`.

### App festivalier
- À quoi ça sert : connexion par code à usage unique, profil, portefeuilles et historique, bracelets, rattachement, perte, QR client, demande de remboursement ; consultation anonyme du solde.
- Endpoints principaux : `POST /customer-auth/otp`, `POST /customer-auth/token`, `GET /me/wallets`, `POST /me/media`, `POST /me/media/{media_id}/report-lost`, `POST /me/customer-qr-tokens`, `POST /me/refund-requests`, `POST /public/balance-lookups`.

### Remboursements, réclamations tardives et demandes d'approbation (back-office)
- À quoi ça sert : lister, approuver, confirmer ou refuser les remboursements ; écrire une réclamation tardive ; décider des demandes d'approbation à deux personnes.
- Endpoints principaux : `GET /refund-requests`, `POST /refund-requests/{refund_request_id}/approve`, `POST /ledgers/{ledger_id}/late-claims`, `GET /approval-requests`, `POST /approval-requests/{approval_request_id}/approve`.

### Passerelle locale
- À quoi ça sert : changer l'autorité de débit d'un grand livre, mener la bascule, répliquer les soldes vers la passerelle et rejouer sa file au central.
- Endpoints principaux : `POST /ledgers/{ledger_id}/debit-authority`, `GET /edge/handovers/current`, `POST /edge/handovers/{handover_id}/release`, `GET /edge/replication-feed`, `POST /edge/sync-batches`.

### V2 (non implémenté en V1)
- Intentions de paiement (`/payment-intents*`, `/device/payment-intents`) et abonnements aux webhooks sortants (`/webhook-endpoints*`).

## Conventions transverses

- **Authentification et permissions** : jeton porteur JWT court + rafraîchissement pour les personnes ; jeton d'appareil lié à la clé du Keystore (ou mTLS) et lots signés pour les terminaux ; mTLS pour la passerelle ; signature HMAC ou mécanisme du PSP pour les webhooks entrants ; `X-Approval-Token` pour la seconde personne au guichet. Le prestataire est toujours déduit de l'identité, jamais d'un paramètre ; un objet d'un autre prestataire répond `404 NOT_FOUND` (§10.3, §13.1).
- **Convention d'erreurs** : `application/problem+json` (RFC 9457) avec un `code` stable de l'énumération `ProblemCode` ; jamais de message SQL brut ; codes `CL001` à `CL024` traduits par SQLSTATE (§5.7).
- **Idempotence** : `Idempotency-Key` obligatoire sur toute écriture ; terminaux `<serial>:<seq>` ; webhooks `<psp>:<id>` ; autres clients préfixés (`app:`, `pos:<client_id>:`, `bo:`) ; rejeu identique → `Idempotency-Replayed: true` ; autre contenu → `409 IDEMPOTENCY_KEY_REUSED` (§10.2).
- **Pagination** : par curseur opaque (`cursor`, `limit`), réponse avec `next_cursor` et `has_more`.
- **Versionnage** : préfixe `/v1` ; codes d'erreur stables (on en ajoute, on n'en change jamais le sens).
- **Limites de débit** : codes à usage unique (3 envois par numéro sur 15 min, 10 demandes par IP et par heure, 5 essais par code) → `429 OTP_RATE_LIMITED` ; code de rattachement (5 essais par compte et par heure, 20 par appareil et par jour) ; consultation anonyme du solde (20 par code, 60 par IP, par heure).
- **Traçabilité et langue** : `X-Request-Id` sur toutes les requêtes et réponses ; `Accept-Language` (`fr`, `en`).
- **Passerelle** : les opérations marquées `x-edge-available` sont aussi servies, à l'identique, par la passerelle.

## Exemples d'usage en contexte

### Paiements
Scénario : un terminal encaisse 6 000 XOF par bracelet, en un seul aller-retour.
```
POST /v1/payments
Idempotency-Key: TPE-FOOD-02:0087
→ 201 (transaction PURCHASE) ; rejeu à l'identique → même réponse, Idempotency-Replayed: true
```

### Demandes d'approbation
Scénario : une levée de trou de séquence demandée par un superviseur, approuvée par un second.
```
POST /v1/devices/{device_id}/seq-gaps/{seq}/waive         → 202, demande PENDING
POST /v1/approval-requests/{approval_request_id}/approve  → demande EXECUTED (valideur = sa session)
```

## Détail par mission

| Mission | Domaines/endpoints touchés | Lien vers détail local |
|---|---|---|
| `fondations-grand-livre-01M4AY8M` (✅ mergée le 08/10/2026) | Aucun endpoint métier ; `GET /v1/health` seulement. Conventions transverses mises en œuvre : problem+json (SQLSTATE → `ProblemCode`), `Idempotency-Key` / `Idempotency-Replayed`, `X-Request-Id`, `Accept-Language` | [`kitty-specs/fondations-grand-livre-01M4AY8M/docs/sequence.md`](../kitty-specs/fondations-grand-livre-01M4AY8M/docs/sequence.md) |
| `identite-roles-double-validation-01M4DNDN` (✅ mergée le 09/10/2026 (10/10 WP, acceptée)) | `/approval-requests` (4 routes, implémentées) ; 7 routes ajoutées au contrat et implémentées : `/operators/{operator_id}/users…`, `role-assignments`, `/platform-admins` (sans `Idempotency-Key`, ADR-78/contradiction C-05) ; clés d'idempotence conservées 30 jours (ADR-79) ; `Authorization: Bearer` (OIDC) sur toutes les routes sauf la santé ; `X-Approval-Token` (formule `act_hash` ajoutée à la description) | [`kitty-specs/identite-roles-double-validation-01M4DNDN/docs/sequence.md`](../kitty-specs/identite-roles-double-validation-01M4DNDN/docs/sequence.md) |
| `configuration-parties-evenements-01M4GCJ9` (✅ mergée le 13/10/2026 (13/13 WP, acceptée, squash `d9e3779` ; dans `main` par la PR #2, CI verte)) | 48 opérations back-office sur 28 chemins, ajoutées au contrat et toutes servies : plateforme (`/jurisdiction-profiles`, `/operators`, contrats et règles de plateforme, `/platform/config-versions`) et prestataire (`/operators/{operator_id}/…` : organisateurs, commerçants, contrats, versions de configuration, événements, configuration résolue, conditions et passages de statut, participations, points de vente, règles de frais) ; `ApprovalAction` étendue de huit actions | [`kitty-specs/configuration-parties-evenements-01M4GCJ9/docs/sequence.md`](../kitty-specs/configuration-parties-evenements-01M4GCJ9/docs/sequence.md) |
| `bracelets-nfc-01M4TD3W` (✅ mergée le 16/10/2026 (20/20 WP, acceptée le 15/10/2026, squash `7b1b8c2` ; dans `main` par la PR #3, CI verte)) | **39 opérations servies** (toutes avec `x-process`). 12 déjà au contrat : `/media/auth-keys` (processus des clés), `/taps`, `/media/activations`, `GET /media/{media_id}`, caution et rendu de caution, restitution, remplacement, espèces dues, `POST /me/media`, `/media/claims/confirmations`, `/public/balance-lookups` (réponse réduite : devise, solde, statut, 10 derniers mouvements, décision n° 11). **27 ajoutées sur 24 chemins** : clés et travaux de clé (8, `/operators/{operator_id}/tag-keys…`, `/tag-key-jobs…`, `/tag-key-check-runs`), lots et codes (10, `/media-batches…`), bracelets au back-office (6, `/media…` : liste, fiche, liste noire, demande de sortie, perte, retrouvé), poste de personnalisation (2), remise en stock `POST /media/{media_id}/reassignment` (1, non prévue au plan). Rôle `PERSONALIZER` ; `ApprovalAction` étendue de trois actions (`TAG_KEY_CREATE`, `TAG_DEK_ROTATE`, `TAG_KEY_RETIRE`) ; la sortie de liste noire réutilise `REINSTATE_MEDIA`. Refus propres à la mission : `409` sur la caution en espèces et les espèces dues sans caisse (ADR-89) ; `422 release.no_chaining` sur `settle_balance` et `refund_deposit_by` (ADR-91, à trancher). Non servie : `POST /me/media/{media_id}/report-lost` (déclaration de perte par le festivalier) | [`kitty-specs/bracelets-nfc-01M4TD3W/docs/sequence.md`](../kitty-specs/bracelets-nfc-01M4TD3W/docs/sequence.md) | [`kitty-specs/bracelets-nfc-01M4TD3W/docs/sequence.md`](../kitty-specs/bracelets-nfc-01M4TD3W/docs/sequence.md) |
| `identite-enrolement-terminaux-01M52R6H` (🚧 plan finalisé le 19/10/2026) | Prévu : 5 opérations du contrat servies (`createDeviceEnrollmentCode` en route `transient`, `enrollDevice`, `refreshDeviceToken`, `getDeviceConfig`, `postDeviceHeartbeat`) et 6 ajoutées (back-office des terminaux) ; `security` des routes de terminal changé en trois preuves ensemble ; en-têtes `Signature-Input`, `Signature`, `Content-Digest` ; erreurs `DEVICE_SIGNATURE_INVALID`, `DEVICE_SERIAL_IN_USE` ; `CLOCK_SKEW_TOO_LARGE` servi avec `Date` | [`kitty-specs/identite-enrolement-terminaux-01M52R6H/docs/sequence.md`](../kitty-specs/identite-enrolement-terminaux-01M52R6H/docs/sequence.md) |

## Questions de nécessité/complétude posées lors de la dernière révision
- Nécessaire pour ce projet ? Voir `06-docs-status.md`.
- Complet au vu des missions mergées à ce jour ? Voir `06-docs-status.md`.
- Spécification technique (OpenAPI) toujours à jour et liée correctement ? Voir `06-docs-status.md`.
- Validé par : en attente.
