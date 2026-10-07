# Contrat — Idempotence applicative (S21)

Sources : SPECIFICATION §10.2, §14.2 S21 ; `openapi.yaml` (conventions d'idempotence).

## En-têtes

| En-tête | Sens |
|---|---|
| `Idempotency-Key` (requête) | Obligatoire sur toute opération qui écrit ; absent → `400 IDEMPOTENCY_KEY_REQUIRED` |
| `Idempotency-Replayed: true` (réponse) | Présent uniquement quand la réponse est rejouée depuis le magasin |

## Protocole

```mermaid
sequenceDiagram
  participant C as Client
  participant I as Intercepteur
  participant DB as PostgreSQL (cashless_app)
  C->>I: requête + Idempotency-Key
  I->>DB: Tx 1 — set_config ; INSERT IN_PROGRESS (bail 60 s) ON CONFLICT DO NOTHING
  alt ligne créée (ou IN_PROGRESS expirée reprise)
    I->>DB: Tx 2 — set_config ; travail métier ; UPDATE … COMPLETED (statut, corps)
    I-->>C: réponse d'origine
  else COMPLETED, même empreinte
    I-->>C: réponse enregistrée + Idempotency-Replayed: true
  else COMPLETED ou IN_PROGRESS, autre empreinte
    I-->>C: 409 IDEMPOTENCY_KEY_REUSED
  else IN_PROGRESS non expirée, même empreinte
    I-->>C: 409 IDEMPOTENCY_KEY_IN_PROGRESS
  end
```

Règles :

1. La Tx 2 contient le travail métier **et** l'enregistrement de la réponse : les deux sont validés ensemble ou pas du
   tout.
2. Réponse 2xx et 4xx métier : enregistrée et rejouée à l'identique. Erreur 5xx : la Tx 2 est annulée, la ligne
   `IN_PROGRESS` est relâchée (bail remis à maintenant) pour permettre la reprise avec la même clé.
3. Empreinte : SHA-256 hex de `METHOD + "\n" + modèle de route + "\n" + JCS(corps)` (RFC 8785).
4. Portée : `(operator_id, scope, key)` ; `operator_id` vient du contexte authentifié.
5. Expiration : `expires_at = created_at + 24 h` (paramétrable) ; au-delà, la clé est traitée comme neuve.
6. Les écritures au grand livre restent en plus protégées par `UNIQUE (ledger_id, idempotency_key)` et
   `request_hash` de `post_transaction` (G5) ; la clé de la ligne S21 et celle du grand livre peuvent différer (le
   serveur préfixe les clés libres : `app:`, `bo:`, `pos:<client_id>:`).
