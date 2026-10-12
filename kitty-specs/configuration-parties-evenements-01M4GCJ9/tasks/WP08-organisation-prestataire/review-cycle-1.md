---
affected_files: []
cycle_number: 1
mission_slug: configuration-parties-evenements-01M4GCJ9
reproduction_command: spec-kitty agent tasks move-task WP08 --to approved --mission configuration-parties-evenements-01M4GCJ9
reviewed_at: '2026-10-12T11:25:00Z'
reviewer_agent: claude
wp_id: WP08
---

Approved by claude: Review passed. Checklist : 1 PASS (services appelés par TenantController ; module importé par AppModule), 2 PASS (18 tests d'intégration par HTTP), 3 PASS, 4 PASS (FR-005, FR-006, FR-007, FR-008, FR-014, FR-019, FR-020, NFR-001 : 404 pour le personnel d'un autre prestataire sur les 18 routes), 5 PASS, 6 PASS (prestataire toujours tiré du chemin ; operator_id d'un corps ignoré, testé), 7 : app.module.ts modifié (une ligne, prévu par le prompt), 8 PASS. Reste à faire, reporté au WP10 qui reprend cette route : le remplacement d'une redevance de plateforme par un PLATFORM_ADMIN (décrit par replaceFeeRule) n'est pas encore servi (403). Choix consignés : un ORGANIZER_ADMIN d'un autre organisateur du même prestataire reçoit 403 (pas 404) ; une clé du prestataire glissée dans la configuration d'un organisateur est refusée en 403.
