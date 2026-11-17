---
affected_files: []
cycle_number: 2
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T10:33:23Z'
reviewer_agent: claude
wp_id: WP09
---

# Relecture WP09, cycle 2 : changements demandés

Cycle 1 : points 1, 2 (hors concurrence), 4, 5 corrigés et vérifiés ; 409 rejoué avec la même clé : 409 stable.

1. BLOQUANT : `source` (paramètre de requête) n'est pas contrôlée comme `external_ref`. `source=a%00b` donne
   `500 INTERNAL_ERROR` ; `a%01b` passe (201). Correction : dans `parseStatementHeader`, refuser les caractères
   de contrôle `[\u0000-\u001f\u007f]` en 400 ; test (NUL, saut de ligne, tabulation).
2. A CORRIGER : le contrôle 409 est un « lire puis agir » hors du verrou de la base. 6 imports simultanés du même
   fichier avec 6 `closing_balance` différents : 6 x 201, un seul solde retenu (60), les 5 autres corrections
   ignorées en silence (le cas du constat 2 de WP09 cycle 1 reste ouvert sous concurrence). Correction côté API :
   après `import_statement_lines`, relire `statement_import` par `import_id` et lever le 409 si source, date ou
   solde diffèrent des paramètres de la requête (la transaction est annulée) ; test avec imports parallèles.
Autres champs du CSV : `value_date`, `amount`, `currency` sont validés strictement (formes fermées) ; sans défaut.
