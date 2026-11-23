# Ajouts au contrat — rendu partiel en espèces (ACCEPTÉS PAR LE PORTEUR LE 23/11/2026)

Contrat partagé stable depuis le 05/11/2026 : ajouts rétrocompatibles seulement. Aucune route existante, aucun champ
existant, aucune énumération ne change. Chaque ajout est inscrit dans `tools/contract-stability/contract-baseline.json`
et admis exactement par le test de gel `contract-additions-9b.spec.ts`.

## A1 — Opération nouvelle

```yaml
/media/{media_id}/partial-cash-refunds:
  post:
    operationId: refundPartialCash
    summary: Rendre en espèces une partie du solde payé sans restituer le bracelet
    description: |
      Permis seulement si le prestataire l'autorise (`cash_partial_refund_allowed`) et si l'événement l'active
      (`cash_partial_refund_enabled`) ; sinon `422 REFUND_NOT_ALLOWED` (raison `PARTIAL_CASH_REFUND_DISABLED`).
      Terminal `TOPUP_DESK` et personne `CASHIER` ou `SUPERVISOR` de l'événement ; session de caisse `OPEN` du
      terminal (`409 CONFLICT_STATE` sinon). Le bracelet est lu (`tap_id` valide) et reste actif. Montant débité du
      solde payé (brut) ; espèces remises = montant − frais de `refund_policy`. Crédits offerts et caution inchangés.
      Seconde personne (`X-Approval-Token`) quand le cumul du jour UTC des rendus partiels du portefeuille (tous bracelets), montant compris,
      dépasse `event.cash_refund_single_max`. Indisponible pendant `EDGE` (`409 DEBIT_AUTHORITY_EDGE`).
    security: [{ deviceMtls: [], deviceToken: [], deviceSignature: [], staffBearer: [] }]
    parameters: [MediaId, IdempotencyKey (obligatoire), ApprovalToken, DeviceRequestId, SignatureInput, Signature,
                 ContentDigest, AcceptLanguage]
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            additionalProperties: false
            required: [tap_id, amount]
            properties:
              tap_id: { type: string, format: uuid }
              amount: { type: integer, format: int64, minimum: 1, description: Montant débité, unités mineures }
    responses:
      '201': PartialCashRefund { transaction_id, media_id, wallet_id, amount_debited, fee, cash_handed,
             paid_balance_after, day_cumulative, approved_by (nullable), cash_session_id }
      '403': APPROVAL_REQUIRED, APPROVAL_INVALID, FORBIDDEN
      '409': CONFLICT_STATE, DEBIT_AUTHORITY_EDGE, MEDIA_STATE_INVALID
      '422': REFUND_NOT_ALLOWED, AMOUNT_OUT_OF_RANGE, INSUFFICIENT_FUNDS, VALIDATION_FAILED
```

## A2 — Propriété facultative d'événement

`cash_partial_refund_enabled: boolean` ajoutée à `Event` (lecture, **hors** `required`) et à `EventUpdate` (clé de
l'`ORGANIZER_ADMIN`). Activer quand le prestataire n'autorise pas : `422 VALIDATION_FAILED`, violation de règle
`operator.cash_partial_refund_allowed`.

## A3 — Clé de cascade (description seulement)

`cash_partial_refund_allowed` (niveau `OPERATOR`, `OPERATOR_ADMIN`, défaut `false`) mentionnée dans la description de
`createOperatorConfigVersion` et de `getResolvedEventConfig` ; la carte `settings` est déjà ouverte : aucun schéma ne
change.
