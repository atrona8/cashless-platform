# Interfaces partagées entre lots

Fichier commun lu par chaque lot, pour éviter que chaque agent relise tout. Signatures cibles ; un lot qui doit en
changer une le signale dans `docs/passation-9a/suivi-lots.md`.

## Base (`packages/ledger-sql/migrations/0081_refund_requests.sql`)

```sql
-- Table : voir data-model.md. Statuts : AWAITING_HOLDER, REQUESTED, PROCESSING, PAID, FAILED, REJECTED, CANCELLED, BLOCKED.
refund_request_operator(p_refund_request uuid) RETURNS uuid          -- SECURITY DEFINER, search_path = public, pg_temp
promote_due_refund_requests() RETURNS integer                         -- SECURITY DEFINER ; cashless_app, cashless_maint
-- otp_challenge : + purpose text NOT NULL DEFAULT 'LOGIN' CHECK (purpose IN ('LOGIN','REFUND_HOLDER')), + subject_id uuid NULL
-- post_transaction : INCHANGÉE (la base ne lit que ledger.status ; la matrice par statut d'événement est celle du moteur)
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

## Répartition des fichiers entre lots (fait foi sur les prompts)

| Lot | Fichiers possédés | Migration |
|---|---|---|
| WP01 Base des demandes | `packages/ledger-sql/migrations/0081_refund_requests.sql`, `post-roles.sql` (section 11 seulement), `tests/tests_refund_requests.sql`, mises à jour des listes figées dans `tests/tests_execute_grants.sql`, `tests_offline_rights.sql` | `0081` |
| WP02 Recrédit d'un échec (moteur) et espèces dues remplacées | `migrations/0082_replace_media_cash_due.sql`, `tests/tests_replace_cash_due.sql`, `apps/api/src/ledger/status-matrix.ts`, `apps/api/src/ledger/ledger-engine.service.ts` (`checkStatus` reçoit le type contre-passé), `apps/api/test/unit/ledger/status-matrix-refund-reversal.spec.ts`, `apps/api/test/integration/ledger/refund-reversal-matrix.spec.ts` | `0082` |
| WP03 Codes du titulaire et destination | `apps/api/src/customer-auth/customer-auth.service.ts` (extraction `verifyChallenge`/`issueChallenge`), `apps/api/src/refunds/destination.ts`, `refunds/holder-challenge.service.ts`, `refunds/holder-decision.controller.ts`, `refunds/refunds-holder.module.ts`, `customer-auth/customer-auth.module.ts` (export du service), `apps/api/src/processes/maintenance*` (tâche d'échéance), tests `apps/api/test/integration/refunds/holder*.spec.ts`, `test/integration/customer-auth/verify-challenge.spec.ts` | — |
| WP04 Création, éligibilité, listes, refus | `apps/api/src/refunds/refunds.module.ts`, `refund-eligibility.ts`, `refund-requests.service.ts`, `my-refund-requests.controller.ts`, `refund-requests.controller.ts` (liste, refus), `refund-requests.dto.ts`, `apps/api/src/customer-app/me.service.ts`, `app.module.ts` (import du module), tests `test/integration/refunds/create*.spec.ts`, `list*.spec.ts`, `reject*.spec.ts`, `test/integration/customer-app/me-refund.spec.ts` | — |
| WP05 Approbation à deux et confirmation | `apps/api/src/refunds/wallet-refund-action.ts`, `refunds/refund-confirm.service.ts`, `refunds/refund-approve.controller.ts` (approve, confirm), `apps/api/src/ledger/builders/festival/refund.ts`, `apps/api/src/debit-authority/debit-paths.ts`, `apps/api/test/integration/debit-authority/{debit-cases.ts,debit-paths-refused.spec.ts}`, tests `test/integration/refunds/approve*.spec.ts`, `confirm*.spec.ts` | — |
| WP06 Guichet de retour enchaîné | `apps/api/src/media/lifecycle/release.controller.ts`, `release.service.ts`, `lifecycle.dto.ts`, `media/lifecycle/return.module.ts`, tests `test/integration/media/release-chaining*.spec.ts`, `test/integration/media/release.spec.ts` (refus provisoire retiré), `test/integration/media/cash-due-after-replace.spec.ts` | — |
| WP07 Preuves, mesures et consignation | `apps/api/test/integration/refunds/journey*.spec.ts`, `concurrency*.spec.ts`, `refund-latency.spec.ts`, `docs/POINTS_OUVERTS.md`, `docs/DECISIONS_ADR.md`, `PROMPTS-A-ENVOYER.md`, `PRD.md`, `tools/export/files/REPONSE-ENDPOINTS-FESTIVALIER.md` | — |

Retouches hors carte permises (une ligne de justification chacune dans le compte rendu) :

- `apps/api/src/refunds/refunds.module.ts` : WP03 et WP05 y déclarent leurs fournisseurs et contrôleurs (WP04 le crée
  en premier : WP03 n'en dépend pas pour ses tests, il enregistre son contrôleur après fusion de WP04 ou via son
  propre module `refunds-holder.module.ts` importé par `refunds.module.ts`).
- `AuditAction` : ajouts en fin d'union, une ligne par valeur, par le lot qui les émet.
- `apps/api/src/http/messages.*.json` : aucun ajout attendu (codes déjà au catalogue) ; un ajout se signale.

## Noms figés

- Module : `RefundsModule` (`refunds/refunds.module.ts`) ; `RefundsHolderModule` (WP03).
- Service partagé de destination (WP03, appelé par WP04) :

```ts
// refunds/destination.ts
export interface ResolvedDestination {
  method: 'WAVE' | 'ORANGE_MONEY';
  msisdn: string;
  newNumber: boolean;
  holderPhone: string | null;        // numéro vérifié du titulaire, s'il existe
}
export async function resolveDestination(
  client: TxClient, input: { operatorId: string; walletId: string; customerId: string;
    destination: RefundRequestCreate['destination'] },
  verify: CustomerAuthService['verifyChallenge'],
): Promise<ResolvedDestination>;     // BANK_TRANSFER → REFUND_NOT_ALLOWED ; autre numéro sans code → REFUND_NOT_ALLOWED
// refunds/holder-challenge.service.ts
startHolderChallenge(client: TxClient, refundRequestId: string, holderPhone: string): Promise<void>;
```

- Action d'approbation : `action = 'WALLET_REFUND'`, `target_id = refund_request.id`.
- Clés de grand livre : `bo:<Idempotency-Key>` (approbation exécutée et `REVERSAL`) ; guichet : clés existantes
  `deposit-refund:…`, `promo-expiry:<wallet>:<n° de rattachement>`, `release-refund:<media>:<n° de rattachement>`
  pour le `WALLET_REFUND` en espèces, `release-cash-due:<media>:<n° de rattachement>` pour le rendu des espèces dues.

## Arbitrages de l'orchestrateur après rédaction des prompts (13/11/2026)

- La base n'applique pas la matrice par statut d'événement (`post_transaction` ne lit que `ledger.status`) : la
  décision 5 se réalise dans `status-matrix.ts` et `checkStatus` du moteur ; `post_transaction` n'est pas modifiée ;
  après verrouillage du grand livre (`LOCKED`), réclamations tardives (9b).
- `createMyRefundRequest` : portefeuille inconnu ou d'un autre festivalier → `422 REFUND_NOT_ALLOWED` (le contrat ne
  déclare pas `404` sur cette route).
- Décision 6 appliquée au code : `wallet.status` ≠ `ACTIVE` → refus ; bracelet `BLACKLISTED` → refus ; bracelet
  `SUSPENDED` (perte déclarée, `lost-media.service.ts` ne bloque pas le portefeuille) → permis.
- Code du nouveau numéro vérifié et consommé dans la même transaction que la création. Un code vivant par (numéro,
  usage, sujet) pour `REFUND_HOLDER`. `verifyChallenge` reçoit aussi `operatorId`. `exchangeIn` impose `LOGIN`.
  Les tests lisent les codes par un `OtpSender` d'enregistrement (aucun en-tête `X-Test-Otp-Code` sur la création).
- `REVERSAL` de `confirmRefundRequest` (`FAILED`) : auteur = la personne qui confirme ; valideur = `approved_by` de la
  demande, ou `requested_by` de l'approbation d'origine si c'est la même personne que celle qui confirme.
- Guichet : `cash_to_hand_back` = caution en espèces + (solde payé − frais) + espèces dues ; seuil
  `cash_refund_single_max` comparé (`>`) au montant brut du `WALLET_REFUND` du solde payé ; `attach_cash_tx` après
  l'écriture en espèces ; montant offert nul : étape `PROMO_EXPIRY` sautée.
- Date limite effective nulle (ni `refund_deadline` ni `ends_at`) : fenêtre close.
- Preuves : chaque lot note « critère → commande → résultat » dans `docs/passation-9a/suivi-lots.md` ; WP07 en tire
  `acceptance-matrix.json`.
