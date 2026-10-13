---
affected_files: []
cycle_number: 1
mission_slug: configuration-parties-evenements-01M4GCJ9
reproduction_command: spec-kitty agent tasks move-task WP11 --to approved --mission configuration-parties-evenements-01M4GCJ9
reviewed_at: '2026-10-12T12:20:17Z'
reviewer_agent: claude
wp_id: WP11
---

Approved by claude: Review passed. Checklist : 1 PASS, 2 PASS (11 tests d'intégration par HTTP : US5 scénarios 1 à 5, refus de l'API comparés aux refus de set_event_status pour RECONCILING et SETTLING, demande LIVE devenue caduque, isolation), 3 PASS, 4 PASS (FR-017, FR-018, FR-019, FR-020), 5 PASS, 6 PASS (C-001 : aucune écriture du statut hors set_event_status ; le seul UPDATE event du code met à jour des colonnes de réglage tirées du catalogue, dont status ne fait pas partie), 7 : fichiers hors périmètre touchés — events.module.ts (déclaration des fichiers de events/status, qui s'appuient sur EventsService), configuration/cascade.service.ts et organization/tenant/fee-rules.service.ts (date d'effet par défaut jamais antérieure à la précédente), suites cascade.spec et events.spec, 8 PASS. Choix consignés : la mise en service est demandée par un ORGANIZER_ADMIN seulement (R-09), les passages suivants par ORGANIZER_ADMIN ou OPERATOR_ADMIN ; les conditions externes (met = null) ne bloquent pas un passage.
