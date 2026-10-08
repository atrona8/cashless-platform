# Référence API, vue produit

> Statut de complétude : voir `06-docs-status.md`. Ce document ne remplace
> jamais le contrat OpenAPI (le contrat technique exact, schéma par schéma) : il
> l'accompagne et ne duplique aucun schéma de requête ou de réponse.
> Dernière mise à jour : initialisation du 07/10/2026. L'API n'est pas encore implémentée : ce document décrit le contrat.

## Lien vers la spécification technique

- Spécification OpenAPI : [`packages/contracts/openapi.yaml`](../packages/contracts/openapi.yaml) (OpenAPI 3.1, 73 chemins ; normative, SPECIFICATION §0.2).
- Généré par : non généré, écrit à la main ; c'est la **source** des types TypeScript et Dart, qui seront générés depuis lui (§2.2).
- Opérations V2 (`x-release: V2`) : présentes dans le contrat, à ne pas implémenter en V1.
- Manque au contrat (à ajouter par les missions) : endpoints du back-office (organisateurs, événements, participations, catalogues, lots, politiques hors ligne, clôture, versements, relevés, exports), en-tête `Accept-Language` commun (§10.1, §10.4).

## Vue d'ensemble par domaine

### Terminaux
- À quoi ça sert : enrôler un terminal par code à usage unique, renouveler son jeton, lui servir sa configuration et suivre ses numéros de séquence.
- Endpoints principaux : `POST /device-enrollment-codes`, `POST /device-enrollments`, `POST /device-tokens/refresh`, `GET /device/config`, `POST /device/heartbeat`, `GET /device/seq-status`.
- Section du contrat : chemins `/device*`, `/devices/{device_id}/…`.

### Bracelets
- À quoi ça sert : obtenir le mot de passe d'un bracelet, enregistrer une lecture, activer, consulter, gérer caution, restitution, remplacement et rendu des espèces dues.
- Endpoints principaux : `POST /media/auth-keys`, `POST /taps`, `POST /media/activations`, `POST /media/{media_id}/release`, `POST /media/{media_id}/replace`, `POST /media/{media_id}/cash-due-refunds`.
- Section du contrat : chemins `/media*`, `/taps`.

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

## Questions de nécessité/complétude posées lors de la dernière révision
- Nécessaire pour ce projet ? Voir `06-docs-status.md`.
- Complet au vu des missions mergées à ce jour ? Voir `06-docs-status.md`.
- Spécification technique (OpenAPI) toujours à jour et liée correctement ? Voir `06-docs-status.md`.
- Validé par : en attente.
