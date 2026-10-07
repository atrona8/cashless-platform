# Contrat — Traduction SQLSTATE → ProblemCode

Source normative : SPECIFICATION §5.7 ; énumération `ProblemCode` de `packages/contracts/openapi.yaml`.
La traduction lit **uniquement** le SQLSTATE (`err.code`) ; le texte du message SQL n'est jamais renvoyé.

| SQLSTATE | ProblemCode | HTTP |
|---|---|---|
| `CL001` | `VALIDATION_FAILED` | 422 (donnée bien formée refusée par la base ; 400 réservé aux requêtes mal formées détectées par l API) |
| `CL002` | `IDEMPOTENCY_KEY_REUSED` | 409 |
| `CL003` | `LEDGER_LOCKED` | 409 |
| `CL004` | `EVENT_CLOSING` | 409 |
| `CL005` | `PERIOD_CLOSED` | 409 |
| `CL006` | `DEBIT_AUTHORITY_EDGE` | 409 |
| `CL007` | `INSUFFICIENT_FUNDS` | 422 |
| `CL008` | `WALLET_LIMIT_EXCEEDED` | 422 |
| `CL009` | `MONTHLY_TOPUP_LIMIT_EXCEEDED` | 422 |
| `CL010` | `BATCH_IN_PROGRESS` | 409 |
| `CL011` | `BATCH_TOO_LARGE` | 413 |
| `CL012` | `SEQ_GAP_NOT_FOUND` | 409 |
| `CL013` | `HANDOVER_INVALID_STATE` | 409 |
| `CL014` | `EDGE_NOT_CAUGHT_UP` | 409 |
| `CL015` | `STALE_AUTHORITY_EPOCH` | 409 |
| `CL016` | `SEQ_OUT_OF_ORDER` | 409 |
| `CL017` | `CHAIN_BROKEN` | 409 |
| `CL018` | `EVENT_TRANSITION_INVALID` | 409 |
| `CL019` | `CLOSING_CONDITION_NOT_MET` | 409 |
| `CL020` | `MEDIA_STATE_INVALID` | 409 |
| `CL021` | `SEQ_OUT_OF_RANGE` | 409 |
| `CL022` | `TAP_UNUSABLE` | 409 |
| `CL023` | `APPROVAL_INVALID` | 409 |
| `CL024` | `LATE_CLAIM_INVALID` | 409 |
| `P0002` | `NOT_FOUND` | 404 (aucun détail ; identique à « n'existe pas ») |
| `42501` | `DEVICE_REVOKED` | 403 (seul usage prévu en V1 ; tout autre `42501` → `INTERNAL_ERROR` journalisé) |
| `23514` | `FORBIDDEN` (contraintes de double validation) / `VALIDATION_FAILED` (autres) | 403 / 422 |
| `P0001` | `INTERNAL_ERROR` | 500 |
| autre / erreur non SQL | `INTERNAL_ERROR` | 500 |

Statuts HTTP repris de la description de `ProblemCode` dans `openapi.yaml` (vérifié le 2026-10-07). Un test
compare cette table à cette description ; en cas d'écart, le contrat fait foi (§0.3).

## Forme de la réponse

```json
{
  "type": "https://errors.cashless/INSUFFICIENT_FUNDS",
  "title": "Solde insuffisant",
  "status": 422,
  "detail": "Le solde disponible ne couvre pas le montant demandé.",
  "code": "INSUFFICIENT_FUNDS",
  "instance": "<X-Request-Id>"
}
```

`Content-Type: application/problem+json`. `title`/`detail` selon `Accept-Language` (`fr` défaut, `en`) ; `code` et
`status` ne dépendent jamais de la langue. Le préfixe de `type` est un paramètre de configuration.
