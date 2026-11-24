# Modèle de données — mission 11b

Migrations `packages/ledger-sql/migrations/0101_anomaly_classification_phone_models.sql` (écritures, WP01) et
`0102_backoffice_read_views.sql` (vues de lecture, WP02) ; noms exacts dans `interfaces.md`.
Aucun `.sql` généré ni migration existante modifiés.

## Classement d'une anomalie (existant `anomaly`, ajouts)

- Colonnes ajoutées : `classified_by uuid REFERENCES app_user(id)`, `classified_at timestamptz`,
  `classification_reason text CHECK (length between 1 and 500)`.
- Invariants :
  - classement ⇔ `status = 'RESOLVED' AND resolution_tx_id IS NULL AND classified_by IS NOT NULL` ;
  - un classement n'existe que pour les 10 types de research D1 (contrainte `CHECK` sur `kind` quand
    `classified_by IS NOT NULL`) ;
  - transition unique `OPEN → RESOLVED` ; jamais d'écriture au grand livre.
- Fonction `classify_anomaly(p_anomaly uuid, p_reason text, p_actor uuid)` `SECURITY DEFINER`, `search_path` fixé,
  `pg_temp` exclu, `EXECUTE` à `cashless_app` seulement ; codes d'erreur `CL…` nouveaux mappés sur 422 / 409.
- Droit retiré (renforcement, research D4) : `UPDATE (status, resolution_tx_id) ON anomaly` à `cashless_app`, si
  aucun usage direct ; sinon déclencheur de garde.

## Modèle de téléphone (nouvelle table de plateforme)

- `phone_model` : `manufacturer text`, `model text` (clé primaire composée, normalisés en minuscules et espaces
  réduits), `nfc_level text CHECK (nfc_level IN ('RECOMMENDED','TOLERATED'))`, `measured_at date NOT NULL`,
  `updated_by uuid`, `updated_at timestamptz`.
- Lecture : `SELECT` à `cashless_app` (donnée non cloisonnée, sans donnée personnelle). Écriture : fonctions
  `upsert_phone_model` / `delete_phone_model` exécutables par le rôle de plateforme seulement.

## Terminal (existant `device`, ajouts)

- `manufacturer text`, `model text` (facultatifs, 1 à 100 caractères, normalisés comme `phone_model`).
- Écrits par les nouvelles versions des fonctions d'enrôlement et de signal de vie ; aucun droit de colonne nouveau.
- Niveau calculé à la lecture : jointure `phone_model` → `RECOMMENDED` / `TOLERATED`, sinon `UNTESTED`.

## Lectures (vues `security_invoker`, sous RLS)

- `sale_overview` : `journal_transaction` `PURCHASE` + `sale_attribution` + commerçant (compte `MERCHANT` →
  participation) + point de vente + annulation (`REVERSAL.reverses_id`). Index à vérifier pour NFR-001 :
  `(event_id, type, occurred_at, id)` ou équivalent partiel sur `PURCHASE`.
- `anomaly_overview` : `anomaly` + événement du grand livre + `classifiable` calculé.
- Pagination : curseur opaque encodant `(occurred_at, id)` ou `(created_at, id)`.

## Audit (actions TypeScript nouvelles)

`ANOMALY_CLASSIFIED`, `PHONE_MODEL_UPSERTED`, `PHONE_MODEL_DELETED`, `STAFF_CUSTOMER_SEARCH`,
`STAFF_CUSTOMER_SEARCH_RATE_LIMITED`. Contenu : auteur, rôle, portée, objet, date ; pour la recherche par numéro,
nombre de résultats et identifiants de clients trouvés, **jamais le numéro**.

## Profil du personnel

Aucune donnée nouvelle : lecture de `app_user` et des attributions de rôle existantes de la personne connectée.
