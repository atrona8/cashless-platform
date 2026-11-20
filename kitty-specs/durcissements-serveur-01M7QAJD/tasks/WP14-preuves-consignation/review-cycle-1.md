---
affected_files: []
cycle_number: 1
mission_slug: durcissements-serveur-01M7QAJD
reproduction_command:
reviewed_at: '2026-11-19T10:36:23Z'
reviewer_agent: claude
wp_id: WP14
---

# Relecture WP14 : à corriger (documents seulement, aucun code)

1. BLOQUANT. Dates « LEVÉ le 18/11/2026 » fausses. Approuvés le 19/11 : WP05, WP06, WP07, WP09, WP10, WP12, WP13 (journal d'états). Donc : OP-N60 (WP05), OP-N76 (WP06/WP07), OP-N116 (WP12), OP-N137 (WP10), OP-N140 (WP09/WP10), OP-N145 (WP09 pour l'API) sont levés le 19/11/2026, pas le 18. Seuls OP-N79 (WP01) et OP-N141 (WP11) sont du 18/11. Corriger : POINTS_OUVERTS.md (lignes tableau §1 et §6-§11, titre « Levées de la mission 11a (18 novembre 2026) », en-tête §11 « consignation du 18/11 »), DECISIONS_ADR.md (« Mise à jour du 18/11/2026 », ADR-216 à 222 « levée consignée le 18/11 »), PRD.md et PROMPTS-A-ENVOYER.md (« Levés le 18/11/2026 »). Les décisions du porteur du 18/11 restent datées du 18/11.
2. BLOQUANT (règle 3). Reports manquants : OP-N160 renvoie à la mission 11 (canSee) sans report dans PROMPTS ni PRD ; OP-N155, OP-N156, OP-N161, OP-N162 sans ligne « Report » ; OP-N155/N156 « à proposer au porteur » sans report. N153 reporte vers « 11a, clos » (aucune mission). Ajouter les reports ou dire explicitement « aucune mission, porteur ».
3. Décision du porteur du 19/11 sur la relance de Colima : absente de POINTS_OUVERTS, ADR-223, PRD, PROMPTS. À consigner (ADR-223 et §11 « Décisions du porteur »).
4. Mineur. ADR-217 ne contient pas la limite « renvoi de la clé d'idempotence après API tombée = 409 et essai compté » (demandé par a-consigner n°19) : seulement ADR-224/N158. Mineur : ADR-224 groupe N154 à N162 sans risque/raison/condition propres par limite (renvoi à la fiche) ; acceptable si les fiches sont complètes (N155, N156, N161, N162 sans « Condition de levée » nette).
5. Mineur. Aucun test de borne pour le déni de service App Attest (N152) : la fiche liste des tests de liste figée, pas de test de la limite elle-même ; le consigner dans « Tests de borne qui manquent ». `sqlstate-map.spec.ts` n'a pas de ligne CL057.
