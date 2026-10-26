# Contrat : droits de la base (`post-roles.sql`)

Règle du projet : `roles.sql` (kit) rend `SELECT`, `INSERT`, `UPDATE` sur toute table et `EXECUTE` sur toute fonction ;
`post-roles.sql` retire puis accorde nommément. Un retrait de colonne se fait par `REVOKE SELECT ON TABLE` puis
`GRANT SELECT (colonnes permises)` (A20 : un `REVOKE SELECT (colonne)` ne retire rien sur une table accordée en
entier), comme pour `code_hash` (correctif post-fusion de la 5a). Chaque retrait est prouvé par une liste exacte.

## Retraits à `cashless_app`

| Objet | Retrait | Raison |
|---|---|---|
| `vendor` | `INSERT`, `UPDATE` ; `SELECT` sauf colonnes permises (sans `pin_hash`, `failed_attempts`, `locked_at`) ; lecture du statut « bloqué » par la vue `vendor_public` | écritures et empreinte par fonctions seulement |
| `vendor_session`, `vendor_pin_check` | `INSERT`, `UPDATE` | ouvertes et fermées par la base |
| `catalog_*`, `point_of_sale_catalog_policy`, `device_catalog_served` | `INSERT`, `UPDATE` | versions créées par la base |
| `sale_line`, `sale_attribution` | `INSERT`, `UPDATE` | ajout seul, par fonctions |
| `payment_request`, `payment_request_detail` | `INSERT`, `UPDATE` ; `SELECT` sans `nonce_hash` | usage unique et expiration garantis par la base (renforcement) |
| `kyc_verification` | `INSERT`, `UPDATE` | aucun usage dans l'API ; identification en mission 10 (renforcement) |
| `device` | `UPDATE (event_id, pos_id, app_mode, nfc_enabled, personal_phone)` | aucun usage dans l'API ; contournement d'OP-N74 et de FR-015 (A12 ; part d'OP-N69, renforcement). Restent : `station_name`, `last_seen_at`, `last_snapshot_version`, `next_seq_floor` (mission 7, OP-N69) |

`DELETE` et `TRUNCATE` sont déjà retirés à `cashless_app` sur toutes les tables.

## Fonctions accordées à `cashless_app` (§4a, et liste figée de `tests_execute_grants.sql`)

- Vendeurs : `create_vendor`, `set_vendor_pin`, `set_vendor_status`, `begin_vendor_pin_check`, `open_vendor_session`,
  `close_vendor_session`, `assert_vendor_session`.
- Catalogue : fonctions d'écriture du catalogue, `record_device_catalog_served`.
- Paiement : `record_device_seq` (existante, schéma de référence ; accordée pour la première fois),
  `assert_tap_payable`, `assert_wallet_payable`, `check_sale_lines` (STABLE, arbitrage du 22/10), `record_sale_lines`, `record_sale_attribution`, `assert_reversible`,
  `consume_tap` (remplacée, A18).
- QR : `create_merchant_payment_request`, `lock_payment_request_for_pay`, `lock_customer_qr_token`,
  `confirm_payment_request`, `cancel_payment_request`, `create_customer_qr_token`,
  `payment_request_for_token(uuid, bytea)` (identifiant et empreinte du jeton ; relecture WP05 cycle 1).
- Terminaux : `set_device_status` (remplacée, A7 ; déjà accordée).

Signatures arrêtées à l'implémentation ; chaque fonction `SECURITY DEFINER` en `search_path = public, pg_temp`,
`REVOKE ALL … FROM PUBLIC` dans sa migration. **Test de borne (OP-N76)** : aucun autre rôle que `cashless_app`
n'exécute `begin_vendor_pin_check` ni `open_vendor_session`.

## Tests

- Liste exacte des colonnes lisibles et modifiables de chaque table nouvelle et de `payment_request`,
  `kyc_verification`, `device`.
- Sous `SET ROLE cashless_app` : `INSERT`/`UPDATE` directs refusés (`42501`), lecture de `pin_hash` et `nonce_hash`
  refusée, chemins légitimes verts.
- `tests_device_rights.sql` §1 : liste des colonnes de `device` modifiables mise à jour.
