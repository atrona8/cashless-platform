# Data Model: Remboursement partiel en espèces au guichet

## Réglages

| Élément | Stockage | Type | Défaut | Réglé par | Règle |
|---|---|---|---|---|---|
| `cash_partial_refund_allowed` | `config_version.settings`, niveau `OPERATOR` | booléen | `false` | `OPERATOR_ADMIN` | Autorise ses organisateurs à activer la fonction |
| `cash_partial_refund_enabled` | colonne `event` (migration 0100), `NOT NULL DEFAULT false` | booléen | `false` | `ORGANIZER_ADMIN` | Ne passe à `true` que si l'autorisation résolue du prestataire est `true` (règle croisée, `422`) |

La fonction est permise pour un rendu si et seulement si les deux valeurs résolues au moment du rendu sont `true`.

## Rendu partiel (écriture existante, marquée)

Pas de table nouvelle. Un rendu partiel est une transaction `WALLET_REFUND` du grand livre de l'événement :

- montant brut débité du compte `WALLET_PAID` du portefeuille du bracelet ; frais selon `refund_policy` ; net crédité
  sur le compte de caisse de la session (`moneyAccount = session.code`) ;
- clé d'idempotence `partial-refund:<media_id>:<Idempotency-Key>` ;
- `metadata` : `{ "cash_session_id": <uuid>, "partial_cash_refund": true, "media_id": <uuid> }` ;
- `created_by` = caissier ; `approved_by` = seconde personne si le cumul du jour dépasse le seuil ;
- rattachée à la session par `attach_cash_tx` (comptée à la fermeture) ;
- ligne d'audit (auteur, valideur, montant, frais, terminal, session).

## Invariants

- Montant demandé > 0, ≥ `refund_policy.minimum_amount`, ≤ solde payé lu sous verrou.
- Crédits offerts (`WALLET_PROMO`) et caution (`media.deposit_status`, `deposit_held`) inchangés.
- Bracelet `ACTIVE` avant et après ; rattachement inchangé.
- Cumul du jour (UTC) des rendus partiels du bracelet + montant demandé > `cash_refund_single_max` ⇒ seconde personne
  distincte de l'auteur.
- Ordre des verrous : bracelet, puis soldes payés des portefeuilles par identifiant (comme `releaseMedia`).
