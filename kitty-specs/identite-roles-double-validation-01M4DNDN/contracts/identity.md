# Contrat — Authentification, personnes, rôles et portées

## Jeton d'accès

- En-tête `Authorization: Bearer <JWT>` (schéma `humanBearer` du contrat).
- Vérifié : signature par la JWKS du serveur d'identité (`OIDC_JWKS_URI`), `iss` = `OIDC_ISSUER`, `aud` contient
  `OIDC_AUDIENCE`, `exp` présent et non dépassé (tolérance 10 s), `nbf` respecté s'il existe, algorithme `RS256`
  ou `ES256`.
- `identify_person(iss, sub)` → personne `ACTIVE` ; sinon `401 UNAUTHENTICATED`.
- Claim `operator_id` facultatif : s'il est présent et différent du prestataire de la personne → `401`.
- Claim `roles` : ignoré (les rôles viennent de la base).
- Clés publiques injoignables → `503 SERVICE_UNAVAILABLE`.
- Routes publiques : `GET /v1/health` uniquement.

## Prestataire de la transaction

| Personne | Route sans prestataire dans le chemin | Route `/operators/{operator_id}/…` |
|---|---|---|
| D'un prestataire | son prestataire | son prestataire si égal au chemin, sinon `404 NOT_FOUND` |
| De la plateforme (`PLATFORM_ADMIN`) | aucune donnée de prestataire accessible | le prestataire du chemin |

## Rôles et portées

Décorateur `@Roles(['OPERATOR_ADMIN', …], { scope: <résolveur de l'objet visé> })`. Accès si la personne a un des
rôles sur la portée de l'objet ou une portée englobante :

```
PLATFORM ⊃ OPERATOR ⊃ ORGANIZER ⊃ EVENT
OPERATOR ⊃ MERCHANT ;  EVENT ⊃ MERCHANT (commerçant participant à l'événement)
```

Refus : `403 FORBIDDEN`. Objet d'un autre prestataire : `404 NOT_FOUND` (identique à inexistant).

## Attribution des rôles

| Attribué par | Peut attribuer |
|---|---|
| `PLATFORM_ADMIN` | `PLATFORM_ADMIN` (plateforme), `OPERATOR_ADMIN` (prestataire) |
| `OPERATOR_ADMIN` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`, `MERCHANT_ADMIN` dans son prestataire |
| `ORGANIZER_ADMIN` | `SUPERVISOR`, `CASHIER` sur ses événements ; `MERCHANT_ADMIN` sur les commerçants participant à ses événements |

Jamais à soi-même. `VENDOR`, `CUSTOMER` : non attribuables dans cette mission.

## Amorçage

`npm run bootstrap-admin -w @cashless/ledger-sql -- --issuer <iss> --subject <sub> --name <nom> [--email <e-mail>]`
(rôle propriétaire) : crée la personne de plateforme et son attribution `PLATFORM_ADMIN` si absentes, écrit une
ligne d'audit `PLATFORM_ADMIN_BOOTSTRAPPED` ; relancée, ne crée rien.
