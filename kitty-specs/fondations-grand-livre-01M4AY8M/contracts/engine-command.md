# Contrat — Commande d'écriture et constructeurs

Interface interne de `apps/api/src/ledger/` (pas une route HTTP). Sources : SPECIFICATION §5.3 à §5.5.

## Commande (`LedgerCommand`)

| Champ | Type | Obligatoire | Note |
|---|---|---|---|
| `type` | `TransactionType` (26 valeurs) | oui | Liste fermée de §5.3 |
| `idempotencyKey` | string | oui | Écrite telle quelle dans `journal_transaction.idempotency_key` |
| `occurredAt` | instant UTC | oui | Heure réelle ; sert à figer la configuration |
| `source` | `ONLINE` \| `OFFLINE_SYNC` \| `EDGE_SYNC` \| `PSP_WEBHOOK` \| `BATCH` \| `BACKOFFICE` | oui | |
| `ledgerId`, `eventId` | uuid | oui / selon type | |
| `currency` | ISO 4217 | oui | Refus `VALIDATION_FAILED` si ≠ devise du grand livre |
| `payload` | union discriminée par `type` | oui | Montant brut `bigint`, portefeuille, participation, canal PSP, etc. |
| `deviceId`, `mediaId` | uuid | non | |
| `reversesId` | uuid | `REVERSAL` seulement | |
| `createdBy`, `approvedBy` | uuid | `BACKOFFICE` seulement | Distincts, sinon `VALIDATION_FAILED` |
| `metadata` | objet JSON | non | `device_occurred_at`, champs `EDGE_SYNC` (`origin_key`, `origin_occurred_at`, `origin_mode`) |

## Contexte fourni au constructeur (`BuildContext`)

`config` (règles de frais résolues, taux de taxe, contrat, `configVersionId`) via `ConfigResolver` ; `accounts`
(résolution `purpose` + titulaire → id de compte) ; `balances` (seulement pour la répartition offerts/payés et les
ventes hors ligne) ; `original` (lignes de la transaction contre-passée, pour `REVERSAL`).

## Sortie

Constructeur pur : `Line[]` avec `{ accountId, amount: bigint (débit +, crédit −), memo }`, dans l'ordre d'écriture.
Invariants vérifiés par le service avant l'appel (et de nouveau par la base) : ≥ 2 lignes, somme = 0, aucun montant
nul.

Service : `{ transactionId, replayed: boolean }` ou une erreur portant un `ProblemCode`.

## Types délégués à la base

| Type (cas) | Fonction appelée | Paramètres |
|---|---|---|
| `DEPOSIT_TAKEN` | `take_deposit(media, money_account?)` | compte d'encaissement en mode `SEPARATE` |
| `DEPOSIT_REFUNDED` | `refund_deposit(media, money_account?)` | idem |
| `DEPOSIT_FORFEITED` | `forfeit_deposit(media)` | — |
| `WALLET_REFUND` (espèces dues) | `refund_cash_due(media, cash_account, key, actor, …)` | clé = `Idempotency-Key` de la requête |
| `PROMO_CREDIT` (préchargement de lot) | `preload_media(media)` | — |

Tous les autres cas de ces types (par exemple `PROMO_CREDIT` offert au personnel, `WALLET_REFUND` du solde payé)
passent par un constructeur de lignes.
