---
affected_files: []
cycle_number: 1
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T10:27:25Z'
reviewer_agent: claude
wp_id: WP09
---

# Relecture WP09, cycle 1 : changements demandés

Preuves relancées : jest reconciliation (SKIP_LATENCY) 29 verts, typecheck et Prettier verts. Les constats
viennent de sondes jetables (fichier retiré), base cashless_wp09r.

1. BLOQUANT : un `external_ref` contenant un octet NUL (`A\u0000B`) donne `500 INTERNAL_ERROR` (jsonb refuse
   U+0000). Entrée malveillante, et le rejeu avec la même clé donnera toujours 500. Correction : dans
   `parseStatementFile` (statements.dto.ts), refuser tout caractère de contrôle (`/[\u0000-\u001f\u007f]/`)
   dans `external_ref` par un `422` citant la ligne ; test dans import-statement.spec.ts.
2. BLOQUANT : même fichier réimporté avec un `closing_balance` ou une `statement_date` corrigés : `201`,
   `lines_created: 0`, l'ancien solde reste (`statement_import` inchangé), la correction est ignorée sans
   signal ; `source` différente idem. L'état de rapprochement (route 13) reste donc faux sans issue.
   Correction côté API, sans toucher à la base : calculer `file_sha256` sur le fichier ET les paramètres
   (source, statement_date, closing_balance), ou refuser par `409 CONFLICT_STATE` si l'empreinte existe avec
   d'autres paramètres. Documenter le choix ; test dédié.
3. MINEUR : deux lignes peuvent être rapprochées à la même anomalie (200 et 200) ; `explained_by_anomalies`
   additionne alors les deux montants. Relève de `match_statement_line` (WP02) : à consigner pour WP14, ou
   refuser une seconde ligne sur la même anomalie.
4. MINEUR : le commentaire d'en-tête de `statements.dto.ts` dit encore que la base ne compare pas le signe
   (obsolète depuis la décision 7) : le corriger.
5. MINEUR : le commentaire du test « signe et montant » dit que le test échoue tant que la correction n'est
   pas fusionnée : obsolète.

Vérifié sans défaut : 10 imports concurrents de la même ligne en rapprochement manuel (un 200, neuf 409) ; 20 imports
simultanés ; anomalie résolue refusée (422) ; autre prestataire/grand livre/compte (404/422) ; BOM, CRLF, formule,
guillemets ; erreurs sans contenu du fichier ; audit sans contenu ; PSP_RECONCILED ; signe et montant (maintenant vert).
