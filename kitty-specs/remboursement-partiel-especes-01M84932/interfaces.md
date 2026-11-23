# Interfaces communes — mission 9c (rendu partiel en espèces au guichet)

Ce fichier fait foi sur tout prompt de lot, `research.md` et `data-model.md` pour les noms, signatures, propriétaires
et codes. Un manque ou une contradiction se signale dans la note de lane, jamais tranché en silence.

## Noms figés

| Nom | Nature | Propriétaire |
|---|---|---|
| `event.cash_partial_refund_enabled` | colonne `boolean NOT NULL DEFAULT false` | WP01 (migration `0100_event_cash_partial_refund.sql`) |
| `cash_partial_refund_allowed` | clé de cascade, niveau `OPERATOR` seul, `boolean`, défaut `false`, réglée par `OPERATOR_ADMIN` | WP03 (`settings-catalog.ts`) |
| `cash_partial_refund_enabled` | colonne du catalogue (`EVENT_COLUMN`), `boolean`, défaut `false`, réglée par `ORGANIZER_ADMIN` | WP03 |
| règle croisée `operator.cash_partial_refund_allowed` | `422 VALIDATION_FAILED`, violation `{field: 'cash_partial_refund_enabled', rule: 'operator.cash_partial_refund_allowed'}` quand on passe l'événement à `true` alors que l'autorisation résolue est `false` | WP03 (`bounds-validator.ts`) |
| `refundPartialCash` | opération `POST /media/{media_id}/partial-cash-refunds` | WP02 (contrat), WP05 (code) |
| `PartialCashRefundCreate`, `PartialCashRefund` | schémas du contrat | WP02 |
| `metadata.partial_cash_refund = true` | marque d'un `WALLET_REFUND` de rendu partiel | WP05 écrit, WP04 lit |
| clé d'idempotence d'écriture | `partial-refund:<media_id>:<Idempotency-Key>` | WP05 |
| raison de refus `PARTIAL_CASH_REFUND_DISABLED` | `reason` dans le détail d'un `422 REFUND_NOT_ALLOWED` (pas un nouveau code) | WP05 |

## Module du seuil (WP04 → WP05)

Fichier `apps/api/src/media/lifecycle/partial-refund-threshold.ts` :

```ts
/** Somme brute des rendus partiels du portefeuille depuis 00:00 UTC du jour de `now`, tous bracelets. */
export async function partialRefundDayTotal(
  client: TxClient, walletId: string, now: Date,
): Promise<bigint>;

/**
 * Décide la seconde personne : `total + amount > limit` (comparaison stricte, ADR-190).
 * Appelée APRÈS `lockWalletPaidBalance` du portefeuille (ADR-195). Renvoie l'identifiant du valideur si un jeton
 * était exigé et a été consommé, `null` sinon ; lève `403 APPROVAL_REQUIRED` si exigé et `approve` est `null`.
 */
export async function requireApprovalOverDailyCumul(
  client: TxClient,
  input: { walletId: string; amount: bigint; limit: bigint; now: Date },
  approve: ((client: TxClient) => Promise<string>) | null,
): Promise<{ dayTotal: bigint; approvedBy: string | null }>;
```

La lecture porte sur `journal_transaction` (`type = 'WALLET_REFUND'`, `metadata->>'partial_cash_refund' = 'true'`,
`recorded_at >= date_trunc('day', now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`), jointe à `posting` sur le compte
`WALLET_PAID` du portefeuille (index existant `posting (account_id, id)`). Montant brut = débit de ce compte. Heure
serveur (`recorded_at`), jamais l'heure du terminal.

## Service et route (WP05)

- `apps/api/src/media/lifecycle/partial-refund.controller.ts` : `@Controller('media/:media_id')`, `@Post('partial-cash-refunds')`,
  `@HttpCode(201)`, mêmes décorateurs que `release` (`RequiresOnsiteApproval({operationId: 'refundPartialCash', role:
  'SUPERVISOR', optional: true, scope: événement du terminal})`, `CounterAuth`, `Idempotent({scope: counterScope})`).
- `apps/api/src/media/lifecycle/partial-refund.service.ts` : `PartialRefundService.refund(client, actor, mediaId, amount,
  language, approve)`. Ordre : bracelet `FOR UPDATE`, statut `ACTIVE`, portefeuille du grand livre du terminal,
  réglages résolus (les deux à `true`), session de caisse `OPEN`, `lockWalletPaidBalance`, contrôle du montant,
  `requireApprovalOverDailyCumul`, `WALLET_REFUND` par le moteur (frais de `refund_policy`), `attach_cash_tx`, audit.
- Inscription dans `return.module.ts` ou `lifecycle.module.ts` (une ligne, hors carte signalée si le module n'est pas au lot).

## Codes de réponse (aucun code nouveau)

| Cas | Réponse |
|---|---|
| Fonction non autorisée ou non activée | `422 REFUND_NOT_ALLOWED`, `reason: PARTIAL_CASH_REFUND_DISABLED` |
| Montant ≤ frais, < `minimum_amount` ou ≤ 0 | `422 AMOUNT_OUT_OF_RANGE` |
| Montant > solde payé | `422 INSUFFICIENT_FUNDS` |
| Seconde personne requise / jeton refusé | `403 APPROVAL_REQUIRED` / `403 APPROVAL_INVALID` |
| Pas de session `OPEN` du terminal | `409 CONFLICT_STATE` |
| Autorité de débit sur la passerelle | `409 DEBIT_AUTHORITY_EDGE` |
| Bracelet non `ACTIVE`, passage d'un autre bracelet | mêmes refus que `releaseMedia` (`counterRefusal`) |
| Portefeuille bloqué ou clôturé | `422 WALLET_BLOCKED` (même code que le paiement) |

## Réponse `201` (`PartialCashRefund`)

`{ transaction_id, media_id, wallet_id, amount_debited, fee, cash_handed, paid_balance_after, day_cumulative,
approved_by (nullable), cash_session_id }`, montants en unités mineures (entiers).

## Numéros réservés

Migration `0100` ; ADR-233 ; points ouverts à partir d'OP-N173 (OP-N170 et OP-N171 réservés au back-office).
