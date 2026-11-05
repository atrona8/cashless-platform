# Contrat : conformité, conflits, temps

Sources : `sync_protocol.md` §7.2 à §7.5 ; SPECIFICATION §9.6 ; research R-12, R-15, R-16.

## Conformité (toute opération, sauf `online_status = CONFIRMED` dont la transaction en ligne existe — R-30.1)

Ordre ; premier échec rapporté dans `reject_reason`, les autres dans `detail` ; résultat `REJECTED`, rien d'écrit,
anomalie `NON_COMPLIANT_OPERATION` (montant, `loss_bearer` selon `provided_by`).

| # | Contrôle | Raison |
|---|---|---|
| 1 | devise du portefeuille = devise de l'événement | `CURRENCY_MISMATCH` |
| 2 | terminal `ACTIVE` à `occurred_at_corrigé` (`device_status_at`) ; `offline_enabled` de la configuration détenue ; session de vendeur ouverte et non expirée à cette heure | `OFFLINE_NOT_ALLOWED` (détail `DEVICE_SUSPENDED`, `DEVICE_REVOKED`, `VENDOR_SESSION`) |
| 3 | `config_id` = dernière configuration servie à ce terminal avec `served_at ≤ occurred_at_corrigé + tol` ; `max_per_sale` ; cumul par bracelet ; cumul par terminal | `POLICY_LIMIT_EXCEEDED` |
| 4 | `snapshot_version` inscrite avant `occurred_at_corrigé + tol`, enveloppée pour ce terminal, et ≥ dernière version accusée avant `occurred_at_corrigé − tol` | `SNAPSHOT_VERSION_UNKNOWN` |
| 5 | âge ≤ `min(max_snapshot_age, valid_until − generated_at) + tol` | `SNAPSHOT_TOO_OLD` |
| 6 | bracelet présent dans le snapshot utilisé (`offline_media_state_at`) | `MEDIA_NOT_IN_SNAPSHOT` |
| 7 | bracelet, lot, portefeuille utilisables dans ce snapshot | `MEDIA_BLOCKED_IN_SNAPSHOT` |
| 8 | lot du bracelet de cet événement | `MEDIA_WRONG_EVENT` |
| 9 | `tap.pack_verified` | `PACK_NOT_VERIFIED` |
| 10 | annulation : cible de ce terminal, non annulée | `REVERSAL_TARGET_NOT_FOUND`, `ALREADY_REVERSED` |

**Exposition** (porteur ; R-30.3) : cumul = montants des `PURCHASE` du terminal (et du bracelet pour le plafond par
bracelet) de numéro inférieur, non rejetées, non `VOID`, moins leurs annulations, dont le résultat n'a pas été rendu
avant `min(occurred_at_corrigé, received_at du lot) − 120 s` (rendu = `offline_batch.completed_at` du lot qui l'a
portée, ou `recorded_at` du registre pour le canal `ONLINE`) ; plus le montant de l'opération.

`CONFIRMED` introuvable : `ONLINE_CONFIRMED_MISSING`, puis conformité complète.

## Période (toute opération, `CONFIRMED` comprise ; terminal non fautif)

| Contrôle | Raison | Anomalie |
|---|---|---|
| `occurred_at_corrigé ≤ ledger.locked_until` | `PERIOD_CLOSED` | `PERIOD_CLOSED_OPERATION` |
| grand livre `LOCKED` | `LEDGER_LOCKED` | `PERIOD_CLOSED_OPERATION` |
| vente ou annulation, événement `SETTLING` ou après | `SYNC_DEADLINE_PASSED` | `LATE_OFFLINE_SYNC` (montant ; commerçant garanti par le back-office) |

`CLOSING`, `RECONCILING` : ventes acceptées.

## Temps (§7.4, tolérance 120 s)

- `recorded_at` = `offline_batch.received_at` (heure d'approbation pour un import) pour toutes les opérations du lot.
- `occurred_at > recorded_at + tol` → `occurred_at_corrigé = recorded_at`, `CLOCK_SKEW`.
- `occurred_at < generated_at(snapshot) − tol` → `occurred_at_corrigé = generated_at`, `CLOCK_SKEW`.
- Dates décroissantes entre numéros (au-delà de `tol`) → `CLOCK_SKEW`, résultat inchangé.
- Original dans `journal_transaction.metadata.device_occurred_at`.

## Table de conflit (§7.3)

`t_blocage` = dernière entrée bloquante de `media_status_history`, `media_batch_status_history`,
`wallet_status_history` ; inconnue → bloqué avant la vente (manque entier). `solde` = PAID + PROMO lu sous verrou.

| Situation (`register_tap` hors ligne) | couvert | manque | statut / raison du manque |
|---|---|---|---|
| `OK`, solde ≥ montant | montant | 0 | `ACCEPTED` |
| `OK`, solde < montant | solde | reste | `ACCEPTED_WITH_SHORTFALL` / `INSUFFICIENT_FUNDS` |
| bloqué, `occurred_at_corrigé < t_blocage + tol` | min(solde, montant) | reste | comme ci-dessus |
| bloqué après, snapshot antérieur au blocage | 0 | montant | `…_WITH_SHORTFALL` / `MEDIA_BLOCKED_AFTER_SNAPSHOT` |
| `CLONE_SUSPECTED` (et identité retirée) | 0 | montant | `MEDIA_CLONE_SUSPECTED` |
| `UID_MISMATCH` | 0 | montant | `MEDIA_UID_MISMATCH` |
| `SIGNATURE_MISMATCH` (liste noire) | 0 | montant | `MEDIA_SIGNATURE_MISMATCH` |
| signature absente, puce signée | inchangé | inchangé | anomalie `SIGNATURE_MISMATCH` en plus |
| portefeuille `BLOCKED`/`CLOSED` | 0 | montant | `WALLET_BLOCKED` |
| `UNKNOWN`, `NOT_ACTIVATED` | — | — | `REJECTED MEDIA_NOT_IN_SNAPSHOT` |
| `WRONG_EVENT` | — | — | `REJECTED MEDIA_WRONG_EVENT` |

Manque > 0 → anomalie `OFFLINE_SHORTFALL` (montant, transaction). Commerçant toujours crédité du montant total.
Transaction 22 du scénario : `L-WAL-W04-P +6000`, `S-ATTENTE +3000`, `L-MCH-FOOD −9000`, `+1080`, `L-ORG-COM −915`,
`L-ORG-TVA −165`.
