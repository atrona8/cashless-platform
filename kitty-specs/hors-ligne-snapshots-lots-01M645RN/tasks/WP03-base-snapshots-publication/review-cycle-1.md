---
affected_files: []
cycle_number: 1
mission_slug: hors-ligne-snapshots-lots-01M645RN
reproduction_command:
reviewed_at: '2026-10-30T11:43:18Z'
reviewer_agent: claude
wp_id: WP03
---

# Relecture WP03 (commit 211becdb) : rejet, 3 constats bloquants

## B1 (bloquant, arbitrage de l'orchestrateur) : offline_snapshot_drafts_ready() rend content_key_wrapped
Dans 0044, `offline_snapshot_drafts_ready() RETURNS SETOF offline_snapshot_draft` (SELECT *) renvoie
`content_key_wrapped` au signataire, contre `interfaces.md` § 3 à jour.
Correction attendue : `RETURNS TABLE (id bigint, operator_id uuid, ledger_id uuid, kind text, base_version bigint,
version bigint, header jsonb, created_at timestamptz)`, colonnes énumérées dans le SELECT ; corriger le commentaire de
tête de section 6 ("La ligne porte content_key_wrapped") ; ajouter un test qui échoue si la colonne revient
(`pg_get_function_result(...) NOT LIKE '%content_key_wrapped%'`, et liste exacte des colonnes). Point à trancher et
consigner : `publish_offline_snapshot` rend `offline_snapshot` entier (donc `content_key_wrapped` + signature) au
signataire ; `interfaces.md` fige ce retour, donc soit on le garde (clé enveloppée KMS, signataire sans accès KMS : à
écrire au rapport), soit on demande au porteur de changer le retour.

## B2 (bloquant) : le lien pwd_pack_sha256 se contourne avec un null (offline_snapshot_item_ok)
Reproduit : entrée avec `pwd_pack_enc` = 68 hex valides et `entry.pwd_pack_sha256` = JSON null : `save_` ACCEPTE
(F3). Cause : en fin de `offline_snapshot_item_ok`, `v_en->>'pwd_pack_sha256' = encode(...)` vaut NULL, la fonction
rend NULL, et `WHERE NOT offline_snapshot_item_ok(x)` n'attrape pas NULL. Un mot de passe est donc stocké sans son
empreinte liée, ce que la règle annoncée interdit (sha != null si pwd_pack_enc présent).
Correction attendue : tout résultat NULL = refus (`RETURN coalesce(..., false)` / `IS DISTINCT FROM` ; et dans
`add_entries` tester `IS NOT TRUE`). Test : pwd_pack_enc non nul avec sha nul, sha faux, sha sans mot de passe,
mot de passe de 33 octets ; AUCUN test actuel ne passe un pwd_pack_enc non nul à `save_` (pg_temp.items met NULL),
donc la branche n'est pas prouvée. Ajouter aussi un cas de succès avec lien correct.

## B3 (bloquant) : publish_offline_snapshot ne contrôle pas réellement la forme de l'en-tête
Reproduit (C4) : en-tête du brouillon modifié par écriture directe (cashless_app a UPDATE sur la table jusqu'à WP08)
en retirant la clé `removed` et ajoutant `"extra":1` : `publish_` PUBLIE. Le test "quinze champs" ne compte que les clés,
et `v_gone <> (h->>'removed')::int` vaut NULL si la clé manque (idem `entries`), donc ne lève pas.
Correction attendue : comparer l'ensemble exact des 15 clés (comme `item_ok` pour les entrées), vérifier la présence
et le type de `entries`, `removed`, `generated_at`, `valid_until`, `content_sha256` avec `IS DISTINCT FROM`, et traiter
tout NULL comme un refus. Tests : clé manquante + clé en trop, `entries` absent, `removed` absent, type texte à la place
d'un nombre. Reprendre le même réflexe pour `seal_` et `add_entries` (comparaisons `<>` avec un NULL).

## Mineurs (non bloquants, à traiter ou consigner)
- M1 : un `entries`/`removed` hors entier (99999999999) lève 22003 au lieu de CL048, et laisse un brouillon OPEN
  bloquant jusqu'au `discard` (fermé, mais code inattendu). Borner à la validation de `save_` (CL048 BAD_PRODUCER_FIELDS).
- M2 : `offline_snapshot_add_entries`, `offline_snapshot_draft_locked`, `offline_snapshot_source_rows` sont DEFINER
  sans garde de prestataire/état propres (add_entries) : sûres tant qu'aucun GRANT ; WP08 ne doit jamais les accorder,
  et idéalement un test les verrouille à propriétaire seul.
- M3 : `cashless_app` hérite de SELECT/INSERT/UPDATE sur les 4 tables nouvelles (privilèges par défaut de roles.sql),
  y compris `offline_snapshot_entry.pwd_pack_enc` alors que `media.pwd_pack_enc` lui est fermé. Fermé par WP08
  (prompt l.183 ne cite que SELECT : WP08 doit retirer aussi INSERT/UPDATE sur draft/entry/state/media_log) ;
  à reporter comme dette nommée tant que WP08 n'est pas fusionné.
- M4 : le test sur `drafts_ready` ne vérifie que le nombre de lignes.

## Vérifié sans défaut (preuves relancées sur cashless_wp03 après reset-db)
tests_offline_snapshots.sql 96/96, tests_definer_search_path 14/14, tests_execute_grants 52/52.
Attaques : publish deux fois / OPEN / DISCARDED / clé EDGE : CL048 ; second save : CL048 ; append sur READY : CL048 ;
version plantée 2^62 : save refuse (chaîne rompue) ; version 2 plantée avec brouillon v2 prêt : publish refuse ;
entries/époque/key_id falsifiés : refus (CL048/CL015) ; deux publish concurrents sur deux connexions : le second attend le
verrou puis CL048 (PUBLISHED), une seule ligne d'audit ; session B sur grand livre/brouillon de A, pour les 10
fonctions : P0002 ; sans contexte de session : P0002 ; draft_content sans pwd_pack_enc.
