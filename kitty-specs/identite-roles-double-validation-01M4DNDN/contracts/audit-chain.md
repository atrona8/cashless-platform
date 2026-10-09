# Contrat — Journal d'audit chaîné et scellé

## Chaîne

- Une chaîne par prestataire (`chain_key` = `operator_id`) et une pour la plateforme
  (`chain_key` = `00000000-0000-0000-0000-000000000000`).
- Genèse : `SHA-256("CASHLESS/AUDIT/v1" ‖ chain_key)` (`chain_key` sur 16 octets bruts).
- Ligne canonique (UTF-8, champs séparés par `|`, champ NULL omis avec son séparateur, comme `concat_ws`) :
  `chain_key | seq | occurred_at | actor_id | actor_role | action | object_type | object_id | before | after |
  approver_id | origin | request_id` ; `occurred_at` en UTC `AAAA-MM-JJTHH:MI:SS.ffffff` ; `before`/`after` en
  texte JSON canonique de PostgreSQL (`jsonb::text`).
- `row_hash = SHA-256(prev_hash ‖ ligne canonique)` ; `prev_hash` = `row_hash` de `seq - 1` (genèse pour `seq` 1).
- Écriture : déclencheur BEFORE INSERT, sous `pg_advisory_xact_lock(hashtextextended('audit-chain:' || chain_key, 0))`.

## Scellement

- `seal_audit(chain_key)` : plage = dernière ligne scellée + 1 → dernière ligne dont `occurred_at` a plus de 5 min ;
  rien sans nouvelle ligne.
- `rows_sha256` = SHA-256 de la concaténation des `row_hash` de la plage, dans l'ordre de `seq`.
- `seal_hash = SHA-256(prev_seal_hash ‖ chain_key ‖ first_seq ‖ last_seq ‖ rows_sha256)` (bornes sur 8 octets
  gros-boutistes) ; premier scellement : `prev_seal_hash` = genèse de la chaîne.
- `external_ref` : renseignée une seule fois par la tâche de copie (mission 9).

## Vérification

`verify_audit_chain(chain_key, since timestamptz)` rend une ligne par anomalie : `seq` manquant, `row_hash`
recalculé ≠ stocké, `prev_hash` ≠ précédent, `rows_sha256` ou `seal_hash` d'un scellement ≠ recalcul, ligne
présente après une plage scellée mais avec `occurred_at` antérieur. Aucune ligne = chaîne intègre.

## Droits

`cashless_app` : `INSERT`, `SELECT` sur `audit_log` (sous RLS) ; rien sur `audit_seal` hors `SELECT` ; aucun
`EXECUTE` sur `seal_audit`, `verify_audit_chain`. La tâche de scellement (mission 9) utilise un rôle d'exploitation.
