# Interfaces partagées entre lots

Fichier commun lu par chaque lot, pour éviter que chaque agent relise tout. Signatures cibles ; un lot qui doit en
changer une le signale dans `docs/passation-9a/suivi-lots.md`.

## Base (`packages/ledger-sql/migrations/0081_refund_requests.sql`)

```sql
-- Table : voir data-model.md. Statuts : AWAITING_HOLDER, REQUESTED, PROCESSING, PAID, FAILED, REJECTED, CANCELLED, BLOCKED.
refund_request_operator(p_refund_request uuid) RETURNS uuid          -- SECURITY DEFINER, search_path = public, pg_temp
promote_due_refund_requests() RETURNS integer                         -- SECURITY DEFINER ; cashless_app, cashless_maint
-- otp_challenge : + purpose text NOT NULL DEFAULT 'LOGIN' CHECK (purpose IN ('LOGIN','REFUND_HOLDER')), + subject_id uuid NULL
-- post_transaction : garde de statut, REVERSAL accepté si reverses_id → WALLET_REFUND et source = 'BACKOFFICE'
-- replace_media : réattribue les anomalies CASH_TOPUP_OVER_LIMIT ouvertes au bracelet neuf
```

## API (`apps/api/src`)

```ts
// refunds/refund-eligibility.ts
export interface RefundEligibility {
  eligible: boolean;
  reason?: 'WINDOW_CLOSED' | 'NOT_ALLOWED';
  deadline: string | null;          // date limite effective (ISO)
  paid: bigint;                     // solde payé
  fee: bigint;                      // règle PER_REFUND (absente : erreur 422 levée par le résolveur)
  estimatedAmount: bigint;          // paid - fee
}
export function evaluateRefundEligibility(
  client: TxClient, walletId: string, at: Date,
): Promise<RefundEligibility>;    // fenêtre, statut d'événement, R-04 (blocages), solde payé > 0, frais < solde

// customer-auth/customer-auth.service.ts
verifyChallenge(input: {
  otpRequestId: string; code: string; expectedPhone: string;
  purpose: 'LOGIN' | 'REFUND_HOLDER'; subjectId?: string;
}): Promise<void>;                 // verrou par numéro, temps constant, essais/blocage, consomme ; aucun jeton
issueChallenge(input: {
  operatorId: string; phone: string; purpose: 'REFUND_HOLDER'; subjectId: string;
}): Promise<{ otpRequestId: string; expiresIn: number; code: string }>; // code rendu seulement au faux (tests)

// refunds/wallet-refund-action.ts : ApprovalActionDefinition<'WALLET_REFUND'>
// payload : { refund_request_id, ledger_id, event_id, operator_id, idempotency_key: `bo:${key}`, note? }
// ledger/builders/festival/refund.ts : moneyAccount 'A-PSP-WAVE' | 'A-PSP-OM' | `A-CAISSE-…` (guichet)
```

## Règles transverses

- Clés d'idempotence du back-office : préfixe `bo:` (§10.2).
- Erreurs : uniquement les codes déjà au catalogue (`packages/contracts/generated/problem-codes.ts`).
- Lignes de 100 caractères, Prettier du dépôt ; commentaires en français.
- Tests en série par l'orchestrateur sur la base partagée ; les lots prennent leur base `cashless_wpXX` avec **toutes**
  les `DATABASE_URL_*` posées (mémoire du poste).
